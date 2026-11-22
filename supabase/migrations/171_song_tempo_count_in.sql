-- 171: live mode, Follow the tempo and the count-in (plan live-offline-and-tempo §4, §6, §8).
--
-- songs
--   time_signature  '4/4', '6/8', '7/8'… (null: the chart's, else 4/4).
--   count_in_bars   1 or 2 bars counted before the band comes in (2 for slow songs).
--   pickup_beats    the song starts this many beats before bar 1 ("on 4": 1).
--   backing_track   played with a backing track: no count-in offered.
--   line_timing     where each lyric line starts, in beats from bar 1, with a hash of
--                   the lyrics' words so an edit invalidates it (src/lib/lineTiming.ts).
-- bands
--   count_in_style  'down' (4 3 2 1, default) or 'up' (1 2 3 4).
--
-- Same rules as the rest of the row: members read, the existing songs / bands
-- policies decide who writes. 132 and 080 grant by column, so each new column
-- gets its own grant. The app reads these only once this is live (apply before
-- the web deploy).
--
-- Needs 170 (live pack) first: its refresh trigger on songs is re-created here
-- so that a change to these columns also refreshes the members' packs. Same
-- function, same columns as 170, plus the five below.

BEGIN;

ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS time_signature text
    CHECK (time_signature IS NULL OR time_signature ~ '^([1-9]|1[0-6])/(1|2|4|8|16)$'),
  ADD COLUMN IF NOT EXISTS count_in_bars smallint NOT NULL DEFAULT 1
    CHECK (count_in_bars BETWEEN 0 AND 2),
  ADD COLUMN IF NOT EXISTS pickup_beats smallint NOT NULL DEFAULT 0
    CHECK (pickup_beats BETWEEN 0 AND 15),
  ADD COLUMN IF NOT EXISTS backing_track boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS line_timing jsonb
    CHECK (line_timing IS NULL OR (jsonb_typeof(line_timing) = 'object' AND pg_column_size(line_timing) <= 65536));

COMMENT ON COLUMN public.songs.time_signature IS 'Time signature ("4/4", "6/8", "7/8"); null = the chord chart''s, else 4/4 (171).';
COMMENT ON COLUMN public.songs.count_in_bars IS 'Bars of count-in before the band comes in: 1, or 2 for slow songs (first bar in half time) (171).';
COMMENT ON COLUMN public.songs.pickup_beats IS 'The song starts this many beats before bar 1 (a pickup): GO comes on that beat (171).';
COMMENT ON COLUMN public.songs.backing_track IS 'Played with a backing track: the track starts the band, no count-in offered (171).';
COMMENT ON COLUMN public.songs.line_timing IS 'Start of each lyric line in beats from bar 1 + a hash of the lyrics'' words: {v, hash, at[], mode, bars?} (171).';

ALTER TABLE public.bands
  ADD COLUMN IF NOT EXISTS count_in_style text NOT NULL DEFAULT 'down'
    CHECK (count_in_style IN ('down', 'up'));

COMMENT ON COLUMN public.bands.count_in_style IS 'Count-in on stage: down (4 3 2 1) or up (1 2 3 4) (171).';

GRANT SELECT (time_signature, count_in_bars, pickup_beats, backing_track, line_timing),
      INSERT (time_signature, count_in_bars, pickup_beats, backing_track, line_timing),
      UPDATE (time_signature, count_in_bars, pickup_beats, backing_track, line_timing)
  ON public.songs TO authenticated;

-- bands: SELECT is by column since 080; writes stay with the admins (RLS).
GRANT SELECT (count_in_style), UPDATE (count_in_style) ON public.bands TO authenticated;

-- 170's silent refresh: also when the tempo, count-in or line timing changes.
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
     OR OLD.audio_url IS DISTINCT FROM NEW.audio_url
     OR OLD.time_signature IS DISTINCT FROM NEW.time_signature
     OR OLD.count_in_bars IS DISTINCT FROM NEW.count_in_bars
     OR OLD.pickup_beats IS DISTINCT FROM NEW.pickup_beats
     OR OLD.backing_track IS DISTINCT FROM NEW.backing_track
     OR OLD.line_timing IS DISTINCT FROM NEW.line_timing)
  EXECUTE FUNCTION public.bw_trg_live_pack_song();

COMMIT;
