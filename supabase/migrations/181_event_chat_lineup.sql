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
--     or on the lineup and not declined; 178 adds the quote-event rule to
--     it), and a lineup row that is not dropped_out or removed either: the
--     statuses the server's notices already treat as off the gig (046).
--     It drives bw_my_chat_ids (messages and chats read policies) and
--     bw_chat_recipient_ids (send-push).
--   * Taken off the lineup, or declined / dropped out / removed: they leave
--     the gig chat (row archived in chat_participants_removed_175). Back on
--     the lineup, the app adds them again when they open it, as for anyone
--     added later.
--   * Rows already stale today are archived and removed.
--
-- Duplicate gig chats: someone put back on the lineup has no participant
-- row, so on a database without 193 an old build's "does the gig chat
-- exist?" lookup can miss it and start a second one. 193 (#291:
-- chats_select_joinable, bw_open_group_chat, one chat per gig) closes that;
-- 181 is compatible with it (checked with 175 + 181 + 193 loaded).
--
-- Older app builds: nothing they call changes. Idempotent. Apply after 175.
-- 178 keeps this definition when re-run (it checks for
-- bw_is_event_participant), and so does 175.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    -- 'group' with a band: legacy, same rule as the band chat (175).
    WHEN p_type IN ('band', 'group') THEN
      p_band_id IS NULL OR public.bw_is_band_member(p_band_id, p_user_id)
    WHEN p_type = 'event' THEN
      (p_band_id IS NULL OR public.bw_is_band_member(p_band_id, p_user_id))
      AND coalesce((
        SELECT (e.band_id IS NULL OR public.bw_is_band_member(e.band_id, p_user_id))
               AND public.bw_is_event_participant(e.id, p_user_id)
               -- Dropped out or removed: off the gig, like declined
               -- (unless they run it: its creator or a band admin).
               AND (e.created_by = p_user_id
                    OR (e.band_id IS NOT NULL AND public.bw_is_band_admin(e.band_id, p_user_id))
                    OR NOT EXISTS (
                      SELECT 1 FROM event_members em
                       WHERE em.event_id = e.id AND em.user_id = p_user_id
                         AND coalesce(em.status, '') IN ('declined', 'dropped_out', 'removed')))
          FROM events e WHERE e.id = p_event_id
      ), true)
    ELSE true
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_chat_scope_ok(text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_scope_ok(text, uuid, uuid, uuid) TO authenticated;

-- Off the lineup (row deleted), declined, dropped out or removed: out of
-- that gig's chat.
CREATE OR REPLACE FUNCTION public.bw_trg_event_member_left_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (coalesce(NEW.status, '') IN ('declined', 'dropped_out', 'removed')
                                AND coalesce(OLD.status, '') NOT IN ('declined', 'dropped_out', 'removed')) THEN
    RETURN NEW;
  END IF;
  WITH gone AS (
    SELECT cp.chat_id, cp.user_id, to_jsonb(cp) AS row_data
      FROM chat_participants cp
      JOIN chats c ON c.id = cp.chat_id
     WHERE c.type::text = 'event'
       AND c.event_id = OLD.event_id
       AND cp.user_id = OLD.user_id
       AND NOT public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, cp.user_id)
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
   WHERE c.type::text = 'event'
     AND NOT public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, cp.user_id)
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = cp.user_id)
), saved AS (
  INSERT INTO public.chat_participants_removed_175 (chat_id, user_id, row_data)
  SELECT chat_id, user_id, row_data FROM stale
  RETURNING chat_id, user_id
)
DELETE FROM chat_participants cp
 USING saved s
 WHERE cp.chat_id = s.chat_id AND cp.user_id = s.user_id;

COMMIT;
