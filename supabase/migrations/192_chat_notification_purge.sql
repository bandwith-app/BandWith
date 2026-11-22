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
--   * notification previews of messages already deleted today are removed
--     (only where the message is gone or marked deleted: an older notice
--     next to an edited message in that chat is kept).
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
-- Older app builds: nothing they call changes. Idempotent; one transaction.
-- Independent of 175/181 (uses no function they redefine).
-- ============================================================================

BEGIN;

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
BEGIN
  IF p_gone IS NULL OR jsonb_array_length(p_gone) = 0 THEN
    RETURN;
  END IF;

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
        -- Same text, or edited since (no longer matches, but it isn't gone:
        -- only notices of gone or deleted messages are purged).
        AND (public.bw_chat_notice_shows(n.body, n.data, m.content)
             OR coalesce((to_jsonb(m) ->> 'edited')::boolean, false)
             OR to_jsonb(m) ->> 'edited_at' IS NOT NULL)
   );

COMMIT;
