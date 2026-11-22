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
--     that lapses after 10 minutes: longer than any send-push call, round 4).
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
-- rings twice. Same claim rule as the notices (10 minutes, released when
-- every device failed for now or the push could not be attempted).
--
-- Deploy order: apply 194 before deploying send-push (send-push falls back
-- to a plain insert while the function is missing).
--
-- Older builds: nothing they do changes. Idempotent.
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

-- Writes the chat notices of one message and claims those to push now.
-- p_rows: [{user_id, type, title, body, data, band_id, action_url}].
CREATE OR REPLACE FUNCTION public.bw_write_chat_notices(p_message_id uuid, p_rows jsonb)
RETURNS TABLE (id uuid, user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  -- The message must still be there, and not marked deleted (read through
  -- to_jsonb: works with or without messages.deleted).
  PERFORM 1 FROM messages m
   WHERE m.id = p_message_id
     AND NOT coalesce((to_jsonb(m) ->> 'deleted')::boolean, false)
     FOR SHARE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO notifications AS n (user_id, type, title, body, data, read, band_id, action_url)
  SELECT r.user_id, r.type, r.title, r.body,
         coalesce(r.data, '{}'::jsonb) || jsonb_build_object('message_id', p_message_id::text),
         false, r.band_id, r.action_url
    FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
         AS r(user_id uuid, type text, title text, body text, data jsonb, band_id uuid, action_url text)
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
     AND coalesce(public.bw_try_timestamptz(n.data ->> 'push_claimed_at'), '-infinity'::timestamptz)
         -- 10 min: longer than any send-push call (wall clock 150 s / 400 s).
         < now() - interval '10 minutes'
  RETURNING n.id, n.user_id;
END;
$function$;
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
ALTER TABLE public.chat_push_only_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_push_only_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.chat_push_only_log TO service_role;

-- Claims the recipients to push now for this message: never pushed, and
-- nobody else is pushing it (a claim older than 10 minutes has lapsed).
-- Nothing for a message that is gone or marked deleted.
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
   ORDER BY u
  ON CONFLICT (message_id, user_id) DO NOTHING;
  RETURN QUERY
  UPDATE chat_push_only_log l
     SET claimed_at = now()
   WHERE l.message_id = p_message_id
     AND l.user_id = ANY (coalesce(p_user_ids, '{}'::uuid[]))
     AND l.pushed_at IS NULL
     AND coalesce(l.claimed_at, '-infinity'::timestamptz) < now() - interval '10 minutes'
  RETURNING l.user_id;
END;
$function$;
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
