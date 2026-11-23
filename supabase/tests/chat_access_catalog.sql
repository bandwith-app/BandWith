-- Read-only (#289 round 5): who can read the chat tables on this database.
-- For main's dry run on prod: run it as is (inside the dry-run transaction,
-- after 175 + 181, before the rollback, and once before them for the
-- baseline). One result set, ordered. Nothing here writes.
--
-- kind = 'function': every function in public whose source mentions
--   chat_participants, every SECURITY DEFINER one that mentions messages or
--   chats, and bw_chat_rule_ungated (175's internal rule, granted to nobody);
--   with who may run it and whether it applies 175's rule.
-- kind = 'policy': every RLS policy on public.chat_participants, messages
--   and chats.
--
-- Check the output against the allowlists in
-- supabase/tests/chat_participants_guard.pglite.mjs: save it as JSON (an
-- array of rows) and run
--   BW_PROD_CATALOG=<file.json> node chat_participants_guard.pglite.mjs <repo>
-- (the allowlist checks then read that file instead of PGlite's catalog).
SELECT kind, name, detail
  FROM (
    SELECT 'function' AS kind,
           p.oid::regprocedure::text AS name,
           jsonb_build_object(
             'proname', p.proname,
             'security_definer', p.prosecdef,
             'is_trigger', p.prorettype = 'trigger'::regtype,
             'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
             'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
             'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'),
             'public', EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'),
             'applies_rule', p.prosrc ~ 'bw_chat_scope_ok|bw_my_chat_ids|bw_chat_row_ok|bw_chat_rule_ungated',
             'tables', to_jsonb(array_remove(ARRAY[
               CASE WHEN p.prosrc ~* '\mchat_participants\M' THEN 'chat_participants' END,
               CASE WHEN p.prosrc ~* '\mmessages\M' THEN 'messages' END,
               CASE WHEN p.prosrc ~* '\mchats\M' THEN 'chats' END], NULL))
           ) AS detail
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND (p.prosrc ~* '\mchat_participants\M'
            OR (p.prosecdef AND p.prosrc ~* '\m(messages|chats)\M')
            OR p.proname = 'bw_chat_rule_ungated')
    UNION ALL
    SELECT 'policy',
           pol.tablename || '.' || pol.policyname,
           jsonb_build_object(
             'table', pol.tablename,
             'policyname', pol.policyname,
             'cmd', pol.cmd,
             'permissive', pol.permissive,
             'roles', to_jsonb(pol.roles),
             'qual', pol.qual,
             'with_check', pol.with_check)
      FROM pg_policies pol
     WHERE pol.schemaname = 'public'
       AND pol.tablename IN ('chat_participants', 'messages', 'chats')
  ) x
 ORDER BY kind, name;
