# supabase/tests/fixtures

## replay-bridge.sql

What `supabase/tests/integration-chain.pglite.mjs` needs to replay every migration of the
checkout from `001` on one empty database: prod was not built from the files alone (tables
and columns made by hand or in the dashboard, the 002 variants, 024's FK test that never
matched). Each piece says what prod has that no migration made. The directives
(`@order`, `@skip`, `@sub`, `@before`) are explained in its header.

When a replay fails (`FAIL replay NNN_…`), add the missing piece here, with its reason, right
before the file that needs it. Never edit a migration to make the replay pass.
`scripts/release-checklist.test.ts` checks every file it names exists and every `@sub` text
is still in its file.

No dump of prod is needed: the release starts from the replayed `main`. The Supabase
parts outside `public` (roles, auth, storage, vault, pg_cron, pg_net, realtime) are stubbed
in the suite itself.
