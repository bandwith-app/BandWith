-- After the release's migrations are in: every function that more than one
-- of them defines has the body that must be live (docs/release-checklist.md,
-- section 2). Read only. Run as the database owner after the last migration:
--   npx supabase db query --remote --yes -f supabase/checks/redefined_functions.sql
-- Every row must be ok = true. A false row means another migration's body is
-- live (applied out of order, or applied again after the later one): stop and
-- re-apply that function's definition from the final migration's file.
--
-- Each row: the function, the migration whose body must be live, the
-- migrations it replaces, and a line of the final body that none of the
-- replaced bodies has. Matched as plain text (strpos) in pg_get_functiondef,
-- by NAME: every overload of that name must have it (an old signature left
-- next to a new one is false), and no signature is written here, so a
-- signature change on a branch can't make the check go stale. A missing
-- function is false.
--
-- The list: scripts/fn-redefinitions.mjs over the branch heads (11-22),
-- counting also definitions built in EXECUTE / EXECUTE format and DO blocks
-- that rewrite a live body (scripts/sql-functions.mjs). The final body is the
-- last definition in the apply order, except where that later definition can
-- be skipped: 178 keeps 175's bw_chat_scope_ok when it is live (its DO block
-- returns on a body that has the lineup and status rules), so 175's is the
-- one that must be live. scripts/release-checklist.test.ts fails when a
-- release migration on main defines a function another one defines too and
-- it has no row here.
--
-- Order these rows depend on (hard: the later migration raises without the
-- earlier one): 178 → 182 (bw_event_deputy_hidden), 175 → 193
-- (bw_chat_scope_ok_for, bw_chats_immutable_keys), 180 → 197
-- (bw_withdraw_song_suggestion starts from 180's body), 178 → 191 (191's DO
-- block adds 178's quote guard to the stage functions).
SELECT v.fn AS function,
       v.final AS final_migration,
       v.replaces,
       coalesce((SELECT bool_and(strpos(pg_get_functiondef(p.oid), v.mark) > 0)
                   FROM pg_proc p
                  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v.fn), false) AS ok
FROM (VALUES
  ('bw_live_pack_window_events', '178', '170', 'AND NOT public.bw_event_is_quote(e.status::text, e.event_type::text, e.quote_id)'),
  ('bw_trg_dispatch_push', '178', '170', 'IF NEW.type IN (''date_hold'', ''date_hold_changed'', ''date_hold_released'') THEN'),
  -- 178 keeps 175's body (above): the marker 181 also looks for.
  ('bw_chat_scope_ok', '175', '178', 'bw:175-r4'),
  ('get_user_chats', '178', '175', 'AND NOT (c.id = ANY ((SELECT public.bw_hidden_quote_chat_ids())::uuid[]));'),
  ('bw_mark_chat_read', '180', '175', 'to_regprocedure(''public.bw_chat_scope_ok_for(uuid,uuid)'') IS NOT NULL'),
  ('bw_mark_chats_delivered', '180', '175', 'to_regprocedure(''public.bw_chat_scope_ok_for(uuid,uuid)'') IS NOT NULL'),
  ('bw_quote_link_view', '187', '183', '''balance'', CASE WHEN v_show_balance THEN v_link.balance_sent END,'),
  ('bw_quote_link_respond', '187', '183', 'IF p_token IS NULL OR p_token !~ ''^[0-9a-f]{64}$'' THEN RETURN NULL; END IF;'),
  ('bw_quote_link_message', '187', '183', 'IF p_token IS NULL OR p_token !~ ''^[0-9a-f]{64}$'' THEN RETURN NULL; END IF;'),
  -- 191's own body; with 178 in, its DO block adds the quote guard after this text.
  ('bw_stage_key', '191', '178', 'OR NOT public.bw_can_view_event(p_event_id)'),
  ('bw_stage_topic_allowed', '191', '178', 'RETURN public.bw_is_band_admin(band) AND public.bw_can_view_event(ev::uuid);'),
  -- 180 → 197: the same body on the 11-22 heads (197 starts from 180's); the
  -- marker tells it from main's 108.
  ('bw_withdraw_song_suggestion', '197', '108', 'EXECUTE ''SELECT public.bw_song_files_left_unused($1)'' INTO v_files')
) AS v(fn, final, replaces, mark)
UNION ALL
-- A trigger redefined by a later migration: 171 adds its new columns to 170's.
SELECT 'trigger bw_live_pack_song ON public.songs', '171', '170',
       EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = 'bw_live_pack_song' AND tg.tgrelid = to_regclass('public.songs')
               AND strpos(pg_get_triggerdef(tg.oid), 'line_timing') > 0)
ORDER BY 2, 1;
