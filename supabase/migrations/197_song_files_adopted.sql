-- ============================================================================
-- 197: an accepted suggested song's files are the band's (audit 09 #5, #9)
-- ----------------------------------------------------------------------------
-- 108 lets a member write in <band>/suggestions/<their id>/ (the files of a
-- song they suggest) and nowhere else. The folder stayed theirs after the
-- song was accepted: when an admin approved it from the song menu (Approve ·
-- learning, Mark as ready) only the status changed, and the member could
-- still replace or delete the recording or chart the band now uses.
--
-- 1. Storage: a member's update / delete in their suggestions folder only
--    applies to files no accepted song uses (a song of the band whose status
--    is no longer 'suggested' and whose audio_url or chart_url is the file).
--    While the song waits for review nothing changes for them. Admins keep
--    every right in the band's folder; upload (insert) is as in 108.
--
-- 2. Moving the files (the app does the Storage part): copy, repoint, sweep.
--    Nothing here can leave a song on a missing file, whatever runs at once
--    (two admins, one admin on phone + iPad) or stops half-way:
--      bw_song_file_adopt_begin(song, field)
--        admin only, song row locked. When the song is past review and its
--        field is a suggestions-folder file: {won, from, to}. `to` is
--        <band>/<kind>/<song id>-<name>, unique per song (no collision with
--        another song's file, even one named the same on purpose). Another
--        admin's run of the last 2 minutes: {won: false, reason: 'busy'}.
--      bw_song_file_adopt_repoint(song, field, from, to)
--        song row locked (FOR UPDATE); repoints only if the field is still
--        `from`: {won, ref (current), to_referenced}. A won repoint records
--        `from` for the sweep, in the same transaction.
--      bw_song_file_copy_reserve(song, field, from, to)
--        right before each copy: the destination is registered
--        (song_file_copies; {registered, reserved_at}); the
--        repoint closes it. One never linked (the run stopped, the song
--        went) is swept after 10 minutes, never an object that was there
--        before its first registration (storage created_at < reserved_at:
--        a name collision, someone else's file).
--      bw_song_file_copy_release(song, to)
--        a destination the run gave up (another file was there, so it
--        picked another name): its registration goes, so only the name
--        finally chosen stays registered.
--      bw_song_file_sweep_list(band)
--        the recorded originals nothing references any more (checked across
--        all songs and pending member suggestions), lapsed delete claims of
--        the band and stale registered copies nothing uses, and band objects
--        older than a day nothing uses or records (rolling backfill), all
--        claimed again by bw_song_file_sweep_claim under the file lock and
--        closed by bw_song_file_sweep_done (only the caller's claims), so no
--        file stays orphaned. Lapsed claims of used or missing files are
--        cleared. First it repairs: a song on a missing suggestion file
--        whose moved copy (an older build's Storage move to
--        <band>/<kind>/<name>) is there, unlinked, gets that copy (rows
--        locked in id order; a field changed meanwhile, e.g. a re-upload
--        on another device, is left as it is). It lists only claims that
--        were there when it started (one it makes waits for the next
--        visit). The scan of all the band's objects runs at most every 6
--        hours per band (song_file_band_scan).
--      bw_song_file_sweep_claim(band, path)
--        right before each delete, the file key locked: re-checks that no
--        song and no member suggestion links the path, then marks it
--        'deleting' ({ok: true}); else {ok: false, reason: 'referenced' |
--        'busy' | 'gone'} and the app skips it. While a path is 'deleting'
--        (or removed), triggers on songs and song_suggestions refuse to link
--        it (BW_FILE_REMOVED, SQLSTATE BWF02); their lock makes a link and a
--        claim wait for each other, so one always sees the other.
--      bw_song_file_sweep_done(band, paths)
--        after the Storage delete: claimed rows marked 'cleaned'. A delete
--        that failed leaves the claim, which lapses after 10 minutes: the
--        path is pending again and the next sweep retries it.
--    song_file_adoptions: that record. No access for anon / authenticated
--    (RLS on, no grants): only these functions (and the service role).
--
-- 3. A file another song (or a pending suggestion: its ref as the value of
--    an audio_url / chart_url key, not text) uses is never removed:
--    bw_review_song_suggestion / bw_withdraw_song_suggestion (108, otherwise
--    unchanged; withdraw identical to 180's on fix/account-deletion,
--    16e85658) return only the files of the song's band nothing
--    else uses, already claimed for deletion (withdraw: of the band of the
--    suggestion it withdrew, also for a member of several bands). Reject closes the suggestion
--    before deleting the song (as 108), so the author is notified once. The app deletes
--    only through a claim: bw_song_files_claim_delete (under the file keys'
--    exclusive locks; claimed files can't be linked), the Storage delete,
--    then bw_song_files_removed; a failed delete lapses after 10 minutes.
--    Only files in Storage are claimed, and a member holds at most 200
--    open claims.
--    Someone outside the band gets 42501 before any file check (songs and
--    suggestions). No song
--    (an admin's either) links another band's file (42501); a member's
--    can't link a file another song of the band uses (BW_FILE_IN_USE,
--    SQLSTATE BWF01). An app user can't link a file no longer in Storage
--    (BW_FILE_REMOVED, BWF02; archived objects and delete markers count as
--    gone where storage.objects has those columns).
--
-- 4. Storage deletes need a claim: bw_song_files_delete_claimed, a
--    RESTRICTIVE delete policy on song-files (bw_song_files_write_delete,
--    PERMISSIVE, stays as is: who; this one: when). A delete goes through
--    only with the user's own claim of the last 10 minutes on a file nothing
--    links. Links stay refused for 15 minutes after a claim, so a delete
--    that started in time never races a link. Other buckets (personal-files)
--    are untouched. Older builds' deletes without a claim (replacing a
--    file, deleting a song, rolling back an upload) are refused: an orphan
--    in Storage, never a lost file.
--
-- 5. song_file_adoptions / song_file_removals / song_file_copies rows go
--    with their band (band_id FK, ON DELETE CASCADE).
--
-- 6. Orphans are collected: a file a song no longer has (deleted or
--    replaced, also by older builds, whose own delete is refused) becomes a
--    lapsed delete claim (songs_file_left, AFTER DELETE / UPDATE OF
--    audio_url, chart_url); the sweep re-checks and deletes it. Once, here,
--    stored song-files objects older than a day that nothing uses get the
--    same lapsed claim (nothing is deleted by the migration); after that the
--    sweep keeps finding such objects itself (bw_song_file_orphans: e.g. an
--    older build's refused rollback of a fresh upload, which nothing
--    records). Age is the later of created_at and updated_at of every
--    version at that name, on the live row (180's live-row predicate). In
--    a band's final folders an orphan is deleted only 7 days after the
--    sweep first saw it (song_file_orphan_seen; a link forgets it): an
--    older build accepts with a Storage move, which keeps created_at, and
--    links the moved file in a separate update.
--
-- 7. songs(audio_url) / songs(chart_url) are indexed for stored refs only
--    ('sb://song-files/%'): a pasted link of any length still saves.
--
-- Links and deletes of one file are ordered by one advisory lock on the
-- file's key (shared to link, exclusive to claim), so a link can't slip in
-- between a delete's check and the delete, whatever state its record is in.
--
-- Older builds keep working: same policies' names and folders, the review
-- and withdraw RPCs keep their arguments and result (the files list can only
-- be shorter), their move + update still works for admins, and they never
-- link a file being deleted or another song's file (they link only new
-- uploads). Their Storage deletes outside reject / withdraw are refused (an
-- orphan for the sweep, see 4 and 6). Safe to run more than once.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_song_file_adopted(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.songs s
     WHERE s.band_id::text = split_part(p_name, '/', 1)
       AND s.band_id::text = ANY (public.bw_my_band_ids())
       AND s.status IS DISTINCT FROM 'suggested'
       AND (s.audio_url = 'sb://song-files/' || p_name OR s.chart_url = 'sb://song-files/' || p_name)
  );
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_adopted(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_adopted(text) TO authenticated;

-- ------------------------------------------------- moving accepted files --

CREATE TABLE IF NOT EXISTS public.song_file_adoptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id uuid NOT NULL,
  song_id uuid NOT NULL,
  field text NOT NULL CHECK (field IN ('audio_url', 'chart_url')),
  from_path text NOT NULL,
  to_path text,
  state text NOT NULL DEFAULT 'copying',
  claimed_by uuid,
  claimed_at timestamptz,
  deleting_by uuid,
  deleting_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (song_id, field, from_path)
);
ALTER TABLE public.song_file_adoptions ADD COLUMN IF NOT EXISTS deleting_by uuid;
ALTER TABLE public.song_file_adoptions ADD COLUMN IF NOT EXISTS deleting_at timestamptz;
ALTER TABLE public.song_file_adoptions DROP CONSTRAINT IF EXISTS song_file_adoptions_state_check;
ALTER TABLE public.song_file_adoptions ADD CONSTRAINT song_file_adoptions_state_check
  CHECK (state IN ('copying', 'repointed', 'deleting', 'cleaned'));
CREATE INDEX IF NOT EXISTS song_file_adoptions_sweep_idx ON public.song_file_adoptions (band_id, state);
CREATE INDEX IF NOT EXISTS song_file_adoptions_path_idx ON public.song_file_adoptions (from_path);
ALTER TABLE public.song_file_adoptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.song_file_adoptions FROM PUBLIC, anon, authenticated;

-- 'sb://song-files/' || path, the reference songs store.
CREATE OR REPLACE FUNCTION public.bw_song_file_ref(p_path text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT 'sb://song-files/' || p_path;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_ref(text) FROM PUBLIC, anon, authenticated;

-- The song-file paths a jsonb value links: the string values of its
-- file-holding keys (audio_url, chart_url, at any depth) that are a ref of
-- this band, 'sb://song-files/<band>/...'. Nothing else counts: lyrics,
-- notes, a message or a reason that happen to hold a ref are text.
-- The suggestion trigger and the in-use check both read it, so they agree.
CREATE OR REPLACE FUNCTION public.bw_song_file_json_paths(p_json jsonb, p_band_id uuid)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(DISTINCT x.p ORDER BY x.p), '{}'::text[])
    FROM (SELECT substr(v #>> '{}', length('sb://song-files/') + 1) AS p
            FROM jsonb_path_query(coalesce(p_json, 'null'::jsonb),
                                  '$.**.audio_url ? (@.type() == "string" && @ starts with $p)',
                                  jsonb_build_object('p', 'sb://song-files/' || p_band_id::text || '/')) v
          UNION ALL
          SELECT substr(v #>> '{}', length('sb://song-files/') + 1)
            FROM jsonb_path_query(coalesce(p_json, 'null'::jsonb),
                                  '$.**.chart_url ? (@.type() == "string" && @ starts with $p)',
                                  jsonb_build_object('p', 'sb://song-files/' || p_band_id::text || '/')) v) x
   WHERE p_band_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_json_paths(jsonb, uuid) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.bw_song_file_json_needle(text);

-- A pending member suggestion of the file's band links this file: its ref
-- is the value of a file key (audio_url / chart_url) in proposed /
-- original / applied (bw_song_file_json_paths). Only that band (its files
-- are its members'; no other band's rows are read). Reviewed, withdrawn or
-- rejected suggestions, and free text, keep no file.
CREATE OR REPLACE FUNCTION public.bw_song_file_in_suggestion(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.song_suggestions g
                  WHERE g.band_id = CASE WHEN split_part(p_path, '/', 1)
                                               ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                         THEN split_part(p_path, '/', 1)::uuid END
                    AND g.status = 'pending'
                    AND p_path = ANY (public.bw_song_file_json_paths(g.proposed, g.band_id)
                                      || public.bw_song_file_json_paths(g.original, g.band_id)
                                      || public.bw_song_file_json_paths(g.applied, g.band_id)));
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_in_suggestion(text) FROM PUBLIC, anon, authenticated;

-- The paths the band's pending member suggestions link (as above), read
-- once: the sweep and the orphan scan check many files against them.
CREATE OR REPLACE FUNCTION public.bw_song_file_pending_paths(p_band_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(DISTINCT x.p), '{}'::text[])
    FROM public.song_suggestions g
   CROSS JOIN LATERAL unnest(public.bw_song_file_json_paths(g.proposed, g.band_id)
                             || public.bw_song_file_json_paths(g.original, g.band_id)
                             || public.bw_song_file_json_paths(g.applied, g.band_id)) x(p)
   WHERE g.band_id = p_band_id AND g.status = 'pending';
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_pending_paths(uuid) FROM PUBLIC, anon, authenticated;

-- A song (of any band) links this file. Each field by the condition of its
-- index (stored refs only).
CREATE OR REPLACE FUNCTION public.bw_song_file_used_by_song(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.songs s
                  WHERE s.audio_url LIKE 'sb://song-files/%' AND s.audio_url = public.bw_song_file_ref(p_path))
      OR EXISTS (SELECT 1 FROM public.songs s
                  WHERE s.chart_url LIKE 'sb://song-files/%' AND s.chart_url = public.bw_song_file_ref(p_path));
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_used_by_song(text) FROM PUBLIC, anon, authenticated;

-- Anything links to this file: a song (of any band) or a member suggestion
-- of its band.
CREATE OR REPLACE FUNCTION public.bw_song_file_in_use(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.bw_song_file_used_by_song(p_path) OR public.bw_song_file_in_suggestion(p_path);
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_in_use(text) FROM PUBLIC, anon, authenticated;

-- One lock orders every link and every delete of a file: a link takes the
-- file key's shared transaction lock (songs trigger), a delete claim (sweep
-- or delete) the exclusive one. Either the link commits first and the
-- claim's re-check sees it, or the claim commits first and the link sees the
-- file being removed. It works with or without a record row (a file still
-- 'copying', or one never adopted). Member suggestions mention files as
-- text: they take the band key (shared) and claims take it too (exclusive).
-- Claims lock their file keys (sorted) before the band key; links only ever
-- take one kind, in sorted order, so the two can't deadlock.
CREATE OR REPLACE FUNCTION public.bw_song_file_lock_key(p_path text)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT hashtextextended('bw:song-file:' || coalesce(p_path, ''), 0);
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_lock_key(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_song_file_band_key(p_band_id uuid)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT hashtextextended('bw:song-file-band:' || coalesce(p_band_id::text, ''), 0);
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_band_key(uuid) FROM PUBLIC, anon, authenticated;

-- Delete claims outside the sweep (deleting a song, replacing a file,
-- rejecting / withdrawing a suggested song): the file is being removed
-- until the app says it is gone; a delete that failed: 10 minutes for its
-- Storage delete, 15 with links refused, then the sweep retries it.
CREATE TABLE IF NOT EXISTS public.song_file_removals (
  path text PRIMARY KEY,
  band_id uuid NOT NULL,
  claimed_by uuid,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS song_file_removals_band_idx ON public.song_file_removals (band_id);
-- A band's file records go with the band.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'song_file_adoptions_band_fk') THEN
    ALTER TABLE public.song_file_adoptions
      ADD CONSTRAINT song_file_adoptions_band_fk FOREIGN KEY (band_id) REFERENCES public.bands (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'song_file_removals_band_fk') THEN
    ALTER TABLE public.song_file_removals
      ADD CONSTRAINT song_file_removals_band_fk FOREIGN KEY (band_id) REFERENCES public.bands (id) ON DELETE CASCADE;
  END IF;
END;
$$;
ALTER TABLE public.song_file_removals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.song_file_removals FROM PUBLIC, anon, authenticated;

-- Copies a move registers right before making them
-- (bw_song_file_copy_reserve): one the repoint never linked (the run
-- stopped, the song went) is deleted by the sweep after 10 minutes
-- (made_at: the latest registration). reserved_at: the first one; an
-- object older than that was already there (a name collision), not this
-- move's copy, and the sweep never deletes it.
CREATE TABLE IF NOT EXISTS public.song_file_copies (
  path text PRIMARY KEY,
  band_id uuid NOT NULL,
  song_id uuid NOT NULL,
  made_by uuid,
  made_at timestamptz NOT NULL DEFAULT now(),
  reserved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.song_file_copies ADD COLUMN IF NOT EXISTS reserved_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS song_file_copies_band_idx ON public.song_file_copies (band_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'song_file_copies_band_fk') THEN
    ALTER TABLE public.song_file_copies
      ADD CONSTRAINT song_file_copies_band_fk FOREIGN KEY (band_id) REFERENCES public.bands (id) ON DELETE CASCADE;
  END IF;
END;
$$;
ALTER TABLE public.song_file_copies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.song_file_copies FROM PUBLIC, anon, authenticated;

-- Unlinked old objects in a band's final folders (not a suggestions
-- folder), by when the sweep first saw them: deleted only if still
-- unlinked 7 days later (Claude review of 28cb3199, B1: an older build
-- accepts with a Storage move, which keeps the upload's created_at, then
-- links the moved file in a separate update). A link forgets the sighting.
CREATE TABLE IF NOT EXISTS public.song_file_orphan_seen (
  path text PRIMARY KEY,
  band_id uuid NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS song_file_orphan_seen_band_idx ON public.song_file_orphan_seen (band_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'song_file_orphan_seen_band_fk') THEN
    ALTER TABLE public.song_file_orphan_seen
      ADD CONSTRAINT song_file_orphan_seen_band_fk FOREIGN KEY (band_id) REFERENCES public.bands (id) ON DELETE CASCADE;
  END IF;
END;
$$;
ALTER TABLE public.song_file_orphan_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.song_file_orphan_seen FROM PUBLIC, anon, authenticated;

-- The refs every file check looks up (bw_song_file_used_by_song, the
-- orphan scan): stored refs only, by the same condition, so a pasted link
-- of any length still saves (a btree entry has a size limit: Claude review
-- of a474bbfb, MINOR 3).
DROP INDEX IF EXISTS public.songs_audio_url_idx;
DROP INDEX IF EXISTS public.songs_chart_url_idx;
CREATE INDEX IF NOT EXISTS songs_audio_ref_idx ON public.songs (audio_url) WHERE audio_url LIKE 'sb://song-files/%';
CREATE INDEX IF NOT EXISTS songs_chart_ref_idx ON public.songs (chart_url) WHERE chart_url LIKE 'sb://song-files/%';

-- When the band's orphan scan (every object of the band) last ran: at most
-- every 6 hours (Claude review of a474bbfb, MINOR 4). Only the sweep reads
-- it (RLS on, no grants); it goes with its band.
CREATE TABLE IF NOT EXISTS public.song_file_band_scan (
  band_id uuid PRIMARY KEY REFERENCES public.bands (id) ON DELETE CASCADE,
  last_scan_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.song_file_band_scan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.song_file_band_scan FROM PUBLIC, anon, authenticated;

-- The file is in Storage: a row in storage.objects that is not archived and
-- not a delete marker (prod storage has archived_at / is_delete_marker; a
-- setup without them, e.g. local or PGlite, checks the row alone). Built
-- from the columns present when this runs; re-run 197 if they appear later.
-- The live-row predicate is the one 180's bw_storage_live_filter() builds
-- (the PGlite test compares them).
DO $do$
DECLARE
  v_pred text := '';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'storage.objects'::regclass AND attname = 'archived_at' AND attnum > 0 AND NOT attisdropped) THEN
    v_pred := v_pred || ' AND o.archived_at IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'storage.objects'::regclass AND attname = 'is_delete_marker' AND attnum > 0 AND NOT attisdropped) THEN
    v_pred := v_pred || ' AND NOT coalesce(o.is_delete_marker, false)';
  END IF;
  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.bw_song_file_stored(p_path text)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $b$
      SELECT EXISTS (SELECT 1 FROM storage.objects o
                      WHERE o.bucket_id = 'song-files' AND o.name = p_path%s);
    $b$;
  $f$, v_pred);
END;
$do$;
REVOKE ALL ON FUNCTION public.bw_song_file_stored(text) FROM PUBLIC, anon, authenticated;

-- A registered copy path the sweep may delete: no object there older than
-- the first registration (an object that was already there is someone
-- else's file). Built from storage.objects' created_at (without it: any).
DO $do$
DECLARE
  v_pred text := 'true';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'storage.objects'::regclass AND attname = 'created_at' AND attnum > 0 AND NOT attisdropped) THEN
    v_pred := $a$NOT EXISTS (SELECT 1 FROM storage.objects o
                             WHERE o.bucket_id = 'song-files' AND o.name = p_path AND o.created_at < p_reserved_at)$a$;
  END IF;
  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.bw_song_file_copy_ours(p_path text, p_reserved_at timestamptz)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $b$
      SELECT %s;
    $b$;
  $f$, v_pred);
END;
$do$;
REVOKE ALL ON FUNCTION public.bw_song_file_copy_ours(text, timestamptz) FROM PUBLIC, anon, authenticated;

-- The file is being deleted, or was (no new link to it). A claim allows
-- its Storage delete for 10 minutes (the delete policy below) and blocks
-- links for 15, so a delete that started in time never races a link.
CREATE OR REPLACE FUNCTION public.bw_song_file_being_removed(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.song_file_adoptions a WHERE a.from_path = p_path AND a.state IN ('deleting', 'cleaned'))
      OR EXISTS (SELECT 1 FROM public.song_file_removals r WHERE r.path = p_path AND r.claimed_at >= now() - interval '15 minutes');
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_being_removed(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_song_file_adopt_begin(p_song_id uuid, p_field text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  s record;
  a record;
  v_ref text;
  v_from text;
  v_parts text[];
  v_to text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_field IS NULL OR p_field NOT IN ('audio_url', 'chart_url') THEN
    RAISE EXCEPTION 'Unknown field' USING ERRCODE = '22023';
  END IF;
  SELECT id, band_id, status, audio_url, chart_url INTO s FROM public.songs WHERE id = p_song_id FOR UPDATE;
  IF s.id IS NULL OR NOT public.bw_is_band_admin(s.band_id, v_uid) THEN
    RAISE EXCEPTION 'Only band admins can move song files' USING ERRCODE = '42501';
  END IF;
  IF s.status IS NOT DISTINCT FROM 'suggested' THEN
    RETURN jsonb_build_object('won', false, 'reason', 'waiting');
  END IF;
  v_ref := CASE p_field WHEN 'audio_url' THEN s.audio_url ELSE s.chart_url END;
  IF v_ref IS NULL OR left(v_ref, length(public.bw_song_file_ref(s.band_id::text || '/suggestions/')))
                      IS DISTINCT FROM public.bw_song_file_ref(s.band_id::text || '/suggestions/') THEN
    RETURN jsonb_build_object('won', false, 'reason', 'nothing', 'ref', v_ref);
  END IF;
  v_from := substr(v_ref, length(public.bw_song_file_ref('')) + 1);
  v_parts := string_to_array(v_from, '/');
  IF array_length(v_parts, 1) IS DISTINCT FROM 5 OR coalesce(v_parts[4], '') NOT IN ('audio', 'chart') OR coalesce(v_parts[5], '') = '' THEN
    RETURN jsonb_build_object('won', false, 'reason', 'nothing', 'ref', v_ref);
  END IF;
  v_to := v_parts[1] || '/' || v_parts[4] || '/' || s.id::text || '-' || v_parts[5];

  SELECT * INTO a FROM public.song_file_adoptions
   WHERE song_id = s.id AND field = p_field AND from_path = v_from FOR UPDATE;
  IF a.id IS NOT NULL AND a.state = 'copying' AND a.claimed_by IS DISTINCT FROM v_uid
     AND a.claimed_at > now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('won', false, 'reason', 'busy');
  END IF;
  INSERT INTO public.song_file_adoptions (band_id, song_id, field, from_path, to_path, state, claimed_by, claimed_at, updated_at)
  VALUES (s.band_id, s.id, p_field, v_from, v_to, 'copying', v_uid, now(), now())
  ON CONFLICT (song_id, field, from_path) DO UPDATE
    SET to_path = EXCLUDED.to_path, state = 'copying', claimed_by = v_uid, claimed_at = now(), updated_at = now();
  RETURN jsonb_build_object('won', true, 'from', v_from, 'to', v_to);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_adopt_begin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_adopt_begin(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.bw_song_file_adopt_repoint(p_song_id uuid, p_field text, p_from text, p_to text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  s record;
  v_ref text;
  v_parts text[];
  v_prefix text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_field IS NULL OR p_field NOT IN ('audio_url', 'chart_url') THEN
    RAISE EXCEPTION 'Unknown field' USING ERRCODE = '22023';
  END IF;
  SELECT id, band_id, audio_url, chart_url INTO s FROM public.songs WHERE id = p_song_id FOR UPDATE;
  IF s.id IS NULL OR NOT public.bw_is_band_admin(s.band_id, v_uid) THEN
    RAISE EXCEPTION 'Only band admins can move song files' USING ERRCODE = '42501';
  END IF;
  -- From: a file of this band's suggestions folders. To: this song's own name in the band's folder.
  v_parts := string_to_array(coalesce(p_from, ''), '/');
  IF array_length(v_parts, 1) IS DISTINCT FROM 5 OR v_parts[1] IS DISTINCT FROM s.band_id::text
     OR v_parts[2] IS DISTINCT FROM 'suggestions'
     OR coalesce(v_parts[4], '') NOT IN ('audio', 'chart') OR coalesce(v_parts[5], '') = '' THEN
    RAISE EXCEPTION 'Bad source' USING ERRCODE = '22023';
  END IF;
  v_prefix := s.band_id::text || '/' || v_parts[4] || '/' || s.id::text || '-';
  IF p_to IS NULL OR v_prefix IS NULL OR left(p_to, length(v_prefix)) IS DISTINCT FROM v_prefix OR length(p_to) = length(v_prefix)
     OR position('/' IN substr(p_to, length(v_prefix) + 1)) > 0 OR length(p_to) > 400 THEN
    RAISE EXCEPTION 'Bad destination' USING ERRCODE = '22023';
  END IF;

  v_ref := CASE p_field WHEN 'audio_url' THEN s.audio_url ELSE s.chart_url END;
  IF v_ref IS DISTINCT FROM public.bw_song_file_ref(p_from) THEN
    -- Changed meanwhile (another run won, or an admin edited the song): nothing written.
    UPDATE public.song_file_adoptions SET claimed_by = NULL, updated_at = now()
     WHERE song_id = s.id AND field = p_field AND from_path = p_from AND claimed_by = v_uid AND state = 'copying';
    RETURN jsonb_build_object('won', false, 'ref', v_ref, 'to_referenced', public.bw_song_file_in_use(p_to));
  END IF;

  -- The original, recorded for the sweep in the same transaction (before
  -- the update: the songs trigger then leaves it to this record).
  INSERT INTO public.song_file_adoptions (band_id, song_id, field, from_path, to_path, state, updated_at)
  VALUES (s.band_id, s.id, p_field, p_from, p_to, 'repointed', now())
  ON CONFLICT (song_id, field, from_path) DO UPDATE
    SET to_path = EXCLUDED.to_path, state = 'repointed', claimed_by = NULL, updated_at = now();
  UPDATE public.songs SET
    audio_url = CASE WHEN p_field = 'audio_url' THEN public.bw_song_file_ref(p_to) ELSE audio_url END,
    chart_url = CASE WHEN p_field = 'chart_url' THEN public.bw_song_file_ref(p_to) ELSE chart_url END
   WHERE id = s.id;
  -- The copy is the song's now: no leftover.
  DELETE FROM public.song_file_copies WHERE path = p_to;
  RETURN jsonb_build_object('won', true, 'ref', public.bw_song_file_ref(p_to), 'to_referenced', true);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_adopt_repoint(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_adopt_repoint(uuid, text, text, text) TO authenticated;

-- Before each copy: the destination is registered (same rules as the
-- repoint's), so a copy no song ends up linking is found by the sweep.
-- Returns {registered: this call registered it (false: an earlier or
-- parallel run did), reserved_at: the first registration (an object made
-- after it is this move's copy)}. Only the app of this PR calls it.
DO $$
BEGIN
  IF to_regprocedure('public.bw_song_file_copy_reserve(uuid, text, text, text)') IS NOT NULL
     AND (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('public.bw_song_file_copy_reserve(uuid, text, text, text)')) <> 'jsonb'::regtype THEN
    DROP FUNCTION public.bw_song_file_copy_reserve(uuid, text, text, text);
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.bw_song_file_copy_reserve(p_song_id uuid, p_field text, p_from text, p_to text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  s record;
  v_parts text[];
  v_prefix text;
  v_new boolean;
  v_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_field IS NULL OR p_field NOT IN ('audio_url', 'chart_url') THEN
    RAISE EXCEPTION 'Unknown field' USING ERRCODE = '22023';
  END IF;
  SELECT id, band_id INTO s FROM public.songs WHERE id = p_song_id;
  IF s.id IS NULL OR NOT public.bw_is_band_admin(s.band_id, v_uid) THEN
    RAISE EXCEPTION 'Only band admins can move song files' USING ERRCODE = '42501';
  END IF;
  v_parts := string_to_array(coalesce(p_from, ''), '/');
  IF array_length(v_parts, 1) IS DISTINCT FROM 5 OR v_parts[1] IS DISTINCT FROM s.band_id::text
     OR v_parts[2] IS DISTINCT FROM 'suggestions'
     OR coalesce(v_parts[4], '') NOT IN ('audio', 'chart') OR coalesce(v_parts[5], '') = '' THEN
    RAISE EXCEPTION 'Bad source' USING ERRCODE = '22023';
  END IF;
  v_prefix := s.band_id::text || '/' || v_parts[4] || '/' || s.id::text || '-';
  IF p_to IS NULL OR left(p_to, length(v_prefix)) IS DISTINCT FROM v_prefix OR length(p_to) = length(v_prefix)
     OR position('/' IN substr(p_to, length(v_prefix) + 1)) > 0 OR length(p_to) > 400 THEN
    RAISE EXCEPTION 'Bad destination' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.song_file_copies (path, band_id, song_id, made_by, made_at, reserved_at)
  VALUES (p_to, s.band_id, s.id, v_uid, now(), now())
  ON CONFLICT (path) DO UPDATE SET made_by = EXCLUDED.made_by, made_at = now()
  RETURNING (xmax = 0), reserved_at INTO v_new, v_at;
  RETURN jsonb_build_object('registered', v_new, 'reserved_at', v_at);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_copy_reserve(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_copy_reserve(uuid, text, text, text) TO authenticated;

-- A destination the run gave up (a different file was already there, so
-- it picked another name): its registration goes. Only the admin who last
-- registered it, of the song's band; true when one went.
CREATE OR REPLACE FUNCTION public.bw_song_file_copy_release(p_song_id uuid, p_to text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  s record;
  n integer;
BEGIN
  SELECT id, band_id INTO s FROM public.songs WHERE id = p_song_id;
  IF v_uid IS NULL OR s.id IS NULL OR NOT public.bw_is_band_admin(s.band_id, v_uid) THEN
    RAISE EXCEPTION 'Only band admins can move song files' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.song_file_copies
   WHERE path = p_to AND band_id = s.band_id AND song_id = s.id AND made_by = v_uid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_copy_release(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_copy_release(uuid, text) TO authenticated;

-- Rolling backfill: band objects that nothing uses and nothing records (no
-- claim, no registered copy, no move in progress), and whose every version
-- at that name is older than a day: older builds' refused deletes (a failed
-- save's rollback of its fresh upload) and other leftovers. With p_path,
-- that one. The row found is the live one (not archived, not a delete
-- marker: Codex review of 28cb3199, B1, versioned Storage keeps old rows
-- next to a fresh upload), and age is the later of created_at and
-- updated_at of every row at that name (Claude B1). Built from the columns
-- storage.objects has (without created_at, none). The sweep lists them
-- (final folders only after their 7-day grace, bw_song_file_orphan_due).
-- The band's pending suggestions are read once per scan (p_pending: the
-- sweep passes what it read already; Claude review of a474bbfb, MINOR 4).
DROP FUNCTION IF EXISTS public.bw_song_file_orphans(uuid, text);
DO $do$
DECLARE
  v_live text := '';
  v_age text := 'false';
  v_at text := 'v.created_at';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'storage.objects'::regclass AND attname = 'archived_at' AND attnum > 0 AND NOT attisdropped) THEN
    v_live := v_live || ' AND o.archived_at IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'storage.objects'::regclass AND attname = 'is_delete_marker' AND attnum > 0 AND NOT attisdropped) THEN
    v_live := v_live || ' AND NOT coalesce(o.is_delete_marker, false)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'storage.objects'::regclass AND attname = 'updated_at' AND attnum > 0 AND NOT attisdropped) THEN
    v_at := 'greatest(v.created_at, coalesce(v.updated_at, v.created_at))';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'storage.objects'::regclass AND attname = 'created_at' AND attnum > 0 AND NOT attisdropped) THEN
    -- No version at that name (archived or not) is recent, or of unknown age.
    v_age := format($a$NOT EXISTS (SELECT 1 FROM storage.objects v
                                    WHERE v.bucket_id = 'song-files' AND v.name = o.name
                                      AND (v.created_at IS NULL OR %s >= now() - interval '24 hours'))$a$, v_at);
  END IF;
  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.bw_song_file_orphans(p_band_id uuid, p_path text DEFAULT NULL, p_pending text[] DEFAULT NULL)
    RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $b$
      SELECT DISTINCT o.name
        FROM storage.objects o
       CROSS JOIN (SELECT coalesce(p_pending, public.bw_song_file_pending_paths(p_band_id)) AS sp) k
       WHERE o.bucket_id = 'song-files'
         AND o.name COLLATE "C" LIKE (p_band_id::text || '/%%') COLLATE "C"
         AND (p_path IS NULL OR o.name = p_path)%s
         AND %s
         AND NOT public.bw_song_file_used_by_song(o.name)
         AND NOT (o.name = ANY (k.sp))
         AND NOT EXISTS (SELECT 1 FROM public.song_file_removals r WHERE r.path = o.name)
         AND NOT EXISTS (SELECT 1 FROM public.song_file_copies c WHERE c.path = o.name)
         AND NOT EXISTS (SELECT 1 FROM public.song_file_adoptions a
                          WHERE (a.from_path = o.name OR a.to_path = o.name) AND a.state IN ('copying', 'repointed', 'deleting'));
    $b$;
  $f$, v_live, v_age);
END;
$do$;
REVOKE ALL ON FUNCTION public.bw_song_file_orphans(uuid, text, text[]) FROM PUBLIC, anon, authenticated;

-- An orphan the sweep may delete now: one in a suggestions folder (24 hours
-- old, as above), or one in a final folder first seen 7 days ago.
CREATE OR REPLACE FUNCTION public.bw_song_file_orphan_due(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT split_part(p_path, '/', 2) = 'suggestions'
      OR EXISTS (SELECT 1 FROM public.song_file_orphan_seen s
                  WHERE s.path = p_path AND s.first_seen_at < now() - interval '7 days');
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_orphan_due(text) FROM PUBLIC, anon, authenticated;

-- Originals of moved files that no song links to any more: safe to delete.
CREATE OR REPLACE FUNCTION public.bw_song_file_sweep_list(p_band_id uuid)
RETURNS text[]
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_before text[];
  v_sp text[];
  v_ids uuid[];
  v_fields text[];
  v_froms text[];
  v_dests text[];
  v_scan boolean;
  v_orphans text[] := '{}'::text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.bw_is_band_admin(p_band_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only band admins can move song files' USING ERRCODE = '42501';
  END IF;
  -- The claims there when this call starts: only those are listed. One
  -- this call makes (its repair lets a file go) waits for the next visit,
  -- so a file never goes out in the same call that made it a claim (Claude
  -- review of a474bbfb, BLOCKER).
  v_before := ARRAY(SELECT r.path FROM public.song_file_removals r WHERE r.band_id = p_band_id);
  -- The band's pending suggestions' files, read once (MINOR 4).
  v_sp := public.bw_song_file_pending_paths(p_band_id);
  -- Repair first (Claude review of 28cb3199, B1): an older build's accept
  -- moved a suggestion file to <band>/<kind>/<name> and its link of the
  -- moved file failed. A song of the band on a missing suggestion file gets
  -- that file when it is there, linked by nothing and claimed by nobody,
  -- and no other song would map to it. It is then in use: never deleted.
  SELECT array_agg(u.id ORDER BY u.id, u.field), array_agg(u.field ORDER BY u.id, u.field),
         array_agg(u.p ORDER BY u.id, u.field), array_agg(u.dest ORDER BY u.id, u.field)
    INTO v_ids, v_fields, v_froms, v_dests
    FROM (
      WITH c AS (
        SELECT s.id, f.field, f.p,
               p_band_id::text || '/' || split_part(f.p, '/', 4) || '/' || split_part(f.p, '/', 5) AS dest
          FROM public.songs s
         CROSS JOIN LATERAL (VALUES ('audio_url', s.audio_url), ('chart_url', s.chart_url)) v(field, ref)
         CROSS JOIN LATERAL (SELECT v.field, substr(v.ref, length('sb://song-files/') + 1) AS p) f
         WHERE s.band_id = p_band_id
           AND v.ref LIKE 'sb://song-files/' || p_band_id::text || '/suggestions/%'
           AND array_length(string_to_array(f.p, '/'), 1) = 5
           AND split_part(f.p, '/', 4) IN ('audio', 'chart') AND split_part(f.p, '/', 5) <> ''
           AND NOT public.bw_song_file_stored(f.p)
      )
      SELECT c.* FROM c
       WHERE (SELECT count(*) FROM c c2 WHERE c2.dest = c.dest) = 1
         AND public.bw_song_file_stored(c.dest)
         AND NOT public.bw_song_file_in_use(c.dest)
         AND NOT public.bw_song_file_being_removed(c.dest)
    ) u;
  IF v_ids IS NOT NULL THEN
    -- Its songs locked in id order, as the claims are (NIT 5); each field
    -- changes only if it is still the missing file it looked at. A field
    -- changed meanwhile (a re-upload on another device) stays as it is,
    -- and a song changed in both is left alone (BLOCKER).
    -- Another device may claim or delete a copy after the look-up above:
    -- the link trigger then refuses it (BWF02). Only the repair waits for
    -- the next visit; the rest of this sweep goes on (Claude review of
    -- 364284f6). Nothing else is caught.
    BEGIN
      PERFORM 1 FROM public.songs s WHERE s.id = ANY (v_ids) ORDER BY s.id FOR UPDATE;
      UPDATE public.songs s
         SET audio_url = CASE WHEN s.audio_url = 'sb://song-files/' || f.a_from THEN 'sb://song-files/' || f.a_dest ELSE s.audio_url END,
             chart_url = CASE WHEN s.chart_url = 'sb://song-files/' || f.c_from THEN 'sb://song-files/' || f.c_dest ELSE s.chart_url END
        FROM (SELECT x.id,
                     max(x.p) FILTER (WHERE x.field = 'audio_url') AS a_from,
                     max(x.dest) FILTER (WHERE x.field = 'audio_url') AS a_dest,
                     max(x.p) FILTER (WHERE x.field = 'chart_url') AS c_from,
                     max(x.dest) FILTER (WHERE x.field = 'chart_url') AS c_dest
                FROM unnest(v_ids, v_fields, v_froms, v_dests) x(id, field, p, dest)
               GROUP BY x.id) f
       WHERE s.id = f.id
         AND (s.audio_url = 'sb://song-files/' || f.a_from OR s.chart_url = 'sb://song-files/' || f.c_from);
    EXCEPTION WHEN SQLSTATE 'BWF02' THEN
      RAISE LOG 'bw_song_file_sweep_list: repair of band % skipped this visit: %', p_band_id, SQLERRM;
    END;
  END IF;
  -- Lapsed claims nothing needs: the file is used again (another song, a
  -- pending suggestion), or is not in Storage (Codex B2): they go.
  DELETE FROM public.song_file_removals r
   WHERE r.band_id = p_band_id AND r.claimed_at < now() - interval '15 minutes'
     AND (public.bw_song_file_used_by_song(r.path) OR r.path = ANY (v_sp) OR NOT public.bw_song_file_stored(r.path));
  -- A registration over an object that was already there, a day old (its
  -- release failed): the row goes, never the object.
  DELETE FROM public.song_file_copies c
   WHERE c.band_id = p_band_id AND c.reserved_at < now() - interval '1 day'
     AND NOT public.bw_song_file_copy_ours(c.path, c.reserved_at);
  -- First sightings in final folders: forgotten once used or gone.
  DELETE FROM public.song_file_orphan_seen s
   WHERE s.band_id = p_band_id
     AND (public.bw_song_file_used_by_song(s.path) OR s.path = ANY (v_sp) OR NOT public.bw_song_file_stored(s.path));
  -- The scan of every object of the band: once per call, and at most
  -- every 6 hours per band (MINOR 4). Its new final-folder orphans are
  -- recorded (their 7 days start now).
  INSERT INTO public.song_file_band_scan AS b (band_id, last_scan_at) VALUES (p_band_id, now())
  ON CONFLICT (band_id) DO UPDATE SET last_scan_at = now()
   WHERE b.last_scan_at < now() - interval '6 hours'
  RETURNING true INTO v_scan;
  IF v_scan THEN
    v_orphans := ARRAY(SELECT o FROM public.bw_song_file_orphans(p_band_id, NULL, v_sp) o);
    INSERT INTO public.song_file_orphan_seen (path, band_id, first_seen_at)
    SELECT o, p_band_id, now() FROM unnest(v_orphans) o
     WHERE split_part(o, '/', 2) <> 'suggestions'
    ON CONFLICT (path) DO NOTHING;
  END IF;
  RETURN coalesce((
    SELECT array_agg(DISTINCT x.p ORDER BY x.p) FROM (
      SELECT a.from_path AS p
        FROM public.song_file_adoptions a
       WHERE a.band_id = p_band_id
         AND (a.state = 'repointed' OR (a.state = 'deleting' AND a.deleting_at < now() - interval '10 minutes'))
         AND a.from_path LIKE p_band_id::text || '/suggestions/%'
      UNION
      -- Lapsed delete claims (the app stopped before the delete or before
      -- bw_song_files_removed): retried here, so no file stays orphaned.
      -- Only claims that were there when this call started.
      SELECT r.path
        FROM public.song_file_removals r
       WHERE r.band_id = p_band_id
         AND r.claimed_at < now() - interval '10 minutes'
         AND r.path LIKE p_band_id::text || '/%'
         AND r.path = ANY (v_before)
      UNION
      -- Copies registered for a move that never repointed (the run stopped,
      -- or the song went) after 10 minutes.
      -- Never an object that was there before the registration.
      SELECT c.path
        FROM public.song_file_copies c
       WHERE c.band_id = p_band_id
         AND c.made_at < now() - interval '10 minutes'
         AND c.path LIKE p_band_id::text || '/%'
         AND public.bw_song_file_copy_ours(c.path, c.reserved_at)
      UNION
      -- At most 200 orphans per visit, of this call's scan.
      SELECT z.o FROM (SELECT o FROM unnest(v_orphans) o
                        WHERE public.bw_song_file_orphan_due(o) ORDER BY 1 LIMIT 200) z) x
     WHERE NOT public.bw_song_file_used_by_song(x.p) AND NOT (x.p = ANY (v_sp))), '{}'::text[]);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_sweep_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_sweep_list(uuid) TO authenticated;

-- Right before deleting one original: under the file key's exclusive lock
-- (and the record's row lock), nothing may link it; then it is 'deleting'
-- (a lapsed claim, 10 minutes, counts as pending again).
CREATE OR REPLACE FUNCTION public.bw_song_file_sweep_claim(p_band_id uuid, p_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.bw_is_band_admin(p_band_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only band admins can move song files' USING ERRCODE = '42501';
  END IF;
  -- Waits for any link of this file (or suggestion of this band) in progress.
  PERFORM pg_advisory_xact_lock(public.bw_song_file_lock_key(p_path));
  PERFORM pg_advisory_xact_lock(public.bw_song_file_band_key(p_band_id));
  SELECT * INTO a FROM public.song_file_adoptions
   WHERE band_id = p_band_id AND from_path = p_path AND state IN ('repointed', 'deleting')
     AND from_path LIKE p_band_id::text || '/suggestions/%'
   ORDER BY updated_at DESC LIMIT 1
   FOR UPDATE;
  IF a.id IS NULL THEN
    -- Not in Storage: nothing to delete; its lapsed (or own) claim and its
    -- stale registration go.
    IF NOT public.bw_song_file_stored(p_path) THEN
      DELETE FROM public.song_file_removals
       WHERE path = p_path AND band_id = p_band_id
         AND (claimed_at < now() - interval '10 minutes' OR claimed_by = auth.uid());
      DELETE FROM public.song_file_copies
       WHERE path = p_path AND band_id = p_band_id AND made_at < now() - interval '10 minutes';
      RETURN jsonb_build_object('ok', false, 'reason', 'gone');
    END IF;
    -- A lapsed delete claim, a stale unused copy, or an orphan that is due:
    -- claimed now for this admin.
    IF EXISTS (SELECT 1 FROM public.song_file_removals r
                WHERE r.path = p_path AND r.band_id = p_band_id AND r.path LIKE p_band_id::text || '/%')
       OR EXISTS (SELECT 1 FROM public.song_file_copies c
                   WHERE c.path = p_path AND c.band_id = p_band_id AND c.made_at < now() - interval '10 minutes'
                     AND c.path LIKE p_band_id::text || '/%'
                     AND public.bw_song_file_copy_ours(c.path, c.reserved_at))
       OR (EXISTS (SELECT 1 FROM public.bw_song_file_orphans(p_band_id, p_path))
           AND public.bw_song_file_orphan_due(p_path)) THEN
      IF cardinality(public.bw_song_files_claim_for(ARRAY[public.bw_song_file_ref(p_path)], auth.uid(), true)) > 0 THEN
        DELETE FROM public.song_file_copies WHERE path = p_path;
        RETURN jsonb_build_object('ok', true);
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason',
        CASE WHEN public.bw_song_file_in_use(p_path) THEN 'referenced' ELSE 'busy' END);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'gone');
  END IF;
  IF a.state = 'deleting' AND a.deleting_at >= now() - interval '10 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'busy');
  END IF;
  -- A new statement: it sees every link committed before this lock was taken.
  IF public.bw_song_file_in_use(p_path) THEN
    UPDATE public.song_file_adoptions SET state = 'repointed', deleting_by = NULL, deleting_at = NULL, updated_at = now()
     WHERE id = a.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'referenced');
  END IF;
  UPDATE public.song_file_adoptions SET state = 'deleting', deleting_by = auth.uid(), deleting_at = now(), updated_at = now()
   WHERE id = a.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_sweep_claim(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_sweep_claim(uuid, text) TO authenticated;

-- After the Storage delete: the claimed rows are done.
CREATE OR REPLACE FUNCTION public.bw_song_file_sweep_done(p_band_id uuid, p_paths text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n integer;
  m integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.bw_is_band_admin(p_band_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only band admins can move song files' USING ERRCODE = '42501';
  END IF;
  UPDATE public.song_file_adoptions SET state = 'cleaned', updated_at = now()
   WHERE band_id = p_band_id AND state = 'deleting' AND deleting_by = auth.uid()
     AND from_path = ANY (coalesce(p_paths, '{}'::text[]));
  GET DIAGNOSTICS n = ROW_COUNT;
  -- And the delete claims this admin's sweep retried (and unclaimed
  -- leftovers of the same files: they are gone).
  DELETE FROM public.song_file_removals
   WHERE band_id = p_band_id AND (claimed_by = auth.uid() OR claimed_by IS NULL)
     AND path = ANY (coalesce(p_paths, '{}'::text[]));
  GET DIAGNOSTICS m = ROW_COUNT;
  -- Their first sightings too (the files are gone).
  DELETE FROM public.song_file_orphan_seen
   WHERE band_id = p_band_id AND path = ANY (coalesce(p_paths, '{}'::text[]));
  RETURN n + m;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_sweep_done(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_sweep_done(uuid, text[]) TO authenticated;

-- Outside the band: the generic refusal (42501) before any file check. A
-- song (an admin's too) links only files of its band's folder (42501, so
-- nothing tells whether another band uses one); a member's, never one
-- another song of the band uses (BW_FILE_IN_USE). No song links a file being
-- deleted, removed or no longer in Storage (BW_FILE_REMOVED), under the
-- file key's shared lock.
-- Older builds never hit either: they link only files they just uploaded
-- and keep the ones a song has (an unchanged field is not checked).
CREATE OR REPLACE FUNCTION public.bw_trg_song_file_not_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ref text;
  v_path text;
  v_paths text[] := '{}';
BEGIN
  FOREACH v_ref IN ARRAY ARRAY[NEW.audio_url, NEW.chart_url] LOOP
    CONTINUE WHEN v_ref IS NULL OR v_ref NOT LIKE 'sb://song-files/%';
    IF TG_OP = 'UPDATE' AND (v_ref IS NOT DISTINCT FROM OLD.audio_url OR v_ref IS NOT DISTINCT FROM OLD.chart_url) THEN
      CONTINUE;
    END IF;
    v_path := substr(v_ref, length('sb://song-files/') + 1);
    -- First of all: someone outside the band (a former member, say) gets
    -- the generic refusal, before anything about the file is looked at.
    -- (This trigger runs before the table's RLS check.)
    IF auth.uid() IS NOT NULL AND NOT (NEW.band_id::text = ANY (public.bw_my_band_ids())) THEN
      RAISE EXCEPTION 'Not allowed to link this file' USING ERRCODE = '42501';
    END IF;
    -- Only the band's own folder, for admins too.
    IF auth.uid() IS NOT NULL AND split_part(v_path, '/', 1) IS DISTINCT FROM NEW.band_id::text THEN
      RAISE EXCEPTION 'Not allowed to link this file' USING ERRCODE = '42501';
    END IF;
    IF auth.uid() IS NOT NULL AND NOT public.bw_is_band_admin(NEW.band_id, auth.uid()) THEN
      -- (rejecting their song would then remove a file the band uses)
      IF EXISTS (SELECT 1 FROM public.songs o
                  WHERE o.band_id = NEW.band_id AND o.id IS DISTINCT FROM NEW.id
                    AND (o.audio_url = v_ref OR o.chart_url = v_ref)) THEN
        RAISE EXCEPTION 'BW_FILE_IN_USE: this file belongs to another song; upload it again'
          USING ERRCODE = 'BWF01';
      END IF;
    END IF;
    v_paths := v_paths || v_path;
  END LOOP;
  -- Sorted within the row. A single statement that links files on several
  -- songs takes each row's locks in turn, so two such statements could still
  -- deadlock (Postgres then cancels one; nothing is lost). No app path does
  -- that: the app links one song per statement.
  FOR v_path IN SELECT DISTINCT p FROM unnest(v_paths) p ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock_shared(public.bw_song_file_lock_key(v_path));
  END LOOP;
  -- New statements: they see a claim (or a delete) that committed while we
  -- waited. An app user's link to a file no longer in Storage (deleted
  -- after its claim lapsed, archived, a delete marker, or never uploaded:
  -- bw_song_file_stored) is refused the same way (the service role may set
  -- a ref before its upload).
  FOREACH v_path IN ARRAY v_paths LOOP
    IF public.bw_song_file_being_removed(v_path)
       OR (auth.uid() IS NOT NULL
           AND NOT public.bw_song_file_stored(v_path)) THEN
      RAISE EXCEPTION 'BW_FILE_REMOVED: this file is being removed; upload it again'
        USING ERRCODE = 'BWF02';
    END IF;
  END LOOP;
  -- Linked: no longer an orphan (a later unlink starts a new grace).
  IF cardinality(v_paths) > 0 THEN
    DELETE FROM public.song_file_orphan_seen WHERE path = ANY (v_paths);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_song_file_not_removed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS songs_file_not_removed ON public.songs;
CREATE TRIGGER songs_file_not_removed
  BEFORE INSERT OR UPDATE OF audio_url, chart_url ON public.songs
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_song_file_not_removed();

-- A file a song no longer has (deleted, or replaced: older builds then
-- delete it from Storage without a claim, which is refused) becomes a
-- lapsed delete claim: the sweep re-checks that nothing uses it, under the
-- file lock, and deletes it. Only files of the song's own band, and only
-- while the band exists (a band's cascade delete adds nothing). The claim
-- is dated past the 15-minute link block: it never blocks a link.
CREATE OR REPLACE FUNCTION public.bw_trg_song_file_left()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ref text;
BEGIN
  FOREACH v_ref IN ARRAY ARRAY[OLD.audio_url, OLD.chart_url] LOOP
    CONTINUE WHEN v_ref IS NULL OR OLD.band_id IS NULL OR v_ref NOT LIKE 'sb://song-files/' || OLD.band_id::text || '/%';
    CONTINUE WHEN TG_OP = 'UPDATE' AND (v_ref IS NOT DISTINCT FROM NEW.audio_url OR v_ref IS NOT DISTINCT FROM NEW.chart_url);
    -- A moved original has its own record (the repoint writes it first).
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.song_file_adoptions a
                           WHERE a.from_path = substr(v_ref, length('sb://song-files/') + 1)
                             AND a.state IN ('repointed', 'deleting', 'cleaned'));
    INSERT INTO public.song_file_removals (path, band_id, claimed_by, claimed_at)
    SELECT substr(v_ref, length('sb://song-files/') + 1), OLD.band_id, NULL, now() - interval '16 minutes'
     WHERE EXISTS (SELECT 1 FROM public.bands b WHERE b.id = OLD.band_id)
       AND public.bw_song_file_stored(substr(v_ref, length('sb://song-files/') + 1))
    ON CONFLICT (path) DO NOTHING;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_song_file_left() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS songs_file_left ON public.songs;
CREATE TRIGGER songs_file_left
  AFTER DELETE OR UPDATE OF audio_url, chart_url ON public.songs
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_song_file_left();

-- The same for member suggestions. First of all, someone outside the band
-- gets the generic refusal (42501), before anything is looked up (this
-- trigger runs before the table's RLS check). Then a suggestion that links
-- (a ref as a JSON value, not free text) a file of its band being deleted
-- or removed is refused, under the band key's shared lock (claims take it
-- exclusive, after their file keys). It fires only on the JSON columns: a
-- review saving its reason never takes the band key. Older builds only put
-- lyrics, chords and notes here, never a file ref.
CREATE OR REPLACE FUNCTION public.bw_trg_song_suggestion_file_not_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_paths text[];
  v_path text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (NEW.band_id::text = ANY (public.bw_my_band_ids())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NEW.band_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_paths := ARRAY(SELECT DISTINCT x FROM unnest(public.bw_song_file_json_paths(NEW.proposed, NEW.band_id)
                                                 || public.bw_song_file_json_paths(NEW.original, NEW.band_id)
                                                 || public.bw_song_file_json_paths(NEW.applied, NEW.band_id)) x ORDER BY 1);
  IF cardinality(v_paths) = 0 THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(public.bw_song_file_band_key(NEW.band_id));
  FOREACH v_path IN ARRAY v_paths LOOP
    IF public.bw_song_file_being_removed(v_path) THEN
      RAISE EXCEPTION 'BW_FILE_REMOVED: this file is being removed; upload it again'
        USING ERRCODE = 'BWF02';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_song_suggestion_file_not_removed() FROM PUBLIC, anon, authenticated;
-- Named to fire after song_suggestions_fill (triggers run by name), on the
-- values the row is stored with.
DROP TRIGGER IF EXISTS song_suggestions_fill_then_file_check ON public.song_suggestions;
CREATE TRIGGER song_suggestions_fill_then_file_check
  BEFORE INSERT OR UPDATE OF proposed, original, applied ON public.song_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_song_suggestion_file_not_removed();

-- ------------------------------------------- files another song still uses --
--
-- Rejecting or withdrawing a suggested song, deleting a song or replacing a
-- file removed its files even when another song links the same file (a
-- member could insert a suggested song pointing at a band song's recording
-- through the API; rejecting it deleted the band's file). Now:
--   bw_review_song_suggestion / bw_withdraw_song_suggestion return only the
--     files nothing else uses, claimed for deletion (same shape; older
--     builds remove that list; their claim lapses after 10 minutes).
--   bw_song_files_claim_delete(refs) claims the refs the user may delete
--     that nothing uses; the app removes only those, then
--     bw_song_files_removed(refs). (No check-only function: a separate
--     check and delete would let a link slip in between.)
--   A member can't insert (or update) a song pointing at a file another
--     song of the band uses (BW_FILE_IN_USE), nor another band's file: the
--     songs trigger above. Older builds only link files they just uploaded,
--     so they never hit it.

DROP FUNCTION IF EXISTS public.bw_song_files_unused(text[]);

-- Of these refs, claims for deletion the stored files nothing uses, under
-- the file keys' exclusive locks (then the band keys'): each one returned is
-- 'being removed' (no new link) until bw_song_files_removed or 15 minutes;
-- its Storage delete is allowed for 10.
-- p_check: only files the user may delete (an admin: the band's; a member:
-- their own suggestion files). Never says "unused" without a claim.
DROP FUNCTION IF EXISTS public.bw_song_files_claim_for(text[], uuid, boolean);
CREATE OR REPLACE FUNCTION public.bw_song_files_claim_for(p_refs text[], p_uid uuid, p_check boolean, p_band_id uuid DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_paths text[];
  v_path text;
  v_band text;
  r record;
  v_out text[] := '{}';
  v_open integer;
BEGIN
  IF p_uid IS NULL THEN
    RETURN v_out;
  END IF;
  v_paths := ARRAY(
    SELECT DISTINCT substr(x, length('sb://song-files/') + 1) AS p
      FROM unnest(coalesce(p_refs, '{}'::text[])) x
     WHERE x LIKE 'sb://song-files/%'
       AND split_part(substr(x, length('sb://song-files/') + 1), '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       -- A removed song's files (no check): only the song's band (p_band_id);
       -- without it, none.
       AND (p_check OR (p_band_id IS NOT NULL AND split_part(substr(x, length('sb://song-files/') + 1), '/', 1) = p_band_id::text))
       AND (NOT p_check
            OR public.bw_is_band_admin(split_part(substr(x, length('sb://song-files/') + 1), '/', 1)::uuid, p_uid)
            OR (split_part(substr(x, length('sb://song-files/') + 1), '/', 1) = ANY (public.bw_my_band_ids())
                AND split_part(substr(x, length('sb://song-files/') + 1), '/', 2) = 'suggestions'
                AND split_part(substr(x, length('sb://song-files/') + 1), '/', 3) = p_uid::text))
     ORDER BY 1);
  FOREACH v_path IN ARRAY v_paths LOOP
    PERFORM pg_advisory_xact_lock(public.bw_song_file_lock_key(v_path));
  END LOOP;
  FOR v_band IN SELECT DISTINCT split_part(p, '/', 1) FROM unnest(v_paths) p ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(public.bw_song_file_band_key(v_band::uuid));
  END LOOP;
  -- New statements: they see every link committed while we waited.
  FOREACH v_path IN ARRAY v_paths LOOP
    CONTINUE WHEN public.bw_song_file_in_use(v_path);
    -- Only a file in Storage (Codex review of 28cb3199, B2: no claims for
    -- files that don't exist).
    CONTINUE WHEN NOT public.bw_song_file_stored(v_path);
    SELECT * INTO r FROM public.song_file_removals WHERE path = v_path;
    CONTINUE WHEN r.path IS NOT NULL AND r.claimed_by IS DISTINCT FROM p_uid AND r.claimed_at >= now() - interval '10 minutes';
    -- A member (not an admin of the file's band) holds at most 200 open
    -- claims; one they already hold doesn't count again.
    IF NOT public.bw_is_band_admin(split_part(v_path, '/', 1)::uuid, p_uid) THEN
      IF v_open IS NULL THEN
        SELECT count(*) INTO v_open FROM public.song_file_removals
         WHERE claimed_by = p_uid AND claimed_at >= now() - interval '15 minutes';
      END IF;
      IF NOT (r.path IS NOT NULL AND r.claimed_by = p_uid AND r.claimed_at >= now() - interval '15 minutes') THEN
        CONTINUE WHEN v_open >= 200;
        v_open := v_open + 1;
      END IF;
    END IF;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.song_file_adoptions a
                           WHERE a.from_path = v_path AND a.state = 'deleting' AND a.deleting_at >= now() - interval '10 minutes');
    INSERT INTO public.song_file_removals (path, band_id, claimed_by, claimed_at)
    VALUES (v_path, split_part(v_path, '/', 1)::uuid, p_uid, now())
    ON CONFLICT (path) DO UPDATE SET claimed_by = EXCLUDED.claimed_by, claimed_at = EXCLUDED.claimed_at;
    v_out := v_out || ('sb://song-files/' || v_path);
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_files_claim_for(text[], uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;

-- For the withdraw RPC (197's and 180's, identical; 180 calls it by name
-- with the refs only): of the withdrawn song's refs, those nothing else
-- uses, claimed for the calling user (jsonb array, the RPC's `files`). Call
-- it after deleting the song row. Only files of the suggestion's own band
-- (Codex review of ed7ec29f, B2): the band of the one suggestion the caller
-- withdrew in this transaction (reviewed_at = now(), the transaction's
-- time); none found (or several): nothing is claimed. Older builds delete
-- the list right away; the claim then lapses.
CREATE OR REPLACE FUNCTION public.bw_song_files_left_unused(p_refs text[])
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bands uuid[];
BEGIN
  v_bands := ARRAY(SELECT DISTINCT g.band_id FROM public.song_suggestions g
                    WHERE g.created_by = auth.uid() AND g.status = 'withdrawn'
                      AND g.reviewed_at = now() AND g.band_id IS NOT NULL);
  IF auth.uid() IS NULL OR cardinality(v_bands) <> 1 THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN to_jsonb(public.bw_song_files_claim_for(p_refs, auth.uid(), false, v_bands[1]));
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_files_left_unused(text[]) FROM PUBLIC, anon, authenticated;

-- For the app: claim, delete from Storage only what this returned, then
-- bw_song_files_removed. A delete that fails leaves the claim to lapse.
CREATE OR REPLACE FUNCTION public.bw_song_files_claim_delete(p_refs text[])
RETURNS text[]
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.bw_song_files_claim_for(p_refs, auth.uid(), true);
$$;
REVOKE ALL ON FUNCTION public.bw_song_files_claim_delete(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_files_claim_delete(text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.bw_song_files_removed(p_refs text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n integer;
BEGIN
  -- The caller's own claims of these files; a registered copy among them
  -- is no leftover any more (only those this call released, and only in
  -- bands the caller is an admin of).
  WITH released AS (
    DELETE FROM public.song_file_removals
     WHERE claimed_by = auth.uid()
       AND path = ANY (ARRAY(SELECT substr(x, length('sb://song-files/') + 1) FROM unnest(coalesce(p_refs, '{}'::text[])) x
                              WHERE x LIKE 'sb://song-files/%'))
    RETURNING path, band_id
  ), unregistered AS (
    DELETE FROM public.song_file_copies c
     USING released r
     WHERE c.path = r.path AND c.band_id::text = ANY (public.bw_my_admin_band_ids())
    RETURNING c.path
  )
  SELECT count(*) INTO n FROM released;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_files_removed(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_files_removed(text[]) TO authenticated;

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
  IF g.status IS DISTINCT FROM 'pending' THEN
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
    -- The suggestion first, as 108: the song's delete trigger (108/180)
    -- then finds it closed and doesn't notify a second time (without the
    -- reason). This UPDATE fires no file check (status / reason only), so
    -- the claim below takes its file keys, then band keys, with none held.
    UPDATE public.song_suggestions
       SET status = v_status, reason = v_reason, reviewed_by = v_uid, reviewed_at = now()
     WHERE id = g.id;
    IF g.kind = 'new_song' AND s.id IS NOT NULL AND s.status = 'suggested' THEN
      DELETE FROM public.songs WHERE id = s.id;
      -- Only files of the song's band nothing else uses (197), claimed for
      -- the app to delete: another song may link the same one.
      v_files := to_jsonb(public.bw_song_files_claim_for(ARRAY[s.audio_url, s.chart_url], v_uid, false, g.band_id));
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
-- Identical to bw_withdraw_song_suggestion in 180_account_deletion_safety.sql
-- (fix/account-deletion at 16e85658; unchanged since 837c53f6): IS DISTINCT FROM for a NULL author,
-- and after the delete bw_song_files_left_unused when it exists (here it
-- always does), so 180 and 197 give the same function in either order.
-- Re-check against 180 if that file changes (the PGlite test loads 180's
-- real function before and after 197).
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
  IF v_uid IS NULL OR g.id IS NULL OR g.created_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Not your suggestion' USING ERRCODE = '42501';
  END IF;
  IF g.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'This suggestion was already reviewed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.song_suggestions SET status = 'withdrawn', reviewed_at = now() WHERE id = g.id;
  IF g.kind = 'new_song' THEN
    SELECT id, status, audio_url, chart_url INTO s FROM public.songs WHERE id = g.song_id;
    IF s.id IS NOT NULL AND s.status = 'suggested' THEN
      DELETE FROM public.songs WHERE id = s.id;
      IF to_regprocedure('public.bw_song_files_left_unused(text[])') IS NOT NULL THEN
        -- 197: after the delete, the files nothing else uses (claimed).
        EXECUTE 'SELECT public.bw_song_files_left_unused($1)' INTO v_files
          USING ARRAY[s.audio_url, s.chart_url];
        v_files := coalesce(v_files, '[]'::jsonb);
      ELSE
        v_files := to_jsonb(array_remove(ARRAY[s.audio_url, s.chart_url], NULL));
      END IF;
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

-- ------------------------------------------------------------ storage RLS --

DROP POLICY IF EXISTS bw_song_files_write_update ON storage.objects;
CREATE POLICY bw_song_files_write_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'song-files'
    AND (
      (storage.foldername(name))[1] = ANY (public.bw_my_admin_band_ids())
      OR ((storage.foldername(name))[1] = ANY (public.bw_my_band_ids())
          AND (storage.foldername(name))[2] = 'suggestions'
          AND (storage.foldername(name))[3] = auth.uid()::text
          AND NOT public.bw_song_file_adopted(name))
    )
  );

-- Storage deletes of song files: RESTRICTIVE, so it holds whatever
-- PERMISSIVE delete policies exist (bw_song_files_write_delete below says
-- who may delete in which folder; this says when). A delete goes through
-- only with the user's own live claim (bw_song_files_claim_delete or the
-- sweep's claim, at most 10 minutes old) on a file nothing links. A late
-- delete (a rolled-back claim, a phone waking up after the lapse) or one
-- of a file linked again is refused: an orphan for later, never a lost
-- file. Other buckets are not touched.
CREATE OR REPLACE FUNCTION public.bw_song_file_delete_allowed(p_bucket text, p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Only for the caller's bands (any other: no, before any lookup).
  SELECT CASE
    WHEN p_bucket IS DISTINCT FROM 'song-files' THEN true
    WHEN auth.uid() IS NULL OR NOT (split_part(p_name, '/', 1) = ANY (public.bw_my_band_ids())) THEN false
    ELSE (NOT public.bw_song_file_in_use(p_name)
          AND (EXISTS (SELECT 1 FROM public.song_file_removals r
                        WHERE r.path = p_name AND r.claimed_by = auth.uid() AND r.claimed_at >= now() - interval '10 minutes')
               OR EXISTS (SELECT 1 FROM public.song_file_adoptions a
                           WHERE a.from_path = p_name AND a.state = 'deleting' AND a.deleting_by = auth.uid()
                             AND a.deleting_at >= now() - interval '10 minutes')))
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_delete_allowed(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_delete_allowed(text, text) TO authenticated;

DROP POLICY IF EXISTS bw_song_files_delete_claimed ON storage.objects;
CREATE POLICY bw_song_files_delete_claimed ON storage.objects
  AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (bucket_id <> 'song-files' OR public.bw_song_file_delete_allowed(bucket_id, name));

DROP POLICY IF EXISTS bw_song_files_write_delete ON storage.objects;
CREATE POLICY bw_song_files_write_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'song-files'
    AND (
      (storage.foldername(name))[1] = ANY (public.bw_my_admin_band_ids())
      OR ((storage.foldername(name))[1] = ANY (public.bw_my_band_ids())
          AND (storage.foldername(name))[2] = 'suggestions'
          AND (storage.foldername(name))[3] = auth.uid()::text
          AND NOT public.bw_song_file_adopted(name))
    )
  );

-- ------------------------------------------------------------- backfill --
-- Once, by the sweep's own rules (bw_song_file_orphans: live row, every
-- version a day old, nothing uses or records it): in a suggestions folder
-- an orphan becomes a lapsed delete claim for the sweep; in a final folder
-- it is only first seen (its 7 days start now). Nothing is deleted here.
DO $do$
BEGIN
  INSERT INTO public.song_file_removals (path, band_id, claimed_by, claimed_at)
  SELECT o, b.id, NULL, now() - interval '16 minutes'
    FROM public.bands b CROSS JOIN LATERAL public.bw_song_file_orphans(b.id) o
   WHERE split_part(o, '/', 2) = 'suggestions'
  ON CONFLICT (path) DO NOTHING;
  INSERT INTO public.song_file_orphan_seen (path, band_id, first_seen_at)
  SELECT o, b.id, now()
    FROM public.bands b CROSS JOIN LATERAL public.bw_song_file_orphans(b.id) o
   WHERE split_part(o, '/', 2) <> 'suggestions'
  ON CONFLICT (path) DO NOTHING;
END;
$do$;

COMMIT;
