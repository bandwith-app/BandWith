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
--   - a member leaves the band (its coming gigs), or an admin is made a
--     member (its coming quote gigs).
-- Applying this migration changes no key by itself (main session on #283):
-- only these changes, from then on.
-- Apps on this version ask for the key whenever online (stageBleNative.ts),
-- so the band's phones pick up the new one. Released apps keep theirs: for a
-- gig whose key changed, they need signing out and in once (noted in the PR).
-- A gig with no key yet gets one on first use, as before.
-- Is this gig a quote some members may not see? 111's rule; with 178 applied
-- first, 178's bw_event_quote_private (a cancelled quote stays private only if
-- it never became a gig), set just below (Claude on #283). Triggers only.
CREATE OR REPLACE FUNCTION public.bw_stage_quote_gig(p_event_id uuid, p_status text, p_event_type text, p_quote_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.bw_event_is_quote(p_status, p_event_type, p_quote_id);
$$;
DO $do$
BEGIN
  IF to_regprocedure('public.bw_event_quote_private(uuid, text, text, uuid)') IS NOT NULL THEN
    EXECUTE $f$
CREATE OR REPLACE FUNCTION public.bw_stage_quote_gig(p_event_id uuid, p_status text, p_event_type text, p_quote_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.bw_event_quote_private(p_event_id, p_status, p_event_type, p_quote_id);
$$;
$f$;
  END IF;
END
$do$;
REVOKE EXECUTE ON FUNCTION public.bw_stage_quote_gig(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_stage_new_band_key(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.stage_keys
     SET key = encode(
       decode(replace(gen_random_uuid()::text, '-', ''), 'hex') || decode(replace(gen_random_uuid()::text, '-', ''), 'hex'),
       'base64')
   WHERE event_id = p_event_id;
  -- Phones in Stage hear it at once (no key in the message: they ask for it),
  -- the leader starts again with the new key and drops the old one's service
  -- (Codex on 642676fc). Realtime down or missing: never stops the change.
  IF FOUND AND to_regprocedure('realtime.send(jsonb, text, text, boolean)') IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(jsonb_build_object('event_id', p_event_id), 'stage-key', 'stage:event:' || p_event_id, true);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;
END;
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
              AND public.bw_stage_quote_gig(e.id, e.status::text, e.event_type::text, e.quote_id)) THEN
    -- The band's advisory lock before the key row, as in every key change (see bw_stage_member_left).
    PERFORM pg_advisory_xact_lock(hashtextextended('bw-stage-band:' || (SELECT e.band_id FROM public.events e WHERE e.id = OLD.event_id)::text, 0));
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
     OR (public.bw_stage_quote_gig(NEW.id, NEW.status::text, NEW.event_type::text, NEW.quote_id)
         AND NOT public.bw_stage_quote_gig(OLD.id, OLD.status::text, OLD.event_type::text, OLD.quote_id)) THEN
    -- The band's advisory lock before the key row (see bw_stage_member_left):
    -- 190's move trigger takes the same one next.
    PERFORM pg_advisory_xact_lock(hashtextextended('bw-stage-band:' || OLD.band_id::text, 0));
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

-- Is a gig still to come? Its date from yesterday on (a day of slack: the
-- database's date is UTC, and tonight in New York is already tomorrow
-- there), no date, or a series with an occurrence from then on (by its
-- until and count; a repeat it can't read counts as coming: a new key costs
-- little) (Claude + Codex on 642676fc).
CREATE OR REPLACE FUNCTION public.bw_stage_gig_coming(p_date date, p_recurring boolean, p_rule jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  from_day date := current_date - 1;
  freq text;
  step integer;
  n integer;
  last_day date;
BEGIN
  IF p_date IS NULL OR p_date >= from_day THEN
    RETURN true;
  END IF;
  IF NOT coalesce(p_recurring, false) OR p_rule IS NULL OR jsonb_typeof(p_rule) <> 'object' THEN
    RETURN false;
  END IF;
  BEGIN
    IF nullif(p_rule->>'until', '') IS NOT NULL AND left(p_rule->>'until', 10)::date < from_day THEN
      RETURN false;
    END IF;
    n := (p_rule->>'count')::integer;
    IF n IS NULL THEN
      RETURN true;
    END IF;
    freq := lower(coalesce(p_rule->>'freq', p_rule->>'frequency', ''));
    step := greatest(coalesce((p_rule->>'interval')::integer, 1), 1);
    -- The calendar's own reading (EventsView): `count` occurrences after the first.
    last_day := CASE freq
      WHEN 'weekly' THEN p_date + 7 * step * n
      WHEN 'biweekly' THEN p_date + 14 * n
      WHEN 'monthly' THEN (p_date + make_interval(months => step * n))::date
      ELSE NULL
    END;
    RETURN last_day IS NULL OR last_day >= from_day;
  EXCEPTION WHEN others THEN
    RETURN true;
  END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bw_stage_gig_coming(date, boolean, jsonb) FROM PUBLIC, anon, authenticated;

-- A member leaves the band (made inactive, removed, moved to another band or
-- account): the band key of the band's coming gigs (bw_stage_gig_coming)
-- changes, so the copy on their phone finds nothing (Claude on #283). Past
-- gigs keep theirs. An admin made a member stays in the band but no longer
-- sees its quotes (111: off their lineup; 178: at all): the coming quote gigs
-- change key (their signing pair is 190's). Released apps (383f15b) keep the copy
-- they have and don't ask again: for those gigs they need signing out and in
-- once (in the PR's release notes).
CREATE OR REPLACE FUNCTION public.bw_stage_member_left()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Before any key row changes, the band's advisory lock (exclusive). 190's
  -- bw_stage_set_signer takes it shared before the gig's key row, so an admin
  -- leaving while another stores a key pair waits instead of deadlocking
  -- (190's own trigger takes it next; a second take in one transaction is
  -- free). Not the band's row (Claude round 8): a band being deleted holds
  -- that row and then cascades into the rows these triggers fire on, so a
  -- trigger waiting for it while holding one of them is a cycle. No delete
  -- takes the advisory lock. Taken only when keys change.
  IF COALESCE(OLD.is_active, true)
     AND (TG_OP = 'DELETE'
          OR NOT COALESCE(NEW.is_active, true)
          OR NEW.band_id IS DISTINCT FROM OLD.band_id
          OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('bw-stage-band:' || OLD.band_id::text, 0));
    PERFORM public.bw_stage_new_band_key(e.id)
       FROM public.events e
       JOIN public.stage_keys s ON s.event_id = e.id
      WHERE e.band_id = OLD.band_id
        AND public.bw_stage_gig_coming(coalesce(e.event_date, e."date"), e.is_recurring, e.recurrence_rule);
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, true)
        AND OLD.role = 'admin' AND NEW.role IS DISTINCT FROM 'admin' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('bw-stage-band:' || OLD.band_id::text, 0));
    PERFORM public.bw_stage_new_band_key(e.id)
       FROM public.events e
       JOIN public.stage_keys s ON s.event_id = e.id
      WHERE e.band_id = OLD.band_id
        AND public.bw_stage_gig_coming(coalesce(e.event_date, e."date"), e.is_recurring, e.recurrence_rule)
        AND public.bw_stage_quote_gig(e.id, e.status::text, e.event_type::text, e.quote_id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bw_stage_member_left() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_stage_member_left ON public.band_members;
CREATE TRIGGER bw_stage_member_left
  AFTER UPDATE OF is_active, role, band_id, user_id OR DELETE ON public.band_members
  FOR EACH ROW EXECUTE FUNCTION public.bw_stage_member_left();
