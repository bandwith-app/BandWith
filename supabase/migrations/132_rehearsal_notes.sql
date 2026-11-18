-- 132 · Rehearsal notes (plan A2): "Mark now, write later", presets, text,
-- for the band or for some members, Practised (per assignee) and OK.
--
-- rehearsal_notes            one note per song (or general), per rehearsal
--                            occurrence (event_id, occurrence_date).
--                            status: 'marked' (one tap in Live mode, details
--                            later) → 'open' → 'ok'.
-- rehearsal_note_assignees   who a note to members is for; each ticks
--                            Practised for themselves.
--
-- Rules (plan §5, approved):
--   Q-A1 admins write and assign to anyone; members write for the band or
--        for themselves (they can't assign others).
--   Q-A2 the whole band reads every note.
--   Q-A4 the assignee marks Practised; OK is set by an admin, or by the
--        author of a note to members; band-wide notes are closed by an admin.
--
-- Ids come from the app (offline: the same note saved twice is one note).
-- Realtime: rehearsal_notes joins supabase_realtime (live sync while Live
-- mode is open); a change of assignees touches its note so it is seen too.
-- RLS on; nothing for anon; explicit column grants (NOTE_COLUMNS /
-- ASSIGNEE_COLUMNS in src/lib/services/rehearsalNotes.ts).
--
-- Additive and idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rehearsal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  session_id uuid REFERENCES public.rehearsal_sessions(id) ON DELETE SET NULL,
  song_id uuid REFERENCES public.songs(id) ON DELETE SET NULL,
  song_title text CHECK (song_title IS NULL OR char_length(song_title) <= 200),
  preset text CHECK (preset IS NULL OR preset IN ('review', 'repeat_section', 'tempo', 'key', 'ending', 'solo', 'nailed')),
  section text CHECK (section IS NULL OR char_length(section) <= 80),
  body text CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 1000),
  scope text NOT NULL DEFAULT 'band' CHECK (scope IN ('band', 'members')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('marked', 'open', 'ok')),
  marked_at_s integer CHECK (marked_at_s IS NULL OR marked_at_s >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ok_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ok_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rehearsal_notes_has_content CHECK (status = 'marked' OR preset IS NOT NULL OR body IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS rehearsal_notes_occurrence_idx ON public.rehearsal_notes (event_id, occurrence_date);
CREATE INDEX IF NOT EXISTS rehearsal_notes_band_open_idx ON public.rehearsal_notes (band_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS rehearsal_notes_song_idx ON public.rehearsal_notes (song_id) WHERE song_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.rehearsal_note_assignees (
  note_id uuid NOT NULL REFERENCES public.rehearsal_notes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  practised_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id)
);

CREATE INDEX IF NOT EXISTS rehearsal_note_assignees_user_idx ON public.rehearsal_note_assignees (user_id);

ALTER TABLE public.rehearsal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rehearsal_note_assignees ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rehearsal_notes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rehearsal_note_assignees FROM PUBLIC, anon, authenticated;

GRANT SELECT (id, band_id, event_id, occurrence_date, session_id, song_id, song_title, preset, section, body, scope, status, marked_at_s, created_by, ok_by, ok_at, created_at, updated_at)
  ON public.rehearsal_notes TO authenticated;
GRANT INSERT (id, band_id, event_id, occurrence_date, session_id, song_id, song_title, preset, section, body, scope, status, marked_at_s)
  ON public.rehearsal_notes TO authenticated;
GRANT UPDATE (id, band_id, event_id, occurrence_date, session_id, song_id, song_title, preset, section, body, scope, status, marked_at_s)
  ON public.rehearsal_notes TO authenticated;
GRANT DELETE ON public.rehearsal_notes TO authenticated;

GRANT SELECT (note_id, user_id, practised_at)
  ON public.rehearsal_note_assignees TO authenticated;
GRANT INSERT (note_id, user_id) ON public.rehearsal_note_assignees TO authenticated;
GRANT UPDATE (practised_at) ON public.rehearsal_note_assignees TO authenticated;
GRANT DELETE ON public.rehearsal_note_assignees TO authenticated;

-- Helpers (definer: they read the note whatever the caller's policies).
CREATE OR REPLACE FUNCTION public.bw_rehearsal_note_band(p_note_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT band_id FROM rehearsal_notes WHERE id = p_note_id;
$function$;

CREATE OR REPLACE FUNCTION public.bw_rehearsal_note_author(p_note_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT created_by FROM rehearsal_notes WHERE id = p_note_id;
$function$;

REVOKE ALL ON FUNCTION public.bw_rehearsal_note_band(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bw_rehearsal_note_author(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_rehearsal_note_band(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bw_rehearsal_note_author(uuid) TO authenticated;

-- ── rehearsal_notes policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS rehearsal_notes_member_select ON public.rehearsal_notes;
DROP POLICY IF EXISTS rehearsal_notes_insert ON public.rehearsal_notes;
DROP POLICY IF EXISTS rehearsal_notes_update ON public.rehearsal_notes;
DROP POLICY IF EXISTS rehearsal_notes_delete ON public.rehearsal_notes;

CREATE POLICY rehearsal_notes_member_select ON public.rehearsal_notes
  FOR SELECT TO authenticated
  USING (public.bw_is_band_member(band_id));

CREATE POLICY rehearsal_notes_insert ON public.rehearsal_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.bw_is_band_member(band_id)
    AND public.bw_event_band_id(event_id) = band_id
    AND created_by = auth.uid()
  );

CREATE POLICY rehearsal_notes_update ON public.rehearsal_notes
  FOR UPDATE TO authenticated
  USING (public.bw_is_band_member(band_id) AND (public.bw_is_band_admin(band_id) OR created_by = auth.uid()))
  WITH CHECK (public.bw_is_band_member(band_id) AND public.bw_event_band_id(event_id) = band_id);

CREATE POLICY rehearsal_notes_delete ON public.rehearsal_notes
  FOR DELETE TO authenticated
  USING (public.bw_is_band_member(band_id) AND (public.bw_is_band_admin(band_id) OR created_by = auth.uid()));

-- Author, OK and the occurrence are the database's to set.
CREATE OR REPLACE FUNCTION public.bw_trg_rehearsal_note_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The app sends no author: it is who writes. (The insert policy checks it.)
    NEW.created_by := COALESCE(me, NEW.created_by);
    NEW.created_at := now();
    IF NEW.status = 'ok' THEN
      RAISE EXCEPTION 'A new note is not OK yet' USING ERRCODE = '22023';
    END IF;
    NEW.ok_by := NULL;
    NEW.ok_at := NULL;
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.band_id := OLD.band_id;
    NEW.event_id := OLD.event_id;
    NEW.occurrence_date := OLD.occurrence_date;
    IF NEW.status = 'ok' AND OLD.status IS DISTINCT FROM 'ok' THEN
      IF OLD.status = 'marked' THEN
        RAISE EXCEPTION 'A mark is written before it is OK' USING ERRCODE = '22023';
      END IF;
      IF me IS NOT NULL AND NOT (
        public.bw_is_band_admin(NEW.band_id, me)
        OR (NEW.scope = 'members' AND OLD.created_by = me)
      ) THEN
        RAISE EXCEPTION 'Only an admin (or the author of a note to members) confirms it OK' USING ERRCODE = '42501';
      END IF;
      NEW.ok_by := me;
      NEW.ok_at := now();
    ELSIF NEW.status IS DISTINCT FROM 'ok' THEN
      NEW.ok_by := NULL;
      NEW.ok_at := NULL;
    ELSE
      NEW.ok_by := OLD.ok_by;
      NEW.ok_at := OLD.ok_at;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rehearsal_notes_guard ON public.rehearsal_notes;
CREATE TRIGGER rehearsal_notes_guard BEFORE INSERT OR UPDATE ON public.rehearsal_notes
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_rehearsal_note_guard();

-- ── rehearsal_note_assignees policies ────────────────────────────────────
DROP POLICY IF EXISTS rehearsal_note_assignees_select ON public.rehearsal_note_assignees;
DROP POLICY IF EXISTS rehearsal_note_assignees_insert ON public.rehearsal_note_assignees;
DROP POLICY IF EXISTS rehearsal_note_assignees_update ON public.rehearsal_note_assignees;
DROP POLICY IF EXISTS rehearsal_note_assignees_delete ON public.rehearsal_note_assignees;

CREATE POLICY rehearsal_note_assignees_select ON public.rehearsal_note_assignees
  FOR SELECT TO authenticated
  USING (public.bw_is_band_member(public.bw_rehearsal_note_band(note_id)));

-- Admins assign any band member; a member assigns only themselves, on their own note.
CREATE POLICY rehearsal_note_assignees_insert ON public.rehearsal_note_assignees
  FOR INSERT TO authenticated
  WITH CHECK (
    public.bw_is_band_member(public.bw_rehearsal_note_band(note_id), user_id)
    AND (
      public.bw_is_band_admin(public.bw_rehearsal_note_band(note_id))
      OR (user_id = auth.uid() AND public.bw_rehearsal_note_author(note_id) = auth.uid())
    )
  );

-- Practised: the assignee for themselves (or an admin).
CREATE POLICY rehearsal_note_assignees_update ON public.rehearsal_note_assignees
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.bw_is_band_admin(public.bw_rehearsal_note_band(note_id)))
  WITH CHECK (user_id = auth.uid() OR public.bw_is_band_admin(public.bw_rehearsal_note_band(note_id)));

CREATE POLICY rehearsal_note_assignees_delete ON public.rehearsal_note_assignees
  FOR DELETE TO authenticated
  USING (
    public.bw_is_band_admin(public.bw_rehearsal_note_band(note_id))
    OR (user_id = auth.uid() AND public.bw_rehearsal_note_author(note_id) = auth.uid())
  );

-- A change of assignees (Practised too) touches its note: Realtime carries it.
CREATE OR REPLACE FUNCTION public.bw_trg_rehearsal_note_assignee_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE rehearsal_notes SET updated_at = now() WHERE id = COALESCE(NEW.note_id, OLD.note_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_rehearsal_note_assignee_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rehearsal_note_assignees_touch ON public.rehearsal_note_assignees;
CREATE TRIGGER rehearsal_note_assignees_touch AFTER INSERT OR UPDATE OR DELETE ON public.rehearsal_note_assignees
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_rehearsal_note_assignee_touch();

-- ── Realtime ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rehearsal_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rehearsal_notes;
  END IF;
END;
$$;

COMMIT;
