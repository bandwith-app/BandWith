-- Stage mode click: let band members measure the leader's clock, for real.
--
-- 103 let members broadcast on "stage:event:<id>" only when the event is
-- 'click-ping'. Realtime decides a channel's broadcast write once, when the
-- client joins, with a probe row that has only the topic and the extension
-- (no event), so that policy never matched: members' pings were dropped, and
-- their clicks ran on their own phone's clock (audit #9).
--
-- Pings move to a topic of their own, "stage-clock:event:<id>", where every
-- active member of the gig's band may broadcast and read. Nothing else is
-- carried there. The leader's answers (pongs, with its time) stay on the
-- admin-only stage topic (085), so a member still can't fake the leader's
-- clock, move anyone's song or start a click for the band. Nothing is stored.

-- The clock topic of a band gig, for its active members.
CREATE OR REPLACE FUNCTION public.bw_stage_clock_topic_allowed(p_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ev text;
  band uuid;
BEGIN
  IF auth.uid() IS NULL OR p_topic IS NULL THEN
    RETURN false;
  END IF;
  ev := substring(p_topic FROM '^stage-clock:event:([0-9a-fA-F-]{36})$');
  IF ev IS NULL THEN
    RETURN false;
  END IF;
  SELECT e.band_id INTO band FROM public.events e WHERE e.id = ev::uuid;
  IF band IS NULL THEN
    RETURN false;
  END IF;
  RETURN public.bw_is_band_member(band);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bw_stage_clock_topic_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_stage_clock_topic_allowed(text) TO authenticated;

DROP POLICY IF EXISTS bw_stage_clock_read ON realtime.messages;
CREATE POLICY bw_stage_clock_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND public.bw_stage_clock_topic_allowed(realtime.topic())
  );

DROP POLICY IF EXISTS bw_stage_clock_write ON realtime.messages;
CREATE POLICY bw_stage_clock_write ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.messages.extension = 'broadcast'
    AND public.bw_stage_clock_topic_allowed(realtime.topic())
  );

-- 103's policy (bw_stage_click_ping_write) is kept as it is. By Realtime's
-- source it can't match (its write probe carries no event), but that wasn't
-- checked against the live server: dropping it could only take something
-- away from members on older builds, keeping it gives nobody anything new.
