-- 171: the score column's grant (sheet music plan §4.1, after 170).
--
-- songs has table-level grants today, so authenticated already reads and
-- writes a new column; this states it for score_path explicitly, so the
-- column stays readable and writable if songs moves to column grants (as
-- band_members did in 079). Members suggest songs (insert) and admins edit
-- them (update): RLS and songs_member_suggest decide who, as for chart_url.
-- anon gets nothing (101).
--
-- Dry run as for 170: strip BEGIN; / COMMIT;, run in a rolled-back transaction.
-- Rollback: REVOKE SELECT (score_path), INSERT (score_path), UPDATE (score_path) ON public.songs FROM authenticated;
--           (only together with 170's rollback).

BEGIN;

GRANT SELECT (score_path), INSERT (score_path), UPDATE (score_path) ON public.songs TO authenticated;
REVOKE ALL (score_path) ON public.songs FROM anon;

COMMIT;
