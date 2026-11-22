-- ============================================================================
-- 181 · Gig chats follow the lineup (audit 05 #2; builds on 175)
-- ----------------------------------------------------------------------------
-- Taking a musician off a gig (Event Detail / Edit) deleted their
-- event_members row but kept their chat_participants row in the gig's chat.
-- Message reads and push recipients trust that row, so they kept getting
-- the gig chat's messages and previews. 175 already closes band and gig
-- chats to people who left the band; this adds the lineup itself:
--
--   * bw_chat_scope_ok (175), event branch: also requires
--     bw_is_event_participant(event, user) (073: event creator, band admin,
--     or on the lineup and not declined), the same rule the app applies
--     before sending. It drives bw_my_chat_ids (messages and chats read
--     policies) and bw_chat_recipient_ids (send-push).
--   * Taken off the lineup, or declined: they leave the gig chat (row
--     archived in chat_participants_removed_175). Back on the lineup, the
--     app adds them again when they open it, as for anyone added later.
--   * Rows already stale today are archived and removed.
--
-- Older app builds: nothing they call changes. Idempotent. Apply after 175.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_type = 'band' THEN
      p_band_id IS NULL OR public.bw_is_band_member(p_band_id, p_user_id)
    WHEN p_type = 'event' THEN
      (p_band_id IS NULL OR public.bw_is_band_member(p_band_id, p_user_id))
      AND coalesce((
        SELECT (e.band_id IS NULL OR public.bw_is_band_member(e.band_id, p_user_id))
               AND public.bw_is_event_participant(e.id, p_user_id)
          FROM events e WHERE e.id = p_event_id
      ), true)
    ELSE true
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_chat_scope_ok(text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_scope_ok(text, uuid, uuid, uuid) TO authenticated;

-- Off the lineup (row deleted) or declined: out of that gig's chat.
CREATE OR REPLACE FUNCTION public.bw_trg_event_member_left_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (coalesce(NEW.status, '') = 'declined' AND coalesce(OLD.status, '') <> 'declined') THEN
    RETURN NEW;
  END IF;
  WITH gone AS (
    SELECT cp.chat_id, cp.user_id, to_jsonb(cp) AS row_data
      FROM chat_participants cp
      JOIN chats c ON c.id = cp.chat_id
     WHERE c.type = 'event'
       AND c.event_id = OLD.event_id
       AND cp.user_id = OLD.user_id
       AND NOT public.bw_chat_scope_ok(c.type, c.band_id, c.event_id, cp.user_id)
       -- An account being deleted takes its chat rows with it: nothing to
       -- archive (the archive's FK to profiles would refuse the deletion).
       AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = cp.user_id)
  ), saved AS (
    INSERT INTO public.chat_participants_removed_175 (chat_id, user_id, row_data)
    SELECT chat_id, user_id, row_data FROM gone
    RETURNING chat_id, user_id
  )
  DELETE FROM chat_participants cp
   USING saved s
   WHERE cp.chat_id = s.chat_id AND cp.user_id = s.user_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_event_member_left_chat() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_event_member_left_chat ON public.event_members;
CREATE TRIGGER bw_event_member_left_chat
  AFTER UPDATE OF status OR DELETE ON public.event_members
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_event_member_left_chat();

-- Stale gig chat rows today: archived, then removed.
WITH stale AS (
  SELECT cp.chat_id, cp.user_id, to_jsonb(cp) AS row_data
    FROM chat_participants cp
    JOIN chats c ON c.id = cp.chat_id
   WHERE c.type = 'event'
     AND NOT public.bw_chat_scope_ok(c.type, c.band_id, c.event_id, cp.user_id)
), saved AS (
  INSERT INTO public.chat_participants_removed_175 (chat_id, user_id, row_data)
  SELECT chat_id, user_id, row_data FROM stale
  RETURNING chat_id, user_id
)
DELETE FROM chat_participants cp
 USING saved s
 WHERE cp.chat_id = s.chat_id AND cp.user_id = s.user_id;

COMMIT;
