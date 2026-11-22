// Local check of migration 184 (push revocation after an offline sign-out)
// without Docker: PGlite with a push_tokens table as 009 + 046 left it.
// Failing first: with /dev/null as the migration there is no way to switch
// the token off without a session, so the signed-out phone keeps its pushes.
//
//   mkdir -p /tmp/pg184 && cd /tmp/pg184 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/push_revoke_signed_out.pglite.mjs . && node push_revoke_signed_out.pglite.mjs <repo>
//   node push_revoke_signed_out.pglite.mjs <repo> /dev/null    # before: FAILs expected
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG = process.argv[3] ?? `${REPO}/supabase/migrations/184_push_revoke_signed_out.sql`;
const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [ALICE, BOB] = [1, 2].map(id);
const TOK = 'a1b2c3d4'.repeat(8), TOK2 = 'f0e1d2c3'.repeat(8);

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.push_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, token text NOT NULL,
  platform text, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE (user_id, token));
INSERT INTO push_tokens (user_id, token, platform, updated_at) VALUES
  ('${ALICE}', '${TOK}', 'ios', '2026-11-20T10:00:00Z'),
  ('${BOB}', '${TOK2}', 'android', '2026-11-20T10:00:00Z');
GRANT SELECT ON public.push_tokens TO service_role;
`);

await db.exec(readFileSync(MIG, 'utf8'));
await db.exec(readFileSync(MIG, 'utf8')); // idempotent
ok(true, 'migration runs twice');

const active = async (tok) => (await db.query(`SELECT is_active FROM push_tokens WHERE token = $1`, [tok])).rows[0]?.is_active;
const revoke = async (role, tok, uid, at) => {
  try {
    await db.exec(`SET ROLE ${role}`);
    const r = (await db.query(`SELECT public.bw_revoke_push_token($1, $2, $3) AS r`, [tok, uid, at])).rows[0].r;
    return r;
  } catch (e) { return `ERR ${e.message}`; }
  finally { await db.exec('RESET ROLE'); }
};

// Signed out at 10:30; a new sign-in would have set updated_at later.
ok(await revoke('anon', TOK, BOB, '2026-11-20T10:30:00Z') === false, "another account can't switch Alice's token off");
ok(await active(TOK) === true, 'still active after the wrong account');
ok(await revoke('anon', 'short', ALICE, '2026-11-20T10:30:00Z') === false, 'malformed token: nothing');
ok(await revoke('anon', TOK, ALICE, '2026-11-20T10:30:00Z') === true, 'signed-out device (anon) switches its own token off');
ok(await active(TOK) === false, 'token is off: no more pushes to that phone');
ok(await revoke('anon', TOK, ALICE, '2026-11-20T10:30:00Z') === false, 'twice: nothing more to do');

// Re-registered after the sign-out (a new sign-in): a late revocation must not undo it.
await db.exec(`UPDATE push_tokens SET is_active = true, updated_at = '2026-11-21T09:00:00Z' WHERE token = '${TOK}'`);
ok(await revoke('anon', TOK, ALICE, '2026-11-20T10:30:00Z') === false, 'a newer registration is left alone');
ok(await active(TOK) === true, 'still active after the late revocation');
ok(await active(TOK2) === true, "Bob's token untouched throughout");

const grants = (await db.query(`SELECT r AS role, has_function_privilege(r, 'public.bw_revoke_push_token(text,uuid,timestamptz)', 'EXECUTE') AS x
  FROM unnest(ARRAY['anon','authenticated']) r`).catch(() => ({ rows: [] }))).rows;
ok(grants.length === 2 && grants.every((g) => g.x === true), `callable without a session: ${JSON.stringify(grants)}`);
const pub = (await db.query(`SELECT has_function_privilege('public', 'public.bw_revoke_push_token(text,uuid,timestamptz)', 'EXECUTE') AS x`).catch(() => ({ rows: [{ x: null }] }))).rows[0].x;
ok(pub === false, 'not granted to PUBLIC');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
