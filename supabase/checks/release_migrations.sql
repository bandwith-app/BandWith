-- Which of this release's migrations are on a database (docs/release-checklist.md).
-- Read only. 177 is expected false: it waits in the sunset list.
-- Run as the database owner:
--   npx supabase db query --remote --yes -f supabase/checks/release_migrations.sql
--
-- Each row is decided by an object the migration creates (a table, column,
-- function, policy, index or a body marker), never by
-- supabase_migrations.schema_migrations: on prod that table stops at 038
-- (everything since was applied by hand), so it can't tell what is in.
-- A function that already existed before its migration (186, 187, 196) is
-- checked by a marker in its new body.
--
-- applied = true: in. false: not in. A migration half applied can't happen
-- (each runs in one transaction).
WITH col(t, c) AS (
  SELECT table_name::text, column_name::text FROM information_schema.columns WHERE table_schema = 'public'
),
fn(n) AS (
  SELECT p.proname::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
)
SELECT m AS migration, coalesce(applied, false) AS applied, proof
FROM (VALUES
  ('170', EXISTS (SELECT 1 FROM col WHERE t = 'live_pack_status' AND c = 'partial')
          AND EXISTS (SELECT 1 FROM fn WHERE n = 'bw_live_pack_status_newer_only'),
          'live_pack_status.partial, function bw_live_pack_status_newer_only (the 11-22 version)'),
  ('171', EXISTS (SELECT 1 FROM col WHERE t = 'songs' AND c = 'time_signature')
          AND EXISTS (SELECT 1 FROM col WHERE t = 'bands' AND c = 'count_in_style'),
          'songs.time_signature, bands.count_in_style'),
  ('172', EXISTS (SELECT 1 FROM col WHERE t = 'songs' AND c = 'vocal_parts')
          AND EXISTS (SELECT 1 FROM col WHERE t = 'setlist_songs' AND c = 'vocal_parts'),
          'songs.vocal_parts, setlist_songs.vocal_parts'),
  ('173', to_regclass('public.app_flags') IS NOT NULL, 'table app_flags'),
  ('174', to_regclass('public.client_errors') IS NOT NULL AND to_regclass('public.client_error_counters') IS NOT NULL,
          'tables client_errors, client_error_counters'),
  ('175', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_chats_immutable_keys')
          AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'band_invitations'
                          AND policyname = 'Users can accept own invitations'),
          'function bw_chats_immutable_keys, invitation self-update policy gone'),
  ('176', EXISTS (SELECT 1 FROM col WHERE t = 'quote_links' AND c = 'pdf_key'), 'quote_links.pdf_key'),
  ('177', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'quotes' AND NOT public), 'bucket quotes is private'),
  ('178', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_event_quote_hidden'), 'function bw_event_quote_hidden'),
  ('180', to_regclass('public.account_deletions_pending') IS NOT NULL, 'table account_deletions_pending'),
  ('181', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_trg_event_member_left_chat'), 'function bw_trg_event_member_left_chat'),
  ('182', EXISTS (SELECT 1 FROM col WHERE t = 'deputy_requests' AND c = 'calendar_token')
          AND EXISTS (SELECT 1 FROM col WHERE t = 'deputy_requests' AND c = 'was_available'),
          'deputy_requests.calendar_token, deputy_requests.was_available'),
  ('183', EXISTS (SELECT 1 FROM col WHERE t = 'quote_links' AND c = 'recipient_changed_at'), 'quote_links.recipient_changed_at'),
  ('184', to_regprocedure('public.bw_revoke_push_token(text, uuid, timestamptz)') IS NOT NULL
          AND EXISTS (SELECT 1 FROM fn WHERE n = 'bw_register_push_token_stamped'),
          'bw_revoke_push_token(text, uuid, timestamptz), bw_register_push_token_stamped'),
  ('185', EXISTS (SELECT 1 FROM col WHERE t = 'quote_links' AND c = 'balance_sent'), 'quote_links.balance_sent'),
  ('186', pg_get_functiondef(to_regprocedure('public.bw_mark_event_paid(uuid)')) LIKE '%COALESCE(em.fee, 0) > 0%',
          'bw_mark_event_paid pays only a fee above 0 (body)'),
  ('187', pg_get_functiondef(to_regprocedure('public.bw_quote_link_view(text)')) LIKE '%balance_sent%',
          'bw_quote_link_view reads balance_sent (body)'),
  ('188', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_save_setlist_songs'), 'function bw_save_setlist_songs'),
  ('189', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_save_song_lyrics'), 'function bw_save_song_lyrics'),
  ('190', EXISTS (SELECT 1 FROM col WHERE t = 'stage_keys' AND c = 'sign_public'), 'stage_keys.sign_public'),
  ('191', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_stage_clock_topic_allowed'), 'function bw_stage_clock_topic_allowed'),
  ('192', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_purge_chat_notices'), 'function bw_purge_chat_notices'),
  ('193', to_regclass('public.chats_one_per_event') IS NOT NULL, 'index chats_one_per_event'),
  ('194', to_regclass('public.notifications_chat_message_once') IS NOT NULL, 'index notifications_chat_message_once'),
  ('195', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_publish_rehearsal_proposal'), 'function bw_publish_rehearsal_proposal'),
  ('196', pg_get_functiondef(to_regprocedure('public.bw_trg_rehearsal_session_guard()')) LIKE '%NEW.started_at IS DISTINCT FROM OLD.started_at%',
          'bw_trg_rehearsal_session_guard skips a restart of a saved session (body)'),
  ('197', to_regclass('public.song_file_adoptions') IS NOT NULL AND EXISTS (SELECT 1 FROM fn WHERE n = 'bw_song_file_adopt_begin'),
          'table song_file_adoptions, function bw_song_file_adopt_begin')
) AS v(m, applied, proof)
ORDER BY m;
