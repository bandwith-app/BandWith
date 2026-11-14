-- ============================================================================
-- 108: band songs are written by admins only; members suggest
-- ----------------------------------------------------------------------------
-- Until now any band member could edit every song (songs_update_member) and
-- add songs with any status (songs_insert_member), and upload or delete any
-- file in the band's song-files folder. Now:
--
--   songs        admins create, edit and delete (bw_is_band_admin: active
--                admins only). A member can only insert a song with status
--                'suggested' and added_by = themselves (the existing "suggest
--                a song" flow). Everyone in the band still reads every song.
--   song-files   admins write anywhere in the band's folder; a member only in
--                <band>/suggestions/<their id>/ (files for a suggested song).
--                Reading is unchanged (the whole band).
--
-- song_suggestions: what a member proposes for a band song.
--   kind 'new_song'  a song added with status 'suggested' (row written by a
--                    trigger on songs, also for the 2 that exist today)
--   kind 'lyrics'    a corrected songs.lyrics (chords inline, as stored)
--   kind 'chords'    the same text where only chords change, and/or a new
--                    songs.chord_chart
--   kind 'note'      a note for the whole band (goes into songs.notes)
-- Members insert their own rows ('pending'); `original` and song_title are set
-- by the server from the song. Admins see the band's rows, a member only
-- their own. Nobody updates or deletes rows directly:
--   bw_review_song_suggestion(id, 'accept' | 'reject', reason, applied, edited)
--     admin only; applies the change (lyrics / chord_chart / notes, or
--     'suggested' → 'learning' for a new song) or rejects it (a suggested
--     song is deleted), and tells the member, with the reason.
--   bw_withdraw_song_suggestion(id)  the author, while pending.
-- Outside the RPC, an admin moving a suggested song to learning / ready
-- accepts its suggestion and deleting it rejects it (triggers), so the member
-- always hears back.
--
-- Notifications, pushed, in each person's profiles.preferred_language:
--   song_suggestion           to the band's active admins (not the author),
--                             one per author per minute
--   song_suggestion_reviewed  to the author, with the admin's reason
-- bw_trg_dispatch_push: live definition (107) plus these two types.
--
-- Grants: song_suggestions gets SELECT and INSERT for authenticated only
-- (101: new tables give anon nothing). Safe to run more than once.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------- table --

CREATE TABLE IF NOT EXISTS public.song_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  song_id uuid REFERENCES public.songs(id) ON DELETE SET NULL,
  song_title text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('new_song', 'lyrics', 'chords', 'note')),
  proposed jsonb NOT NULL DEFAULT '{}'::jsonb,
  original jsonb NOT NULL DEFAULT '{}'::jsonb,
  message text CHECK (message IS NULL OR char_length(message) <= 1000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'accepted_edited', 'rejected', 'withdrawn')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 1000),
  applied jsonb,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  CONSTRAINT song_suggestions_proposed_size CHECK (pg_column_size(proposed) <= 400000)
);

CREATE INDEX IF NOT EXISTS song_suggestions_band_status_idx ON public.song_suggestions (band_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS song_suggestions_author_idx ON public.song_suggestions (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS song_suggestions_song_idx ON public.song_suggestions (song_id);

ALTER TABLE public.song_suggestions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.song_suggestions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.song_suggestions TO authenticated;

DROP POLICY IF EXISTS song_suggestions_select ON public.song_suggestions;
CREATE POLICY song_suggestions_select ON public.song_suggestions
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.bw_is_band_admin(band_id));

-- A member proposes a change to a song of their band. new_song rows come
-- from the songs trigger below.
DROP POLICY IF EXISTS song_suggestions_insert ON public.song_suggestions;
CREATE POLICY song_suggestions_insert ON public.song_suggestions
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND kind IN ('lyrics', 'chords', 'note')
    AND status = 'pending'
    AND public.bw_is_band_member(band_id)
    AND EXISTS (SELECT 1 FROM public.songs s WHERE s.id = song_id AND s.band_id = song_suggestions.band_id)
  );

-- Server-side fields: what the song looks like now, its title, no review.
CREATE OR REPLACE FUNCTION public.bw_trg_song_suggestion_fill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s record;
  v_pending integer;
BEGIN
  SELECT id, band_id, title, lyrics, chord_chart, notes INTO s FROM public.songs WHERE id = NEW.song_id;
  IF s.id IS NULL OR s.band_id IS DISTINCT FROM NEW.band_id THEN
    RAISE EXCEPTION 'song_suggestions: unknown song' USING ERRCODE = '23503';
  END IF;
  NEW.song_title := coalesce(s.title, '');
  NEW.status := 'pending';
  NEW.reason := NULL;
  NEW.applied := NULL;
  NEW.reviewed_by := NULL;
  NEW.reviewed_at := NULL;
  -- Backfill (no user) keeps the song's date.
  NEW.created_at := CASE WHEN auth.uid() IS NULL THEN coalesce(NEW.created_at, now()) ELSE now() END;
  NEW.message := nullif(btrim(coalesce(NEW.message, '')), '');

  IF NEW.kind IN ('lyrics', 'chords') THEN
    IF jsonb_typeof(NEW.proposed -> 'lyrics') IS DISTINCT FROM 'string'
       AND jsonb_typeof(NEW.proposed -> 'chord_chart') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'song_suggestions: proposed lyrics or chord_chart required' USING ERRCODE = '22023';
    END IF;
    NEW.proposed := jsonb_strip_nulls(jsonb_build_object(
      'lyrics', CASE WHEN jsonb_typeof(NEW.proposed -> 'lyrics') = 'string' THEN NEW.proposed -> 'lyrics' END,
      'chord_chart', CASE WHEN jsonb_typeof(NEW.proposed -> 'chord_chart') = 'object' THEN NEW.proposed -> 'chord_chart' END));
    IF char_length(coalesce(NEW.proposed ->> 'lyrics', '')) > 100000 THEN
      RAISE EXCEPTION 'song_suggestions: lyrics too long' USING ERRCODE = '22001';
    END IF;
    NEW.original := jsonb_build_object('lyrics', s.lyrics, 'chord_chart', s.chord_chart);
  ELSIF NEW.kind = 'note' THEN
    IF nullif(btrim(coalesce(NEW.proposed ->> 'note', '')), '') IS NULL THEN
      RAISE EXCEPTION 'song_suggestions: note required' USING ERRCODE = '22023';
    END IF;
    IF char_length(NEW.proposed ->> 'note') > 2000 THEN
      RAISE EXCEPTION 'song_suggestions: note too long' USING ERRCODE = '22001';
    END IF;
    NEW.proposed := jsonb_build_object('note', btrim(NEW.proposed ->> 'note'));
    NEW.original := jsonb_build_object('notes', s.notes);
  ELSE
    -- new_song: written by bw_trg_song_suggested (proposed/before empty).
    NEW.proposed := '{}'::jsonb;
    NEW.original := '{}'::jsonb;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT count(*) INTO v_pending FROM public.song_suggestions
     WHERE created_by = NEW.created_by AND band_id = NEW.band_id AND status = 'pending';
    IF v_pending >= 200 THEN
      RAISE EXCEPTION 'song_suggestions: too many pending suggestions' USING ERRCODE = '54000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_song_suggestion_fill() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS song_suggestions_fill ON public.song_suggestions;
CREATE TRIGGER song_suggestions_fill
  BEFORE INSERT ON public.song_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_song_suggestion_fill();

-- ----------------------------------------------------------------- texts --

CREATE OR REPLACE FUNCTION public.bw_song_suggestion_text(p_key text, p_lang text, p_vars jsonb DEFAULT '{}'::jsonb)
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
    -- To admins
    WHEN 'new_song.title' THEN '{"en":"Song suggested · {song}","it":"Brano suggerito · {song}","es":"Canción sugerida · {song}","fr":"Morceau suggéré · {song}","de":"Song vorgeschlagen · {song}","pt":"Música sugerida · {song}"}'
    WHEN 'new_song.body' THEN '{"en":"{who} suggests adding it to the repertoire.","it":"{who} propone di aggiungerlo al repertorio.","es":"{who} propone añadirla al repertorio.","fr":"{who} propose de l’ajouter au répertoire.","de":"{who} schlägt vor, ihn ins Repertoire aufzunehmen.","pt":"{who} sugere adicioná-la ao repertório."}'
    WHEN 'lyrics.title' THEN '{"en":"Lyrics correction · {song}","it":"Correzione al testo · {song}","es":"Corrección de la letra · {song}","fr":"Correction des paroles · {song}","de":"Korrektur am Songtext · {song}","pt":"Correção da letra · {song}"}'
    WHEN 'lyrics.body' THEN '{"en":"{who} suggests a correction to the lyrics.","it":"{who} suggerisce una correzione al testo.","es":"{who} sugiere una corrección de la letra.","fr":"{who} suggère une correction des paroles.","de":"{who} schlägt eine Korrektur am Songtext vor.","pt":"{who} sugere uma correção da letra."}'
    WHEN 'chords.title' THEN '{"en":"Chords correction · {song}","it":"Correzione agli accordi · {song}","es":"Corrección de acordes · {song}","fr":"Correction des accords · {song}","de":"Korrektur an den Akkorden · {song}","pt":"Correção das cifras · {song}"}'
    WHEN 'chords.body' THEN '{"en":"{who} suggests a correction to the chords.","it":"{who} suggerisce una correzione agli accordi.","es":"{who} sugiere una corrección de los acordes.","fr":"{who} suggère une correction des accords.","de":"{who} schlägt eine Korrektur an den Akkorden vor.","pt":"{who} sugere uma correção das cifras."}'
    WHEN 'note.title' THEN '{"en":"Note for the band · {song}","it":"Nota per la band · {song}","es":"Nota para la banda · {song}","fr":"Note pour le groupe · {song}","de":"Notiz für die Band · {song}","pt":"Nota para a banda · {song}"}'
    WHEN 'note.body' THEN '{"en":"{who}: “{note}”","it":"{who}: “{note}”","es":"{who}: “{note}”","fr":"{who} : « {note} »","de":"{who}: „{note}“","pt":"{who}: “{note}”"}'
    WHEN 'message.suffix' THEN '{"en":" “{message}”","it":" “{message}”","es":" “{message}”","fr":" « {message} »","de":" „{message}“","pt":" “{message}”"}'
    -- To the author
    WHEN 'accepted.title' THEN '{"en":"Suggestion accepted · {song}","it":"Suggerimento accettato · {song}","es":"Sugerencia aceptada · {song}","fr":"Suggestion acceptée · {song}","de":"Vorschlag angenommen · {song}","pt":"Sugestão aceita · {song}"}'
    WHEN 'accepted.body' THEN '{"en":"{who} accepted your suggestion.","it":"{who} ha accettato il tuo suggerimento.","es":"{who} ha aceptado tu sugerencia.","fr":"{who} a accepté ta suggestion.","de":"{who} hat deinen Vorschlag angenommen.","pt":"{who} aceitou sua sugestão."}'
    WHEN 'accepted_edited.title' THEN '{"en":"Accepted with changes · {song}","it":"Accettato con modifiche · {song}","es":"Aceptada con cambios · {song}","fr":"Acceptée avec des modifications · {song}","de":"Mit Änderungen angenommen · {song}","pt":"Aceita com alterações · {song}"}'
    WHEN 'accepted_edited.body' THEN '{"en":"{who} accepted your suggestion with some changes.","it":"{who} ha accettato il tuo suggerimento con qualche modifica.","es":"{who} ha aceptado tu sugerencia con algunos cambios.","fr":"{who} a accepté ta suggestion avec quelques modifications.","de":"{who} hat deinen Vorschlag mit einigen Änderungen angenommen.","pt":"{who} aceitou sua sugestão com algumas alterações."}'
    WHEN 'rejected.title' THEN '{"en":"Suggestion not accepted · {song}","it":"Suggerimento non accettato · {song}","es":"Sugerencia no aceptada · {song}","fr":"Suggestion non retenue · {song}","de":"Vorschlag nicht angenommen · {song}","pt":"Sugestão não aceita · {song}"}'
    WHEN 'rejected.body' THEN '{"en":"{who} didn’t accept your suggestion.","it":"{who} non ha accettato il tuo suggerimento.","es":"{who} no ha aceptado tu sugerencia.","fr":"{who} n’a pas retenu ta suggestion.","de":"{who} hat deinen Vorschlag nicht angenommen.","pt":"{who} não aceitou sua sugestão."}'
    WHEN 'reason.body' THEN '{"en":"{who}: “{reason}”","it":"{who}: “{reason}”","es":"{who}: “{reason}”","fr":"{who} : « {reason} »","de":"{who}: „{reason}“","pt":"{who}: “{reason}”"}'
    WHEN 'someone' THEN '{"en":"A bandmate","it":"Un membro della band","es":"Un compañero de banda","fr":"Un membre du groupe","de":"Ein Bandmitglied","pt":"Um colega de banda"}'
    WHEN 'admin' THEN '{"en":"The band admin","it":"L’admin della band","es":"El admin de la banda","fr":"L’admin du groupe","de":"Der Band-Admin","pt":"O admin da banda"}'
    WHEN 'untitled' THEN '{"en":"Song","it":"Brano","es":"Canción","fr":"Morceau","de":"Song","pt":"Música"}'
  END)::jsonb;
  IF j IS NULL THEN RETURN NULL; END IF;
  v := coalesce(j ->> p_lang, j ->> 'en');
  FOR k IN SELECT jsonb_object_keys(coalesce(p_vars, '{}'::jsonb)) LOOP
    v := replace(v, '{' || k || '}', coalesce(p_vars ->> k, ''));
  END LOOP;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_suggestion_text(text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_user_lang(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN l IN ('en', 'it', 'es', 'fr', 'de', 'pt') THEN l ELSE 'en' END
    FROM (SELECT lower(left(btrim(coalesce((SELECT preferred_language FROM public.profiles WHERE id = p_user_id), '')), 2)) AS l) x;
$$;
REVOKE ALL ON FUNCTION public.bw_user_lang(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------- notify: to the admins --

CREATE OR REPLACE FUNCTION public.bw_trg_song_suggestion_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_who text := public.bw_display_name(NEW.created_by);
  v_song text := nullif(NEW.song_title, '');
  v_note text;
BEGIN
  v_note := left(regexp_replace(coalesce(NEW.proposed ->> 'note', ''), '\s+', ' ', 'g'), 140);
  INSERT INTO public.notifications (user_id, band_id, type, title, body, data, read, reference_id, reference_type)
  SELECT r.u, NEW.band_id, 'song_suggestion',
         left(public.bw_song_suggestion_text(NEW.kind || '.title', r.lang,
              jsonb_build_object('song', coalesce(v_song, public.bw_song_suggestion_text('untitled', r.lang)))), 255),
         public.bw_song_suggestion_text(NEW.kind || '.body', r.lang, jsonb_build_object(
              'who', coalesce(v_who, public.bw_song_suggestion_text('someone', r.lang)),
              'note', v_note))
           || CASE WHEN NEW.message IS NOT NULL AND NEW.kind <> 'note'
                   THEN public.bw_song_suggestion_text('message.suffix', r.lang, jsonb_build_object('message', left(NEW.message, 140)))
                   ELSE '' END,
         jsonb_build_object('suggestion_id', NEW.id, 'song_id', NEW.song_id, 'song_title', NEW.song_title,
                            'kind', NEW.kind, 'by', NEW.created_by,
                            'tag', 'song-suggestion-' || NEW.created_by, 'channel_id', 'bandwith_general'),
         false, NEW.id, 'song_suggestion'
    FROM (
      SELECT u, public.bw_user_lang(u) AS lang
        FROM unnest(public.bw_active_band_member_ids(NEW.band_id, true)) AS u
       WHERE u IS NOT NULL AND u <> NEW.created_by
         -- A list of songs suggested at once: one notification.
         AND NOT EXISTS (
           SELECT 1 FROM public.notifications n
            WHERE n.user_id = u AND n.type = 'song_suggestion'
              AND n.data ->> 'by' = NEW.created_by::text
              AND n.created_at > now() - interval '1 minute')
    ) r;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_song_suggestion_notify: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_song_suggestion_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS song_suggestions_notify ON public.song_suggestions;
CREATE TRIGGER song_suggestions_notify
  AFTER INSERT ON public.song_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_song_suggestion_notify();

-- ------------------------------------------------- notify: to the author --

CREATE OR REPLACE FUNCTION public.bw_notify_song_suggestion_outcome(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g record;
  v_lang text;
  v_who text;
  v_body text;
BEGIN
  SELECT * INTO g FROM public.song_suggestions WHERE id = p_id;
  IF g.id IS NULL OR g.status NOT IN ('accepted', 'accepted_edited', 'rejected') THEN RETURN; END IF;
  IF g.reviewed_by IS NOT NULL AND g.reviewed_by = g.created_by THEN RETURN; END IF;
  v_lang := public.bw_user_lang(g.created_by);
  v_who := coalesce(public.bw_display_name(g.reviewed_by), public.bw_song_suggestion_text('admin', v_lang));
  v_body := CASE WHEN nullif(btrim(coalesce(g.reason, '')), '') IS NOT NULL
                 THEN public.bw_song_suggestion_text('reason.body', v_lang, jsonb_build_object('who', v_who, 'reason', left(g.reason, 300)))
                 ELSE public.bw_song_suggestion_text(g.status || '.body', v_lang, jsonb_build_object('who', v_who)) END;
  INSERT INTO public.notifications (user_id, band_id, type, title, body, data, read, reference_id, reference_type)
  VALUES (g.created_by, g.band_id, 'song_suggestion_reviewed',
          left(public.bw_song_suggestion_text(g.status || '.title', v_lang,
               jsonb_build_object('song', coalesce(nullif(g.song_title, ''), public.bw_song_suggestion_text('untitled', v_lang)))), 255),
          v_body,
          jsonb_build_object('suggestion_id', g.id, 'song_id', g.song_id, 'song_title', g.song_title,
                             'kind', g.kind, 'status', g.status, 'reason', g.reason,
                             'tag', 'song-suggestion-' || g.id, 'channel_id', 'bandwith_general'),
          false, g.id, 'song_suggestion');
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_notify_song_suggestion_outcome: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_notify_song_suggestion_outcome(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------- suggested songs (new_song) --

-- A member adds a song with status 'suggested': its suggestion row.
CREATE OR REPLACE FUNCTION public.bw_trg_song_suggested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_by uuid := coalesce(NEW.added_by, auth.uid());
BEGIN
  IF NEW.status = 'suggested' AND v_by IS NOT NULL AND NOT public.bw_is_band_admin(NEW.band_id, v_by) THEN
    INSERT INTO public.song_suggestions (band_id, song_id, kind, created_by)
    VALUES (NEW.band_id, NEW.id, 'new_song', v_by);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_song_suggested() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS songs_suggested ON public.songs;
CREATE TRIGGER songs_suggested
  AFTER INSERT ON public.songs
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_song_suggested();

-- An admin moves a suggested song on (or deletes it) outside the review
-- screen: its pending suggestion is accepted (or rejected) and the author
-- hears back. The review RPC closes the row first, so it isn't done twice.
CREATE OR REPLACE FUNCTION public.bw_trg_song_suggestion_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (OLD.status = 'suggested' AND NEW.status IS DISTINCT FROM 'suggested') THEN RETURN NEW; END IF;
    v_status := 'accepted';
  ELSE
    IF OLD.status IS DISTINCT FROM 'suggested' THEN RETURN OLD; END IF;
    v_status := 'rejected';
  END IF;
  FOR v_id IN
    UPDATE public.song_suggestions
       SET status = v_status, reviewed_by = auth.uid(), reviewed_at = now()
     WHERE song_id = OLD.id AND kind = 'new_song' AND status = 'pending'
       -- The author withdrawing their own song: no notification.
       AND (auth.uid() IS NULL OR created_by <> auth.uid() OR v_status = 'accepted')
    RETURNING id
  LOOP
    PERFORM public.bw_notify_song_suggestion_outcome(v_id);
  END LOOP;
  -- Corrections still waiting for a deleted song can't be applied any more.
  IF TG_OP = 'DELETE' THEN
    UPDATE public.song_suggestions SET status = 'withdrawn', reviewed_at = now()
     WHERE song_id = OLD.id AND status = 'pending';
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_song_suggestion_close() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS songs_suggestion_close_update ON public.songs;
CREATE TRIGGER songs_suggestion_close_update
  AFTER UPDATE OF status ON public.songs
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_song_suggestion_close();
DROP TRIGGER IF EXISTS songs_suggestion_close_delete ON public.songs;
CREATE TRIGGER songs_suggestion_close_delete
  BEFORE DELETE ON public.songs
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_song_suggestion_close();

-- The suggested songs that exist today get their row (no notification: the
-- admins already saw them in the repertoire).
ALTER TABLE public.song_suggestions DISABLE TRIGGER song_suggestions_notify;
INSERT INTO public.song_suggestions (band_id, song_id, kind, created_by, created_at)
SELECT s.band_id, s.id, 'new_song', s.added_by, s.created_at
  FROM public.songs s
 WHERE s.status = 'suggested' AND s.added_by IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = s.added_by)
   AND NOT EXISTS (SELECT 1 FROM public.song_suggestions g WHERE g.song_id = s.id AND g.kind = 'new_song');
ALTER TABLE public.song_suggestions ENABLE TRIGGER song_suggestions_notify;

-- ------------------------------------------------------------ review RPC --

-- p_decision 'accept' | 'reject'. p_applied (accept only): the fields to
-- write, when the admin changed the proposal: {lyrics, chord_chart, notes};
-- without it the proposal is applied as it is (a note is appended to the
-- song's notes). p_edited marks "accepted with changes".
-- Returns {status, song_id, files}: files = storage refs of a rejected
-- suggested song, for the app to remove.
CREATE OR REPLACE FUNCTION public.bw_review_song_suggestion(
  p_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL,
  p_applied jsonb DEFAULT NULL,
  p_edited boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  g record;
  s record;
  v_status text;
  v_apply jsonb := '{}'::jsonb;
  v_fields text[] := '{}';
  v_files jsonb := '[]'::jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO g FROM public.song_suggestions WHERE id = p_id FOR UPDATE;
  IF g.id IS NULL OR NOT public.bw_is_band_admin(g.band_id) THEN
    RAISE EXCEPTION 'Only band admins can review suggestions' USING ERRCODE = '42501';
  END IF;
  IF g.status <> 'pending' THEN
    RAISE EXCEPTION 'This suggestion was already reviewed' USING ERRCODE = '55000';
  END IF;
  IF p_decision NOT IN ('accept', 'reject') THEN
    RAISE EXCEPTION 'Unknown decision' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(v_reason, '')) > 1000 THEN
    RAISE EXCEPTION 'Reason too long' USING ERRCODE = '22001';
  END IF;
  SELECT id, status, notes, audio_url, chart_url INTO s FROM public.songs WHERE id = g.song_id;

  IF p_decision = 'reject' THEN
    v_status := 'rejected';
    UPDATE public.song_suggestions
       SET status = v_status, reason = v_reason, reviewed_by = v_uid, reviewed_at = now()
     WHERE id = g.id;
    IF g.kind = 'new_song' AND s.id IS NOT NULL AND s.status = 'suggested' THEN
      v_files := to_jsonb(array_remove(ARRAY[s.audio_url, s.chart_url], NULL));
      DELETE FROM public.songs WHERE id = s.id;
    END IF;
  ELSE
    IF s.id IS NULL THEN
      RAISE EXCEPTION 'The song no longer exists' USING ERRCODE = '55000';
    END IF;
    v_status := CASE WHEN p_edited THEN 'accepted_edited' ELSE 'accepted' END;
    IF g.kind IN ('lyrics', 'chords') THEN
      v_apply := coalesce(p_applied, g.proposed);
      IF v_apply ? 'lyrics' AND jsonb_typeof(v_apply -> 'lyrics') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'Bad lyrics' USING ERRCODE = '22023';
      END IF;
      IF v_apply ? 'chord_chart' AND jsonb_typeof(v_apply -> 'chord_chart') NOT IN ('object', 'null') THEN
        RAISE EXCEPTION 'Bad chord chart' USING ERRCODE = '22023';
      END IF;
      v_apply := (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
                    FROM jsonb_each(v_apply) WHERE key IN ('lyrics', 'chord_chart'));
    ELSIF g.kind = 'note' THEN
      IF p_applied IS NOT NULL AND p_applied ? 'notes' THEN
        IF jsonb_typeof(p_applied -> 'notes') NOT IN ('string', 'null') THEN
          RAISE EXCEPTION 'Bad notes' USING ERRCODE = '22023';
        END IF;
        v_apply := jsonb_build_object('notes', p_applied -> 'notes');
      ELSE
        v_apply := jsonb_build_object('notes',
          CASE WHEN nullif(btrim(coalesce(s.notes, '')), '') IS NULL THEN g.proposed ->> 'note'
               ELSE rtrim(s.notes) || E'\n\n' || (g.proposed ->> 'note') END);
      END IF;
    END IF;

    UPDATE public.song_suggestions
       SET status = v_status, reason = v_reason, applied = CASE WHEN g.kind = 'new_song' THEN NULL ELSE v_apply END,
           reviewed_by = v_uid, reviewed_at = now()
     WHERE id = g.id;

    IF g.kind = 'new_song' THEN
      IF s.status = 'suggested' THEN
        UPDATE public.songs SET status = 'learning' WHERE id = s.id;
      END IF;
    ELSIF v_apply <> '{}'::jsonb THEN
      UPDATE public.songs SET
        lyrics = CASE WHEN v_apply ? 'lyrics' THEN v_apply ->> 'lyrics' ELSE lyrics END,
        chord_chart = CASE WHEN v_apply ? 'chord_chart' THEN
                        CASE WHEN jsonb_typeof(v_apply -> 'chord_chart') = 'null' THEN NULL ELSE v_apply -> 'chord_chart' END
                      ELSE chord_chart END,
        notes = CASE WHEN v_apply ? 'notes' THEN v_apply ->> 'notes' ELSE notes END
      WHERE id = s.id;
      v_fields := array_remove(ARRAY[
        CASE WHEN v_apply ? 'lyrics' THEN 'lyrics' END,
        CASE WHEN v_apply ? 'chord_chart' THEN 'chords' END,
        CASE WHEN v_apply ? 'notes' THEN 'notes' END], NULL);
    END IF;
  END IF;

  PERFORM public.bw_notify_song_suggestion_outcome(g.id);
  -- The band hears about the changed song (107), like any admin edit.
  IF cardinality(v_fields) > 0 THEN
    PERFORM public.bw_notify_song_updated(s.id, v_fields);
  END IF;

  RETURN jsonb_build_object('status', v_status, 'song_id', g.song_id, 'files', v_files);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_review_song_suggestion(uuid, text, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_review_song_suggestion(uuid, text, text, jsonb, boolean) TO authenticated;

-- The author takes a pending suggestion back (a suggested song is deleted).
CREATE OR REPLACE FUNCTION public.bw_withdraw_song_suggestion(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  g record;
  s record;
  v_files jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO g FROM public.song_suggestions WHERE id = p_id FOR UPDATE;
  IF v_uid IS NULL OR g.id IS NULL OR g.created_by <> v_uid THEN
    RAISE EXCEPTION 'Not your suggestion' USING ERRCODE = '42501';
  END IF;
  IF g.status <> 'pending' THEN
    RAISE EXCEPTION 'This suggestion was already reviewed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.song_suggestions SET status = 'withdrawn', reviewed_at = now() WHERE id = g.id;
  IF g.kind = 'new_song' THEN
    SELECT id, status, audio_url, chart_url INTO s FROM public.songs WHERE id = g.song_id;
    IF s.id IS NOT NULL AND s.status = 'suggested' THEN
      v_files := to_jsonb(array_remove(ARRAY[s.audio_url, s.chart_url], NULL));
      DELETE FROM public.songs WHERE id = s.id;
    END IF;
  END IF;
  -- The admins' unread notification about it goes away.
  DELETE FROM public.notifications
   WHERE type = 'song_suggestion' AND reference_id = g.id AND NOT coalesce(read, false);
  RETURN jsonb_build_object('status', 'withdrawn', 'files', v_files);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_withdraw_song_suggestion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_withdraw_song_suggestion(uuid) TO authenticated;

-- --------------------------------------------------------------- songs RLS --

DROP POLICY IF EXISTS "Band admins can manage songs" ON public.songs;
DROP POLICY IF EXISTS songs_insert_member ON public.songs;
DROP POLICY IF EXISTS songs_update_member ON public.songs;
DROP POLICY IF EXISTS songs_admin_insert ON public.songs;
DROP POLICY IF EXISTS songs_admin_update ON public.songs;
DROP POLICY IF EXISTS songs_admin_delete ON public.songs;
DROP POLICY IF EXISTS songs_member_suggest ON public.songs;

CREATE POLICY songs_admin_insert ON public.songs
  FOR INSERT TO authenticated
  WITH CHECK (public.bw_is_band_admin(band_id));
CREATE POLICY songs_admin_update ON public.songs
  FOR UPDATE TO authenticated
  USING (public.bw_is_band_admin(band_id))
  WITH CHECK (public.bw_is_band_admin(band_id));
CREATE POLICY songs_admin_delete ON public.songs
  FOR DELETE TO authenticated
  USING (public.bw_is_band_admin(band_id));
-- A member suggests a song: it waits as 'suggested' until an admin reviews it.
CREATE POLICY songs_member_suggest ON public.songs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.bw_is_band_member(band_id)
    AND status = 'suggested'
    AND added_by = auth.uid()
    AND coalesce(times_played, 0) = 0
    AND last_played_at IS NULL
    -- Files only from the member's own suggestions folder.
    AND (audio_url IS NULL OR audio_url NOT LIKE 'sb://song-files/%'
         OR audio_url LIKE 'sb://song-files/' || band_id::text || '/suggestions/' || auth.uid()::text || '/%')
    AND (chart_url IS NULL OR chart_url NOT LIKE 'sb://song-files/%'
         OR chart_url LIKE 'sb://song-files/' || band_id::text || '/suggestions/' || auth.uid()::text || '/%')
  );
-- "Band members can view songs" (read for the whole band) stays as it is.

-- ------------------------------------------------------- song-files storage --

DROP POLICY IF EXISTS bw_song_files_member_insert ON storage.objects;
DROP POLICY IF EXISTS bw_song_files_member_update ON storage.objects;
DROP POLICY IF EXISTS bw_song_files_member_delete ON storage.objects;
DROP POLICY IF EXISTS bw_song_files_write_insert ON storage.objects;
DROP POLICY IF EXISTS bw_song_files_write_update ON storage.objects;
DROP POLICY IF EXISTS bw_song_files_write_delete ON storage.objects;

CREATE POLICY bw_song_files_write_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'song-files'
    AND (
      (storage.foldername(name))[1] = ANY (public.bw_my_admin_band_ids())
      OR ((storage.foldername(name))[1] = ANY (public.bw_my_band_ids())
          AND (storage.foldername(name))[2] = 'suggestions'
          AND (storage.foldername(name))[3] = auth.uid()::text)
    )
  );
CREATE POLICY bw_song_files_write_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'song-files'
    AND (
      (storage.foldername(name))[1] = ANY (public.bw_my_admin_band_ids())
      OR ((storage.foldername(name))[1] = ANY (public.bw_my_band_ids())
          AND (storage.foldername(name))[2] = 'suggestions'
          AND (storage.foldername(name))[3] = auth.uid()::text)
    )
  );
CREATE POLICY bw_song_files_write_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'song-files'
    AND (
      (storage.foldername(name))[1] = ANY (public.bw_my_admin_band_ids())
      OR ((storage.foldername(name))[1] = ANY (public.bw_my_band_ids())
          AND (storage.foldername(name))[2] = 'suggestions'
          AND (storage.foldername(name))[3] = auth.uid()::text)
    )
  );

-- ---------------------------------------------------------------- pushes --

-- As live (107), plus song_suggestion / song_suggestion_reviewed.
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

-- Admins see a suggestion arrive while the review screen is open.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'song_suggestions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.song_suggestions;
  END IF;
END $$;

COMMIT;
