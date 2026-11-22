-- ============================================================================
-- 170: live mode offline, part A2 (plan docs/plans/live-offline-and-tempo.md
-- §3.2, §3.3, §3.4, §8)
-- ----------------------------------------------------------------------------
-- 1. live_pack_status: each device says which version of an event's live
--    pack it holds. A member writes and reads their own rows; band admins
--    read the rows of their band's events ("Offline: 4 of 5 members ready").
--    Only active band members taking part in the event (not declined) can
--    write a row: deputies and declined members cannot. `partial`: the pack
--    is held but not complete (live_pack off, or a part not loaded yet): not
--    counted as ready, not "already on their device" for invites and Remind,
--    still a holder for the silent refresh (so it is kept current while off).
-- 2. profiles.live_pack_auto / live_pack_asked_at: the person's choice on the
--    consent sheet ("Download and keep it automatic"), kept across devices.
-- 3. bw_live_pack_invite_sweep(): daily (pg_cron) and when a setlist is first
--    attached to an event inside the window. One notification
--    `live_pack_ready` per member per event when the gig or rehearsal enters
--    the next 7 days, a second (last) one the day before if there is still no
--    pack. Never to people who chose automatic (they download silently), who
--    declined, who have no app installed (no active push token), or who
--    already have the pack. Text in profiles.preferred_language (en, it, es,
--    fr, de, pt) like 088–090 and 133; no data.server flag, so 089/090's
--    translation triggers leave it alone.
-- 4. Silent refresh: a change to a setlist or one of its songs, for an event
--    inside the window, queues the event (live_pack_refresh_queue, server
--    only). Every 5 minutes bw_live_pack_refresh_flush() sends one silent push
--    per queued event (send-push with "silent": true: iOS background push,
--    Android data-only) to the people who chose automatic or already hold a
--    pack. Best effort: the app also refreshes on open and resume.
-- 5. bw_live_pack_remind(event, user): an admin's "Remind" (one push, at most
--    every 6 hours per member and event).
-- 6. bw_trg_dispatch_push: as live (133), plus live_pack_ready.
-- 7. Kill switch: with app_flags live_pack off (173), no invites, no Remind
--    and no new automatic downloads: the silent refresh goes only to people
--    who already hold the pack, and keeps their copy current.
--
-- Nothing in the pack itself lives on the server: fees, contracts, quotes and
-- other members' notes never reach these tables. Safe to run more than once.
-- ============================================================================

BEGIN;

-- 1. Which device holds which pack --------------------------------------------

CREATE TABLE IF NOT EXISTS public.live_pack_status (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id text NOT NULL CHECK (char_length(device_id) BETWEEN 1 AND 100),
  version text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 64),
  downloaded_at timestamptz NOT NULL DEFAULT now(),
  partial boolean NOT NULL DEFAULT false,
  PRIMARY KEY (event_id, user_id, device_id)
);
ALTER TABLE public.live_pack_status ADD COLUMN IF NOT EXISTS partial boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS live_pack_status_user_idx ON public.live_pack_status (user_id);

-- An older status never overwrites a newer one: a device's writes can land
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

ALTER TABLE public.live_pack_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.live_pack_status FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.live_pack_status TO authenticated;

-- An active member of the event's band, taking part in it (not declined).
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
       AND public.bw_is_band_member(e.band_id, p_user_id)
       AND public.bw_is_event_participant(e.id, p_user_id)
  );
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_can_hold(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_live_pack_can_hold(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS live_pack_status_select ON public.live_pack_status;
CREATE POLICY live_pack_status_select ON public.live_pack_status
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = live_pack_status.event_id
         AND e.band_id IS NOT NULL
         AND public.bw_is_band_admin(e.band_id)
    )
  );

DROP POLICY IF EXISTS live_pack_status_insert ON public.live_pack_status;
CREATE POLICY live_pack_status_insert ON public.live_pack_status
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.bw_live_pack_can_hold(event_id));

DROP POLICY IF EXISTS live_pack_status_update ON public.live_pack_status;
CREATE POLICY live_pack_status_update ON public.live_pack_status
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.bw_live_pack_can_hold(event_id));

DROP POLICY IF EXISTS live_pack_status_delete ON public.live_pack_status;
CREATE POLICY live_pack_status_delete ON public.live_pack_status
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 2. The person's choice ------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS live_pack_auto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_pack_asked_at timestamptz;
-- New readable/writable columns get their explicit grant (anon has none).
GRANT SELECT (live_pack_auto, live_pack_asked_at) ON public.profiles TO authenticated;
GRANT UPDATE (live_pack_auto, live_pack_asked_at) ON public.profiles TO authenticated;

-- 3. The invitation -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bw_live_pack_text(p_key text, p_lang text, p_vars jsonb DEFAULT '{}'::jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  j jsonb;
  v text;
  k text;
BEGIN
  j := (CASE p_key
    WHEN 'title.gig' THEN '{"en":"{day}''s setlist, ready without signal","it":"La scaletta di {day}, pronta anche senza segnale","es":"El setlist del {day}, listo sin señal","fr":"La setlist de {day}, prête sans réseau","de":"Die Setlist für {day}, auch ohne Netz bereit","pt":"O setlist de {day}, pronto sem sinal"}'
    WHEN 'title.rehearsal' THEN '{"en":"{day}''s rehearsal songs, ready without signal","it":"I brani della prova di {day}, pronti anche senza segnale","es":"Las canciones del ensayo del {day}, listas sin señal","fr":"Les morceaux de la répétition de {day}, prêts sans réseau","de":"Die Songs der Probe am {day}, auch ohne Netz bereit","pt":"As músicas do ensaio de {day}, prontas sem sinal"}'
    WHEN 'body' THEN '{"en":"Download lyrics, chords and structures for {place} ({n} songs). Tap to see what’s included.","it":"Scarica testi, accordi e strutture per {place} ({n} brani). Tocca per vedere cosa include.","es":"Descarga letras, acordes y estructuras para {place} ({n} canciones). Toca para ver qué incluye.","fr":"Télécharge paroles, accords et structures pour {place} ({n} morceaux). Touche pour voir ce qui est inclus.","de":"Lade Texte, Akkorde und Abläufe für {place} herunter ({n} Songs). Tippe, um zu sehen, was dabei ist.","pt":"Baixe letras, acordes e estruturas para {place} ({n} músicas). Toque para ver o que inclui."}'
    WHEN 'body.one' THEN '{"en":"Download lyrics, chords and structures for {place} (1 song). Tap to see what’s included.","it":"Scarica testi, accordi e strutture per {place} (1 brano). Tocca per vedere cosa include.","es":"Descarga letras, acordes y estructuras para {place} (1 canción). Toca para ver qué incluye.","fr":"Télécharge paroles, accords et structures pour {place} (1 morceau). Touche pour voir ce qui est inclus.","de":"Lade Texte, Akkorde und Abläufe für {place} herunter (1 Song). Tippe, um zu sehen, was dabei ist.","pt":"Baixe letras, acordes e estruturas para {place} (1 música). Toque para ver o que inclui."}'
  END)::jsonb;
  IF j IS NULL THEN RETURN NULL; END IF;
  v := coalesce(j ->> p_lang, j ->> 'en');
  FOR k IN SELECT jsonb_object_keys(coalesce(p_vars, '{}'::jsonb)) LOOP
    v := replace(v, '{' || k || '}', coalesce(p_vars ->> k, ''));
  END LOOP;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_text(text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Weekday name in the person's language ("Saturday", "sabato", …).
CREATE OR REPLACE FUNCTION public.bw_live_pack_day(p_date date, p_lang text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (CASE coalesce(p_lang, 'en')
    WHEN 'it' THEN ARRAY['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato']
    WHEN 'es' THEN ARRAY['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
    WHEN 'fr' THEN ARRAY['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi']
    WHEN 'de' THEN ARRAY['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag']
    WHEN 'pt' THEN ARRAY['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado']
    ELSE ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  END)[extract(dow FROM p_date)::int + 1];
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_day(date, text) FROM PUBLIC, anon, authenticated;

-- The events whose packs matter now: band gigs and rehearsals with a setlist,
-- not cancelled, from today to 7 days ahead.
CREATE OR REPLACE FUNCTION public.bw_live_pack_window_events(p_event_id uuid DEFAULT NULL)
RETURNS TABLE (event_id uuid, band_id uuid, event_date date, is_rehearsal boolean, place text, songs int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.band_id, coalesce(e.event_date, e.date),
         coalesce(e.event_type, '') = 'rehearsal',
         coalesce(nullif(btrim(e.venue_name), ''), nullif(btrim(e.venue), ''), nullif(btrim(e.title), ''), ''),
         (SELECT count(*)::int FROM public.setlist_songs ss WHERE ss.setlist_id = e.setlist_id)
    FROM public.events e
   WHERE e.band_id IS NOT NULL
     AND e.setlist_id IS NOT NULL
     AND coalesce(e.status, '') NOT IN ('cancelled', 'canceled')
     AND coalesce(e.event_date, e.date) BETWEEN current_date AND current_date + 7
     AND (p_event_id IS NULL OR e.id = p_event_id)
     AND EXISTS (SELECT 1 FROM public.setlist_songs ss WHERE ss.setlist_id = e.setlist_id);
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_window_events(uuid) FROM PUBLIC, anon, authenticated;

-- Kill switch live_pack (173_app_flags, docs/flags.md). On unless the row
-- says off: no table yet, no row or an unreadable row all mean on, like the
-- app. So 170 and 173 can be applied in either order. min_app_version is the
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
  -- Kill switch off: no question and no new automatic download. Packs already
  -- on a device still get the silent refresh (bw_live_pack_refresh_flush).
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

-- 4. Silent refresh -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.live_pack_refresh_queue (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now()
);
-- Server only: RLS on, no policy, no grant.
ALTER TABLE public.live_pack_refresh_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.live_pack_refresh_queue FROM PUBLIC, anon, authenticated;

-- Queue the window's events that use this setlist (or this song).
CREATE OR REPLACE FUNCTION public.bw_live_pack_queue(p_setlist_id uuid, p_song_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.live_pack_refresh_queue (event_id)
  SELECT e.id
    FROM public.events e
   WHERE e.band_id IS NOT NULL
     AND e.setlist_id IS NOT NULL
     AND coalesce(e.status, '') NOT IN ('cancelled', 'canceled')
     AND coalesce(e.event_date, e.date) BETWEEN current_date AND current_date + 7
     AND (
       (p_setlist_id IS NOT NULL AND e.setlist_id = p_setlist_id)
       OR (p_song_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.setlist_songs ss WHERE ss.setlist_id = e.setlist_id AND ss.song_id = p_song_id))
     )
  ON CONFLICT (event_id) DO UPDATE SET queued_at = excluded.queued_at;
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_queue(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_trg_live_pack_setlist_songs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM public.bw_live_pack_queue(NEW.setlist_id, NULL); END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') AND (TG_OP = 'DELETE' OR OLD.setlist_id IS DISTINCT FROM NEW.setlist_id) THEN
    PERFORM public.bw_live_pack_queue(OLD.setlist_id, NULL);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  -- Never block a setlist save.
  RAISE WARNING 'bw_trg_live_pack_setlist_songs: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_live_pack_setlist_songs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_live_pack_setlist_songs ON public.setlist_songs;
CREATE TRIGGER bw_live_pack_setlist_songs
  AFTER INSERT OR UPDATE OR DELETE ON public.setlist_songs
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_live_pack_setlist_songs();

CREATE OR REPLACE FUNCTION public.bw_trg_live_pack_song()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.bw_live_pack_queue(NULL, NEW.id);
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_live_pack_song: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_live_pack_song() FROM PUBLIC, anon, authenticated;

-- Only what travels in the pack (not play counts or plays).
DROP TRIGGER IF EXISTS bw_live_pack_song ON public.songs;
CREATE TRIGGER bw_live_pack_song
  AFTER UPDATE ON public.songs
  FOR EACH ROW
  WHEN (OLD.title IS DISTINCT FROM NEW.title
     OR OLD.artist IS DISTINCT FROM NEW.artist
     OR OLD.key IS DISTINCT FROM NEW.key
     OR OLD.bpm IS DISTINCT FROM NEW.bpm
     OR OLD.duration_seconds IS DISTINCT FROM NEW.duration_seconds
     OR OLD.lyrics IS DISTINCT FROM NEW.lyrics
     OR OLD.chord_chart IS DISTINCT FROM NEW.chord_chart
     OR OLD.audio_url IS DISTINCT FROM NEW.audio_url)
  EXECUTE FUNCTION public.bw_trg_live_pack_song();

-- An event gets its first setlist inside the window (or moves into it with
-- one): invite now rather than at tomorrow's sweep; a changed setlist, date
-- or time refreshes the packs already out.
CREATE OR REPLACE FUNCTION public.bw_trg_live_pack_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.setlist_id IS NULL OR NEW.band_id IS NULL THEN RETURN NULL; END IF;
  IF OLD.setlist_id IS NULL
     OR coalesce(OLD.event_date, OLD.date) IS DISTINCT FROM coalesce(NEW.event_date, NEW.date) THEN
    PERFORM public.bw_live_pack_invite_sweep(NEW.id);
  END IF;
  IF OLD.setlist_id IS DISTINCT FROM NEW.setlist_id
     OR coalesce(OLD.event_date, OLD.date) IS DISTINCT FROM coalesce(NEW.event_date, NEW.date)
     OR OLD.start_time IS DISTINCT FROM NEW.start_time
     OR OLD.venue_name IS DISTINCT FROM NEW.venue_name
     OR OLD.title IS DISTINCT FROM NEW.title THEN
    INSERT INTO public.live_pack_refresh_queue (event_id)
    SELECT event_id FROM public.bw_live_pack_window_events(NEW.id)
    ON CONFLICT (event_id) DO UPDATE SET queued_at = excluded.queued_at;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_live_pack_event: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_live_pack_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_live_pack_event ON public.events;
CREATE TRIGGER bw_live_pack_event
  AFTER UPDATE OF setlist_id, event_date, "date", start_time, venue_name, title ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_live_pack_event();

-- A new event created with its setlist already inside the window.
CREATE OR REPLACE FUNCTION public.bw_trg_live_pack_event_new()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.bw_live_pack_invite_sweep(NEW.id);
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_live_pack_event_new: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_live_pack_event_new() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_live_pack_event_new ON public.events;
CREATE TRIGGER bw_live_pack_event_new
  AFTER INSERT ON public.events
  FOR EACH ROW
  WHEN (NEW.setlist_id IS NOT NULL AND NEW.band_id IS NOT NULL)
  EXECUTE FUNCTION public.bw_trg_live_pack_event_new();

-- Who gets the silent refresh of an event: people taking part who chose
-- automatic or already hold a pack of it.
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
     -- Kill switch off: only people who already hold the pack (their copy is
     -- kept current); "automatic" alone would start a new download.
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
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'bw_project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'bw_push_dispatch_secret' LIMIT 1;

  -- Two quiet minutes first: one push after a burst of edits, not one per edit.
  FOR q IN
    DELETE FROM public.live_pack_refresh_queue
     WHERE queued_at < now() - interval '2 minutes'
    RETURNING event_id
  LOOP
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

-- 5. An admin's "Remind" ------------------------------------------------------

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

-- 6. Push: as live (133), plus live_pack_ready ---------------------------------

CREATE OR REPLACE FUNCTION public.bw_trg_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_push_pref text;
BEGIN
  -- Rows created by send-push itself were already pushed.
  IF coalesce(NEW.data->>'skip_push', 'false') = 'true' THEN RETURN NEW; END IF;

  IF NOT (
    NEW.type IN (
      'invite_received', 'event_invite', 'event_update', 'event_cancelled',
      'event_reminder', 'rehearsal_reminder', 'member_dropped_out',
      'rehearsal_poll', 'rehearsal_proposal',
      'quote_accepted', 'payment_due', 'payment_overdue', 'fee_changed',
      'chat_message', 'chat_mention', 'deputy_reply',
      'deputy_joined', 'deputy_request', 'deputy_gig_changed',
      'quote_viewed', 'quote_declined', 'quote_message',
      'song_suggestion', 'song_suggestion_reviewed',
      -- The setlist ready for offline (170).
      'live_pack_ready'
    )
    -- One summary after a setlist / song save (107); the per-row notes stay inbox-only.
    OR (NEW.type IN ('setlist_updated', 'song_updated') AND coalesce(NEW.data->>'kind', '') = 'summary')
    -- An admin declined your rehearsal proposal (123).
    OR (NEW.type = 'system' AND coalesce(NEW.data->>'kind', '') = 'proposal_declined')
    -- A rehearsal session ended: what to practise (133).
    OR (NEW.type = 'rehearsal_notes_added' AND coalesce(NEW.data->>'kind', '') = 'summary')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT notification_preferences->>'push' INTO v_push_pref FROM public.profiles WHERE id = NEW.user_id;
  IF coalesce(v_push_pref, 'true') = 'false' THEN RETURN NEW; END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'bw_project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'bw_push_dispatch_secret' LIMIT 1;
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bw-dispatch-secret', v_secret),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'title', NEW.title,
      -- send-push requires a body; fall back to the title.
      'body', coalesce(nullif(NEW.body, ''), NEW.title),
      'create_in_app', false,
      'data', coalesce(NEW.data, '{}'::jsonb) || jsonb_build_object(
        'type', NEW.type,
        'notification_id', NEW.id,
        'band_id', NEW.band_id
      )
    ),
    timeout_milliseconds := 8000
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_dispatch_push: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Schedules ---------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('bw-live-pack-invites')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-live-pack-invites');
  -- 14:00 UTC: morning in New York, afternoon in Europe.
  PERFORM cron.schedule('bw-live-pack-invites', '0 14 * * *', 'SELECT public.bw_live_pack_invite_sweep()');

  PERFORM cron.unschedule('bw-live-pack-refresh')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-live-pack-refresh');
  PERFORM cron.schedule('bw-live-pack-refresh', '*/5 * * * *', 'SELECT public.bw_live_pack_refresh_flush()');
END;
$$;

COMMIT;
