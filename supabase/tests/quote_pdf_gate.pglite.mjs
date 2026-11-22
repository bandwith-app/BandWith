// Local check of migrations 176 + 177 (quote PDFs behind the quote link)
// without Docker: PGlite with stand-ins for storage.buckets and the quote
// tables. Failing first: with /dev/null for both migrations, the bucket is
// still public and there is no gate.
//
//   mkdir -p /tmp/pg176 && cd /tmp/pg176 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/quote_pdf_gate.pglite.mjs . && node quote_pdf_gate.pglite.mjs <repo>
//   node quote_pdf_gate.pglite.mjs <repo> /dev/null /dev/null   # before: FAILs expected
//
// It runs on a database before 185 (no quote_links.balance_sent; the column
// is added later, as 185 does), on one where 185 came first, with
// events.status as the event_status enum of 002 (and once as text).
// Round 3: 177 (private bucket) is NOT in this release: by default it is not
// applied and everything must work with the bucket still public. WITH177=1
// adds it (the later step).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const REPO = process.argv[2];
const M176 = process.argv[3] ?? `${REPO}/supabase/migrations/176_quote_pdf_gate.sql`;
const M177 = process.argv[4] ?? (process.env.WITH177 ? `${REPO}/supabase/migrations/177_quotes_bucket_private.sql` : null);
const migs = [M176, M177].filter(Boolean).map((f) => readFileSync(f, 'utf8'));

process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const BAND = id(1), OTHER = id(2), Q1 = id(10), Q2 = id(11), Q3 = id(12), Q4 = id(13), Q5 = id(14), GIG = id(20);
const tok = (c) => c.repeat(64);
const SB = 'https://elvlzpowkohjbhxjasvd.supabase.co/storage/v1/object/public/quotes/quotes';
const name = (n) => `Q-${n}_ab12_Quote_Hudson_Horns_Client.pdf`;
const file = (band, n) => `${SB}/${band}/${name(n)}`;
const bal = (n) => JSON.stringify({ v: 1, amount: 1200 + n, pdfUrl: file(BAND, n) });

async function run(label, before185, statusType = 'event_status') {
  console.log(`\n── ${label}`);
  const db = new PGlite();
  await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
INSERT INTO storage.buckets VALUES ('quotes', 'quotes', true), ('avatars', 'avatars', true), ('song-files', 'song-files', false);
CREATE TABLE public.quotes (id uuid PRIMARY KEY, band_id uuid, converted_to_event_id uuid);
CREATE TYPE event_status AS ENUM ('draft', 'tentative', 'confirmed', 'cancelled', 'completed');
CREATE TABLE public.events (id uuid PRIMARY KEY, band_id uuid, quote_id uuid, status ${statusType}, created_at timestamptz DEFAULT now());
CREATE TABLE public.quote_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid, band_id uuid, token text UNIQUE,
  snapshot jsonb, version int, pdf_url text, pdf_version int, status text, accepted_pdf_url text, revoked_at timestamptz, balance jsonb,
  balance_sent_at timestamptz);
${before185 ? '' : 'ALTER TABLE public.quote_links ADD COLUMN balance_sent jsonb;'}
CREATE FUNCTION public.bw_quote_gig_id(p_quote_id uuid) RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT e.id FROM public.quotes q JOIN public.events e ON e.band_id = q.band_id AND (e.id = q.converted_to_event_id OR e.quote_id = q.id)
   WHERE q.id = p_quote_id LIMIT 1 $f$;
INSERT INTO quotes VALUES ('${Q1}','${BAND}',NULL), ('${Q2}','${BAND}',NULL), ('${Q3}','${BAND}','${GIG}'), ('${Q4}','${BAND}',NULL), ('${Q5}','${BAND}',NULL);
INSERT INTO events VALUES ('${GIG}','${BAND}','${Q3}','confirmed');
INSERT INTO quote_links (quote_id, band_id, token, snapshot, version, pdf_url, pdf_version, status, accepted_pdf_url, revoked_at, balance, balance_sent_at) VALUES
  ('${Q1}','${BAND}','${tok('a')}','{}',2,'${file(BAND, 1)}',2,'sent',NULL,NULL,NULL,NULL),
  ('${Q2}','${BAND}','${tok('b')}','{}',2,'${file(BAND, 2)}',2,'sent',NULL, now(),NULL,NULL),
  ('${Q3}','${BAND}','${tok('c')}','{}',3,'${file(BAND, 3)}',2,'accepted','${file(BAND, 30)}',NULL,'${bal(31)}', now()),
  ('${Q4}','${BAND}','${tok('d')}','{}',1,'${file(OTHER, 4)}',1,'sent',NULL,NULL,NULL,NULL),
  ('${Q5}','${BAND}','${tok('e')}','{}',1,'${file(BAND, 5)}',1,'sent',NULL,NULL,NULL,NULL);
${before185 ? '' : `UPDATE public.quote_links SET balance_sent = balance WHERE balance IS NOT NULL AND balance_sent_at IS NOT NULL;`}
`);

  for (const m of migs) await db.exec(m);
  for (const m of migs) await db.exec(m); // idempotent
  ok(true, 'migrations run twice');

  const pub = (await db.query(`SELECT id, public FROM storage.buckets ORDER BY id`)).rows;
  ok(pub.find((b) => b.id === 'quotes')?.public === !M177, M177 ? 'quotes bucket is private (177)' : 'without 177: quotes bucket stays public');
  ok(pub.find((b) => b.id === 'avatars')?.public === true, 'other buckets untouched');

  // What the client page gets (anon, by token), and what a PDF key opens.
  const keys = async (t) => {
    try {
      await db.exec('BEGIN; SET LOCAL ROLE anon;');
      const j = (await db.query(`SELECT public.bw_quote_link_pdf_keys($1) AS j`, [t])).rows[0].j;
      await db.exec('COMMIT');
      return j ?? {};
    } catch (e) { await db.exec('ROLLBACK'); return { error: e.message }; }
  };
  const open = async (key, k = 'doc') => {
    try { return (await db.query(`SELECT public.bw_quote_link_pdf_path($1, $2) AS p`, [key ?? '', k])).rows[0].p; }
    catch (e) { return `ERR ${e.message}`; }
  };
  const P = (n, band = BAND) => `quotes/${band}/${name(n)}`;

  const a = await keys(tok('a'));
  ok(/^[0-9a-f]{64}$/.test(a.doc ?? ''), `the page gets a PDF key for its document (${a.error ?? a.doc})`);
  ok(await open(a.doc) === P(1), 'active link: its PDF');
  ok(a.doc !== createHash('sha256').update(tok('a')).digest('hex') && await open(tok('a')) === null,
    'the key is not the token or its hash (a PDF link never carries the token)');
  ok(a.balance == null, 'no balance key before a balance');
  ok(await open(a.doc, 'balance') === null, "a quote PDF key doesn't open a balance");

  ok((await keys(tok('b'))).doc == null, 'link turned off: no keys');
  const bOld = (await db.query(`SELECT pdf_key FROM quote_links WHERE token = '${tok('b')}'`).catch(() => ({ rows: [] }))).rows[0]?.pdf_key;
  ok(bOld == null, 'link turned off: no key stored');

  const c = await keys(tok('c'));
  ok(await open(c.doc) === P(30), 'accepted: the accepted PDF');
  ok(await open(c.balance, 'balance') === P(31), 'balance PDF once sent');
  ok(!!c.balance && c.balance !== c.doc && await open(c.balance) === null, 'the balance key opens only the balance PDF');
  const sha = (t) => createHash('sha256').update(t).digest('hex');
  ok(await open(sha(tok('c')), 'balance') === null && await open(sha(tok('c'))) === null,
    'one key per document: the old token-hash key (round 1) opens neither the quote nor the balance PDF');

  // A new balance: the forwarded balance link no longer opens anything.
  if (before185) {
    await db.exec(`UPDATE quote_links SET balance = '${bal(32)}' WHERE token = '${tok('c')}'`);
    ok(await open(c.balance, 'balance') === null, 'a forwarded balance PDF link does not open the new balance');
    const c2 = await keys(tok('c'));
    ok(await open(c2.balance, 'balance') === P(32), 'the page gets the new balance PDF');
    // 185 lands later: its column, then its one-time copy of what was sent.
    await db.exec(`ALTER TABLE quote_links ADD COLUMN balance_sent jsonb;
      UPDATE quote_links SET balance_sent = balance WHERE balance IS NOT NULL AND balance_sent_at IS NOT NULL;`);
    ok(await open(c2.balance, 'balance') === P(32), 'after 185: the balance already sent still opens');
  }
  // From 185 on: a published balance is not the one sent.
  const sentKey = (await keys(tok('c'))).balance;
  await db.exec(`UPDATE quote_links SET balance = '${bal(33)}' WHERE token = '${tok('c')}'`);
  ok(!!sentKey && (await keys(tok('c'))).balance === sentKey, 'published, not sent: the key stays');
  ok(await open(sentKey, 'balance') === P(before185 ? 32 : 31), 'published, not sent: the PDF opened is still the one sent');
  await db.exec(`UPDATE quote_links SET balance_sent = balance WHERE token = '${tok('c')}'`);
  ok(await open(sentKey, 'balance') === null, 'sent: the old balance PDF link stops');
  const c3 = await keys(tok('c'));
  ok(await open(c3.balance, 'balance') === P(33), 'sent: the new balance PDF opens');
  await db.exec(`UPDATE quote_links SET status = 'accepted', balance = '${bal(34)}', balance_sent = NULL WHERE token = '${tok('a')}'`);
  ok((await keys(tok('a'))).balance == null, 'a balance never sent: no balance PDF');
  await db.exec(`UPDATE quote_links SET status = 'sent', balance = NULL WHERE token = '${tok('a')}'`);

  // Round 3: an edit after acceptance bumps the version; the client still
  // sees the frozen accepted PDF, and its forwarded link keeps working.
  const cAcc = (await keys(tok('c'))).doc;
  await db.exec(`UPDATE quote_links SET version = version + 1, pdf_url = '${file(BAND, 35)}', pdf_version = version + 1 WHERE token = '${tok('c')}'`);
  ok(!!cAcc && (await keys(tok('c'))).doc === cAcc && await open(cAcc) === P(30), 'accepted, then edited: the accepted PDF keeps its key');
  await db.exec(`UPDATE events SET status = '${statusType === 'text' ? 'Cancelled' : 'cancelled'}' WHERE id = '${GIG}'`);
  ok(await open(c3.balance, 'balance') === null, `balance PDF hidden once the gig is cancelled (${statusType})`);
  ok((await keys(tok('c'))).balance == null, 'and its key is not handed out');
  ok(await open((await keys(tok('d'))).doc) === null, "a URL pointing at another band's folder is refused");
  ok(Object.keys(await keys(tok('f'))).length === 0, 'unknown token: nothing');
  ok(await open('not-a-key') === null, 'malformed key: nothing');

  // A new version: the forwarded PDF of the old one stops.
  const a2 = await keys(tok('a'));
  await db.exec(`UPDATE quote_links SET version = 3 WHERE token = '${tok('a')}'`);
  ok(!!a2.doc && await open(a2.doc) === null, 'a new version: the old PDF link opens nothing');
  ok((await keys(tok('a'))).doc == null, 'no PDF of the new version yet: no key');
  await db.exec(`UPDATE quote_links SET pdf_url = '${file(BAND, 6)}', pdf_version = 3 WHERE token = '${tok('a')}'`);
  const a3 = await keys(tok('a'));
  ok(await open(a3.doc) === P(6) && a3.doc !== a2.doc, 'the new PDF gets a new key');
  await db.exec(`UPDATE quote_links SET pdf_key = '${'0'.repeat(64)}' WHERE token = '${tok('a')}'`).catch(() => {});
  ok((await keys(tok('a'))).doc === a3.doc, 'a key cannot be set by hand');

  // Stored names: decoded, then checked.
  const pathOf = async (fname) => {
    await db.exec(`UPDATE quote_links SET pdf_url = '${SB}/${BAND}/${fname}', version = version + 1, pdf_version = version + 1 WHERE token = '${tok('e')}'`);
    return open((await keys(tok('e'))).doc);
  };
  ok(await pathOf('Q-7_Quote%41.pdf') === `quotes/${BAND}/Q-7_QuoteA.pdf`, 'an encoded name is decoded');
  for (const bad of ['..%2F' + OTHER + '%2Fx.pdf', '%2E%2E', 'a%2Fb.pdf', 'a%5Cb.pdf', 'a%252Fb.pdf', 'a%25.pdf', 'a%00.pdf', 'a%0A.pdf', 'bad%E0%A4.pdf', 'a%G1.pdf', 'x..pdf']) {
    ok(await pathOf(bad) === null, `refused after decoding: ${bad}`);
  }

  const idx = (await db.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'quote_links'`)).rows.map((r) => r.indexdef).join('\n');
  ok(/UNIQUE INDEX \S+ ON public.quote_links USING btree \(pdf_key\)/.test(idx) && /\(balance_pdf_key\)/.test(idx),
    'keys are looked up through a unique index (no hashing of every link)');

  const grants = (await db.query(`SELECT r AS role, has_function_privilege(r, 'public.bw_quote_link_pdf_path(text,text)', 'EXECUTE') AS x,
      has_function_privilege(r, 'public.bw_quote_link_pdf_keys(text)', 'EXECUTE') AS k
    FROM unnest(ARRAY['anon','authenticated','service_role']) r`).catch(() => ({ rows: [] }))).rows;
  ok(grants.length === 3 && grants.every((g) => g.x === (g.role === 'service_role') && (g.k || g.role === 'service_role')), `path server only, keys for the page: ${JSON.stringify(grants)}`);
  await db.close();
}

await run('176 before 185 (no balance_sent yet)', true);
await run('185 before 176 (balance_sent exists)', false);
await run('events.status as text', false, 'text');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
