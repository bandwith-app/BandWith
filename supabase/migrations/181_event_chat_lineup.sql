-- ============================================================================
-- 181 · Gig chats follow the lineup (audit 05 #2; builds on 175)
-- ----------------------------------------------------------------------------
-- Taking a musician off a gig (Event Detail / Edit) deleted their
-- event_members row but kept their chat_participants row in the gig's chat.
-- Message reads and push recipients trust that row, so they kept getting
-- the gig chat's messages and previews.
--
-- Who uses a gig chat is 175's rule (bw_chat_scope_ok, one definition since
-- round 3; this file no longer redefines it): an active member of the band
-- who is the gig's creator, a band admin, or on the lineup and not declined,
-- dropped out or removed (the statuses the server's notices treat as off the
-- gig, 046). A gig with no lineup: only its admins and its creator use the
-- gig chat (as 071). The "whole band" fallback applies only to the gig's
-- logistics notifications (bw_event_recipient_ids), never to its chat.
-- This file adds what 175 can't see happen:
--   * taken off the lineup (row deleted), or declined / dropped out /
--     removed: out of that gig's chat. Round 4: their participant row is
--     KEPT (a record goes to chat_participants_removed_175) and 175's rule
--     refuses it everywhere (reads, roster, receipts, push). Back on the
--     lineup, the same row works again: same chat, cleared_at, read times
--     and mute as they were, and no app can miss the chat and start a
--     second one;
--   * rows already stale today are kept the same way (archived once).
-- Lineup statuses are compared with lower(btrim()) ('Declined', 'Dropped_Out ').
--
-- Prerequisites and order: 175 -> 178 -> 193 -> 181 (tested in that order).
-- 193 (#291: bw_open_group_chat, chats_select_joinable, one chat per gig) is
-- REQUIRED: someone added to a gig's lineup for the first time has no
-- participant row, and without 193 an old build's "does the gig chat
-- exist?" lookup misses it and starts a second chat. #281 and #289 must not
-- ship without #291; round 4: this file refuses to run without 193's
-- bw_open_group_chat, and without 175's final rule (marker bw:175-r4). 178 comes
-- before 193 because 193's bw_chat_joinable builds on 178's
-- bw_is_event_participant (dropped out / removed are off the gig there too).
--
-- Older app builds: nothing they call changes. Idempotent; re-running 175 or
-- 181 in any order keeps the same rule.
-- ============================================================================

BEGIN;

-- 175 first, its final version: it holds the lineup rule this file relies
-- on. Round 4: only that version carries the marker "-- bw:175-r4" in
-- bw_chat_scope_ok (an earlier round's rule also mentions dropped_out); and
-- 193 must be live (bw_open_group_chat), see above.
DO $$
BEGIN
  IF to_regprocedure('public.bw_chat_scope_ok(text, uuid, uuid, uuid)') IS NULL
     OR pg_get_functiondef(to_regprocedure('public.bw_chat_scope_ok(text, uuid, uuid, uuid)')) NOT LIKE '%-- bw:175-r4%' THEN
    RAISE EXCEPTION '181: apply 175 (final version, marker bw:175-r4) first';
  END IF;
  IF to_regprocedure('public.bw_open_group_chat(text,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION '181: apply 193 (bw_open_group_chat, #291) first';
  END IF;
END $$;

-- Off the lineup (row deleted), declined, dropped out or removed: out of
-- that gig's chat. Round 4: archived and kept, never deleted.
CREATE OR REPLACE FUNCTION public.bw_trg_event_member_left_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (lower(btrim(coalesce(NEW.status::text, ''))) IN ('declined', 'dropped_out', 'removed')
                                AND lower(btrim(coalesce(OLD.status::text, ''))) NOT IN ('declined', 'dropped_out', 'removed')) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.chat_participants_removed_175 (chat_id, user_id, row_data)
  SELECT cp.chat_id, cp.user_id, to_jsonb(cp)
    FROM chat_participants cp
    JOIN chats c ON c.id = cp.chat_id
   WHERE c.type::text = 'event'
     AND c.event_id = OLD.event_id
     AND cp.user_id = OLD.user_id
     AND NOT coalesce(public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, cp.user_id), false)
     -- An account being deleted takes its chat rows with it: nothing to
     -- archive (the archive's FK to profiles would refuse the deletion).
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = cp.user_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_event_member_left_chat() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_event_member_left_chat ON public.event_members;
CREATE TRIGGER bw_event_member_left_chat
  AFTER UPDATE OF status OR DELETE ON public.event_members
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_event_member_left_chat();

-- Stale gig chat rows today: archived once, kept (round 4; the rule
-- refuses them).
INSERT INTO public.chat_participants_removed_175 (chat_id, user_id, row_data)
SELECT cp.chat_id, cp.user_id, to_jsonb(cp)
  FROM chat_participants cp
  JOIN chats c ON c.id = cp.chat_id
 WHERE c.type::text = 'event'
   AND NOT coalesce(public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, cp.user_id), false)
   AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = cp.user_id)
   AND NOT EXISTS (SELECT 1 FROM public.chat_participants_removed_175 r
                    WHERE r.chat_id = cp.chat_id AND r.user_id = cp.user_id);

COMMIT;
