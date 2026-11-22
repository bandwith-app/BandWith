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
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
-- 009 + 031: one row per token.
CREATE TABLE public.push_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, token text NOT NULL,
  platform text, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE (token));
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

// The device saved its token at 10:00 and read back the row's updated_at.
const REG = '2026-11-20T10:00:00Z';
ok(await revoke('anon', TOK, BOB, REG) === false, "another account can't switch Alice's token off");
ok(await active(TOK) === true, 'still active after the wrong account');
ok(await revoke('anon', 'short', ALICE, REG) === false, 'malformed token: nothing');
// Codex review #287: a device time is never compared. A slow clock (sign-out
// "before" the registration) or a future time decide nothing.
ok(await revoke('anon', TOK, ALICE, '2026-11-20T09:00:00Z') === false, 'a time that is not the registration: nothing');
ok(await revoke('anon', TOK, ALICE, '2099-01-01T00:00:00Z') === false, 'a future time: nothing');
ok(await active(TOK) === true, 'still active after those');
ok(await revoke('anon', TOK, ALICE, REG) === true, 'signed-out device (anon) switches its own registration off');
ok(await active(TOK) === false, 'token is off: no more pushes to that phone');
ok(await revoke('anon', TOK, ALICE, REG) === false, 'twice: nothing more to do');

// Re-registered later (a new sign-in): the old stamp no longer matches.
await db.exec(`UPDATE push_tokens SET is_active = true, updated_at = '2026-11-21T09:00:00Z' WHERE token = '${TOK}'`);
ok(await revoke('anon', TOK, ALICE, REG) === false, 'a newer registration is left alone');
ok(await revoke('anon', TOK, ALICE, '2099-01-01T00:00:00Z') === false, 'and a future time cannot reach it either');
ok(await active(TOK) === true, 'still active after the late revocation');
ok(await active(TOK2) === true, "Bob's token untouched throughout");

// Codex review #287 round 2 (B3): the save returns its own stamp, so the app
// needs no second request (which a dropped connection could lose).
const register = async (uid, tok, platform = 'ios') => {
  try {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`);
    return (await db.query(`SELECT public.bw_register_push_token_stamped($1, $2)::text AS at`, [tok, platform])).rows[0].at;
  } catch (e) { return `ERR ${e.message}`; }
  finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false)`); }
};
const TOK3 = 'c0ffee00'.repeat(8);
const stamp = await register(ALICE, TOK3);
ok(typeof stamp === 'string' && !stamp.startsWith('ERR'), `the save returns a stamp: ${stamp}`);
const row = (await db.query(`SELECT user_id, is_active, updated_at::text AS at FROM push_tokens WHERE token = $1`, [TOK3])).rows[0];
ok(row?.user_id === ALICE && row?.is_active === true && row?.at === stamp, 'it is exactly the row the save wrote');
ok(await revoke('anon', TOK3, ALICE, stamp) === true, 'that stamp revokes exactly that registration');
const again = await register(BOB, TOK3, 'android'); // the device moves to Bob (046 behaviour)
ok(typeof again === 'string' && !again.startsWith('ERR') && again !== stamp, 'a new save moves the token and gives a new stamp');
ok(await revoke('anon', TOK3, ALICE, stamp) === false && await active(TOK3) === true, "Alice's old stamp can't touch Bob's registration");
ok(String(await register(null, TOK3)).startsWith('ERR'), 'needs a session');
ok(String(await register(ALICE, 'short')).startsWith('ERR'), 'malformed token refused');
const anonReg = (await db.query(`SELECT has_function_privilege('anon', 'public.bw_register_push_token_stamped(text,text)', 'EXECUTE') AS x`).catch(() => ({ rows: [{ x: null }] }))).rows[0].x;
ok(anonReg === false, 'the stamped save is not open to anon');

const grants = (await db.query(`SELECT r AS role, has_function_privilege(r, 'public.bw_revoke_push_token(text,uuid,timestamptz)', 'EXECUTE') AS x
  FROM unnest(ARRAY['anon','authenticated']) r`).catch(() => ({ rows: [] }))).rows;
ok(grants.length === 2 && grants.every((g) => g.x === true), `callable without a session: ${JSON.stringify(grants)}`);
const pub = (await db.query(`SELECT has_function_privilege('public', 'public.bw_revoke_push_token(text,uuid,timestamptz)', 'EXECUTE') AS x`).catch(() => ({ rows: [{ x: null }] }))).rows[0].x;
ok(pub === false, 'not granted to PUBLIC');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
