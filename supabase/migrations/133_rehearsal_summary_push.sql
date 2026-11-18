-- ============================================================================
-- 133: one summary push when a rehearsal session ends (plan A4, Q-A5)
-- ----------------------------------------------------------------------------
-- When a rehearsal session (131) ends, everyone on the rehearsal with songs
-- to practise gets ONE notification, pushed, in their
-- profiles.preferred_language (en, it, es, fr, de, pt):
--
--   "Rehearsal done · Weekly rehearsal"
--   "To practise: Paper Boats, Harbor Lights +1."
--
-- Never one push per note. What counts: that occurrence's notes (132) that
-- are written or still marks (status open / marked), for the band or
-- assigned to the person. Nobody with nothing to practise gets anything.
--
-- Who: the rehearsal's lineup (event_members, not declined) among the band's
-- active members, or all active members when it has no lineup; plus anyone
-- with a note assigned (even if they missed it). Not the person who ended
-- it (they're looking at the summary).
--
-- Once per person per session: ending again after Resume sends nothing new.
-- A session saved already ended (an admin offline the whole time) counts too.
--
-- Pushes: bw_trg_dispatch_push (live definition, 123) also pushes
-- rehearsal_notes_added rows with data.kind = 'summary'; it already skips
-- people who turned push off (notification_preferences.push). The rows carry
-- no data.server flag, so 089/090's translation triggers leave the text
-- written here alone.
--
-- Nothing here is callable by the app. Safe to run more than once.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bw_rehearsal_summary_text(p_key text, p_lang text, p_vars jsonb DEFAULT '{}'::jsonb)
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
    WHEN 'title' THEN '{"en":"Rehearsal done · {event}","it":"Prova finita · {event}","es":"Ensayo terminado · {event}","fr":"Répétition terminée · {event}","de":"Probe beendet · {event}","pt":"Ensaio terminado · {event}"}'
    WHEN 'rehearsal' THEN '{"en":"Rehearsal","it":"Prova","es":"Ensayo","fr":"Répétition","de":"Probe","pt":"Ensaio"}'
    WHEN 'body.songs' THEN '{"en":"To practise: {songs}.","it":"Da studiare: {songs}.","es":"Para practicar: {songs}.","fr":"À travailler : {songs}.","de":"Zum Üben: {songs}.","pt":"Para praticar: {songs}."}'
    WHEN 'body.notes' THEN '{"en":"Rehearsal notes to read: {n}.","it":"Note della prova da leggere: {n}.","es":"Notas del ensayo para leer: {n}.","fr":"Notes de répétition à lire : {n}.","de":"Probennotizen zum Lesen: {n}.","pt":"Notas do ensaio para ler: {n}."}'
  END)::jsonb;
  IF j IS NULL THEN RETURN NULL; END IF;
  v := coalesce(j ->> p_lang, j ->> 'en');
  FOR k IN SELECT jsonb_object_keys(coalesce(p_vars, '{}'::jsonb)) LOOP
    v := replace(v, '{' || k || '}', coalesce(p_vars ->> k, ''));
  END LOOP;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_rehearsal_summary_text(text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_trg_rehearsal_session_ended()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_title text;
  v_active uuid[];
  v_roster uuid[];
BEGIN
  SELECT nullif(btrim(e.title), '') INTO v_title FROM public.events e WHERE e.id = NEW.event_id;
  v_active := coalesce(public.bw_active_band_member_ids(NEW.band_id), '{}');
  SELECT coalesce(array_agg(DISTINCT em.user_id), '{}') INTO v_roster
    FROM public.event_members em
   WHERE em.event_id = NEW.event_id
     AND em.user_id IS NOT NULL
     AND em.user_id = ANY (v_active)
     AND coalesce(em.status, '') <> 'declined';
  IF cardinality(v_roster) = 0 THEN v_roster := v_active; END IF;
  -- Whoever has a note assigned gets it too, even if they missed the rehearsal.
  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_roster
    FROM (
      SELECT unnest(v_roster) AS u
      UNION
      SELECT a.user_id
        FROM public.rehearsal_note_assignees a
        JOIN public.rehearsal_notes n ON n.id = a.note_id
       WHERE n.event_id = NEW.event_id AND n.occurrence_date = NEW.occurrence_date
         AND a.user_id = ANY (v_active)
    ) x;

  INSERT INTO public.notifications (user_id, band_id, type, title, body, data, read, reference_id, reference_type)
  SELECT r.u, NEW.band_id, 'rehearsal_notes_added',
         left(public.bw_rehearsal_summary_text('title', r.lang, jsonb_build_object(
                'event', coalesce(v_title, public.bw_rehearsal_summary_text('rehearsal', r.lang)))), 255),
         CASE WHEN cardinality(x.songs) > 0
              THEN public.bw_rehearsal_summary_text('body.songs', r.lang, jsonb_build_object(
                     'songs', array_to_string(x.songs[1:3], ', ')
                              || CASE WHEN cardinality(x.songs) > 3 THEN ' +' || (cardinality(x.songs) - 3) ELSE '' END))
              ELSE public.bw_rehearsal_summary_text('body.notes', r.lang, jsonb_build_object('n', x.general))
         END,
         jsonb_build_object(
           'kind', 'summary',
           'event_id', NEW.event_id,
           'session_id', NEW.id,
           'occurrence_date', NEW.occurrence_date,
           'songs', to_jsonb(x.songs),
           'tag', 'rehearsal-' || NEW.id,
           'channel_id', 'bandwith_events'),
         false, NEW.event_id, 'event'
    FROM (
      SELECT u,
             coalesce(nullif(lower(left(btrim(p.preferred_language), 2)), ''), 'en') AS lang
        FROM unnest(v_roster) AS u
        LEFT JOIN public.profiles p ON p.id = u
       WHERE u IS DISTINCT FROM v_uid
    ) r
    CROSS JOIN LATERAL (
      -- The songs with notes for this person, most notes first.
      SELECT coalesce(array_agg(s.title ORDER BY s.cnt DESC, s.title) FILTER (WHERE s.song_id IS NOT NULL AND s.title IS NOT NULL), '{}') AS songs,
             coalesce(sum(s.cnt) FILTER (WHERE s.song_id IS NULL), 0)::int AS general
        FROM (
          SELECT n.song_id,
                 max(coalesce(nullif(btrim(n.song_title), ''), so.title)) AS title,
                 count(*) AS cnt
            FROM public.rehearsal_notes n
            LEFT JOIN public.songs so ON so.id = n.song_id
           WHERE n.event_id = NEW.event_id
             AND n.occurrence_date = NEW.occurrence_date
             AND n.status IN ('open', 'marked')
             AND (n.scope = 'band'
                  OR EXISTS (SELECT 1 FROM public.rehearsal_note_assignees a WHERE a.note_id = n.id AND a.user_id = r.u))
           GROUP BY n.song_id
        ) s
    ) x
   WHERE (cardinality(x.songs) > 0 OR x.general > 0)
     AND NOT EXISTS (
       SELECT 1 FROM public.notifications o
        WHERE o.user_id = r.u
          AND o.type = 'rehearsal_notes_added' AND o.data ->> 'session_id' = NEW.id::text);
  RETURN NULL;
EXCEPTION WHEN others THEN
  -- Never block saving the session.
  RAISE WARNING 'bw_trg_rehearsal_session_ended: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_rehearsal_session_ended() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_rehearsal_session_ended ON public.rehearsal_sessions;
CREATE TRIGGER bw_rehearsal_session_ended
  AFTER UPDATE OF ended_at ON public.rehearsal_sessions
  FOR EACH ROW
  WHEN (OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL)
  EXECUTE FUNCTION public.bw_trg_rehearsal_session_ended();

DROP TRIGGER IF EXISTS bw_rehearsal_session_saved_ended ON public.rehearsal_sessions;
CREATE TRIGGER bw_rehearsal_session_saved_ended
  AFTER INSERT ON public.rehearsal_sessions
  FOR EACH ROW
  WHEN (NEW.ended_at IS NOT NULL)
  EXECUTE FUNCTION public.bw_trg_rehearsal_session_ended();

-- Push: as live (123), plus the rehearsal summary above.
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
      'song_suggestion', 'song_suggestion_reviewed'
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
