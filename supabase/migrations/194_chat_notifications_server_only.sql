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

-- One notice per recipient per chat message (also serves send-push's lookup).
CREATE UNIQUE INDEX IF NOT EXISTS notifications_chat_message_once
  ON public.notifications (user_id, ((data->>'message_id')))
  WHERE type IN ('chat_message', 'chat_mention') AND data ? 'message_id';

COMMIT;
