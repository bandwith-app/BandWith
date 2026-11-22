# supabase/tests/fixtures

## base_schema.sql (not committed yet)

The database the release goes onto, for `supabase/tests/release_integration.pglite.mjs`:
prod's `public` schema **before** the release, schema only, no rows. The migrations on
`main` can't rebuild it (prod was set up partly by hand, and 001 doesn't replay), so the
release run starts from this dump.

Who makes it: main session or the owner (it reads prod). Read only (`pg_dump`):

```sh
npx supabase db dump --linked --schema public --file supabase/tests/fixtures/base_schema.sql
```

Before committing it:
- check it has no rows and no secrets (`grep -n -i -E "insert into|copy .* from stdin|secret|password|key" base_schema.sql`);
- load it once with the suite (`node supabase/tests/pglite-runner/run.mjs . release_integration.pglite.mjs`).
  PGlite lacks some extensions: drop or stub what it refuses, and say so in a comment at the top.

Refresh it after each release, once the release's migrations are live (the next release starts from there).

The Supabase parts that aren't in `public` (auth, storage, pg_cron, pg_net, roles, the
realtime publication) are stubbed in the suite itself.
