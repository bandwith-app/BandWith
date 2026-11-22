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
const as = async (uid, fn) => {
  try {
    await db.exec(uid ? `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false)` : `SET ROLE anon`);
    return await fn();
  } catch (e) { return `ERR ${e.message}`; }
  finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false)`); }
};
// Signed out (uid null) or signed in as uid. secret: what the device kept.
const revoke = (uid, tok, owner, at, secret) =>
  as(uid, async () => (await db.query(`SELECT public.bw_revoke_push_token($1, $2, $3, $4) AS r`, [tok, owner, at, secret])).rows[0].r);
const revoke3 = (uid, tok, owner, at) =>
  as(uid, async () => (await db.query(`SELECT public.bw_revoke_push_token($1, $2, $3) AS r`, [tok, owner, at])).rows[0].r);
const register = (uid, tok, secret, platform = 'ios') =>
  as(uid, async () => (await db.query(`SELECT public.bw_register_push_token_stamped($1, $2, $3) AS j`, [tok, platform, secret])).rows[0].j);
const pending = (tok, owner) =>
  as(null, async () => (await db.query(`SELECT public.bw_push_token_registered($1, $2) AS r`, [tok, owner])).rows[0].r);
const S1 = 'a'.repeat(20) + '1'.repeat(44), S2 = 'b'.repeat(20) + '2'.repeat(44);

// Codex review #287 round 4 (B2): a former user on a shared iPad holds the
// device token and a bandmate's id. Without a session, the token, account
// and a stamp are not enough: only the secret the registration stored.
const REG = '2026-11-20T10:00:00Z';
ok(await revoke3(null, TOK, ALICE, REG) === false && await active(TOK) === true, 'anon with token + account + stamp, no secret: refused');
ok(await revoke3(null, TOK, ALICE, null) === false && await active(TOK) === true, 'anon with no stamp and no secret: refused');
ok(await revoke(null, TOK, ALICE, null, S1) === false && await active(TOK) === true, 'anon with a secret the row never stored: refused');
// Signed in as the owner: the own token, with or without its stamp.
ok(await revoke(BOB, TOK, ALICE, null, null) === false && await active(TOK) === true, 'signed in as someone else: refused');
ok(await revoke(ALICE, TOK, ALICE, '2026-11-20T09:00:00Z', null) === false, 'owner with a stamp that is not the registration: nothing');
ok(await revoke(ALICE, TOK, ALICE, null, null) === true && await active(TOK) === false, 'owner without a stamp switches the own token off');

// The stamped save stores the device's secret (hashed) and returns the stamp.
const TOK3 = 'c0ffee00'.repeat(8);
const r1 = await register(ALICE, TOK3, S1);
ok(typeof r1?.registered_at === 'string', `the save returns a stamp: ${JSON.stringify(r1)}`);
const row = (await db.query(`SELECT user_id, is_active, updated_at AS at, revoke_secret_hash AS h FROM push_tokens WHERE token = $1`, [TOK3])).rows[0];
ok(row?.user_id === ALICE && row?.is_active === true && new Date(row.at).getTime() === new Date(r1.registered_at).getTime(), 'it is exactly the row the save wrote');
ok(typeof row?.h === 'string' && row.h.length === 64 && !row.h.includes(S1), 'only a hash of the secret is stored');
ok(await revoke(null, TOK3, BOB, null, S1) === false && await active(TOK3) === true, "anon: the secret doesn't work for another account");
ok(await revoke(null, TOK3, ALICE, null, S1) === true && await active(TOK3) === false, 'anon with the secret switches exactly that registration off');
ok(await revoke(null, TOK3, ALICE, null, S1) === false, 'replayed: nothing more to do');
// Re-registering rotates the secret: a replay of the old one fails.
await register(ALICE, TOK3, S2);
ok(await revoke(null, TOK3, ALICE, null, S1) === false && await active(TOK3) === true, 'after a new registration the old secret is refused');
ok(await pending(TOK3, ALICE) === true, 'still registered to Alice: the device keeps its revocation');
// The device moves to Bob: Alice's secrets are useless, and Bob's row is his.
await register(BOB, TOK3, S1);
ok(await revoke(null, TOK3, ALICE, null, S2) === false && await revoke(null, TOK3, ALICE, null, S1) === false && await active(TOK3) === true, "Alice's secrets can't touch Bob's registration");
ok(await pending(TOK3, ALICE) === false, 'no longer registered to Alice: her revocation can go');
ok(await pending(TOK3, BOB) === true, 'registered to Bob');
// Any other re-save (046, an older build) clears the secret: no replay.
await db.exec(`CREATE OR REPLACE FUNCTION public.bw_register_push_token(p_token text, p_platform text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.push_tokens (user_id, token, platform, is_active, updated_at) VALUES (auth.uid(), p_token, p_platform, true, now())
  ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, is_active = true, updated_at = now() $$;
  GRANT EXECUTE ON FUNCTION public.bw_register_push_token(text, text) TO authenticated;`);
await as(BOB, () => db.query(`SELECT public.bw_register_push_token($1, 'ios')`, [TOK3]));
ok(await revoke(null, TOK3, BOB, null, S1) === false && await active(TOK3) === true, 'a re-save by 046 clears the secret: the old one is refused');
ok(await revoke(BOB, TOK3, BOB, null, null) === true, 'the signed-in owner can still switch it off');
// The same secret sent twice stays valid (the save set it itself).
await register(BOB, TOK3, S2);
await register(BOB, TOK3, S2);
ok(await revoke(null, TOK3, BOB, null, S2) === true, 'a save repeating the same secret keeps it');
ok(String(await register(null, TOK3, S1)).startsWith('ERR'), 'the save needs a session');
ok(String(await register(ALICE, 'short', S1)).startsWith('ERR'), 'malformed token refused');
ok(String(await register(ALICE, TOK2, 'short')).startsWith('ERR'), 'a short secret is refused');
const gen = await register(ALICE, 'deadbeef'.repeat(8), null);
ok(typeof gen?.secret === 'string' && gen.secret.length >= 32, 'no secret sent: the server makes one and returns it');
ok(await revoke(null, 'deadbeef'.repeat(8), ALICE, null, gen.secret) === true, 'and that one works');
ok(await revoke(null, 'short', ALICE, null, S1) === false, 'malformed token: nothing');
ok(await active(TOK2) === true, "Bob's other token untouched throughout");

const priv = async (role, fn) => (await db.query(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS x`).catch(() => ({ rows: [{ x: null }] }))).rows[0].x;
ok(await priv('anon', 'public.bw_register_push_token_stamped(text,text,text)') === false, 'the stamped save is not open to anon');
ok(await priv('authenticated', 'public.bw_register_push_token_stamped(text,text,text)') === true, 'the stamped save is open to signed-in users');
for (const fn of ['public.bw_revoke_push_token(text,uuid,timestamptz,text)', 'public.bw_push_token_registered(text,uuid)']) {
  ok(await priv('anon', fn) === true && await priv('authenticated', fn) === true, `${fn} callable without a session`);
  ok(await priv('public', fn) === false, `${fn} not granted to PUBLIC`);
}
const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'push_tokens' AND column_name = 'revoke_secret_hash'`)).rows;
ok(cols.length === 1, 'push_tokens.revoke_secret_hash exists');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
