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
GRANT ALL ON public.push_tokens TO authenticated; -- 009 (RLS: own rows)
-- 046 as live: returns void, so a sign-out can't tell whether it switched anything off.
CREATE OR REPLACE FUNCTION public.bw_unregister_push_token(p_token text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.push_tokens SET is_active = false, updated_at = now() WHERE token = p_token AND user_id = auth.uid(); $$;
REVOKE ALL ON FUNCTION public.bw_unregister_push_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_unregister_push_token(text) TO authenticated;
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
const gated = async (tok) => (await db.query(`SELECT uid_gated FROM push_tokens WHERE token = $1`, [tok])).rows[0]?.uid_gated;
const registerGated = (uid, tok, secret, platform, flag) =>
  as(uid, async () => (await db.query(`SELECT public.bw_register_push_token_stamped($1, $2, $3, $4) AS j`, [tok, platform, secret, flag])).rows[0].j);
const S1 = 'a'.repeat(20) + '1'.repeat(44), S2 = 'b'.repeat(20) + '2'.repeat(44);

// Codex review #287 round 4 (B2): a former user on a shared iPad holds the
// device token and a bandmate's id. Without a session, the token, account
// and a stamp are not enough: only the secret the registration stored.
const REG = '2026-11-20T10:00:00Z';
ok(await revoke3(null, TOK, ALICE, '2026-11-20T10:00:00.000001Z') === false && await active(TOK) === true, 'anon with a stamp one microsecond off: refused');
// Codex round 8 (B1): no matching credential, so false: the answer never
// says whether Bob (or Alice) is on this device.
ok(await revoke3(null, TOK, BOB, REG) === false && await active(TOK) === true, "anon with the stamp but another account: false, Alice's row untouched");
ok(await revoke3(null, TOK, ALICE, null) === false && await active(TOK) === true, 'anon with no stamp and no secret: refused');
ok(await revoke(null, TOK, ALICE, null, S1) === false && await active(TOK) === true, 'anon with a secret the row never stored: refused');
// Signed in as the owner: the own token, with or without its stamp.
ok(await revoke(BOB, TOK, ALICE, null, null) === false && await active(TOK) === true, 'signed in as someone else: refused');
ok(await revoke(ALICE, TOK, ALICE, '2026-11-20T09:00:00Z', null) === false, 'owner with a stamp that is not the registration: nothing');
// Main's decision (round 6): no secret matched (an older build's
// registration), but token, account and the exact stamp of its save do.
ok(await revoke(null, TOK, ALICE, REG, S1) === true && await active(TOK) === false, 'anon: wrong secret, exact stamp of that registration: switched off');
await db.query(`UPDATE push_tokens SET is_active = true, updated_at = $2 WHERE token = $1`, [TOK, REG]);
ok(await revoke3(null, TOK, ALICE, REG) === true && await active(TOK) === false, 'anon: no secret, exact stamp: switched off');
await db.query(`UPDATE push_tokens SET is_active = true, updated_at = $2 WHERE token = $1`, [TOK, REG]);
{
  ok(await revoke3(null, TOK, ALICE, REG) === true, 'switched off once');
  const after = (await db.query(`SELECT updated_at AS at FROM push_tokens WHERE token = $1`, [TOK])).rows[0].at;
  ok(await revoke3(null, TOK, ALICE, REG) === false && new Date((await db.query(`SELECT updated_at AS at FROM push_tokens WHERE token = $1`, [TOK])).rows[0].at).getTime() === new Date(after).getTime(),
    'replayed by stamp: the switch-off changed the stamp, false, nothing written');
}
await db.query(`UPDATE push_tokens SET is_active = true, updated_at = $2 WHERE token = $1`, [TOK, REG]);
ok(await revoke(ALICE, TOK, ALICE, null, null) === true && await active(TOK) === false, 'owner without a stamp switches the own token off');

// The stamped save stores the device's secret (hashed) and returns the stamp.
const TOK3 = 'c0ffee00'.repeat(8);
const r1 = await register(ALICE, TOK3, S1);
ok(typeof r1?.registered_at === 'string', `the save returns a stamp: ${JSON.stringify(r1)}`);
const row = (await db.query(`SELECT user_id, is_active, updated_at AS at, revoke_secret_hash AS h FROM push_tokens WHERE token = $1`, [TOK3])).rows[0];
ok(row?.user_id === ALICE && row?.is_active === true && new Date(row.at).getTime() === new Date(r1.registered_at).getTime(), 'it is exactly the row the save wrote');
ok(typeof row?.h === 'string' && row.h.length === 64 && !row.h.includes(S1), 'only a hash of the secret is stored');
ok(await revoke(null, TOK3, BOB, null, S1) === false && await active(TOK3) === true, "anon: the secret doesn't work for another account (false)");
ok(await revoke(null, TOK3, ALICE, null, S1) === true && await active(TOK3) === false, 'anon with the secret switches exactly that registration off');
ok(await revoke(null, TOK3, ALICE, null, S1) === true && await active(TOK3) === false, 'replayed with the secret: the row is off, the credential still matches: true');
// Re-registering rotates the secret: a replay of the old one fails.
await register(ALICE, TOK3, S2);
ok(await revoke(null, TOK3, ALICE, null, S1) === false && await active(TOK3) === true, 'after a new registration the old secret is refused');
// Main's decision (round 5): no lookup by token at all, the device decides.
ok((await db.query(`SELECT to_regprocedure('public.bw_push_token_registered(text,uuid)') AS a, to_regprocedure('public.bw_push_token_registered(text,uuid,text)') AS b`)).rows.every((r) => r.a === null && r.b === null), 'no bw_push_token_registered: nobody can ask by token');
// The device moves to Bob: Alice's secrets are useless, and Bob's row is his.
await register(BOB, TOK3, S1);
ok(await revoke(null, TOK3, ALICE, null, S2) === false && await revoke(null, TOK3, ALICE, null, S1) === false && await active(TOK3) === true, "Alice's secrets can't touch Bob's registration (false)");
// Any other re-save (046, an older build) clears the secret: no replay.
await db.exec(`CREATE OR REPLACE FUNCTION public.bw_register_push_token(p_token text, p_platform text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.push_tokens (user_id, token, platform, is_active, updated_at) VALUES (auth.uid(), p_token, p_platform, true, now())
  ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, is_active = true, updated_at = now() $$;
  GRANT EXECUTE ON FUNCTION public.bw_register_push_token(text, text) TO authenticated;`);
await as(BOB, () => db.query(`SELECT public.bw_register_push_token($1, 'ios')`, [TOK3]));
ok(await revoke(null, TOK3, BOB, null, S1) === false && await active(TOK3) === true, 'a re-save by 046 clears the secret: the old one is refused');
ok(await revoke(BOB, TOK3, BOB, null, null) === true, 'the signed-in owner can still switch it off');
// Codex review #287 round 5 (B1): only the new Android save marks a token as
// checking the signed-in account; any other change of the registration
// clears it, so send-push falls back to the notification message.
const TOKA = 'android-token-' + 'f'.repeat(40);
ok(await registerGated(ALICE, TOKA, S1, 'android', true) !== null && await gated(TOKA) === true, 'the new Android save marks the token');
await register(ALICE, TOKA, S1, 'android');
ok(await gated(TOKA) === false, 'a save without the mark (3-arg call) leaves it unmarked');
await registerGated(ALICE, TOKA, S1, 'android', true);
await as(BOB, () => db.query(`SELECT public.bw_register_push_token($1, 'android')`, [TOKA]));
ok(await gated(TOKA) === false, 'a re-save by 046 (an older build) clears the mark');
await registerGated(BOB, TOKA, S2, 'android', true);
await db.query(`UPDATE push_tokens SET is_active = false WHERE token = $1`, [TOKA]);
ok(await gated(TOKA) === false, 'switched off: the mark goes');
await registerGated(BOB, TOKA, S2, 'ios', true);
ok(await gated(TOKA) === false, 'never on iOS');
await registerGated(BOB, TOKA, S2, 'android', null);
ok(await gated(TOKA) === false, 'null means no');
await registerGated(BOB, TOKA, S2, 'android', true);
await db.query(`UPDATE push_tokens SET user_id = $2 WHERE token = $1`, [TOKA, ALICE]);
ok(await gated(TOKA) === false, 'moved to another account by anything else: the mark goes');
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
// C4 (round 7): the revoke takes every token the save takes (10+ chars).
{
  const T10 = '0123456789';
  await register(ALICE, T10, S1);
  ok(await active(T10) === true && await revoke(null, T10, ALICE, null, S1) === true && await active(T10) === false, 'a 10-character token the save took can be revoked');
}
// C2 / Codex M2 (round 7): the token row is gone (an APNs 410 switched it
// off, or the account was deleted and the row cascaded): done, not refused forever.
{
  const T410 = 'feedface'.repeat(8);
  await register(ALICE, T410, S1);
  await db.query(`UPDATE push_tokens SET is_active = false WHERE token = $1`, [T410]); // send-push after a 410
  ok(await revoke(null, T410, ALICE, null, S1) === true && await active(T410) === false, 'switched off by send-push (APNs 410), the matching secret: true');
  ok(await revoke(null, T410, ALICE, null, S2) === false, 'switched off, a secret it never had: false');
  ok(await revoke(null, T410, BOB, null, null) === false && await revoke(null, T410, BOB, null, S1) === false, "a bandmate's id on an inactive row, no matching credential: false");
  ok(await revoke(ALICE, T410, ALICE, null, null) === true, 'the signed-in owner: nothing of hers on: true');
  await db.query(`DELETE FROM push_tokens WHERE token = $1`, [T410]); // the account's rows cascade
  ok(await revoke(null, T410, ALICE, null, S1) === false && await revoke(null, T410, BOB, null, null) === false, 'no row left: false for anyone signed out');
  ok(await revoke(ALICE, T410, ALICE, null, null) === true, 'no row left, the signed-in owner: true');
  // A bandmate's id with nothing matching: false whether the row is on, off or absent.
  const TB = 'beadbead'.repeat(8);
  await register(BOB, TB, S2);
  const asked = async () => revoke(null, TB, BOB, null, S1);
  const on = await asked();
  await db.query(`UPDATE push_tokens SET is_active = false WHERE token = $1`, [TB]);
  const off = await asked();
  await db.query(`DELETE FROM push_tokens WHERE token = $1`, [TB]);
  const absent = await asked();
  ok(on === false && off === false && absent === false, `no credential match: the same false on, off and absent (${on}/${off}/${absent})`);
}
// A row switched back on by a plain save loses the kept secret.
{
  const TR = 'abcdabcd'.repeat(8);
  const hashOf = async (tok) => (await db.query(`SELECT revoke_secret_hash AS h FROM push_tokens WHERE token = $1`, [tok])).rows[0]?.h;
  await register(ALICE, TR, S1);
  ok(await revoke(null, TR, ALICE, null, S1) === true && await hashOf(TR) !== null, 'switched off by the revocation: the secret stays');
  await as(ALICE, () => db.query(`SELECT public.bw_register_push_token($1, 'ios')`, [TR]));
  ok(await hashOf(TR) === null && await revoke(null, TR, ALICE, null, S1) === false && await active(TR) === true, 'back on through 046: the secret is gone, the old one refused');
}
ok(await active(TOK2) === true, "Bob's other token untouched throughout");

const priv = async (role, fn) => (await db.query(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS x`).catch(() => ({ rows: [{ x: null }] }))).rows[0].x;
ok(await priv('anon', 'public.bw_register_push_token_stamped(text,text,text,boolean)') === false, 'the stamped save is not open to anon');
ok(await priv('authenticated', 'public.bw_register_push_token_stamped(text,text,text,boolean)') === true, 'the stamped save is open to signed-in users');
ok((await db.query(`SELECT to_regprocedure('public.bw_register_push_token_stamped(text,text,text)') AS f`)).rows[0].f === null, 'one stamped save only (the draft 3-arg form is dropped)');
for (const fn of ['public.bw_revoke_push_token(text,uuid,timestamptz,text)']) {
  ok(await priv('anon', fn) === true && await priv('authenticated', fn) === true, `${fn} callable without a session`);
  ok(await priv('public', fn) === false, `${fn} not granted to PUBLIC`);
}
// Claude review #287 round 5: the owner can write its own rows through RLS;
// only the stamped save may set the secret's hash and the account mark.
const TOKD = 'direct-token-' + 'c'.repeat(40);
await registerGated(ALICE, TOKD, S1, 'android', true);
const hashOf = async (tok) => (await db.query(`SELECT revoke_secret_hash AS h FROM push_tokens WHERE token = $1`, [tok])).rows[0]?.h;
const before = await hashOf(TOKD);
await as(ALICE, () => db.query(`UPDATE push_tokens SET revoke_secret_hash = 'forged', uid_gated = false WHERE token = $1`, [TOKD]));
ok(await hashOf(TOKD) === before && await gated(TOKD) === true, 'a direct update by the owner leaves the hash and the mark as they were');
await as(ALICE, () => db.query(`UPDATE push_tokens SET platform = 'android' WHERE token = $1`, [TOKD]));
ok(await hashOf(TOKD) === before && await gated(TOKD) === true, 'an unrelated direct update keeps them too');
const TOKI = 'inserted-token-' + 'd'.repeat(40);
await as(ALICE, () => db.query(`INSERT INTO push_tokens (user_id, token, platform, revoke_secret_hash, uid_gated) VALUES ($1, $2, 'android', 'forged', true)`, [ALICE, TOKI]));
ok(await hashOf(TOKI) === null && await gated(TOKI) === false, 'a direct insert starts with neither');
await registerGated(ALICE, TOKI, S2, 'android', true);
ok(await hashOf(TOKI) !== null && await gated(TOKI) === true && await revoke(null, TOKI, ALICE, null, S2) === true, 'the stamped save still sets both');

// Codex review #287 round 6 (B2): the signed-in unregister says whether it
// switched a token off. Same name and argument, so older builds (which read
// only the error) keep working.
const TOKU = 'unreg-token-' + 'e'.repeat(40);
await registerGated(ALICE, TOKU, S1, 'ios', false);
const unreg = (uid, tok) => as(uid, async () => (await db.query(`SELECT public.bw_unregister_push_token($1) AS r`, [tok])).rows[0].r);
ok(await unreg(BOB, TOKU) === false && await active(TOKU) === true, "Bob signing out while the token is still Alice's: false, nothing switched off");
ok(await unreg(ALICE, 'no-such-token-' + 'x'.repeat(30)) === false, 'an unknown token: false');
ok(await unreg(ALICE, TOKU) === true && await active(TOKU) === false, 'the owner: true, switched off');
ok(String(await unreg(null, TOKU)).startsWith('ERR'), 'still not open to anon');
ok((await db.query(`SELECT pg_get_function_result('public.bw_unregister_push_token(text)'::regprocedure) AS r`)).rows[0].r === 'boolean', 'one argument as before, now returns boolean');
ok(await priv('authenticated', 'public.bw_unregister_push_token(text)') === true && await priv('anon', 'public.bw_unregister_push_token(text)') === false, 'grants as in 046');

const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'push_tokens' AND column_name IN ('revoke_secret_hash', 'uid_gated')`)).rows;
ok(cols.length === 2, 'push_tokens.revoke_secret_hash and uid_gated exist');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
