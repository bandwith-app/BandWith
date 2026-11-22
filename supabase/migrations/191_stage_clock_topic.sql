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

-- Topics carry the event id as text. The pattern is a strict UUID: the
-- looser '[0-9a-fA-F-]{36}' of 085 let 36 dashes through to ::uuid, which
-- raises inside the policy (an error, where a plain "no" belongs).

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
  ev := substring(p_topic FROM '^stage-clock:event:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$');
  IF ev IS NULL THEN
    RETURN false;
  END IF;
  SELECT e.band_id INTO band FROM public.events e WHERE e.id = ev::uuid;
  IF band IS NULL THEN
    RETURN false;
  END IF;
  -- And may see this gig: a tentative quote is hidden from members off its lineup (111).
  RETURN public.bw_is_band_member(band) AND public.bw_can_view_event(ev::uuid);
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

-- 085's stage topic helper, with that strict pattern, and only for who may
-- see the gig (bw_can_view_event, 111): on a tentative quote, members off its
-- lineup are refused, as they are from the gig itself. Its policies are
-- unchanged and pick it up. Admins and the gig's lineup are unaffected, so
-- released apps work as before; deputies were never band members here.
CREATE OR REPLACE FUNCTION public.bw_stage_topic_allowed(p_topic text, p_lead boolean DEFAULT false)
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
  ev := substring(p_topic FROM '^stage:event:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$');
  IF ev IS NULL THEN
    RETURN false;
  END IF;
  SELECT e.band_id INTO band FROM public.events e WHERE e.id = ev::uuid;
  IF band IS NULL THEN
    RETURN false;
  END IF;
  IF p_lead THEN
    RETURN public.bw_is_band_admin(band) AND public.bw_can_view_event(ev::uuid);
  END IF;
  RETURN public.bw_is_band_member(band) AND public.bw_can_view_event(ev::uuid);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bw_stage_topic_allowed(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_stage_topic_allowed(text, boolean) TO authenticated;

-- 087's band key, likewise only for who may see the gig (same signature:
-- released apps call it as before).
CREATE OR REPLACE FUNCTION public.bw_stage_key(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  band uuid;
  k text;
BEGIN
  IF auth.uid() IS NULL OR p_event_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT e.band_id INTO band FROM public.events e WHERE e.id = p_event_id;
  IF band IS NULL OR NOT public.bw_is_band_member(band) OR NOT public.bw_can_view_event(p_event_id) THEN
    RETURN NULL;
  END IF;
  SELECT s.key INTO k FROM public.stage_keys s WHERE s.event_id = p_event_id;
  IF k IS NULL THEN
    -- Two v4 UUIDs: 244 random bits, no extension needed.
    INSERT INTO public.stage_keys (event_id, key)
    VALUES (
      p_event_id,
      encode(
        decode(replace(gen_random_uuid()::text, '-', ''), 'hex') || decode(replace(gen_random_uuid()::text, '-', ''), 'hex'),
        'base64'
      )
    )
    ON CONFLICT (event_id) DO NOTHING;
    SELECT s.key INTO k FROM public.stage_keys s WHERE s.event_id = p_event_id;
  END IF;
  RETURN k;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bw_stage_key(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_stage_key(uuid) TO authenticated;

-- With 178 (date on hold) applied first: its rule spelled out in all three
-- functions too, not only inherited through its stricter bw_can_view_event
-- (a quote event is the band admins' only; members on its lineup included).
-- Without 178 (no bw_event_quote_hidden), nothing changes. Built from the
-- bodies above, like 178 does for 175's.
DO $do$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.bw_event_quote_hidden(uuid, uuid)') IS NULL THEN
    RETURN;
  END IF;
  v_def := pg_get_functiondef('public.bw_stage_key(uuid)'::regprocedure);
  v_new := replace(v_def, 'OR NOT public.bw_can_view_event(p_event_id) THEN',
                          'OR NOT public.bw_can_view_event(p_event_id) OR public.bw_event_quote_hidden(p_event_id) THEN');
  IF v_new = v_def AND position('bw_event_quote_hidden' IN v_def) = 0 THEN
    RAISE EXCEPTION '191: bw_stage_key is not the body this migration expects';
  END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.bw_stage_topic_allowed(text, boolean)'::regprocedure);
  v_new := replace(v_def, 'RETURN public.bw_is_band_member(band) AND public.bw_can_view_event(ev::uuid);',
                          'RETURN public.bw_is_band_member(band) AND public.bw_can_view_event(ev::uuid) AND NOT public.bw_event_quote_hidden(ev::uuid);');
  IF v_new = v_def AND position('bw_event_quote_hidden' IN v_def) = 0 THEN
    RAISE EXCEPTION '191: bw_stage_topic_allowed is not the body this migration expects';
  END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.bw_stage_clock_topic_allowed(text)'::regprocedure);
  v_new := replace(v_def, 'RETURN public.bw_is_band_member(band) AND public.bw_can_view_event(ev::uuid);',
                          'RETURN public.bw_is_band_member(band) AND public.bw_can_view_event(ev::uuid) AND NOT public.bw_event_quote_hidden(ev::uuid);');
  IF v_new = v_def AND position('bw_event_quote_hidden' IN v_def) = 0 THEN
    RAISE EXCEPTION '191: bw_stage_clock_topic_allowed is not the body this migration expects';
  END IF;
  EXECUTE v_new;
END
$do$;

-- A band key someone had stays on their phone: the app keeps it for offline
-- and uses it without asking again. So whoever may no longer see a gig gets
-- it changed, and the key they kept finds nothing (it also makes the
-- Bluetooth service id). A new key when:
--   - a tentative quote's lineup loses someone (111: off the lineup, off the quote);
--   - a gig becomes a quote (members off its lineup, or every member with 178,
--     no longer see it);
--   - a gig moves to another band;
--   - and once now, for every quote gig (keys handed out before this).
-- Apps on this version ask for the key whenever online (stageBleNative.ts),
-- so the band's phones pick up the new one. Released apps keep theirs: for a
-- gig whose key changed, they need signing out and in once (noted in the PR).
-- A gig with no key yet gets one on first use, as before.
CREATE OR REPLACE FUNCTION public.bw_stage_new_band_key(p_event_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.stage_keys
     SET key = encode(
       decode(replace(gen_random_uuid()::text, '-', ''), 'hex') || decode(replace(gen_random_uuid()::text, '-', ''), 'hex'),
       'base64')
   WHERE event_id = p_event_id;
$$;
REVOKE EXECUTE ON FUNCTION public.bw_stage_new_band_key(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_stage_lineup_left()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.event_id IS NOT DISTINCT FROM OLD.event_id AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NULL;
  END IF;
  -- The gig itself going (its lineup goes with it, ON DELETE CASCADE): no row, nothing to do.
  IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = OLD.event_id
              AND public.bw_event_is_quote(e.status, e.event_type, e.quote_id)) THEN
    PERFORM public.bw_stage_new_band_key(OLD.event_id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bw_stage_lineup_left() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_stage_lineup_left ON public.event_members;
CREATE TRIGGER bw_stage_lineup_left
  AFTER UPDATE OF event_id, user_id OR DELETE ON public.event_members
  FOR EACH ROW EXECUTE FUNCTION public.bw_stage_lineup_left();

CREATE OR REPLACE FUNCTION public.bw_stage_event_hidden()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.band_id IS DISTINCT FROM OLD.band_id
     OR (public.bw_event_is_quote(NEW.status, NEW.event_type, NEW.quote_id)
         AND NOT public.bw_event_is_quote(OLD.status, OLD.event_type, OLD.quote_id)) THEN
    PERFORM public.bw_stage_new_band_key(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bw_stage_event_hidden() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_stage_event_hidden ON public.events;
CREATE TRIGGER bw_stage_event_hidden
  AFTER UPDATE OF band_id, status, event_type, quote_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.bw_stage_event_hidden();

-- Once: the keys of today's quote gigs (a run again changes them again, harmless).
SELECT public.bw_stage_new_band_key(e.id)
  FROM public.events e
  JOIN public.stage_keys s ON s.event_id = e.id
 WHERE public.bw_event_is_quote(e.status, e.event_type, e.quote_id);
