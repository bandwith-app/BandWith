-- After the release's migrations are in: every function that more than one
-- of them defines has the body of the LAST one in the apply order
-- (docs/release-checklist.md, section 2). Read only. Run as the database
-- owner after the last migration:
--   npx supabase db query --remote --yes -f supabase/checks/redefined_functions.sql
-- Every row must be ok = true. A false row means an earlier migration's body
-- is live (applied out of order, or applied again after the later one): stop
-- and re-apply the final migration's definition of that function from its file.
--
-- Each row: the function, the migration whose body must be live, the
-- migrations it replaces, and a line of the final body that none of the
-- replaced bodies has (checked against the branch heads, 11-22, and by
-- scripts/release-checklist.test.ts once the files are on main). Matched as
-- plain text (strpos) in pg_get_functiondef. A missing function is ok = false.
--
-- The list: the groups known on 11-22 (from the branch heads, and the ones
-- the security fixes named). The test above fails when a release migration on
-- main defines a function another one defines too and it has no row here.
SELECT v.sig AS function,
       v.final AS final_migration,
       v.replaces,
       coalesce(strpos(pg_get_functiondef(to_regprocedure(v.sig)), v.mark) > 0, false) AS ok
FROM (VALUES
  ('public.bw_live_pack_window_events(uuid)', '178', '170', 'AND NOT public.bw_event_is_quote(e.status, e.event_type, e.quote_id)'),
  ('public.bw_trg_dispatch_push()', '178', '170', 'IF NEW.type IN (''date_hold'', ''date_hold_changed'', ''date_hold_released'') THEN'),
  ('public.bw_chat_scope_ok(text, uuid, uuid, uuid)', '178', '175', 'AND NOT public.bw_event_quote_hidden(e.id, p_user_id))'),
  ('public.get_user_chats(uuid)', '178', '175', 'AND NOT (c.id = ANY (public.bw_hidden_quote_chat_ids()));'),
  ('public.bw_mark_chat_read(uuid)', '180', '175', 'to_regprocedure(''public.bw_chat_scope_ok_for(uuid,uuid)'') IS NOT NULL'),
  ('public.bw_mark_chats_delivered()', '180', '175', 'to_regprocedure(''public.bw_chat_scope_ok_for(uuid,uuid)'') IS NOT NULL'),
  ('public.bw_quote_link_view(text)', '187', '183', '''balance'', CASE WHEN v_show_balance THEN v_link.balance_sent END,'),
  ('public.bw_quote_link_respond(text, text, text, text, integer)', '187', '183', 'IF p_token IS NULL OR p_token !~ ''^[0-9a-f]{64}$'' THEN RETURN NULL; END IF;'),
  ('public.bw_quote_link_message(text, text)', '187', '183', 'IF p_token IS NULL OR p_token !~ ''^[0-9a-f]{64}$'' THEN RETURN NULL; END IF;'),
  ('public.bw_stage_key(uuid)', '191', '178', 'OR NOT public.bw_can_view_event(p_event_id)'),
  ('public.bw_stage_topic_allowed(text, boolean)', '191', '178', 'RETURN public.bw_is_band_admin(band) AND public.bw_can_view_event(ev::uuid);'),
  ('public.bw_withdraw_song_suggestion(uuid)', '197', '180', 'EXECUTE ''SELECT public.bw_song_files_left_unused($1)'' INTO v_files')
) AS v(sig, final, replaces, mark)
UNION ALL
-- A trigger redefined by a later migration: 171 adds its new columns to 170's.
SELECT 'trigger bw_live_pack_song ON public.songs', '171', '170',
       EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = 'bw_live_pack_song' AND tg.tgrelid = to_regclass('public.songs')
               AND strpos(pg_get_triggerdef(tg.oid), 'line_timing') > 0)
ORDER BY 2, 1;
