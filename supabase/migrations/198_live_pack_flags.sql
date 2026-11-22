-- ============================================================================
-- 198: live pack, kill switch and partial packs (review #273, 11-22)
-- ----------------------------------------------------------------------------
-- 170 is on main and stays as it is; this round's changes to it live here.
-- Apply in ONE transaction with 170, right after it (it needs 170's table
-- and functions): 170's own triggers, sweep and flush don't read the switch,
-- so 170 alone would send invites with live_pack off. Both files' BEGIN;/
-- COMMIT; are replaced by one pair, as in
-- docs/release-checklist.md, section 2, step 3
-- (supabase/tests/integration-chain.pglite.mjs applies them the same way).
--
-- 1. live_pack_status.partial: the pack is held but not complete (live_pack
--    off, or a part not loaded yet): not counted as ready, not "already on
--    their device" for invites and Remind, still a holder for the silent
--    refresh (sent only while live_pack is on).
-- 2. bw_live_pack_status_newer_only: an older status never overwrites a newer
--    one (a device's writes can land out of order).
-- 3. bw_live_pack_can_hold(event, user) answers only about the caller, or,
--    for an admin of the event's band, about a member (Remind).
-- 4. Kill switch: bw_live_pack_on() reads app_flags live_pack (173); with it
--    off, no push of any kind: no invites, no Remind, no silent refresh
--    (queued refreshes are kept and go out once it is back on, for events
--    still in the window). Read before every push, also mid-run. Packs
--    already on a phone are brought up to date by the app on open and resume.
-- 5. bw_live_pack_keep(event ids): which of them the caller may still keep a
--    pack for (not cancelled, readable, an active member still in the
--    lineup). The app deletes the others (pack, notes, stage key).
--
-- Idempotent: safe to run more than once, and again after a later migration
-- (none of the release redefines these functions after 198).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.live_pack_status') IS NULL OR to_regprocedure('public.bw_live_pack_window_events(uuid)') IS NULL THEN
    RAISE EXCEPTION '198 needs 170 first (170_live_pack.sql): public.live_pack_status or bw_live_pack_window_events is missing'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- 1. partial ------------------------------------------------------------------
ALTER TABLE public.live_pack_status ADD COLUMN IF NOT EXISTS partial boolean NOT NULL DEFAULT false;

-- 2. An older status never overwrites a newer one: a device's writes can land
-- out of order (a partial one on a slow connection after the full one).
-- downloaded_at is the pack's save time on that device, so the older save loses.
CREATE OR REPLACE FUNCTION public.bw_live_pack_status_newer_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.downloaded_at < OLD.downloaded_at THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_status_newer_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_live_pack_status_newer_only ON public.live_pack_status;
CREATE TRIGGER bw_live_pack_status_newer_only
  BEFORE UPDATE ON public.live_pack_status
  FOR EACH ROW EXECUTE FUNCTION public.bw_live_pack_status_newer_only();

-- 3. An active member of the event's band, taking part in it (not declined).
-- Only about the caller, or, for an admin of the event's band, about one of
-- its members (Remind): nobody else can ask who takes part in an event.
CREATE OR REPLACE FUNCTION public.bw_live_pack_can_hold(p_event_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id
       AND e.band_id IS NOT NULL
       AND (p_user_id = auth.uid() OR public.bw_is_band_admin(e.band_id))
       AND public.bw_is_band_member(e.band_id, p_user_id)
       AND public.bw_is_event_participant(e.id, p_user_id)
  );
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_can_hold(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_live_pack_can_hold(uuid, uuid) TO authenticated;

-- 4. Kill switch ---------------------------------------------------------------
-- Kill switch live_pack (173_app_flags, docs/flags.md). On unless the row
-- says off: no table yet, no row or an unreadable row all mean on, like the
-- app. So 173 and 198 can be applied in either order. min_app_version is the
-- app's business (the server cannot tell which version a person runs).
CREATE OR REPLACE FUNCTION public.bw_live_pack_on()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_on boolean;
BEGIN
  IF to_regclass('public.app_flags') IS NULL THEN RETURN true; END IF;
  EXECUTE 'SELECT enabled FROM public.app_flags WHERE key = $1' INTO v_on USING 'live_pack';
  RETURN v_on IS DISTINCT FROM false;
EXCEPTION WHEN OTHERS THEN
  -- Fail open by design (the table can only turn things off), but visible in the logs.
  RAISE WARNING 'bw_live_pack_on: % (%), treated as on', SQLERRM, SQLSTATE;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_on() FROM PUBLIC, anon, authenticated;

-- One invitation row for a person and an event (no checks: callers check).
CREATE OR REPLACE FUNCTION public.bw_live_pack_invite_row(
  p_user uuid, p_band uuid, p_event uuid, p_date date, p_rehearsal boolean,
  p_place text, p_songs int, p_kind text, p_round int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lang text;
BEGIN
  IF NOT public.bw_live_pack_on() THEN RETURN; END IF;
  SELECT coalesce(nullif(lower(left(btrim(p.preferred_language), 2)), ''), 'en') INTO v_lang
    FROM public.profiles p WHERE p.id = p_user;
  v_lang := coalesce(v_lang, 'en');
  INSERT INTO public.notifications (user_id, band_id, type, title, body, data, read, reference_id, reference_type)
  VALUES (
    p_user, p_band, 'live_pack_ready',
    left(public.bw_live_pack_text(CASE WHEN p_rehearsal THEN 'title.rehearsal' ELSE 'title.gig' END, v_lang,
           jsonb_build_object('day', public.bw_live_pack_day(p_date, v_lang))), 255),
    public.bw_live_pack_text(CASE WHEN p_songs = 1 THEN 'body.one' ELSE 'body' END, v_lang,
      jsonb_build_object('place', p_place, 'n', p_songs)),
    jsonb_build_object(
      'kind', p_kind,
      'round', p_round,
      'event_id', p_event,
      'songs', p_songs,
      'tag', 'live-pack-' || p_event,
      'channel_id', 'bandwith_events'),
    false, p_event, 'event');
END;
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_invite_row(uuid, uuid, uuid, date, boolean, text, int, text, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_live_pack_invite_sweep(p_event_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n int := 0;
BEGIN
  -- Kill switch off: no question and no new automatic download. Read again
  -- on every row (it can be switched off while the sweep runs).
  IF NOT public.bw_live_pack_on() THEN RETURN 0; END IF;
  FOR r IN
    SELECT w.*, m.u, coalesce(pr.live_pack_auto, false) AS auto,
           (SELECT count(*) FROM public.notifications o
             WHERE o.user_id = m.u AND o.type = 'live_pack_ready'
               AND o.data ->> 'kind' = 'invite' AND o.data ->> 'event_id' = w.event_id::text) AS sent,
           (SELECT max(o.created_at) FROM public.notifications o
             WHERE o.user_id = m.u AND o.type = 'live_pack_ready'
               AND o.data ->> 'kind' = 'invite' AND o.data ->> 'event_id' = w.event_id::text) AS last_sent
      FROM public.bw_live_pack_window_events(p_event_id) w
      CROSS JOIN LATERAL unnest(public.bw_active_band_member_ids(w.band_id)) AS m(u)
      LEFT JOIN public.profiles pr ON pr.id = m.u
     WHERE public.bw_is_event_participant(w.event_id, m.u)
       -- No app installed: nobody to ask.
       AND EXISTS (SELECT 1 FROM public.push_tokens t WHERE t.user_id = m.u AND coalesce(t.is_active, true))
       -- Already on one of their devices (a partial pack doesn't count).
       AND NOT EXISTS (SELECT 1 FROM public.live_pack_status s WHERE s.event_id = w.event_id AND s.user_id = m.u AND NOT s.partial)
  LOOP
    EXIT WHEN NOT public.bw_live_pack_on();
    IF r.auto THEN
      -- Automatic: no question, a silent refresh instead.
      INSERT INTO public.live_pack_refresh_queue (event_id) VALUES (r.event_id) ON CONFLICT (event_id) DO NOTHING;
      CONTINUE;
    END IF;
    IF r.sent = 0 THEN
      PERFORM public.bw_live_pack_invite_row(r.u, r.band_id, r.event_id, r.event_date, r.is_rehearsal, r.place, r.songs, 'invite', 1);
      n := n + 1;
    ELSIF r.sent = 1 AND r.event_date = current_date + 1 AND r.last_sent < now() - interval '20 hours' THEN
      -- "Not now" (or no answer): asked again once, the day before.
      PERFORM public.bw_live_pack_invite_row(r.u, r.band_id, r.event_id, r.event_date, r.is_rehearsal, r.place, r.songs, 'invite', 2);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_invite_sweep(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_live_pack_refresh_targets(p_event_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT m.u), '{}'::uuid[])
    FROM public.events e
    CROSS JOIN LATERAL unnest(public.bw_active_band_member_ids(e.band_id)) AS m(u)
    LEFT JOIN public.profiles p ON p.id = m.u
   WHERE e.id = p_event_id
     AND public.bw_is_event_participant(e.id, m.u)
     -- Kill switch off: the flush sends nothing (it reads the flag before
     -- every push). A second guard: "automatic" alone, while off, is no target.
     AND ((coalesce(p.live_pack_auto, false) AND public.bw_live_pack_on())
          OR EXISTS (SELECT 1 FROM public.live_pack_status s WHERE s.event_id = e.id AND s.user_id = m.u));
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_refresh_targets(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_live_pack_refresh_flush()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_secret text;
  q record;
  v_users uuid[];
  n int := 0;
  v_off boolean := false;
BEGIN
  -- Kill switch off: no push at all. The queue is kept, so the refresh goes
  -- out once it is back on; the app also brings held packs up to date on open
  -- and resume.
  IF NOT public.bw_live_pack_on() THEN RETURN 0; END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'bw_project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'bw_push_dispatch_secret' LIMIT 1;

  -- Two quiet minutes first: one push after a burst of edits, not one per edit.
  FOR q IN
    DELETE FROM public.live_pack_refresh_queue
     WHERE queued_at < now() - interval '2 minutes'
    RETURNING event_id, queued_at
  LOOP
    -- Read before every push: switched off mid-run, the rest go back in the queue.
    v_off := v_off OR NOT public.bw_live_pack_on();
    IF v_off THEN
      INSERT INTO public.live_pack_refresh_queue (event_id, queued_at) VALUES (q.event_id, q.queued_at)
      ON CONFLICT (event_id) DO NOTHING;
      CONTINUE;
    END IF;
    -- Back on after a while: only events still in the window (no refresh for
    -- a gig that is past, cancelled or no longer has a setlist).
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.bw_live_pack_window_events(q.event_id));
    v_users := public.bw_live_pack_refresh_targets(q.event_id);
    CONTINUE WHEN cardinality(v_users) = 0 OR v_url IS NULL OR v_secret IS NULL;
    PERFORM net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-bw-dispatch-secret', v_secret),
      body := jsonb_build_object(
        'user_ids', to_jsonb(v_users[1:200]),
        'silent', true,
        'create_in_app', false,
        'data', jsonb_build_object('type', 'live_pack_refresh', 'event_id', q.event_id)
      ),
      timeout_milliseconds := 8000
    );
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_refresh_flush() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_live_pack_remind(p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF NOT public.bw_live_pack_on() THEN RETURN false; END IF;
  SELECT * INTO w FROM public.bw_live_pack_window_events(p_event_id);
  IF w.event_id IS NULL THEN RETURN false; END IF;
  IF NOT public.bw_is_band_admin(w.band_id) THEN
    RAISE EXCEPTION 'only band admins can remind' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() OR NOT public.bw_live_pack_can_hold(p_event_id, p_user_id) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.live_pack_status s WHERE s.event_id = p_event_id AND s.user_id = p_user_id AND NOT s.partial) THEN
    RETURN false;
  END IF;
  -- One push, not a stream of them.
  IF EXISTS (SELECT 1 FROM public.notifications o
              WHERE o.user_id = p_user_id AND o.type = 'live_pack_ready'
                AND o.data ->> 'event_id' = p_event_id::text
                AND o.data ->> 'kind' = 'remind'
                AND o.created_at > now() - interval '6 hours') THEN
    RETURN false;
  END IF;
  PERFORM public.bw_live_pack_invite_row(p_user_id, w.band_id, w.event_id, w.event_date, w.is_rehearsal, w.place, w.songs, 'remind', 0);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_remind(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_live_pack_remind(uuid, uuid) TO authenticated;

-- 5. Which held packs the caller may keep -------------------------------------
CREATE OR REPLACE FUNCTION public.bw_live_pack_keep(p_event_ids uuid[])
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- NULL (no answer) when signed out or over 500 ids: never '{}', which the
  -- app reads as "keep none" and would delete every pack.
  SELECT CASE
           WHEN auth.uid() IS NULL OR cardinality(coalesce(p_event_ids, '{}'::uuid[])) > 500 THEN NULL
           ELSE coalesce(array_agg(e.id), '{}'::uuid[])
         END
    FROM public.events e
   WHERE auth.uid() IS NOT NULL
     AND cardinality(coalesce(p_event_ids, '{}'::uuid[])) <= 500
     AND e.id = ANY (coalesce(p_event_ids, '{}'::uuid[]))
     AND lower(btrim(coalesce(e.status::text, ''))) NOT IN ('cancelled', 'canceled')
     AND public.bw_can_view_event(e.id, auth.uid())
     AND public.bw_live_pack_can_hold(e.id, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_keep(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_live_pack_keep(uuid[]) TO authenticated;

COMMIT;
