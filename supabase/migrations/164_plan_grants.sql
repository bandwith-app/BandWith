-- 164: grants (paid plans P5, docs/plans/paid-plans.md §6).
--
--   bw_trial_offer(band)        the trial an admin may start now, or NULL
--   bw_start_trial(band)        starts it: Pro for plan_settings.trial_days,
--                               once per account, only for a band that never
--                               had a plan, only while plans_trial is on
--   bw_founding_candidates()    a REPORT of the bands that qualify for the
--                               founding offer (plan_settings.founding_rules);
--                               service role / SQL only. The grant itself is a
--                               separate statement run by hand with the user's
--                               OK (docs/plans/paid-plans.md §6).
--   bw_plan_ending_notices()    daily: an inbox note to the band's admins 7
--                               days and 1 day before a trial or a grant ends,
--                               only while plans_enforced is on.
--
-- Switched off like the rest: no switch row, no settings row = no offer, no
-- candidates, no notes. No values here (the repository is public): trial
-- length and founding rules live only in plan_settings.

BEGIN;

-- ------------------------------------------------------------ settings --

-- The trial length in days from plan_settings.trial_days (a JSON number, 1–90), or NULL.
CREATE OR REPLACE FUNCTION public.bw_trial_days()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN jsonb_typeof(s.value) = 'number' AND (s.value)::text ~ '^[0-9]+$'
                   AND (s.value)::text::int BETWEEN 1 AND 90
              THEN (s.value)::text::int END
    FROM public.plan_settings s WHERE s.key = 'trial_days';
$$;
REVOKE ALL ON FUNCTION public.bw_trial_days() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- trial --

-- Why the caller cannot start a trial on this band now, or NULL when they can.
CREATE OR REPLACE FUNCTION public.bw_trial_refusal(p_band_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_band_id IS NULL THEN RETURN 'not_admin'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.band_members m
     WHERE m.band_id = p_band_id AND m.user_id = p_user_id AND m.role = 'admin' AND COALESCE(m.is_active, true)
  ) THEN
    RETURN 'not_admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_switches s WHERE s.key = 'plans_trial' AND s.enabled IS TRUE)
     OR public.bw_trial_days() IS NULL THEN
    RETURN 'off';
  END IF;
  IF EXISTS (SELECT 1 FROM public.plan_trials t WHERE t.user_id = p_user_id) THEN RETURN 'used'; END IF;
  IF EXISTS (SELECT 1 FROM public.band_plans p WHERE p.band_id = p_band_id) THEN RETURN 'band_had_plan'; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trial_refusal(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- {plan, days} when the caller (an admin of the band) may start a trial now.
CREATE OR REPLACE FUNCTION public.bw_trial_offer(p_band_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.bw_trial_refusal(p_band_id, auth.uid()) IS NOT NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('plan', 'pro', 'days', public.bw_trial_days());
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trial_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_trial_offer(uuid) TO authenticated;

-- Starts the trial and returns the band's entitlements. Refusals:
-- BW_TRIAL:not_admin | off | used | band_had_plan (SQLSTATE P0001).
CREATE OR REPLACE FUNCTION public.bw_start_trial(p_band_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_why text;
  v_days integer;
BEGIN
  v_why := public.bw_trial_refusal(p_band_id, v_uid);
  IF v_why IS NOT NULL THEN
    RAISE EXCEPTION 'BW_TRIAL:%', v_why USING ERRCODE = 'P0001';
  END IF;
  v_days := public.bw_trial_days();
  BEGIN
    INSERT INTO public.plan_trials (user_id, band_id) VALUES (v_uid, p_band_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'BW_TRIAL:used' USING ERRCODE = 'P0001';
  END;
  BEGIN
    INSERT INTO public.band_plans (band_id, plan, source, status, trial_ends_at)
    VALUES (p_band_id, 'pro', 'trial', 'trialing', now() + make_interval(days => v_days));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'BW_TRIAL:band_had_plan' USING ERRCODE = 'P0001';
  END;
  RETURN public.bw_band_entitlements(p_band_id);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_start_trial(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_start_trial(uuid) TO authenticated;

-- ------------------------------------------------------- founding bands --

-- The bands that qualify for the founding offer under plan_settings.founding_rules
-- ({"launch_date": "YYYY-MM-DD", "min_members": n, "active_days": n}): created
-- before the launch, at least min_members active members, a gig or rehearsal
-- (not cancelled) in the active_days before the launch, and no plan row yet
-- (the partner band and earlier grants are left out). Rules missing = no rows.
CREATE OR REPLACE FUNCTION public.bw_founding_candidates()
RETURNS TABLE (band_id uuid, band_name text, created_at timestamptz, active_members integer, last_activity date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_launch date;
  v_min integer;
  v_days integer;
BEGIN
  SELECT s.value INTO v_rules FROM public.plan_settings s WHERE s.key = 'founding_rules';
  BEGIN
    v_launch := (v_rules ->> 'launch_date')::date;
    v_min := (v_rules ->> 'min_members')::int;
    v_days := (v_rules ->> 'active_days')::int;
  EXCEPTION WHEN others THEN
    RETURN;
  END;
  IF v_launch IS NULL OR v_min IS NULL OR v_days IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT b.id, b.name::text, b.created_at, m.n::int, a.last_day
    FROM public.bands b
    JOIN LATERAL (
      SELECT count(*) AS n FROM public.band_members bm
       WHERE bm.band_id = b.id AND COALESCE(bm.is_active, true)
    ) m ON true
    JOIN LATERAL (
      SELECT max(e.event_date)::date AS last_day FROM public.events e
       WHERE e.band_id = b.id
         AND COALESCE(e.status, '') <> 'cancelled'
         AND e.event_date::date >= v_launch - v_days
         AND e.event_date::date < v_launch
    ) a ON true
   WHERE b.created_at < v_launch::timestamptz
     AND m.n >= v_min
     AND a.last_day IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.band_plans p WHERE p.band_id = b.id)
   ORDER BY b.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_founding_candidates() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------ ending warnings --

-- The note's words in the reader's language (profiles.preferred_language).
CREATE OR REPLACE FUNCTION public.bw_plan_ending_text(p_key text, p_lang text, p_band text, p_date date)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v jsonb;
  t text;
  d text;
BEGIN
  v := (CASE p_key
    WHEN 'title.7' THEN '{"en":"{band}: Pro ends in 7 days","it":"{band}: Pro finisce tra 7 giorni","es":"{band}: Pro termina en 7 días","fr":"{band} : Pro se termine dans 7 jours","de":"{band}: Pro endet in 7 Tagen","pt":"{band}: o Pro termina em 7 dias"}'
    WHEN 'title.1' THEN '{"en":"{band}: Pro ends tomorrow","it":"{band}: Pro finisce domani","es":"{band}: Pro termina mañana","fr":"{band} : Pro se termine demain","de":"{band}: Pro endet morgen","pt":"{band}: o Pro termina amanhã"}'
    WHEN 'body.trial' THEN '{"en":"The Pro trial ends on {date}. Then the band is on Free: nothing is deleted.","it":"La prova di Pro finisce il {date}. Poi la band passa a Free: non si cancella nulla.","es":"La prueba de Pro termina el {date}. Después la banda pasa a Free: no se borra nada.","fr":"L’essai Pro se termine le {date}. Ensuite le groupe passe en Free : rien n’est supprimé.","de":"Die Pro-Testphase endet am {date}. Danach ist die Band auf Free: Nichts wird gelöscht.","pt":"O teste do Pro termina em {date}. Depois a banda passa para Free: nada é apagado."}'
    WHEN 'body.grant' THEN '{"en":"Pro offered by BandWith ends on {date}. Then the band is on Free: nothing is deleted.","it":"Il Pro offerto da BandWith finisce il {date}. Poi la band passa a Free: non si cancella nulla.","es":"El Pro ofrecido por BandWith termina el {date}. Después la banda pasa a Free: no se borra nada.","fr":"Le Pro offert par BandWith se termine le {date}. Ensuite le groupe passe en Free : rien n’est supprimé.","de":"Das von BandWith geschenkte Pro endet am {date}. Danach ist die Band auf Free: Nichts wird gelöscht.","pt":"O Pro oferecido pelo BandWith termina em {date}. Depois a banda passa para Free: nada é apagado."}'
  END)::jsonb;
  t := COALESCE(v ->> p_lang, v ->> 'en');
  d := CASE p_lang
         WHEN 'de' THEN to_char(p_date, 'DD.MM.YYYY')
         WHEN 'en' THEN to_char(p_date, 'FMDD Mon YYYY')
         ELSE to_char(p_date, 'DD/MM/YYYY')
       END;
  RETURN replace(replace(t, '{band}', COALESCE(p_band, 'BandWith')), '{date}', d);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_plan_ending_text(text, text, text, date) FROM PUBLIC, anon, authenticated;

-- Daily: notes 7 days and 1 day before the end (Europe/Rome dates), once per
-- band, admin, end date and step. Returns how many notes it wrote.
CREATE OR REPLACE FUNCTION public.bw_plan_ending_notices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_n integer := 0;
  r record;
  v_lang text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_switches s WHERE s.key = 'plans_enforced' AND s.enabled IS TRUE) THEN
    RETURN 0;
  END IF;
  FOR r IN
    SELECT p.band_id, b.name AS band_name, m.user_id, x.ends, x.kind, (x.ends - v_today) AS days
      FROM public.band_plans p
      JOIN public.bands b ON b.id = p.band_id
      CROSS JOIN LATERAL (
        SELECT CASE WHEN p.source = 'trial' AND p.status = 'trialing' THEN (p.trial_ends_at AT TIME ZONE 'Europe/Rome')::date
                    WHEN p.source = 'grant' AND p.status = 'active' THEN (p.grant_until AT TIME ZONE 'Europe/Rome')::date
               END AS ends,
               CASE WHEN p.source = 'trial' THEN 'trial' ELSE 'grant' END AS kind
      ) x
      JOIN public.band_members m ON m.band_id = p.band_id AND m.role = 'admin' AND COALESCE(m.is_active, true)
     WHERE x.ends IS NOT NULL AND (x.ends - v_today) IN (7, 1)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.user_id = r.user_id AND n.band_id = r.band_id AND n.type = 'system'
         AND n.data ->> 'kind' = 'plan_ending' AND n.data ->> 'ends' = r.ends::text AND n.data ->> 'days' = r.days::text
    ) THEN
      CONTINUE;
    END IF;
    SELECT COALESCE(NULLIF(pr.preferred_language, ''), 'en') INTO v_lang FROM public.profiles pr WHERE pr.id = r.user_id;
    INSERT INTO public.notifications (user_id, band_id, type, title, body, data)
    VALUES (
      r.user_id, r.band_id, 'system',
      public.bw_plan_ending_text('title.' || r.days, COALESCE(v_lang, 'en'), r.band_name, r.ends),
      public.bw_plan_ending_text('body.' || r.kind, COALESCE(v_lang, 'en'), r.band_name, r.ends),
      jsonb_build_object('kind', 'plan_ending', 'source', r.kind, 'ends', r.ends::text, 'days', r.days)
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_plan_ending_notices() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('bw-plan-ending-notices')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-plan-ending-notices');
  PERFORM cron.schedule('bw-plan-ending-notices', '10 8 * * *', 'SELECT public.bw_plan_ending_notices()');
END;
$$;

COMMIT;
