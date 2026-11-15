-- 118 · Band-member policies count active members only.
--
-- Several policies exported in 073 checked band_members without is_active,
-- so a member made inactive (is_active false) kept access, and the admin
-- ones counted inactive admins. Harmless today (removing a member deletes the
-- row; live data on 2026-11-14 has no inactive rows) but inconsistent with
-- the bw_is_band_member / bw_is_band_admin helpers every newer policy uses.
--
-- Same policies, same names, same rights; only the membership check changes:
--   playlists        members read, admins manage
--   playlist_songs   members read, admins manage
--   songs            members read (writes: 108, unchanged)
--   song_folders     members manage
--   song_proposals   members manage and read (band, or the event's band)
--   rehearsal_poll_votes  members of the poll's band read
--   member_invites   admins manage (the invitee's own read is unchanged)
-- The vote and "none work" insert policies were updated in 117.
--
-- Idempotent; safe to re-run on live data.

BEGIN;

-- ── playlists ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Band admins can manage playlists" ON public.playlists;
CREATE POLICY "Band admins can manage playlists" ON public.playlists
  FOR ALL TO authenticated
  USING (public.bw_is_band_admin(band_id))
  WITH CHECK (public.bw_is_band_admin(band_id));

DROP POLICY IF EXISTS "Band members can view playlists" ON public.playlists;
CREATE POLICY "Band members can view playlists" ON public.playlists
  FOR SELECT TO authenticated
  USING (public.bw_is_band_member(band_id));

-- ── playlist_songs (band from the parent playlist) ───────────────────────
DROP POLICY IF EXISTS "Manage playlist songs" ON public.playlist_songs;
CREATE POLICY "Manage playlist songs" ON public.playlist_songs
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_songs.playlist_id AND public.bw_is_band_admin(p.band_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_songs.playlist_id AND public.bw_is_band_admin(p.band_id)
  ));

DROP POLICY IF EXISTS "View playlist songs" ON public.playlist_songs;
CREATE POLICY "View playlist songs" ON public.playlist_songs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_songs.playlist_id AND public.bw_is_band_member(p.band_id)
  ));

-- ── songs: read ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Band members can view songs" ON public.songs;
CREATE POLICY "Band members can view songs" ON public.songs
  FOR SELECT TO authenticated
  USING (public.bw_is_band_member(band_id));

-- ── song_folders ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Band members can manage song folders" ON public.song_folders;
CREATE POLICY "Band members can manage song folders" ON public.song_folders
  FOR ALL TO authenticated
  USING (public.bw_is_band_member(band_id))
  WITH CHECK (public.bw_is_band_member(band_id));

-- ── song_proposals ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Band members can manage proposals" ON public.song_proposals;
CREATE POLICY "Band members can manage proposals" ON public.song_proposals
  FOR ALL TO authenticated
  USING (public.bw_is_band_member(band_id))
  WITH CHECK (public.bw_is_band_member(band_id));

-- Proposals tied to an event: members of the event's band (definer helper,
-- so it does not depend on the events read policy).
DROP POLICY IF EXISTS "Band members can manage song proposals" ON public.song_proposals;
CREATE POLICY "Band members can manage song proposals" ON public.song_proposals
  FOR ALL TO authenticated
  USING (public.bw_is_band_member(public.bw_event_band_id(event_id)))
  WITH CHECK (public.bw_is_band_member(public.bw_event_band_id(event_id)));

DROP POLICY IF EXISTS "Band members can view proposals" ON public.song_proposals;
CREATE POLICY "Band members can view proposals" ON public.song_proposals
  FOR SELECT TO authenticated
  USING (public.bw_is_band_member(band_id));

DROP POLICY IF EXISTS "Band members can view song proposals" ON public.song_proposals;
CREATE POLICY "Band members can view song proposals" ON public.song_proposals
  FOR SELECT TO authenticated
  USING (public.bw_is_band_member(band_id));

-- ── rehearsal_poll_votes: read ───────────────────────────────────────────
DROP POLICY IF EXISTS "band_members_can_select_votes" ON public.rehearsal_poll_votes;
CREATE POLICY "band_members_can_select_votes" ON public.rehearsal_poll_votes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rehearsal_polls rp
    WHERE rp.id = rehearsal_poll_votes.poll_id AND public.bw_is_band_member(rp.band_id)
  ));

-- ── member_invites: admins ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Band admins can manage invites" ON public.member_invites;
CREATE POLICY "Band admins can manage invites" ON public.member_invites
  FOR ALL TO authenticated
  USING (public.bw_is_band_admin(band_id))
  WITH CHECK (public.bw_is_band_admin(band_id));

COMMIT;
