-- ============================================================================
-- 194 · Chat notifications come from the server only (Codex review #284)
-- ----------------------------------------------------------------------------
-- send-push now checks that a chat push announces the caller's own message,
-- and writes sender and text from the database. But a participant could still
-- INSERT a chat_message / chat_mention row for someone else directly
-- (notifications_insert → bw_can_notify), and the push trigger dispatched it
-- with the dispatch secret, skipping that check: a forged sender and text in
-- the recipient's inbox and on their lock screen.
--
-- The app never writes chat notifications itself: send-push writes them, as
-- service role (no RLS), for every build in the field (checked back to
-- android-v1.0.1). So bw_can_notify now refuses chat types for anyone but
-- the actor; everything else is as in 073.
--
-- Round 2 (Claude review #284): one chat notice per recipient per message.
-- Calling send-push again with a real message id rang everyone again and
-- added inbox rows. send-push now skips recipients who already have that
-- message's notice; this unique index is the backstop when two calls race
-- (send-push answers 23505 with "already announced" and rings nobody).
-- Only rows with data.message_id count: send-push writes it since #284,
-- nothing wrote it before, so existing rows can't collide.
--
-- Round 3 (Codex review #284): send-push writes chat notices through
-- bw_write_chat_notices (service role only), which
--   * rechecks the message inside the insert: gone or marked deleted (a
--     delete after send-push verified it) → nothing written, nothing pushed.
--     The message row is held FOR SHARE until the notices are in, so a
--     delete either comes first or after them (its purge, 192, sees them);
--   * inserts per recipient with ON CONFLICT DO NOTHING: two overlapping
--     calls ([Alice, Bob] and [Bob, Carol]) no longer roll each other back.
--     Rows are inserted and claimed in user order, so overlapping calls lock
--     them in one order (no 40P01); send-push retries a deadlock anyway;
--   * returns the recipients to push now: their notice is new or was never
--     pushed, and nobody else is pushing it (data.push_claimed_at, a claim
--     that lapses after 7 minutes, 10 before round 5: longer than any send-push call).
--     send-push marks them pushed afterwards
--     (bw_mark_chat_notices_pushed, data.pushed_at) once a device took it
--     or there was nothing to deliver to. A malformed claim (data is
--     writable by the recipient) counts as none. So a push lost after
--     the insert (failed token lookup, crash) is retried, and "already
--     announced" means already pushed, not only written.
--
-- Round 4 (Codex review #284): duplicates from before the index are
-- removed first (the oldest per recipient and message stays); a claim
-- whose push could not be attempted is released
-- (bw_release_chat_notice_claims), so a retry delivers at once.
--
-- Round 5 (Codex review #284): a push-only call (create_in_app false, no
-- inbox row) is recorded too, per message and recipient
-- (chat_push_only_log, service role only): a retry after a lost reply never
-- rings twice. Same claim rule as the notices (7 minutes, released when
-- every device failed for now or the push could not be attempted).
--
-- Round 7 (Codex #284 B4): a notice's body and data.content are the preview
-- of the message as stored, read under its FOR SHARE lock (bw_chat_preview,
-- the same function 192 defines), not the text send-push passed in.
--
-- Round 8 (Claude #284/#291 review): bw_write_chat_notices also returns,
-- per recipient, the preview it wrote and the message as it read it under
-- the lock (columns added, none renamed: older send-push builds read id and
-- user_id as before), so the push says what the inbox says. An empty
-- message reads "New message" in the recipient's language
-- (bw_chat_preview_in; bw_chat_preview is unchanged).
--
-- Deploy order: apply 194 before deploying send-push (send-push falls back
-- to a plain insert while the function is missing).
--
-- Older builds: nothing they do changes. Idempotent, also after 192: 192
-- redefines bw_write_chat_notices and bw_claim_chat_push_only with its read
-- check (lines ending "-- 192: may still read"); with that check live, 194
-- run again leaves those two functions as they are (NOTICE) instead of
-- putting its own bodies back (round 9, Claude delta review MINOR-1).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_can_notify(p_recipient uuid, p_band_id uuid, p_type text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR p_recipient IS NULL THEN
    RETURN false;
  END IF;
  IF p_recipient = actor THEN
    RETURN true;
  END IF;

  -- Chat notices for others are written by send-push after it verified the
  -- message (194): never by the app.
  IF p_type IN ('chat_message', 'chat_mention') THEN
    RETURN false;
  END IF;

  IF p_band_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (public.bw_is_band_member(p_band_id, actor) AND public.bw_is_band_member(p_band_id, p_recipient)) THEN
    RETURN false;
  END IF;

  -- Admins run the band: lineup invites, polls, reminders, updates.
  IF public.bw_is_band_admin(p_band_id, actor) THEN
    RETURN true;
  END IF;

  -- Members to anyone in the band.
  IF p_type IN ('song_added') THEN
    RETURN true;
  END IF;

  -- Members to the band's admins: RSVP answers, conflicts, proposals.
  IF p_type IN ('event_confirmed', 'member_dropped_out', 'event_update', 'rehearsal_proposal') THEN
    RETURN public.bw_is_band_admin(p_band_id, p_recipient);
  END IF;

  RETURN false;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bw_can_notify(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_can_notify(uuid, uuid, text) TO authenticated;

-- Duplicates from before the index (send-push deployed ahead of 194) would
-- stop it: the oldest per recipient and message stays (round 4; prod has
-- none today).
DELETE FROM public.notifications n
 USING public.notifications o
 WHERE n.type IN ('chat_message', 'chat_mention') AND n.data ? 'message_id'
   AND o.type IN ('chat_message', 'chat_mention') AND o.data ? 'message_id'
   AND o.user_id = n.user_id
   AND o.data ->> 'message_id' = n.data ->> 'message_id'
   AND (o.created_at < n.created_at OR (o.created_at = n.created_at AND o.id < n.id));

-- One notice per recipient per chat message (also serves send-push's lookup).
CREATE UNIQUE INDEX IF NOT EXISTS notifications_chat_message_once
  ON public.notifications (user_id, ((data->>'message_id')))
  WHERE type IN ('chat_message', 'chat_mention') AND data ? 'message_id';

-- A timestamp from notification data, or NULL when it isn't one (the
-- recipient can write their own notifications' data: a bad value must
-- never abort a batch).
CREATE OR REPLACE FUNCTION public.bw_try_timestamptz(p_value text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_value IS NULL OR p_value !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' THEN
    RETURN NULL;
  END IF;
  RETURN p_value::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.bw_try_timestamptz(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_try_timestamptz(text) TO authenticated, service_role;

-- Is a push claim free to take? Missing or malformed: yes. Older than
-- 7 minutes (lapsed): yes. More than a minute ahead of now(): yes, it is
-- bogus (a minute of slack: another call's claim, committed after this
-- transaction began, is a little ahead of now() and still holds).
-- Claude #284 r5; the same rule as send-push's noticeSettled (PUSH_CLAIM_MS).
CREATE OR REPLACE FUNCTION public.bw_chat_push_claim_free(p_claimed timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT p_claimed IS NULL
      OR p_claimed < now() - interval '7 minutes'
      OR p_claimed > now() + interval '1 minute';
$function$;
REVOKE ALL ON FUNCTION public.bw_chat_push_claim_free(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_chat_push_claim_free(timestamptz) TO service_role;

-- The preview of a message, as send-push's chatPreview cuts it (B4, Codex
-- #284 r7): bw_write_chat_notices builds it from the message as stored.
-- Byte-identical to 192's copy (#291 applies after this one and keeps it;
-- a test there compares the two).
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

-- The preview one reader sees (round 8, Claude NIT): an empty message says
-- "New message" in their profiles.preferred_language (it, es, fr, de, pt;
-- 089's rule), English otherwise. Anything else is bw_chat_preview's text.
-- Same words as chat-push.ts NEW_MESSAGE.
CREATE OR REPLACE FUNCTION public.bw_chat_preview_in(p_content text, p_lang text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN nullif(public.bw_js_left(coalesce(p_content, ''), 120), '') IS NULL
      THEN coalesce('{"it":"Nuovo messaggio","es":"Nuevo mensaje","fr":"Nouveau message","de":"Neue Nachricht","pt":"Nova mensagem"}'::jsonb
                      ->> lower(left(btrim(coalesce(p_lang, '')), 2)), 'New message')
    ELSE public.bw_chat_preview(p_content)
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_chat_preview_in(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_preview_in(text, text) TO authenticated, service_role;

-- Writes the chat notices of one message and claims those to push now.
-- p_rows: [{user_id, type, title, body, data, band_id, action_url}].
-- body and data.content are the preview of the message as it reads now,
-- under its FOR SHARE lock, never p_rows' text (Codex #284 r7 B4: an edit
-- between send-push's check and this insert left the old text). An edit
-- after it waits for this transaction; 192 then rewrites the notices.
-- Returns, per recipient to push now: the notice, the preview in their
-- language and the message's content as read under the lock (round 8:
-- send-push pushes that text and finds the @mentions in it, not in its own
-- earlier read). 192 redefines this function (who may still read the chat);
-- keep the two in step.
-- The result gained columns in round 8: CREATE OR REPLACE can't change it,
-- so an older shape is dropped first (only then; GRANTs are set below).
DO $$
BEGIN
  IF to_regprocedure('public.bw_write_chat_notices(uuid, jsonb)') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_proc
                      WHERE oid = to_regprocedure('public.bw_write_chat_notices(uuid, jsonb)')
                        AND 'preview' = ANY (proargnames)) THEN
    DROP FUNCTION public.bw_write_chat_notices(uuid, jsonb);
  END IF;
END
$$;
-- 192's version (its read check) stays when it is live: see the header.
DO $create$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE oid = to_regprocedure('public.bw_write_chat_notices(uuid, jsonb)')
                AND position('-- 192: may still read' IN prosrc) > 0) THEN
    RAISE NOTICE '194: public.bw_write_chat_notices(uuid, jsonb) has 192''s read check; left as it is';
    RETURN;
  END IF;
  EXECUTE $sql$
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
$sql$;
END
$create$;
REVOKE ALL ON FUNCTION public.bw_write_chat_notices(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_write_chat_notices(uuid, jsonb) TO service_role;

-- After the push attempt: these notices are pushed (never pushed again).
CREATE OR REPLACE FUNCTION public.bw_mark_chat_notices_pushed(p_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE notifications n
     SET data = (n.data - 'push_claimed_at') || jsonb_build_object('pushed_at', now())
   WHERE n.id = ANY (coalesce(p_ids, '{}'::uuid[]))
     AND n.type IN ('chat_message', 'chat_mention');
$function$;
REVOKE ALL ON FUNCTION public.bw_mark_chat_notices_pushed(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_mark_chat_notices_pushed(uuid[]) TO service_role;

-- The push could not be attempted (token lookup failed): drop the claim so
-- a retry right away delivers (round 4). A pushed notice stays pushed.
CREATE OR REPLACE FUNCTION public.bw_release_chat_notice_claims(p_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE notifications n
     SET data = n.data - 'push_claimed_at'
   WHERE n.id = ANY (coalesce(p_ids, '{}'::uuid[]))
     AND n.type IN ('chat_message', 'chat_mention')
     AND NOT n.data ? 'pushed_at'
     AND n.data ? 'push_claimed_at';
$function$;
REVOKE ALL ON FUNCTION public.bw_release_chat_notice_claims(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_release_chat_notice_claims(uuid[]) TO service_role;

-- ── Push-only calls (round 5) ──────────────────────────────────────────────
-- No inbox row to hold the claim: one row per message and recipient here.
-- Gone with the message.
CREATE TABLE IF NOT EXISTS public.chat_push_only_log (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  claimed_at timestamptz,
  pushed_at timestamptz,
  PRIMARY KEY (message_id, user_id)
);
-- Gone with the account too (Claude #284 r5): account deletion (#282, 180)
-- removes the profile, never blocked by this log. Added idempotently, also
-- to a table made by an earlier run of this file.
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conrelid = 'public.chat_push_only_log'::regclass
                        AND conname = 'chat_push_only_log_user_id_fkey') THEN
    DELETE FROM public.chat_push_only_log l
     WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = l.user_id);
    ALTER TABLE public.chat_push_only_log
      ADD CONSTRAINT chat_push_only_log_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END
$$;
ALTER TABLE public.chat_push_only_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_push_only_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.chat_push_only_log TO service_role;

-- Claims the recipients to push now for this message: never pushed, and
-- nobody else is pushing it (bw_chat_push_claim_free: a claim older than
-- 7 minutes has lapsed).
-- Nothing for a message that is gone or marked deleted.
-- 192's version (its read check) stays when it is live: see the header.
DO $create$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE oid = to_regprocedure('public.bw_claim_chat_push_only(uuid, uuid[])')
                AND position('-- 192: may still read' IN prosrc) > 0) THEN
    RAISE NOTICE '194: public.bw_claim_chat_push_only(uuid, uuid[]) has 192''s read check; left as it is';
    RETURN;
  END IF;
  EXECUTE $sql$
CREATE OR REPLACE FUNCTION public.bw_claim_chat_push_only(p_message_id uuid, p_user_ids uuid[])
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  PERFORM 1 FROM messages m
   WHERE m.id = p_message_id
     AND NOT coalesce((to_jsonb(m) ->> 'deleted')::boolean, false)
     FOR SHARE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  INSERT INTO chat_push_only_log AS l (message_id, user_id)
  SELECT p_message_id, u FROM (SELECT DISTINCT unnest(coalesce(p_user_ids, '{}'::uuid[])) AS u) x
   WHERE u IS NOT NULL
     -- The log references profiles: someone with no profile (account gone)
     -- has no device to ring either.
     AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = u)
   ORDER BY u
  ON CONFLICT (message_id, user_id) DO NOTHING;
  RETURN QUERY
  UPDATE chat_push_only_log l
     SET claimed_at = now()
   WHERE l.message_id = p_message_id
     AND l.user_id = ANY (coalesce(p_user_ids, '{}'::uuid[]))
     AND l.pushed_at IS NULL
     AND public.bw_chat_push_claim_free(l.claimed_at)
  RETURNING l.user_id;
END;
$function$;
$sql$;
END
$create$;
REVOKE ALL ON FUNCTION public.bw_claim_chat_push_only(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_claim_chat_push_only(uuid, uuid[]) TO service_role;

-- After the attempt: p_pushed are done for good; p_released can be retried
-- right away (every device failed for now, or nothing was attempted).
CREATE OR REPLACE FUNCTION public.bw_settle_chat_push_only(p_message_id uuid, p_pushed uuid[], p_released uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE chat_push_only_log l
     SET pushed_at = now(), claimed_at = NULL
   WHERE l.message_id = p_message_id AND l.user_id = ANY (coalesce(p_pushed, '{}'::uuid[]));
  UPDATE chat_push_only_log l
     SET claimed_at = NULL
   WHERE l.message_id = p_message_id AND l.user_id = ANY (coalesce(p_released, '{}'::uuid[]))
     AND l.pushed_at IS NULL;
$function$;
REVOKE ALL ON FUNCTION public.bw_settle_chat_push_only(uuid, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_settle_chat_push_only(uuid, uuid[], uuid[]) TO service_role;

COMMIT;
