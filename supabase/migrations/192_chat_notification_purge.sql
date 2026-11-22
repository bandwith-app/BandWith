-- ============================================================================
-- 192 · Deleted messages take their notification previews with them
--       (audit 07 #4, release 383f15b)
-- ----------------------------------------------------------------------------
-- "Delete chat" (bw_delete_chat_history, 067/175) removed the messages, but
-- every recipient's chat notification kept a copy of the text: the whole
-- message in body and data.content when it was short, its first 120
-- characters otherwise. The deleted DM stayed on the server.
--
-- Now:
--   * whenever messages are deleted (Delete chat, a deleted chat, any other
--     path), the chat_message / chat_mention notifications that announced
--     them are deleted in the same statement (trigger on messages, security
--     definer: the sender cannot otherwise touch the recipient's rows);
--   * the link is data.message_id, which send-push writes from #284 on (it
--     also fills it for older app builds, by matching their preview). Rows
--     written before that have no message_id: they are matched on chat,
--     preview text and time (written within an hour after the message);
--   * notification previews of messages already deleted today are removed;
--     an older notice (no message_id) stays only if it matches a live
--     message in its chat as that message reads now (an edited message's
--     old notice goes: losing an old notice is harmless, showing text the
--     chat no longer has is not);
--   * a chat left with no live message (a deleted DM, a deleted chat)
--     loses every chat notice, whatever its text;
--   * (round 4) every delete applies the backfill rule to its chat: an
--     older notice matching no live message as it reads now goes (an
--     edited-then-deleted message kept its first text). Accepted cost: an
--     older unread notice of a message edited since loses its badge once.
--
-- Round 2 (Codex + Claude review #291):
--   * a message marked deleted (messages.deleted = true, deleteMessage in
--     chats.ts) takes its notices too, not only a real DELETE;
--   * (a chat notice for a message deleted before it is written: send-push
--     writes notices through 194's bw_write_chat_notices, which rechecks
--     the message and holds it FOR SHARE until the notices are in, so a
--     delete either comes first or its purge here sees them);
--   * the preview is cut like the app's JS substring: 120 UTF-16 units, not
--     120 characters (an emoji is 2 units), so long messages with emoji are
--     matched and the backfill keeps their valid notices;
--   * an older notice (no message_id) belongs to one message only: the newest
--     with that preview sent at or before it, else (clock skew) the oldest
--     sent within the minute after it. Deleting either of two "OK"s, even
--     seconds apart, takes only its own notice.
--
-- Round 4: messages.client_id (nullable) + unique (sender_id, client_id):
-- Try again after a timeout never saves a second copy.
--
-- CR6 (Claude #291 M6): an edited message's notices take its new preview
-- (older ones that match nothing go); purge and edit lock the chat first,
-- chats in id order.
--
-- Older app builds: nothing they call changes. Idempotent; one transaction.
-- Needs 175 first (round 7, Codex #291 B3: an edit rewrites a notice only
-- for someone who can still read the chat, 175's bw_chat_scope_ok_for):
-- without it this file stops at once, naming 175. Redefines nothing from
-- 175/181.
-- Round 8 (Claude review, finding 3): needs 194 (round 8) first too, and
-- redefines its bw_write_chat_notices(uuid, jsonb) -> TABLE (id uuid,
-- user_id uuid, preview text, content text): 194's body plus a check, at
-- write time, that each recipient can still read the chat (a row in it and
-- 175's bw_chat_scope_ok_for). Someone removed after send-push picked the
-- recipients gets no notice and no push, whichever send-push is deployed.
-- The added lines end in "-- 192: may still read"; without them the
-- function is 194's, byte for byte (chat_audit checks it). An edited
-- message's notices read "New message" in each reader's language when it
-- is empty (194's bw_chat_preview_in).
-- ============================================================================

BEGIN;

-- ── 175 first ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.bw_chat_scope_ok_for(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION '192 needs 175 (175_security_audit_access.sql, #281) applied first: missing public.bw_chat_scope_ok_for(uuid, uuid)';
  END IF;
END
$$;

-- ── 194 first (round 8) ─────────────────────────────────────────────────────
-- 192 redefines 194's bw_write_chat_notices (below): its round-8 shape
-- (id, user_id, preview, content) must be there.
DO $$
BEGIN
  IF to_regprocedure('public.bw_write_chat_notices(uuid, jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc
                     WHERE oid = to_regprocedure('public.bw_write_chat_notices(uuid, jsonb)')
                       AND 'preview' = ANY (proargnames)) THEN
    RAISE EXCEPTION '192 needs 194 (194_chat_notifications_server_only.sql, #284, round 8) applied first: missing public.bw_write_chat_notices(uuid, jsonb) returning preview';
  END IF;
END
$$;

-- One copy per bubble (round 4, Claude review): a send that timed out
-- after its insert landed, then Try again, saved the message twice. Apps
-- from this release send a client id per bubble and insert with
-- ON CONFLICT (sender_id, client_id) DO NOTHING. Nullable, and NULLs never
-- collide: older builds (no client id) and every existing row are untouched.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS client_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_client_once
  ON public.messages (sender_id, client_id);

-- Lookups by message and by chat for chat notifications only.
CREATE INDEX IF NOT EXISTS idx_notifications_chat_message_id
  ON public.notifications ((data ->> 'message_id'))
  WHERE type IN ('chat_message', 'chat_mention');
CREATE INDEX IF NOT EXISTS idx_notifications_chat_chat_id
  ON public.notifications ((coalesce(data ->> 'chat_id', data ->> 'chatId')), created_at)
  WHERE type IN ('chat_message', 'chat_mention');

-- JS `s.substring(0, n)`: n UTF-16 code units (characters above U+FFFF take
-- two). A cut through such a character drops it (Postgres text can't hold
-- half of it).
CREATE OR REPLACE FUNCTION public.bw_js_left(p_text text, p_units integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE STRICT
SET search_path TO 'public'
AS $$
DECLARE
  v_units integer := 0;
  v_i integer := 0;
  v_len integer;
BEGIN
  -- Each UTF-16 unit is at least one UTF-8 byte: short texts fit whole.
  IF octet_length(p_text) <= p_units THEN
    RETURN p_text;
  END IF;
  v_len := char_length(p_text);
  WHILE v_i < v_len LOOP
    v_units := v_units + CASE WHEN ascii(substr(p_text, v_i + 1, 1)) > 65535 THEN 2 ELSE 1 END;
    EXIT WHEN v_units > p_units;
    v_i := v_i + 1;
  END LOOP;
  RETURN left(p_text, v_i);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_js_left(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_js_left(text, integer) TO authenticated, service_role;

-- The preview the app and send-push store for a message (chat-push.ts chatPreview).
CREATE OR REPLACE FUNCTION public.bw_chat_preview(p_content text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(nullif(public.bw_js_left(coalesce(p_content, ''), 120), ''), 'New message');
$$;
REVOKE ALL ON FUNCTION public.bw_chat_preview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_preview(text) TO authenticated, service_role;

-- Whether an older notice (no message_id) shows this message's text.
CREATE OR REPLACE FUNCTION public.bw_chat_notice_shows(p_body text, p_data jsonb, p_content text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT p_body = public.bw_chat_preview(p_content)
      OR p_data ->> 'content' = public.bw_js_left(coalesce(p_content, ''), 120);
$$;
REVOKE ALL ON FUNCTION public.bw_chat_notice_shows(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_notice_shows(text, jsonb, text) TO authenticated, service_role;

-- Whether message a (sent at p_a) owns an older notice (written at p_n)
-- rather than message b: the newest sent at or before the notice, else the
-- oldest sent after it (clock skew); ties by id.
CREATE OR REPLACE FUNCTION public.bw_chat_notice_closer(p_n timestamptz, p_a timestamptz, p_a_id uuid, p_b timestamptz, p_b_id uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_a <= p_n THEN p_b > p_n OR p_a > p_b OR (p_a = p_b AND p_a_id > p_b_id)
    ELSE p_b > p_n AND (p_a < p_b OR (p_a = p_b AND p_a_id < p_b_id))
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_chat_notice_closer(timestamptz, timestamptz, uuid, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_notice_closer(timestamptz, timestamptz, uuid, timestamptz, uuid) TO authenticated, service_role;

-- Deletes the chat notices of these messages (gone, or marked deleted):
-- [{id, chat_id, content, created_at}]. messages.deleted is read through
-- to_jsonb so this works with or without that column.
CREATE OR REPLACE FUNCTION public.bw_purge_chat_notices(p_gone jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_chat uuid;
BEGIN
  IF p_gone IS NULL OR jsonb_array_length(p_gone) = 0 THEN
    RETURN;
  END IF;

  -- Lock order (Claude #291 CR6 M6): this purge and the edit rewrite below
  -- take a lock per chat, chats in id order, before touching a notice, so
  -- the two never wait on each other's notices.
  FOR v_chat IN
    SELECT DISTINCT g.chat_id FROM jsonb_to_recordset(p_gone) AS g(chat_id uuid)
     WHERE g.chat_id IS NOT NULL ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('bw_chat_notices:' || v_chat::text, 0));
  END LOOP;

  -- Notifications that name the message.
  DELETE FROM notifications n
   USING jsonb_to_recordset(p_gone) AS g(id uuid, chat_id uuid, content text, created_at timestamptz)
   WHERE n.type IN ('chat_message', 'chat_mention')
     AND n.data ->> 'message_id' = g.id::text;

  -- Older rows without message_id: same chat, same preview, around the same
  -- time, and no live message with that preview owns the row instead
  -- (bw_chat_notice_closer). Other messages deleted in the same statement
  -- don't matter: their own pass deletes what they own.
  DELETE FROM notifications n
   USING jsonb_to_recordset(p_gone) AS g(id uuid, chat_id uuid, content text, created_at timestamptz)
   WHERE n.type IN ('chat_message', 'chat_mention')
     AND n.data ->> 'message_id' IS NULL
     AND coalesce(n.data ->> 'chat_id', n.data ->> 'chatId') = g.chat_id::text
     AND n.created_at >= g.created_at - interval '1 minute'
     AND n.created_at < g.created_at + interval '1 hour'
     AND public.bw_chat_notice_shows(n.body, n.data, g.content)
     AND NOT EXISTS (
       SELECT 1 FROM messages m2
        WHERE m2.chat_id = g.chat_id
          AND m2.id <> g.id
          AND m2.created_at <= n.created_at + interval '1 minute'
          AND m2.created_at > n.created_at - interval '1 hour'
          AND NOT coalesce((to_jsonb(m2) ->> 'deleted')::boolean, false)
          AND public.bw_chat_notice_shows(n.body, n.data, m2.content)
          AND public.bw_chat_notice_closer(n.created_at, m2.created_at, m2.id, g.created_at, g.id)
     );

  -- Round 4: the backfill rule on every delete. In these chats an older
  -- notice (no message_id) that matches no live message as it reads now
  -- goes: a message edited after this migration and then deleted no longer
  -- matches its first text above, and kept it.
  DELETE FROM notifications n
   USING (SELECT DISTINCT g.chat_id FROM jsonb_to_recordset(p_gone) AS g(chat_id uuid)) AS e
   WHERE n.type IN ('chat_message', 'chat_mention')
     AND n.data ->> 'message_id' IS NULL
     AND coalesce(n.data ->> 'chat_id', n.data ->> 'chatId') = e.chat_id::text
     AND NOT EXISTS (
       SELECT 1 FROM messages m
        WHERE m.chat_id = e.chat_id
          AND m.created_at <= n.created_at + interval '1 minute'
          AND m.created_at > n.created_at - interval '1 hour'
          AND NOT coalesce((to_jsonb(m) ->> 'deleted')::boolean, false)
          AND public.bw_chat_notice_shows(n.body, n.data, m.content)
     );

  -- A chat left with no live message (a deleted DM: every message, for both
  -- people; a deleted chat): every chat notice for it goes, whatever its
  -- text (round 3: one edited since, or in another preview format, matched
  -- nothing above and kept the deleted text).
  DELETE FROM notifications n
   USING (SELECT DISTINCT g.chat_id FROM jsonb_to_recordset(p_gone) AS g(chat_id uuid)) AS e
   WHERE n.type IN ('chat_message', 'chat_mention')
     AND coalesce(n.data ->> 'chat_id', n.data ->> 'chatId') = e.chat_id::text
     AND NOT EXISTS (
       SELECT 1 FROM messages m
        WHERE m.chat_id = e.chat_id
          AND NOT coalesce((to_jsonb(m) ->> 'deleted')::boolean, false)
     );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_purge_chat_notices(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_trg_messages_purge_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.bw_purge_chat_notices(
    (SELECT jsonb_agg(jsonb_build_object('id', g.id, 'chat_id', g.chat_id, 'content', g.content, 'created_at', g.created_at)) FROM gone g));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_messages_purge_notifications() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_messages_purge_notifications ON public.messages;
CREATE TRIGGER bw_messages_purge_notifications
  AFTER DELETE ON public.messages
  REFERENCING OLD TABLE AS gone
  FOR EACH STATEMENT EXECUTE FUNCTION public.bw_trg_messages_purge_notifications();

-- Marked deleted (deleted = true): the same purge.
CREATE OR REPLACE FUNCTION public.bw_trg_messages_soft_delete_purge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.bw_purge_chat_notices(jsonb_build_array(
    jsonb_build_object('id', OLD.id, 'chat_id', OLD.chat_id, 'content', OLD.content, 'created_at', OLD.created_at)));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_messages_soft_delete_purge() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.messages'::regclass
                AND attname = 'deleted' AND NOT attisdropped) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS bw_messages_soft_delete_purge ON public.messages';
    EXECUTE 'CREATE TRIGGER bw_messages_soft_delete_purge
               AFTER UPDATE OF deleted ON public.messages
               FOR EACH ROW
               WHEN (NEW.deleted IS TRUE AND OLD.deleted IS DISTINCT FROM TRUE)
               EXECUTE FUNCTION public.bw_trg_messages_soft_delete_purge()';
  END IF;
END;
$$;

-- Edited (Claude #291 CR6 M6, privacy): a message's notices showed its
-- first text after an edit. Its notices (data.message_id) now read its new
-- preview in body and data.content, as send-push writes them; older notices
-- (no message_id) in its chat that match no live message as it reads now go,
-- the backfill rule above. Same per-chat lock as the purge first (one chat
-- per edited row), so an edit and a delete in that chat take turns.
-- Lock order: one chat per row here. A statement that edits the text of
-- messages in several chats takes these locks row by row; such a writer
-- (none in the app: it edits one message) must touch the chats in sorted
-- id order, as the purge does, or two of them can deadlock (Claude NIT).
-- Round 7 (Codex #291 B3): only someone who can still read the chat (a row
-- in it and 175's bw_chat_scope_ok_for) gets the new text; anyone else's
-- notice of this message goes (a former member never sees the new text).
CREATE OR REPLACE FUNCTION public.bw_trg_messages_edit_notices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.chat_id IS NULL OR coalesce((to_jsonb(NEW) ->> 'deleted')::boolean, false) THEN
    RETURN NULL; -- marked deleted: the soft-delete purge takes its notices
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bw_chat_notices:' || NEW.chat_id::text, 0));

  DELETE FROM notifications n
   WHERE n.type IN ('chat_message', 'chat_mention')
     AND n.data ->> 'message_id' = NEW.id::text
     AND NOT (EXISTS (SELECT 1 FROM chat_participants cp
                       WHERE cp.chat_id = NEW.chat_id AND cp.user_id = n.user_id)
              AND coalesce(public.bw_chat_scope_ok_for(NEW.chat_id, n.user_id), false));

  UPDATE notifications n
     SET body = public.bw_chat_preview_in(NEW.content, (SELECT p.preferred_language FROM profiles p WHERE p.id = n.user_id)),
         data = CASE WHEN n.data ? 'content'
                     THEN jsonb_set(n.data, '{content}', to_jsonb(public.bw_chat_preview_in(NEW.content, (SELECT p.preferred_language FROM profiles p WHERE p.id = n.user_id))))
                     ELSE n.data END
   WHERE n.type IN ('chat_message', 'chat_mention')
     AND n.data ->> 'message_id' = NEW.id::text;

  DELETE FROM notifications n
   WHERE n.type IN ('chat_message', 'chat_mention')
     AND n.data ->> 'message_id' IS NULL
     AND coalesce(n.data ->> 'chat_id', n.data ->> 'chatId') = NEW.chat_id::text
     AND NOT EXISTS (
       SELECT 1 FROM messages m
        WHERE m.chat_id = NEW.chat_id
          AND m.created_at <= n.created_at + interval '1 minute'
          AND m.created_at > n.created_at - interval '1 hour'
          AND NOT coalesce((to_jsonb(m) ->> 'deleted')::boolean, false)
          AND public.bw_chat_notice_shows(n.body, n.data, m.content)
     );
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_messages_edit_notices() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_messages_edit_notices ON public.messages;
CREATE TRIGGER bw_messages_edit_notices
  AFTER UPDATE OF content ON public.messages
  FOR EACH ROW
  WHEN (NEW.content IS DISTINCT FROM OLD.content)
  EXECUTE FUNCTION public.bw_trg_messages_edit_notices();

-- Writes a message's chat notices (194's function, round 8, Claude review
-- finding 3): only for recipients who can still read the chat at write time.
-- 194's body with the "-- 192: may still read" lines added; keep the two in
-- step (chat_audit compares them). #278's redefined_functions.sql lists the
-- pair 194 -> 192.
CREATE OR REPLACE FUNCTION public.bw_write_chat_notices(p_message_id uuid, p_rows jsonb)
RETURNS TABLE (id uuid, user_id uuid, preview text, content text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_content text;
  v_chat uuid;
BEGIN
  -- The message must still be there, and not marked deleted (read through
  -- to_jsonb: works with or without messages.deleted).
  SELECT m.content, m.chat_id INTO v_content, v_chat FROM messages m
   WHERE m.id = p_message_id
     AND NOT coalesce((to_jsonb(m) ->> 'deleted')::boolean, false)
     FOR SHARE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO notifications AS n (user_id, type, title, body, data, read, band_id, action_url)
  SELECT r.user_id, r.type, r.title, w.preview,
         coalesce(r.data, '{}'::jsonb)
           || jsonb_build_object('message_id', p_message_id::text, 'content', w.preview),
         false, r.band_id, r.action_url
    FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
         AS r(user_id uuid, type text, title text, body text, data jsonb, band_id uuid, action_url text)
         CROSS JOIN LATERAL (
           SELECT public.bw_chat_preview_in(v_content, (SELECT p.preferred_language FROM profiles p WHERE p.id = r.user_id)) AS preview
         ) w
   WHERE r.user_id IS NOT NULL AND r.type IN ('chat_message', 'chat_mention')
     AND EXISTS (SELECT 1 FROM chat_participants cp WHERE cp.chat_id = v_chat AND cp.user_id = r.user_id) -- 192: may still read
     AND coalesce(public.bw_chat_scope_ok_for(v_chat, r.user_id), false) -- 192: may still read
   -- One lock order for overlapping calls (no deadlock on the index).
   ORDER BY r.user_id
  ON CONFLICT (user_id, ((data->>'message_id')))
    WHERE type IN ('chat_message', 'chat_mention') AND data ? 'message_id'
    DO NOTHING;

  RETURN QUERY
  UPDATE notifications n
     SET data = n.data || jsonb_build_object('push_claimed_at', now())
   WHERE n.id IN (
           -- Locked in user order too.
           SELECT n2.id FROM notifications n2
            WHERE n2.type IN ('chat_message', 'chat_mention')
              AND n2.data ? 'message_id'
              AND n2.data ->> 'message_id' = p_message_id::text
              AND n2.user_id IN (SELECT (e ->> 'user_id')::uuid FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e)
              AND EXISTS (SELECT 1 FROM chat_participants cp WHERE cp.chat_id = v_chat AND cp.user_id = n2.user_id) -- 192: may still read
              AND coalesce(public.bw_chat_scope_ok_for(v_chat, n2.user_id), false) -- 192: may still read
            ORDER BY n2.user_id
              FOR UPDATE)
     AND NOT n.data ? 'pushed_at'
     -- Missing or malformed claim = unclaimed.
     -- 7 min: longer than any send-push call (wall clock 150 s / 400 s), and
     -- a lapsed claim is retried well inside the 20-minute push window
     -- (send-push CHAT_PUSH_WINDOW_MS; Claude #284 r5). A claim more than a
     -- minute in the future is bogus (hand-edited data, clock jump): unclaimed.
     AND public.bw_chat_push_claim_free(public.bw_try_timestamptz(n.data ->> 'push_claimed_at'))
  RETURNING n.id, n.user_id,
            public.bw_chat_preview_in(v_content, (SELECT p.preferred_language FROM profiles p WHERE p.id = n.user_id)),
            v_content;
END;
$function$;
REVOKE ALL ON FUNCTION public.bw_write_chat_notices(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_write_chat_notices(uuid, jsonb) TO service_role;

-- Round 2 wrote this guard as a trigger here; 194's bw_write_chat_notices
-- does it now.
DROP TRIGGER IF EXISTS bw_notifications_chat_message_live ON public.notifications;
DROP FUNCTION IF EXISTS public.bw_trg_notifications_chat_message_live();

-- Previews of messages deleted (or marked deleted) before this migration.
DELETE FROM public.notifications n
 WHERE n.type IN ('chat_message', 'chat_mention')
   AND n.data ->> 'message_id' IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.id::text = n.data ->> 'message_id'
                     AND NOT coalesce((to_jsonb(m) ->> 'deleted')::boolean, false));

DELETE FROM public.notifications n
 WHERE n.type IN ('chat_message', 'chat_mention')
   AND n.data ->> 'message_id' IS NULL
   AND coalesce(n.data ->> 'chat_id', n.data ->> 'chatId') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.messages m
      WHERE m.chat_id::text = coalesce(n.data ->> 'chat_id', n.data ->> 'chatId')
        AND m.created_at <= n.created_at + interval '1 minute'
        AND m.created_at > n.created_at - interval '1 hour'
        AND NOT coalesce((to_jsonb(m) ->> 'deleted')::boolean, false)
        -- Only an exact match of a live message as it reads now keeps it
        -- (round 3, main's rule: losing an old notice is harmless, showing
        -- deleted or replaced text is not; an edited message's old notice goes).
        AND public.bw_chat_notice_shows(n.body, n.data, m.content)
   );

COMMIT;
