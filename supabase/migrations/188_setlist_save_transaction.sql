-- ============================================================================
-- 188 · Saving a setlist in one transaction (audit 383f15b, 09 #3)
-- ----------------------------------------------------------------------------
-- Until now the app saved a setlist as separate requests: rename the setlist,
-- delete every setlist_songs row, insert the new rows, then update
-- song_count. If the app closed or lost signal after the delete, the running
-- order was gone (the "put the old rows back" step is one more request that
-- never ran). Even a plain rename in the repertoire editor took this path.
--
-- bw_save_setlist_songs(setlist, songs, name, expected) does it all in one
-- transaction: any failure rolls back to the setlist as it was.
--
--   p_songs  [{ "song_id": uuid, "set_number": int?, "notes": text? }, …]
--            in play order. "notes" left out keeps the note already stored
--            for that song; "notes": null clears it.
--   p_name   new name, or NULL / blank to keep the current one.
--   p_expected  optional: the setlist as the editor loaded it,
--            { "name": text, "songs": [{ "song_id", "set_number" }, …] } in
--            play order. Two admins on the same setlist: if it changed since
--            (another save, a Stage reorder, an older build's delete +
--            insert, a rename), nothing is written and the answer is
--            { "saved": false, "conflict": true, "current": { name, songs } }.
--            The app then offers "Load the latest version" or "Save mine
--            instead" (the same call with expected = current). NULL: no check.
--   returns  { "saved": true, "previous": [{ song_id, set_number, position }, …],
--              "song_count": n }
--            previous = the order before the save, so the app can sum up the
--            change for the band's push (107, bw_notify_setlist_saved, which
--            the app still calls after this; it is not redefined here).
--
-- Rows for a song already in the setlist stay the same rows, updated in
-- place (position, set, notes when sent): their id and vocal_parts (172: who
-- sings what for this gig is stored per row id) never change, the n-th time
-- a song appears taking the n-th existing row of that song. Only rows of
-- songs taken out are deleted, only new ones inserted. Before, every save
-- gave the rows new ids and dropped their vocal_parts.
--
-- Who: active band admins of the setlist's band (setlists are admin-written
-- since 074). A song must belong to that band or already be in this setlist.
-- Concurrent saves of the same setlist wait for each other (row lock on the
-- setlist). The setlist's song rows are locked too before they are copied:
-- a singer change another admin saves meanwhile (Voice picker, 172) is either
-- in the copy or waits for this save, never put back to the old value.
--
-- Additive only: older TestFlight / APK builds keep doing their own
-- delete + insert on setlist_songs under the 074 policies, unchanged.
-- Needs 172 (setlist_songs.vocal_parts): stops with a message without it.
-- Safe to run more than once.
-- ============================================================================

BEGIN;

-- One function only: an older draft with three parameters next to this one
-- would make PostgREST calls ambiguous (PGRST203). Not live before 188.
DROP FUNCTION IF EXISTS public.bw_save_setlist_songs(uuid, jsonb, text);

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'setlist_songs' AND column_name = 'vocal_parts'
  ) THEN
    RAISE EXCEPTION '188 needs migration 172 first (setlist_songs.vocal_parts is missing)'
      USING ERRCODE = '42703';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.bw_save_setlist_songs(
  p_setlist_id uuid,
  p_songs jsonb,
  p_name text DEFAULT NULL,
  p_expected jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_band uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_prev jsonb;
  v_plan jsonb;
  v_now jsonb;
  v_now_name text;
  v_count integer;
  v_bad integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_songs IS NULL OR jsonb_typeof(p_songs) <> 'array' THEN
    RAISE EXCEPTION 'The songs must be a list' USING ERRCODE = '22023';
  END IF;

  -- One save at a time per setlist.
  SELECT s.band_id INTO v_band FROM public.setlists s WHERE s.id = p_setlist_id FOR UPDATE;
  IF v_band IS NULL OR NOT public.bw_is_band_admin(v_band, v_uid) THEN
    RAISE EXCEPTION 'Only band admins can change setlists' USING ERRCODE = '42501';
  END IF;

  -- Every entry names a song of this band (or one already in this setlist).
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_songs) AS e(item)
   WHERE jsonb_typeof(e.item) <> 'object'
      OR coalesce(e.item ->> 'song_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR NOT (
           EXISTS (SELECT 1 FROM public.songs so WHERE so.id = (e.item ->> 'song_id')::uuid AND so.band_id = v_band)
        OR EXISTS (SELECT 1 FROM public.setlist_songs x WHERE x.setlist_id = p_setlist_id AND x.song_id = (e.item ->> 'song_id')::uuid)
      );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'A song in this setlist is not in the band''s repertoire' USING ERRCODE = '22023';
  END IF;

  -- Lock the rows first, so the copy below holds what is stored now: a
  -- concurrent update of who sings what waits here, or has committed and is
  -- read (each statement sees what committed before it started).
  PERFORM 1 FROM public.setlist_songs ss WHERE ss.setlist_id = p_setlist_id FOR UPDATE;

  -- Written only over the setlist the editor loaded (checked under the locks).
  IF p_expected IS NOT NULL THEN
    IF jsonb_typeof(p_expected) <> 'object' THEN
      RAISE EXCEPTION 'The expected setlist must be an object' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('song_id', ss.song_id, 'set_number', coalesce(ss.set_number, 1))
                              ORDER BY coalesce(ss.set_number, 1), ss.position, ss.id), '[]'::jsonb)
      INTO v_now
      FROM public.setlist_songs ss
     WHERE ss.setlist_id = p_setlist_id;
    SELECT s.name INTO v_now_name FROM public.setlists s WHERE s.id = p_setlist_id;
    IF (p_expected ? 'name' AND v_now_name IS DISTINCT FROM (p_expected ->> 'name'))
       OR (p_expected ? 'songs' AND v_now IS DISTINCT FROM (
             SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'song_id', (e.item ->> 'song_id')::uuid,
                      'set_number', CASE WHEN jsonb_typeof(e.item -> 'set_number') = 'number'
                                         THEN floor((e.item ->> 'set_number')::numeric)::int ELSE 1 END)
                    ORDER BY e.ord), '[]'::jsonb)
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_expected -> 'songs') = 'array'
                                              THEN p_expected -> 'songs' ELSE '[]'::jsonb END)
                    WITH ORDINALITY AS e(item, ord)))
    THEN
      RETURN jsonb_build_object('saved', false, 'conflict', true,
                                'current', jsonb_build_object('name', v_now_name, 'songs', v_now));
    END IF;
  END IF;

  -- The rows as they are now, numbered per song in play order.
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.set_number, r.position, r.id), '[]'::jsonb)
    INTO v_prev
    FROM (
      SELECT ss.id, ss.song_id, ss.position, coalesce(ss.set_number, 1) AS set_number,
             row_number() OVER (PARTITION BY ss.song_id ORDER BY coalesce(ss.set_number, 1), ss.position, ss.id) AS occ
        FROM public.setlist_songs ss
       WHERE ss.setlist_id = p_setlist_id
    ) r;

  -- The new list, each entry with the row it keeps (null: a new row).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'song_id', n.song_id, 'pos', n.pos, 'set_number', n.set_number,
           'has_notes', n.item ? 'notes', 'notes', n.item ->> 'notes') ORDER BY n.pos), '[]'::jsonb)
    INTO v_plan
    FROM (
      SELECT e.item,
             e.ord::int AS pos,
             (e.item ->> 'song_id')::uuid AS song_id,
             CASE WHEN jsonb_typeof(e.item -> 'set_number') = 'number' AND (e.item ->> 'set_number')::numeric >= 1
                  THEN floor((e.item ->> 'set_number')::numeric)::int ELSE 1 END AS set_number,
             row_number() OVER (PARTITION BY e.item ->> 'song_id' ORDER BY e.ord) AS occ
        FROM jsonb_array_elements(p_songs) WITH ORDINALITY AS e(item, ord)
    ) n
    LEFT JOIN jsonb_to_recordset(v_prev) AS p(id uuid, song_id uuid, occ bigint)
      ON p.song_id = n.song_id AND p.occ = n.occ;
  v_count := jsonb_array_length(v_plan);

  -- Rows that stay are changed in place, never deleted and put back: a
  -- singer change saved by another admin while this lock is held then
  -- waits and lands on the updated row (a deleted row would be skipped).
  DELETE FROM public.setlist_songs ss
   WHERE ss.setlist_id = p_setlist_id
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan) x WHERE (x ->> 'id')::uuid = ss.id);

  -- Rows that move go to a free (negative) position first: databases built
  -- from 002 have UNIQUE(setlist_id, position), and a swap would otherwise
  -- collide half-way. The final positions are 1..n, all different.
  UPDATE public.setlist_songs ss
     SET position = -k.pos
    FROM jsonb_to_recordset(v_plan) AS k(id uuid, pos int)
   WHERE k.id IS NOT NULL
     AND ss.id = k.id
     AND ss.setlist_id = p_setlist_id
     AND ss.position IS DISTINCT FROM k.pos;

  UPDATE public.setlist_songs ss
     SET position = k.pos,
         set_number = k.set_number,
         notes = CASE WHEN k.has_notes THEN k.notes ELSE ss.notes END
    FROM jsonb_to_recordset(v_plan) AS k(id uuid, pos int, set_number int, has_notes boolean, notes text)
   WHERE k.id IS NOT NULL
     AND ss.id = k.id
     AND ss.setlist_id = p_setlist_id
     AND (ss.position IS DISTINCT FROM k.pos
          OR ss.set_number IS DISTINCT FROM k.set_number
          OR (k.has_notes AND ss.notes IS DISTINCT FROM k.notes));

  INSERT INTO public.setlist_songs (setlist_id, song_id, position, set_number, notes)
  SELECT p_setlist_id, k.song_id, k.pos, k.set_number, CASE WHEN k.has_notes THEN k.notes END
    FROM jsonb_to_recordset(v_plan) AS k(id uuid, song_id uuid, pos int, set_number int, has_notes boolean, notes text)
   WHERE k.id IS NULL
   ORDER BY k.pos;

  UPDATE public.setlists
     SET song_count = v_count,
         name = coalesce(v_name, name),
         updated_at = now()
   WHERE id = p_setlist_id;

  RETURN jsonb_build_object(
    'saved', true,
    'song_count', v_count,
    'previous', coalesce((
      SELECT jsonb_agg(jsonb_build_object('song_id', x ->> 'song_id', 'set_number', (x ->> 'set_number')::int,
                                          'position', (x ->> 'position')::int) ORDER BY o)
        FROM jsonb_array_elements(v_prev) WITH ORDINALITY AS t(x, o)), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.bw_save_setlist_songs(uuid, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_save_setlist_songs(uuid, jsonb, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.bw_save_setlist_songs(uuid, jsonb, text, jsonb) IS
  'Save a setlist''s name, songs and count in one transaction, optionally only over the state the editor loaded (188, audit 09 #3). Admins of the band.';

COMMIT;
