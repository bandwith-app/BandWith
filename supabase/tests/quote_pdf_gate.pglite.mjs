// Local check of migrations 176 + 177 (quote PDFs behind the quote link)
// without Docker: PGlite with stand-ins for storage.buckets and the quote
// tables. Failing first: with /dev/null for both migrations, the bucket is
// still public and there is no gate.
//
//   mkdir -p /tmp/pg176 && cd /tmp/pg176 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/quote_pdf_gate.pglite.mjs . && node quote_pdf_gate.pglite.mjs <repo>
//   node quote_pdf_gate.pglite.mjs <repo> /dev/null /dev/null   # before: FAILs expected
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const REPO = process.argv[2];
const M176 = process.argv[3] ?? `${REPO}/supabase/migrations/176_quote_pdf_gate.sql`;
const M177 = process.argv[4] ?? `${REPO}/supabase/migrations/177_quotes_bucket_private.sql`;
const migs = [M176, M177].map((f) => readFileSync(f, 'utf8'));

const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const BAND = id(1), OTHER = id(2), Q1 = id(10), Q2 = id(11), Q3 = id(12), Q4 = id(13), GIG = id(20);
const tok = (c) => c.repeat(64);
const SB = 'https://elvlzpowkohjbhxjasvd.supabase.co/storage/v1/object/public/quotes/quotes';
const file = (band, n) => `${SB}/${band}/Q-${n}_ab12_Quote_Hudson_Horns_Client.pdf`;

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
INSERT INTO storage.buckets VALUES ('quotes', 'quotes', true), ('avatars', 'avatars', true), ('song-files', 'song-files', false);
CREATE TABLE public.quotes (id uuid PRIMARY KEY, band_id uuid, converted_to_event_id uuid);
CREATE TABLE public.events (id uuid PRIMARY KEY, band_id uuid, quote_id uuid, status text, created_at timestamptz DEFAULT now());
CREATE TABLE public.quote_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid, band_id uuid, token text,
  snapshot jsonb, version int, pdf_url text, pdf_version int, status text, accepted_pdf_url text, revoked_at timestamptz, balance jsonb);
CREATE FUNCTION public.bw_quote_gig_id(p_quote_id uuid) RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT e.id FROM public.quotes q JOIN public.events e ON e.band_id = q.band_id AND (e.id = q.converted_to_event_id OR e.quote_id = q.id)
   WHERE q.id = p_quote_id LIMIT 1 $f$;
INSERT INTO quotes VALUES ('${Q1}','${BAND}',NULL), ('${Q2}','${BAND}',NULL), ('${Q3}','${BAND}','${GIG}'), ('${Q4}','${BAND}',NULL);
INSERT INTO events VALUES ('${GIG}','${BAND}','${Q3}','confirmed');
INSERT INTO quote_links (quote_id, band_id, token, snapshot, version, pdf_url, pdf_version, status, accepted_pdf_url, revoked_at, balance) VALUES
  ('${Q1}','${BAND}','${tok('a')}','{}',2,'${file(BAND, 1)}',2,'sent',NULL,NULL,NULL),
  ('${Q2}','${BAND}','${tok('b')}','{}',2,'${file(BAND, 2)}',2,'sent',NULL, now(),NULL),
  ('${Q3}','${BAND}','${tok('c')}','{}',3,'${file(BAND, 3)}',2,'accepted','${file(BAND, 30)}',NULL,'{"pdfUrl":"${file(BAND, 31)}"}'),
  ('${Q4}','${BAND}','${tok('d')}','{}',1,'${file(OTHER, 4)}',1,'sent',NULL,NULL,NULL);
`);

for (const m of migs) await db.exec(m);
for (const m of migs) await db.exec(m); // idempotent
ok(true, 'migrations run twice');

const pub = (await db.query(`SELECT id, public FROM storage.buckets ORDER BY id`)).rows;
ok(pub.find((b) => b.id === 'quotes')?.public === false, 'quotes bucket is private');
ok(pub.find((b) => b.id === 'avatars')?.public === true, 'other buckets untouched');

// The gate takes sha256(token), never the token itself.
const keyOf = (t) => createHash('sha256').update(t).digest('hex');
const path = async (t, k = 'doc', raw = false) => {
  try { return (await db.query(`SELECT public.bw_quote_link_pdf_path($1, $2) AS p`, [raw ? t : keyOf(t), k])).rows[0].p; }
  catch (e) { return `ERR ${e.message}`; }
};
ok(await path(tok('a')) === `quotes/${BAND}/Q-1_ab12_Quote_Hudson_Horns_Client.pdf`, 'active link: its PDF');
ok(await path(tok('b')) === null, 'link turned off: no PDF');
ok(await path(tok('c')) === `quotes/${BAND}/Q-30_ab12_Quote_Hudson_Horns_Client.pdf`, 'accepted: the accepted PDF');
ok(await path(tok('c'), 'balance') === `quotes/${BAND}/Q-31_ab12_Quote_Hudson_Horns_Client.pdf`, 'balance PDF once shown');
await db.exec(`UPDATE events SET status = 'cancelled' WHERE id = '${GIG}'`);
ok(await path(tok('c'), 'balance') === null, 'balance PDF hidden once the gig is cancelled');
ok(await path(tok('d')) === null, "a URL pointing at another band's folder is refused");
ok(await path(tok('e')) === null, 'unknown token: nothing');
ok(await path('not-a-token', 'doc', true) === null, 'malformed key: nothing');
ok(await path(tok('a'), 'doc', true) === null, 'the token itself is not a PDF key (a PDF link never carries it)');
await db.exec(`UPDATE quote_links SET version = 3 WHERE token = '${tok('a')}'`);
ok(await path(tok('a')) === null, 'PDF of an older version is not served');

const grants = (await db.query(`SELECT r AS role, has_function_privilege(r, 'public.bw_quote_link_pdf_path(text,text)', 'EXECUTE') AS x
  FROM unnest(ARRAY['anon','authenticated','service_role']) r`).catch(() => ({ rows: [] }))).rows;
ok(grants.length === 3 && grants.every((g) => g.x === (g.role === 'service_role')), `server only: ${JSON.stringify(grants)}`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
