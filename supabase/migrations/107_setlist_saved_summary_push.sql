-- ============================================================================
-- 107: one push after a setlist or song is saved, with a summary
-- ----------------------------------------------------------------------------
-- Until now every setlist_songs row written by a save fired 046's
-- bw_notify_setlist: an inbox-only "Setlist updated" to every band member,
-- with nothing about what changed. Now the app saves (reorder, add, remove in
-- the gig overview, Edit event or the band's setlists) and then calls one RPC,
-- which sends ONE notification per person, pushed, in their
-- profiles.preferred_language (en, it, es, fr, de, pt):
--
--   "Setlist updated · Jazz Club Night"
--   "Ana: 2 songs moved, 1 added."
--
-- Who gets it:
--   bw_notify_setlist_saved(setlist, event, …)  the event's lineup (event_members,
--                                                not declined), for a gig's setlist
--   bw_notify_setlist_saved(setlist, NULL, …)   the band's active members, for a
--                                                setlist edited in the band's library
--   bw_notify_song_updated(song, fields)         the band's active members
-- Never the person who saved. Only a band admin can send the setlist one
-- (setlists are admin-written since 074); a song one needs a band member.
--
-- The per-row inbox notes that the same save just wrote (046) are removed, so
-- each person has the summary only. They still appear for changes made
-- without a summary (e.g. Stage mode), as before.
--
-- Pushes: bw_trg_dispatch_push (live definition, unchanged otherwise) also
-- pushes setlist_updated / song_updated rows with data.kind = 'summary'. The
-- 046 note stays inbox-only.
-- The rows carry no data.server flag, so 089/090's translation triggers leave
-- the text written here alone.
-- Safe to run more than once.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bw_setlist_text(p_key text, p_lang text, p_vars jsonb DEFAULT '{}'::jsonb)
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
    WHEN 'gig.title' THEN '{"en":"Setlist updated · {event}","it":"Scaletta aggiornata · {event}","es":"Setlist actualizada · {event}","fr":"Setlist mise à jour · {event}","de":"Setlist aktualisiert · {event}","pt":"Setlist atualizada · {event}"}'
    WHEN 'band.title' THEN '{"en":"Setlist updated · {name}","it":"Scaletta aggiornata · {name}","es":"Setlist actualizada · {name}","fr":"Setlist mise à jour · {name}","de":"Setlist aktualisiert · {name}","pt":"Setlist atualizada · {name}"}'
    WHEN 'summary.body' THEN '{"en":"{who}: {changes}.","it":"{who}: {changes}.","es":"{who}: {changes}.","fr":"{who} : {changes}.","de":"{who}: {changes}.","pt":"{who}: {changes}."}'
    WHEN 'renamed.body' THEN '{"en":"{who} renamed the setlist to “{name}”.","it":"{who} ha rinominato la scaletta in “{name}”.","es":"{who} ha cambiado el nombre de la setlist a “{name}”.","fr":"{who} a renommé la setlist en « {name} ».","de":"{who} hat die Setlist in „{name}“ umbenannt.","pt":"{who} renomeou a setlist para “{name}”."}'
    -- Parts of the summary: the first one names the songs, the others don't.
    WHEN 'moved.one' THEN '{"en":"1 song moved","it":"1 brano spostato","es":"1 canción movida","fr":"1 morceau déplacé","de":"1 Song verschoben","pt":"1 música movida"}'
    WHEN 'moved.many' THEN '{"en":"{n} songs moved","it":"{n} brani spostati","es":"{n} canciones movidas","fr":"{n} morceaux déplacés","de":"{n} Songs verschoben","pt":"{n} músicas movidas"}'
    WHEN 'added.one' THEN '{"en":"1 song added","it":"1 brano aggiunto","es":"1 canción añadida","fr":"1 morceau ajouté","de":"1 Song hinzugefügt","pt":"1 música adicionada"}'
    WHEN 'added.many' THEN '{"en":"{n} songs added","it":"{n} brani aggiunti","es":"{n} canciones añadidas","fr":"{n} morceaux ajoutés","de":"{n} Songs hinzugefügt","pt":"{n} músicas adicionadas"}'
    WHEN 'added.one.short' THEN '{"en":"1 added","it":"1 aggiunto","es":"1 añadida","fr":"1 ajouté","de":"1 hinzugefügt","pt":"1 adicionada"}'
    WHEN 'added.many.short' THEN '{"en":"{n} added","it":"{n} aggiunti","es":"{n} añadidas","fr":"{n} ajoutés","de":"{n} hinzugefügt","pt":"{n} adicionadas"}'
    WHEN 'removed.one' THEN '{"en":"1 song removed","it":"1 brano rimosso","es":"1 canción quitada","fr":"1 morceau retiré","de":"1 Song entfernt","pt":"1 música removida"}'
    WHEN 'removed.many' THEN '{"en":"{n} songs removed","it":"{n} brani rimossi","es":"{n} canciones quitadas","fr":"{n} morceaux retirés","de":"{n} Songs entfernt","pt":"{n} músicas removidas"}'
    WHEN 'removed.one.short' THEN '{"en":"1 removed","it":"1 rimosso","es":"1 quitada","fr":"1 retiré","de":"1 entfernt","pt":"1 removida"}'
    WHEN 'removed.many.short' THEN '{"en":"{n} removed","it":"{n} rimossi","es":"{n} quitadas","fr":"{n} retirés","de":"{n} entfernt","pt":"{n} removidas"}'
    -- Songs
    WHEN 'song.title' THEN '{"en":"Song updated · {song}","it":"Brano aggiornato · {song}","es":"Canción actualizada · {song}","fr":"Morceau mis à jour · {song}","de":"Song aktualisiert · {song}","pt":"Música atualizada · {song}"}'
    WHEN 'song.body' THEN '{"en":"{who} changed: {fields}.","it":"{who} ha modificato: {fields}.","es":"{who} ha cambiado: {fields}.","fr":"{who} a modifié : {fields}.","de":"{who} hat geändert: {fields}.","pt":"{who} alterou: {fields}."}'
    WHEN 'song.body.none' THEN '{"en":"{who} edited the song.","it":"{who} ha modificato il brano.","es":"{who} ha editado la canción.","fr":"{who} a modifié le morceau.","de":"{who} hat den Song bearbeitet.","pt":"{who} editou a música."}'
    WHEN 'field.title' THEN '{"en":"title","it":"titolo","es":"título","fr":"titre","de":"Titel","pt":"título"}'
    WHEN 'field.artist' THEN '{"en":"artist","it":"artista","es":"artista","fr":"artiste","de":"Interpret","pt":"artista"}'
    WHEN 'field.key' THEN '{"en":"key","it":"tonalità","es":"tonalidad","fr":"tonalité","de":"Tonart","pt":"tom"}'
    WHEN 'field.tempo' THEN '{"en":"tempo","it":"tempo","es":"tempo","fr":"tempo","de":"Tempo","pt":"andamento"}'
    WHEN 'field.duration' THEN '{"en":"duration","it":"durata","es":"duración","fr":"durée","de":"Dauer","pt":"duração"}'
    WHEN 'field.lyrics' THEN '{"en":"lyrics","it":"testo","es":"letra","fr":"paroles","de":"Songtext","pt":"letra"}'
    WHEN 'field.chords' THEN '{"en":"chords","it":"accordi","es":"acordes","fr":"accords","de":"Akkorde","pt":"cifras"}'
    WHEN 'field.notes' THEN '{"en":"notes","it":"note","es":"notas","fr":"notes","de":"Notizen","pt":"notas"}'
    WHEN 'field.media' THEN '{"en":"files and links","it":"file e link","es":"archivos y enlaces","fr":"fichiers et liens","de":"Dateien und Links","pt":"arquivos e links"}'
    WHEN 'field.genres' THEN '{"en":"genres","it":"generi","es":"géneros","fr":"genres","de":"Genres","pt":"gêneros"}'
    WHEN 'someone' THEN '{"en":"A bandmate","it":"Un membro della band","es":"Un compañero de banda","fr":"Un membre du groupe","de":"Ein Bandmitglied","pt":"Um colega de banda"}'
  END)::jsonb;
  IF j IS NULL THEN RETURN NULL; END IF;
  v := coalesce(j ->> p_lang, j ->> 'en');
  FOR k IN SELECT jsonb_object_keys(coalesce(p_vars, '{}'::jsonb)) LOOP
    v := replace(v, '{' || k || '}', coalesce(p_vars ->> k, ''));
  END LOOP;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_setlist_text(text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- "2 songs moved, 1 added" in one language.
CREATE OR REPLACE FUNCTION public.bw_setlist_summary(p_lang text, p_moved int, p_added int, p_removed int)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parts text[] := '{}';
  v_kind text;
  v_n int;
BEGIN
  FOR v_kind, v_n IN SELECT * FROM (VALUES ('moved', greatest(coalesce(p_moved, 0), 0)),
                                           ('added', greatest(coalesce(p_added, 0), 0)),
                                           ('removed', greatest(coalesce(p_removed, 0), 0))) AS x(kind, n) LOOP
    CONTINUE WHEN v_n = 0;
    parts := parts || public.bw_setlist_text(
      v_kind || CASE WHEN v_n = 1 THEN '.one' ELSE '.many' END
             || CASE WHEN cardinality(parts) > 0 AND v_kind <> 'moved' THEN '.short' ELSE '' END,
      p_lang, jsonb_build_object('n', v_n));
  END LOOP;
  RETURN array_to_string(parts, ', ');
END;
$$;
REVOKE ALL ON FUNCTION public.bw_setlist_summary(text, int, int, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_notify_setlist_saved(
  p_setlist_id uuid,
  p_event_id uuid DEFAULT NULL,
  p_moved int DEFAULT 0,
  p_added int DEFAULT 0,
  p_removed int DEFAULT 0,
  p_renamed boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_band uuid;
  v_name text;
  v_event_title text;
  v_who text;
  v_recipients uuid[];
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_moved, 0) <= 0 AND coalesce(p_added, 0) <= 0 AND coalesce(p_removed, 0) <= 0 AND NOT coalesce(p_renamed, false) THEN
    RETURN 0;
  END IF;

  SELECT s.band_id, s.name INTO v_band, v_name FROM public.setlists s WHERE s.id = p_setlist_id;
  IF v_band IS NULL OR NOT public.bw_is_band_admin(v_band) THEN
    RAISE EXCEPTION 'Only band admins can change setlists' USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NOT NULL THEN
    SELECT e.title INTO v_event_title
      FROM public.events e
     WHERE e.id = p_event_id AND e.setlist_id = p_setlist_id AND e.band_id = v_band;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This event does not use that setlist' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(DISTINCT em.user_id), '{}') INTO v_recipients
      FROM public.event_members em
     WHERE em.event_id = p_event_id
       AND em.user_id IS NOT NULL
       AND em.user_id <> v_uid
       AND coalesce(em.status, '') <> 'declined';
  ELSE
    SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_recipients
      FROM unnest(public.bw_active_band_member_ids(v_band)) AS u
     WHERE u IS NOT NULL AND u <> v_uid;
  END IF;

  -- The inbox notes the same save just wrote, one per row (046): replaced
  -- by the summary, also for band members who aren't in this gig.
  DELETE FROM public.notifications n
   WHERE n.type = 'setlist_updated'
     AND n.reference_id = p_setlist_id
     AND n.read = false
     AND coalesce(n.data ->> 'kind', '') <> 'summary'
     AND n.created_at > now() - interval '5 minutes';

  v_who := public.bw_display_name(v_uid);

  INSERT INTO public.notifications (user_id, band_id, type, title, body, data, read, reference_id, reference_type)
  SELECT r.u, v_band, 'setlist_updated',
         left(public.bw_setlist_text(CASE WHEN p_event_id IS NOT NULL THEN 'gig.title' ELSE 'band.title' END, r.lang,
                jsonb_build_object('event', coalesce(nullif(v_event_title, ''), v_name), 'name', v_name)), 255),
         CASE WHEN coalesce(p_moved, 0) <= 0 AND coalesce(p_added, 0) <= 0 AND coalesce(p_removed, 0) <= 0
              THEN public.bw_setlist_text('renamed.body', r.lang, jsonb_build_object(
                     'who', coalesce(v_who, public.bw_setlist_text('someone', r.lang)), 'name', v_name))
              ELSE public.bw_setlist_text('summary.body', r.lang, jsonb_build_object(
                     'who', coalesce(v_who, public.bw_setlist_text('someone', r.lang)),
                     'changes', public.bw_setlist_summary(r.lang, p_moved, p_added, p_removed)))
         END,
         jsonb_strip_nulls(jsonb_build_object(
           'kind', 'summary',
           'setlist_id', p_setlist_id,
           'setlist_name', v_name,
           'event_id', p_event_id,
           'event_title', v_event_title,
           'moved', greatest(coalesce(p_moved, 0), 0),
           'added', greatest(coalesce(p_added, 0), 0),
           'removed', greatest(coalesce(p_removed, 0), 0),
           'tag', 'setlist-' || p_setlist_id,
           'channel_id', 'bandwith_events')),
         false, p_setlist_id, 'setlist'
    FROM (
      SELECT u,
             coalesce(nullif(lower(left(btrim(p.preferred_language), 2)), ''), 'en') AS lang
        FROM unnest(v_recipients) AS u
        LEFT JOIN public.profiles p ON p.id = u
    ) r;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_notify_setlist_saved(uuid, uuid, int, int, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_notify_setlist_saved(uuid, uuid, int, int, int, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.bw_notify_song_updated(p_song_id uuid, p_fields text[] DEFAULT '{}')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_band uuid;
  v_title text;
  v_who text;
  v_fields text[];
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT s.band_id, s.title INTO v_band, v_title FROM public.songs s WHERE s.id = p_song_id;
  IF v_band IS NULL OR NOT public.bw_is_band_member(v_band) THEN
    RAISE EXCEPTION 'Not a member of this band' USING ERRCODE = '42501';
  END IF;
  -- Known fields only, in a fixed order.
  SELECT coalesce(array_agg(f ORDER BY o), '{}') INTO v_fields
    FROM unnest(ARRAY['title', 'artist', 'key', 'tempo', 'duration', 'lyrics', 'chords', 'notes', 'media', 'genres'])
         WITH ORDINALITY AS x(f, o)
   WHERE f = ANY (coalesce(p_fields, '{}'));
  v_who := public.bw_display_name(v_uid);

  INSERT INTO public.notifications (user_id, band_id, type, title, body, data, read, reference_id, reference_type)
  SELECT r.u, v_band, 'song_updated',
         left(public.bw_setlist_text('song.title', r.lang, jsonb_build_object('song', v_title)), 255),
         CASE WHEN cardinality(v_fields) = 0
              THEN public.bw_setlist_text('song.body.none', r.lang, jsonb_build_object('who', coalesce(v_who, public.bw_setlist_text('someone', r.lang))))
              ELSE public.bw_setlist_text('song.body', r.lang, jsonb_build_object(
                     'who', coalesce(v_who, public.bw_setlist_text('someone', r.lang)),
                     'fields', (SELECT string_agg(public.bw_setlist_text('field.' || f, r.lang), ', ' ORDER BY o)
                                  FROM unnest(v_fields) WITH ORDINALITY AS y(f, o))))
         END,
         jsonb_build_object('kind', 'summary', 'song_id', p_song_id, 'song_title', v_title,
                            'fields', to_jsonb(v_fields), 'tag', 'song-' || p_song_id, 'channel_id', 'bandwith_general'),
         false, p_song_id, 'song'
    FROM (
      SELECT u,
             coalesce(nullif(lower(left(btrim(p.preferred_language), 2)), ''), 'en') AS lang
        FROM unnest(public.bw_active_band_member_ids(v_band)) AS u
        LEFT JOIN public.profiles p ON p.id = u
       WHERE u IS NOT NULL AND u <> v_uid
         -- Saving the same song twice in a minute: one push.
         AND NOT EXISTS (
           SELECT 1 FROM public.notifications n
            WHERE n.user_id = u AND n.type = 'song_updated' AND n.reference_id = p_song_id
              AND n.created_at > now() - interval '1 minute')
    ) r;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_notify_song_updated(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_notify_song_updated(uuid, text[]) TO authenticated;

-- Push: as live (068 + 084/086/088/099 additions), plus the summaries above.
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
      'quote_viewed', 'quote_declined', 'quote_message'
    )
    -- One summary after a setlist / song save (107); the per-row notes stay inbox-only.
    OR (NEW.type IN ('setlist_updated', 'song_updated') AND coalesce(NEW.data->>'kind', '') = 'summary')
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
