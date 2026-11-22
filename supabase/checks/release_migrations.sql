-- Which of this release's migrations are on a database (docs/release-checklist.md).
-- Read only. 177 is expected false: it waits in the sunset list.
-- Run as the database owner:
--   npx supabase db query --remote --yes -f supabase/checks/release_migrations.sql
--
-- Each row is decided by what the migration creates, never by
-- supabase_migrations.schema_migrations: on prod that table stops at 038
-- (everything since was applied by hand), so it can't tell what is in.
--
-- Every proof takes a marker from the FINAL body on its branch head (review
-- #278, Codex): an object (table, column, function) only says that some
-- version ran, and several of these files were edited in place. A marker is
-- a line that is in that function's body at the head named in
-- supabase/checks/release-sources.txt (4th column) and in none of main's
-- bodies of it from before this release. It tells the final version from the
-- edits that changed that function's marked lines; an older commit that
-- differed only elsewhere in the file can still match (none of this release is
-- live yet, and main's prod dry runs roll back; 170, applied on dev databases,
-- has its own check in the candidate step). A file edited again needs its
-- markers checked again: scripts/fn-redefinitions.mjs lists the files that
-- changed since their head was checked, and scripts/release-checklist.test.ts
-- checks each marker is still in its file once the file is on main.
-- Markers are matched as plain text (strpos), never with LIKE: _ and % in a
-- body are not wildcards. The markers sit in functions that no later
-- migration of the release redefines (175's dropped_out rule is read in
-- bw_event_recipient_ids, not in bw_chat_scope_ok, which 178 redefines), so
-- a row stays true after the rest of the release is in. Functions that a later
-- migration redefines are checked after the apply by
-- supabase/checks/redefined_functions.sql.
--
-- Rows without a body marker: 172 (live before this release), 173 and 170
-- (one version only, 170 frozen on main: their tables), 177 (no function: a bucket flag), 171 (its
-- final trigger, read with pg_get_triggerdef).
-- Where an earlier version differs from the final one only outside function
-- bodies, the object proof reads that difference instead: 180 the column
-- committed_at (earlier: prepared_at), 184 push_tokens.uid_gated, 195 the
-- policy role (TO authenticated), 191 the quote guard its DO block adds to
-- bw_stage_clock_topic_allowed once 178 is in.
--
-- Apply order (docs/release-checklist.md, "Constraints").
-- Hard (the later one raises without the earlier): 170 → 198 (and they go
-- in one transaction), 170 → 171, 178 → 182, 175 → 193, 175 → 181, 193 → 181,
-- 183 → 187, 185 → 187, 175 → 192, 194 → 192.
-- Soft (no raise): 180 → 197, 192 → 193, 183 → 185 → 186 → 187,
-- 175 → 178 → 193, 178 → 191. A row can be true out of order;
-- redefined_functions.sql catches a wrong live body.
-- The source column: the PR whose branch head the markers were taken from.
--
-- applied = true: in. false: not in. A migration half applied can't happen
-- (each runs in one transaction).
WITH col(t, c) AS (
  SELECT table_name::text, column_name::text FROM information_schema.columns WHERE table_schema = 'public'
),
fn(n) AS (
  SELECT p.proname::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
),
body(n, src) AS (
  SELECT p.proname::text, p.prosrc FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
),
-- One row per marker: migration, function, a line of its final body.
marker(m, f, txt) AS (VALUES
  ('198', 'bw_live_pack_can_hold', 'AND (p_user_id = auth.uid() OR public.bw_is_band_admin(e.band_id))'),
  ('198', 'bw_live_pack_on', 'RAISE WARNING ''bw_live_pack_on: % (%), treated as on'', SQLERRM, SQLSTATE;'),
  ('198', 'bw_live_pack_invite_row', 'IF NOT public.bw_live_pack_on() THEN RETURN; END IF;'),
  ('198', 'bw_live_pack_invite_sweep', 'EXIT WHEN NOT public.bw_live_pack_on();'),
  ('198', 'bw_live_pack_refresh_targets', 'AND ((coalesce(p.live_pack_auto, false) AND public.bw_live_pack_on())'),
  ('198', 'bw_live_pack_refresh_flush', 'v_off := v_off OR NOT public.bw_live_pack_on();'),
  ('198', 'bw_live_pack_refresh_flush', 'CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.bw_live_pack_window_events(q.event_id));'),
  ('198', 'bw_live_pack_remind', 'IF NOT public.bw_live_pack_on() THEN RETURN false; END IF;'),
  ('198', 'bw_live_pack_keep', 'WHEN auth.uid() IS NULL OR cardinality(coalesce(p_event_ids, ''{}''::uuid[])) > 500 THEN NULL'),
  ('174', 'bw_report_client_error', 'IF auth.uid() IS NULL OR p_message IS NULL OR btrim(p_message) = '''' THEN'),
  ('174', 'bw_report_client_error', 'left(public.bw_client_error_scrub(left(p_app_version, 200)), 40),'),
  ('194', 'bw_write_chat_notices', 'AND public.bw_chat_push_claim_free(public.bw_try_timestamptz(n.data ->> ''push_claimed_at''))'),
  ('194', 'bw_chat_push_claim_free', 'OR p_claimed > now() + interval ''1 minute'';'),
  ('194', 'bw_release_chat_notice_claims', 'WHERE n.id = ANY (coalesce(p_ids, ''{}''::uuid[]))'),
  ('194', 'bw_claim_chat_push_only', 'AND public.bw_chat_push_claim_free(l.claimed_at)'),
  ('194', 'bw_chat_preview', 'SELECT coalesce(nullif(public.bw_js_left(coalesce(p_content, ''''), 120), ''''), ''New message'');'),
  ('194', 'bw_chat_preview_in', '{"it":"Nuovo messaggio","es":"Nuevo mensaje"'),
  ('184', 'bw_revoke_push_token', 'AND (p_registered_at IS NULL OR updated_at = p_registered_at);'),
  ('184', 'bw_register_push_token_stamped', 'ELSIF length(v_secret) < 32 OR length(v_secret) > 256 THEN'),
  ('184', 'bw_revoke_push_token', 'WHERE token = p_token AND user_id = p_user_id AND coalesce(is_active, true)'),
  ('184', 'bw_revoke_push_token', 'WHERE token = p_token AND user_id = p_user_id AND updated_at = p_registered_at'),
  ('175', 'bw_chat_recipient_ids', 'FROM ok WHERE user_id IS DISTINCT FROM p_sender'),
  ('175', 'bw_event_recipient_ids', 'AND lower(btrim(coalesce(status::text, ''invited''))) NOT IN (''declined'', ''dropped_out'', ''removed'')'),
  ('175', 'bw_chat_row_ok', 'SELECT ch.type::text AS type, ch.band_id, ch.event_id INTO c FROM chats ch WHERE ch.id = p_chat_id;'),
  ('176', 'bw_quote_link_doc_id', 'md5(concat_ws(''|'', ''doc'', p_link.token, p_link.version, p_link.pdf_url))'),
  ('176', 'bw_quote_link_doc_id', 'CASE WHEN lower(btrim(p_link.status::text)) = ''accepted'''),
  ('178', 'bw_event_quote_hidden', 'OR public.bw_is_band_admin(e.band_id, auth.uid())))'),
  ('178', 'bw_event_quote_hidden', 'OR EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = auth.uid()))'),
  ('178', 'bw_trg_date_hold_quote_moved', 'AND ((NEW.event_date IS DISTINCT FROM OLD.event_date AND NEW.event_date IS NOT NULL AND e.event_date IS DISTINCT FROM NEW.event_date)'),
  ('180', 'bw_mark_chat_read', 'to_regprocedure(''public.bw_chat_scope_ok_for(uuid,uuid)'') IS NOT NULL'),
  ('180', 'bw_account_deletion_polls', 'updated_at = CASE WHEN cardinality(array_remove(array_remove(rp.invited_user_ids, p_uid), NULL)) = 0'),
  ('192', 'bw_purge_chat_notices', 'FROM jsonb_to_recordset(p_gone) AS g(chat_id uuid)) AS e'),
  ('192', 'bw_purge_chat_notices', 'AND public.bw_chat_notice_shows(n.body, n.data, m.content)'),
  ('192', 'bw_trg_messages_edit_notices', 'PERFORM pg_advisory_xact_lock(hashtextextended(''bw_chat_notices:'' || NEW.chat_id::text, 0));'),
  ('192', 'bw_trg_messages_edit_notices', 'AND coalesce(public.bw_chat_scope_ok_for(NEW.chat_id, n.user_id), false));'),
  ('192', 'bw_write_chat_notices', 'AND coalesce(public.bw_chat_scope_ok_for(v_chat, n2.user_id), false)'),
  ('192', 'bw_claim_chat_push_only', 'AND coalesce(public.bw_chat_scope_ok_for((SELECT m3.chat_id FROM messages m3 WHERE m3.id = p_message_id), u), false)'),
  ('193', 'bw_open_group_chat', 'IF to_regprocedure(''public.bw_chat_scope_ok_for(uuid, uuid)'') IS NOT NULL THEN'),
  ('193', 'bw_trg_chats_one_group_chat', 'OR public.bw_chat_joinable_rule(NEW.type::text, v_rule_band, NEW.event_id, auth.uid()) THEN'),
  ('181', 'bw_trg_event_member_left_chat', 'AND NOT coalesce(public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, cp.user_id), false)'),
  ('181', 'bw_trg_event_member_left_chat', 'AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = cp.user_id);'),
  ('181', 'bw_trg_event_band_fixed', 'AND (EXISTS (SELECT 1 FROM chats c WHERE c.type::text = ''event'' AND c.event_id = OLD.id)'),
  ('182', 'bw_member_calendar_flag_shared', 'NOT review_link AND NOT review_kept'),
  ('182', 'bw_my_event_calendar_link', 'IF NOT coalesce(v_when.ok, false) THEN RETURN NULL; END IF;'),
  ('182', 'bw_event_date_deleted', 'SELECT coalesce(p_date IS NOT NULL AND jsonb_typeof(p_rule) = ''object'' AND jsonb_typeof(p_rule->''skip_dates'') = ''array'''),
  ('182', 'bw_member_calendar_event', 'AND NOT public.bw_event_quote_hidden(e.id, p_uid)'),
  ('182', 'bw_deputy_request_view', '''venue_address'', CASE WHEN r.status = ''available'' AND NOT v_cancelled THEN e.venue_address END,'),
  ('183', 'bw_quote_link_publish', 'BW_LINK_CHANGED: the quote link was replaced'),
  ('183', 'bw_trg_quote_recipient_changed', '''deposit_required'', ''deposit_percentage'', ''deposit_amount''];'),
  ('183', 'bw_trg_quote_totals', 'v_rate := CASE WHEN coalesce((v_new ->> ''vat_exempt'')::boolean, false) OR coalesce((v_new ->> ''reverse_charge'')::boolean, false)'),
  ('183', 'bw_quote_link_publish', 'RAISE EXCEPTION ''BW_LINK_CHANGED: the quote now goes to another client, open the quote again'' USING ERRCODE = ''40001'';'),
  ('183', 'bw_quote_link_rotate', 'reassign_guard = CASE WHEN l.recipient_changed_at IS NOT NULL AND public.bw_quote_link_current(v_link)'),
  ('185', 'bw_quote_balance_mark_sent', 'IF v_link.balance_paid_at IS NOT NULL AND v_link.balance_sent IS DISTINCT FROM v_link.balance THEN'),
  ('185', 'bw_quote_balance_mark_paid', 'balance_paid_deposit_amount = CASE WHEN v_paid THEN v_amount END,'),
  ('185', 'bw_quote_save_lineup', '(SELECT coalesce(jsonb_agg(to_jsonb(qm)), ''[]''::jsonb) FROM public.quote_musicians qm WHERE qm.quote_id = p_quote_id)) THEN'),
  ('186', 'bw_mark_event_paid', 'COALESCE(em.fee, 0) > 0'),
  ('187', 'bw_quote_link_view', '''client_name'', CASE WHEN v_signer THEN coalesce(v_link.accepted_client_name, v_client) ELSE v_client END'),
  ('187', 'bw_quote_link_view', '''balance'', CASE WHEN v_show_balance THEN v_link.balance_sent END,'),
  ('187', 'bw_quote_link_message', 'INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version, link_id)'),
  ('187', 'bw_quote_link_message', 'WHERE a.link_id = v_link.id AND a.kind = ''client_message'' AND a.created_at > now() - interval ''1 hour'';'),
  ('188', 'bw_save_setlist_songs', 'AS k(id uuid, song_id uuid, pos int, set_number int, has_notes boolean, notes text)'),
  ('188', 'bw_save_setlist_songs', 'FROM jsonb_to_recordset(v_plan) AS k(id uuid, pos int)'),
  ('188', 'bw_save_setlist_songs', 'FROM n JOIN prev p ON p.id = n.want AND p.song_id = n.song_id'),
  ('188', 'bw_save_setlist_songs', 'v_exp := CASE WHEN jsonb_typeof(p_expected -> ''songs'') = ''array'' THEN p_expected -> ''songs'' ELSE ''[]''::jsonb END;'),
  ('189', 'bw_save_song_lyrics', 'WHERE k <> ALL (v_allowed);'),
  ('190', 'bw_stage_verify_key', 'SELECT s.sign_public, s.sign_version INTO k, ver FROM public.stage_keys s'),
  ('190', 'bw_stage_set_signer', 'band := public.bw_stage_admin_band(p_event_id);'),
  ('190', 'bw_stage_set_signer', 'SET sign_public = p_public, sign_private = p_private,'),
  ('190', 'bw_stage_set_signer', 'PERFORM 1 FROM public.events e WHERE e.id = p_event_id AND e.band_id = band FOR UPDATE;'),
  ('191', 'bw_stage_topic_allowed', 'RETURN public.bw_is_band_admin(band) AND public.bw_can_view_event(ev::uuid);'),
  ('191', 'bw_stage_event_hidden', 'AND NOT public.bw_stage_quote_gig(OLD.id, OLD.status::text, OLD.event_type::text, OLD.quote_id)) THEN'),
  ('191', 'bw_stage_member_left', 'PERFORM 1 FROM public.bands b WHERE b.id = OLD.band_id FOR NO KEY UPDATE;'),
  ('191', 'bw_stage_lineup_left', 'PERFORM 1 FROM public.bands b WHERE b.id = (SELECT e.band_id FROM public.events e WHERE e.id = OLD.event_id) FOR NO KEY UPDATE;'),
  ('195', 'bw_skip_rehearsal_date', 'This rehearsal does not repeat any more'),
  ('195', 'bw_move_rehearsal_date', 'FROM public.setlists sl WHERE sl.id = v_ev.setlist_id AND sl.band_id = v_ev.band_id;'),
  ('196', 'bw_trg_rehearsal_session_guard', 'COALESCE(jsonb_typeof(NEW.summary -> ''pauses'') = ''array'', false)'),
  ('196', 'bw_trg_rehearsal_session_guard', 'AND NOT (NEW.started_at < OLD.started_at AND COALESCE(jsonb_typeof(NEW.summary -> ''pauses'') = ''array'', false)) THEN'),
  ('196', 'bw_trg_rehearsal_session_guard', 'v_old_played := CASE WHEN jsonb_typeof(OLD.summary -> ''played'') = ''array'' THEN OLD.summary -> ''played'' ELSE ''[]''::jsonb END;'),
  ('197', 'bw_trg_song_file_not_removed', 'WHERE o.band_id = NEW.band_id AND o.id IS DISTINCT FROM NEW.id'),
  ('197', 'bw_song_file_adopt_repoint', 'OR coalesce(v_parts[4], '''') NOT IN (''audio'', ''chart'') OR coalesce(v_parts[5], '''') = '''' THEN'),
  ('197', 'bw_song_file_sweep_list', 'WHERE NOT public.bw_song_file_in_use(x.p)), ''{}''::text[]);'),
  ('197', 'bw_song_files_claim_for', 'AND (p_check OR (p_band_id IS NOT NULL AND split_part(substr(x, length(''sb://song-files/'') + 1), ''/'', 1) = p_band_id::text))'),
  ('197', 'bw_song_file_sweep_list', 'SET audio_url = coalesce((SELECT ''sb://song-files/'' || u.dest FROM u WHERE u.id = s.id AND u.field = ''audio_url''), s.audio_url),')
),
-- Where each proof comes from: the PR that owns the migration
-- (supabase/checks/release-sources.txt; its branch head is what the markers
-- were taken from).
source(m, pr) AS (VALUES
  ('173', '#273'),
  ('170', '#273'),
  ('198', '#273'),
  ('171', '#272'),
  ('174', '#277'),
  ('175', '#281'),
  ('176', '#281'),
  ('178', '#294'),
  ('180', '#282'),
  ('194', '#284'),
  ('192', '#291'),
  ('193', '#291'),
  ('181', '#289'),
  ('182', '#285'),
  ('183', '#286'),
  ('184', '#287'),
  ('185', '#293'),
  ('186', '#293'),
  ('187', '#293'),
  ('188', '#292'),
  ('189', '#292'),
  ('190', '#288'),
  ('191', '#283'),
  ('195', '#297'),
  ('196', '#296'),
  ('197', '#295')
),
marked(m, ok, fns) AS (
  SELECT k.m,
         bool_and(EXISTS (SELECT 1 FROM body b WHERE b.n = k.f AND strpos(b.src, k.txt) > 0)),
         string_agg(DISTINCT k.f, ', ')
  FROM marker k GROUP BY k.m
)
SELECT v.m AS migration,
       coalesce(v.applied, false) AND coalesce(mk.ok, true) AS applied,
       v.proof || coalesce('; final body of ' || mk.fns, '') AS proof,
       src.pr AS source
FROM (VALUES
  -- 170 is frozen: main's file, one version (squash-merged, #269).
  ('170', to_regclass('public.live_pack_status') IS NOT NULL AND EXISTS (SELECT 1 FROM fn WHERE n = 'bw_live_pack_queue'),
          'table live_pack_status, function bw_live_pack_queue'),
  ('171', EXISTS (SELECT 1 FROM col WHERE t = 'songs' AND c = 'time_signature')
          AND EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = 'bw_live_pack_song' AND tg.tgrelid = to_regclass('public.songs')
                      AND strpos(pg_get_triggerdef(tg.oid), 'line_timing') > 0),
          'songs.time_signature, trigger bw_live_pack_song follows line_timing (final)'),
  ('172', EXISTS (SELECT 1 FROM col WHERE t = 'songs' AND c = 'vocal_parts')
          AND EXISTS (SELECT 1 FROM col WHERE t = 'setlist_songs' AND c = 'vocal_parts'),
          'songs.vocal_parts, setlist_songs.vocal_parts'),
  ('173', to_regclass('public.app_flags') IS NOT NULL, 'table app_flags'),
  ('198', EXISTS (SELECT 1 FROM col WHERE t = 'live_pack_status' AND c = 'partial')
          AND EXISTS (SELECT 1 FROM fn WHERE n = 'bw_live_pack_status_newer_only')
          AND EXISTS (SELECT 1 FROM fn WHERE n = 'bw_live_pack_keep'),
          'live_pack_status.partial, functions bw_live_pack_status_newer_only, bw_live_pack_keep'),
  ('174', to_regclass('public.client_errors') IS NOT NULL AND to_regclass('public.client_error_counters') IS NOT NULL,
          'tables client_errors, client_error_counters'),
  ('175', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_chats_immutable_keys')
          AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'band_invitations'
                          AND policyname = 'Users can accept own invitations')
          -- an earlier 175 differs only here: no delete guard on messages
          AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'messages'
                       AND policyname = 'messages_delete_guard'),
          'function bw_chats_immutable_keys, invitation self-update policy gone, policy messages_delete_guard'),
  ('176', EXISTS (SELECT 1 FROM col WHERE t = 'quote_links' AND c = 'pdf_key'), 'quote_links.pdf_key'),
  ('177', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'quotes' AND NOT public), 'bucket quotes is private'),
  ('178', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_event_quote_hidden'), 'function bw_event_quote_hidden'),
  -- An earlier 180 had prepared_at; the final one renames it committed_at.
  ('180', EXISTS (SELECT 1 FROM col WHERE t = 'account_deletions_pending' AND c = 'committed_at'), 'account_deletions_pending.committed_at'),
  ('181', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_trg_event_member_left_chat'), 'function bw_trg_event_member_left_chat'),
  ('182', EXISTS (SELECT 1 FROM col WHERE t = 'deputy_requests' AND c = 'calendar_token')
          AND EXISTS (SELECT 1 FROM col WHERE t = 'deputy_requests' AND c = 'was_available'),
          'deputy_requests.calendar_token, deputy_requests.was_available'),
  ('183', EXISTS (SELECT 1 FROM col WHERE t = 'quote_links' AND c = 'recipient_changed_at'), 'quote_links.recipient_changed_at'),
  -- No signature (bw_revoke_push_token's changed on its branch, #287 ee0f5467):
  -- the column (an earlier 184 had none) and the function, by name.
  ('184', EXISTS (SELECT 1 FROM col WHERE t = 'push_tokens' AND c = 'uid_gated')
          AND EXISTS (SELECT 1 FROM fn WHERE n = 'bw_register_push_token_stamped'),
          'push_tokens.uid_gated, function bw_register_push_token_stamped'),
  ('185', EXISTS (SELECT 1 FROM col WHERE t = 'quote_links' AND c = 'balance_sent'), 'quote_links.balance_sent'),
  ('186', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_mark_event_paid'), 'function bw_mark_event_paid'),
  ('187', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_quote_link_view'), 'function bw_quote_link_view'),
  ('188', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_save_setlist_songs'), 'function bw_save_setlist_songs'),
  ('189', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_save_song_lyrics'), 'function bw_save_song_lyrics'),
  ('190', EXISTS (SELECT 1 FROM col WHERE t = 'stage_keys' AND c = 'sign_public'), 'stage_keys.sign_public'),
  -- With 178 in (it is, in this release), 191's DO block adds 178's quote
  -- guard to the clock topic; an earlier 191 had no DO block.
  ('191', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_stage_clock_topic_allowed')
          AND (NOT EXISTS (SELECT 1 FROM fn WHERE n = 'bw_event_quote_hidden')
               OR EXISTS (SELECT 1 FROM body WHERE n = 'bw_stage_clock_topic_allowed'
                           AND strpos(src, 'AND NOT public.bw_event_quote_hidden(ev::uuid)') > 0)),
          'function bw_stage_clock_topic_allowed (with 178: its quote guard)'),
  ('192', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_purge_chat_notices'), 'function bw_purge_chat_notices'),
  ('193', to_regclass('public.chats_one_per_event') IS NOT NULL, 'index chats_one_per_event'),
  ('194', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_write_chat_notices'), 'function bw_write_chat_notices'),
  ('195', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_publish_rehearsal_proposal')
          -- an earlier 195 differs only here: its policy was TO public
          AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rehearsal_polls'
                       AND policyname = 'rehearsal_polls_select' AND roles = '{authenticated}'::name[]),
          'function bw_publish_rehearsal_proposal, policy rehearsal_polls_select TO authenticated'),
  ('196', EXISTS (SELECT 1 FROM fn WHERE n = 'bw_trg_rehearsal_session_guard'), 'function bw_trg_rehearsal_session_guard'),
  ('197', to_regclass('public.song_file_adoptions') IS NOT NULL AND EXISTS (SELECT 1 FROM fn WHERE n = 'bw_song_file_adopt_begin'),
          'table song_file_adoptions, function bw_song_file_adopt_begin')
) AS v(m, applied, proof)
LEFT JOIN marked mk ON mk.m = v.m
LEFT JOIN source src ON src.m = v.m
ORDER BY v.m;
