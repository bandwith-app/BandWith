/**
 * Demo mode: an in-memory stand-in for the Supabase client, used only in
 * development (see `isDemoMode` in ../supabase.ts). It implements the subset
 * of supabase-js the app calls: the PostgREST query builder (filters, order,
 * limit, embedded relations), auth, realtime channels, storage, functions and
 * RPCs. Data comes from ./seed.ts and is kept in localStorage so changes
 * survive a reload; signing out wipes it.
 */
import { buildSeed, DEMO_USER, type DemoDB, type Row } from './seed';
import { memberStatsFromRows } from '@/lib/memberStats';
import { freeSlotsFromRows, type MemberCommitment } from '@/lib/freeSlots';
import { computeEntitlements, limitFor, type BandPlanRow, type Entitlements, type LimitKey } from '@/lib/plans';
import { reportPlanLimit } from '@/lib/planLimit';
import { isDateHoldType, isQuoteStageEvent } from '@/lib/dateHoldRules';

// v5: song suggestions (108) refer to seed songs added with them.
const DB_KEY = 'bw-demo-db-v6';
const SESSION_KEY = 'bw-demo-session';

// ---------------------------------------------------------------- storage --

const readLS = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeLS = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: demo still works in memory */
  }
};

let db: DemoDB | null = null;
const getDB = (): DemoDB => {
  if (db) return db;
  const raw = readLS(DB_KEY);
  if (raw) {
    try {
      db = JSON.parse(raw) as DemoDB;
      // Tables added to the seed after this demo was saved start seeded.
      const seed = buildSeed();
      for (const t of Object.keys(seed)) if (!(t in db)) db[t] = seed[t];
      return db;
    } catch {
      /* corrupt: reseed */
    }
  }
  db = buildSeed();
  persist();
  return db;
};
const persist = () => {
  if (db) writeLS(DB_KEY, JSON.stringify(db));
};
const table = (name: string): Row[] => {
  const d = getDB();
  if (!d[name]) d[name] = [];
  return d[name];
};

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// ------------------------------------------------------- relation helpers --

/** FK column name → table it points to. */
const FK_TABLE: Record<string, string> = {
  user_id: 'profiles',
  invited_by: 'profiles',
  assigned_to: 'profiles',
  proposed_by: 'profiles',
  created_by: 'profiles',
  sender_id: 'profiles',
  added_by: 'profiles',
  accepted_by: 'profiles',
  reviewed_by: 'profiles',
  band_id: 'bands',
  event_id: 'events',
  song_id: 'songs',
  chat_id: 'chats',
  poll_id: 'rehearsal_polls',
  option_id: 'rehearsal_poll_options',
  setlist_id: 'setlists',
  quote_id: 'quotes',
  proposal_id: 'song_proposals',
  reply_to_id: 'messages',
};

/** Table → the FK column other tables use to point at it. */
const BACK_FK: Record<string, string> = {
  profiles: 'user_id',
  bands: 'band_id',
  events: 'event_id',
  songs: 'song_id',
  chats: 'chat_id',
  rehearsal_polls: 'poll_id',
  rehearsal_poll_options: 'option_id',
  setlists: 'setlist_id',
  quotes: 'quote_id',
  song_proposals: 'proposal_id',
  rehearsal_notes: 'note_id',
};

const KNOWN_TABLES = new Set([...Object.values(FK_TABLE), ...Object.keys(BACK_FK)]);

interface SelectField {
  kind: 'star' | 'col' | 'rel';
  name: string; // column or relation token
  alias?: string;
  hint?: string;
  inner?: boolean;
  children?: SelectField[];
}

/** Split on top-level commas (ignores commas inside parentheses). */
const splitTop = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
};

const parseSelect = (s: string | undefined): SelectField[] => {
  if (!s || !s.trim()) return [{ kind: 'star', name: '*' }];
  return splitTop(s.replace(/\s+/g, ' ')).map((tok): SelectField => {
    const paren = tok.indexOf('(');
    if (paren === -1) {
      if (tok === '*') return { kind: 'star', name: '*' };
      const [a, b] = tok.split(':').map((x) => x.trim());
      const name = (b ?? a).split('::')[0];
      return { kind: 'col', name, alias: b ? a : undefined };
    }
    const head = tok.slice(0, paren).trim();
    const body = tok.slice(paren + 1, tok.lastIndexOf(')'));
    let alias: string | undefined;
    let rel = head;
    if (head.includes(':')) {
      [alias, rel] = head.split(':').map((x) => x.trim());
    }
    const [name, ...hints] = rel.split('!').map((x) => x.trim());
    const inner = hints.includes('inner');
    const hint = hints.find((h) => h !== 'inner' && h !== 'left');
    return { kind: 'rel', name, alias, hint, inner, children: parseSelect(body) };
  });
};

/** Resolve an embedded relation for one row. Returns undefined when unknown. */
const resolveRelation = (srcTable: string, row: Row, f: SelectField): Row | Row[] | null => {
  let target = f.name;
  let fkCol: string | undefined;

  if (!KNOWN_TABLES.has(target) && FK_TABLE[target]) {
    // `alias:fk_column(...)` form
    fkCol = target;
    target = FK_TABLE[target];
  }
  if (f.hint) {
    const h = f.hint.replace(new RegExp(`^${srcTable}_`), '').replace(/_fkey$/, '');
    if (h in row) fkCol = h;
  }

  // Many-to-one: the row carries the FK.
  if (!fkCol) {
    const singular = BACK_FK[target];
    if (singular && singular in row) fkCol = singular;
    else if (target === 'profiles' && 'id' in row && srcTable === 'auth_users') fkCol = 'id';
  }
  if (fkCol) {
    const id = row[fkCol];
    if (id == null) return null;
    return table(target).find((r) => r.id === id) ?? null;
  }

  // One-to-many: target rows point back at this row.
  const back = BACK_FK[srcTable];
  if (back) return table(target).filter((r) => r[back] === row.id);
  return null;
};

const project = (srcTable: string, row: Row, fields: SelectField[]): Row | null => {
  const out: Row = {};
  for (const f of fields) {
    if (f.kind === 'star') Object.assign(out, clone(row));
    else if (f.kind === 'col') out[f.alias ?? f.name] = clone(row[f.name] ?? null);
  }
  for (const f of fields) {
    if (f.kind !== 'rel') continue;
    const key = f.alias ?? f.name;
    const targetTable = !KNOWN_TABLES.has(f.name) && FK_TABLE[f.name] ? FK_TABLE[f.name] : f.name;
    const rel = resolveRelation(srcTable, row, f);
    if (Array.isArray(rel)) {
      const items = rel.map((r) => project(targetTable, r, f.children!)).filter(Boolean) as Row[];
      if (f.inner && items.length === 0) return null;
      out[key] = items;
    } else if (rel) {
      out[key] = project(targetTable, rel, f.children!);
    } else {
      if (f.inner) return null;
      out[key] = null;
    }
  }
  return out;
};

// ----------------------------------------------------------------- filters --

type Pred = (row: Row) => boolean;

const coerce = (v: any): any => {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
};
const cmp = (a: any, b: any) => {
  if (a == null || b == null) return NaN;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};
const likeToRe = (pattern: string, ci: boolean) =>
  new RegExp(
    '^' + String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$',
    ci ? 'i' : ''
  );
const containsVal = (have: any, want: any): boolean => {
  if (Array.isArray(want)) return Array.isArray(have) && want.every((w) => have.includes(w));
  if (want && typeof want === 'object')
    return !!have && typeof have === 'object' && Object.entries(want).every(([k, v]) => containsVal(have[k], v));
  return have === want;
};

const opPred = (col: string, op: string, val: any): Pred => {
  switch (op) {
    case 'eq':
      return (r) => r[col] === coerce(val) || (r[col] != null && String(r[col]) === String(val));
    case 'neq':
      return (r) => r[col] !== coerce(val) && String(r[col]) !== String(val);
    case 'gt':
      return (r) => cmp(r[col], val) > 0;
    case 'gte':
      return (r) => cmp(r[col], val) >= 0;
    case 'lt':
      return (r) => cmp(r[col], val) < 0;
    case 'lte':
      return (r) => cmp(r[col], val) <= 0;
    case 'like':
      return (r) => r[col] != null && likeToRe(val, false).test(String(r[col]));
    case 'ilike':
      return (r) => r[col] != null && likeToRe(val, true).test(String(r[col]));
    case 'is':
      return (r) => (coerce(val) === null ? r[col] == null : r[col] === coerce(val));
    case 'in': {
      const list = Array.isArray(val)
        ? val
        : String(val).replace(/^\(|\)$/g, '').split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
      return (r) => list.some((x: any) => r[col] === x || String(r[col]) === String(x));
    }
    case 'cs':
    case 'contains':
      return (r) => containsVal(r[col], typeof val === 'string' ? safeJSON(val) : val);
    default:
      return () => true;
  }
};
const safeJSON = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

/** Parse a PostgREST `or=(...)` expression such as `a.eq.1,and(b.is.null,c.eq.2)`. */
const parseLogic = (expr: string, mode: 'or' | 'and'): Pred => {
  const parts = splitTop(expr).map((p): Pred => {
    const m = p.match(/^(and|or)\((.*)\)$/);
    if (m) return parseLogic(m[2], m[1] as 'or' | 'and');
    const [col, maybeNot, ...rest] = p.split('.');
    if (maybeNot === 'not') {
      const [op, ...v] = rest;
      const inner = opPred(col, op, v.join('.'));
      return (r) => !inner(r);
    }
    return opPred(col, maybeNot, rest.join('.'));
  });
  return mode === 'or' ? (r) => parts.some((p) => p(r)) : (r) => parts.every((p) => p(r));
};

// ------------------------------------------------------ database changes --

/**
 * Tables published to Realtime (postgres_changes) in the demo: a write is
 * applied to the other tabs' copy of the demo and reaches their channels,
 * like the real thing (two tabs = two band members in the same rehearsal).
 */
const REALTIME_TABLES = new Set(['rehearsal_notes', 'rehearsal_note_assignees']);
type DbChange = { table: string; eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Row | null; old: Row | null };
const dbListeners = new Set<(c: DbChange) => void>();
let dbBus: BroadcastChannel | null = null;
const rowKey = (t: string) => (t === 'rehearsal_note_assignees' ? ['note_id', 'user_id'] : ['id']);
const sameRow = (t: string, a: Row, b: Row) => rowKey(t).every((k) => a[k] === b[k]);

/** Another tab wrote: the same change here (memory only; that tab saved it). */
const applyRemote = (c: DbChange) => {
  const rows = table(c.table);
  if (c.eventType === 'DELETE' && c.old) {
    getDB()[c.table] = rows.filter((r) => !sameRow(c.table, r, c.old!));
  } else if (c.new) {
    const at = rows.findIndex((r) => sameRow(c.table, r, c.new!));
    if (at >= 0) rows[at] = clone(c.new);
    else rows.push(clone(c.new));
  }
};
const openDbBus = () => {
  if (dbBus || typeof BroadcastChannel === 'undefined') return dbBus;
  dbBus = new BroadcastChannel('bw-demo-db');
  dbBus.onmessage = (e: MessageEvent) => {
    const c = e.data as DbChange;
    if (!c || !REALTIME_TABLES.has(c.table)) return;
    applyRemote(c);
    dbListeners.forEach((l) => l(c));
  };
  return dbBus;
};
const emitChange = (c: DbChange) => {
  if (!REALTIME_TABLES.has(c.table)) return;
  const all = [c];
  // 132's touch trigger: a change of assignees updates its note.
  if (c.table === 'rehearsal_note_assignees') {
    const noteId = (c.new ?? c.old)?.note_id;
    const note = table('rehearsal_notes').find((n) => n.id === noteId);
    if (note) {
      note.updated_at = new Date().toISOString();
      all.push({ table: 'rehearsal_notes', eventType: 'UPDATE', new: clone(note), old: { id: note.id } });
    }
  }
  for (const x of all) {
    openDbBus()?.postMessage(x);
    setTimeout(() => dbListeners.forEach((l) => l(x)), 0);
  }
};

/** 132's guard trigger, for the demo: the author, and who confirmed OK. */
const guardNote = (row: Row, before?: Row) => {
  if (!before) {
    row.created_by = row.created_by ?? demoUid();
    row.ok_by = null;
    row.ok_at = null;
    return;
  }
  if (row.status === 'ok' && before.status !== 'ok') {
    row.ok_by = demoUid();
    row.ok_at = new Date().toISOString();
  } else if (row.status !== 'ok') {
    row.ok_by = null;
    row.ok_at = null;
  }
};

// ----------------------------------------------------------- query builder --

const UNIQUE_KEYS: Record<string, string[]> = {
  profiles: ['id'],
  onboarding_progress: ['user_id'],
  push_tokens: ['token'],
  chat_participants: ['chat_id', 'user_id'],
  event_members: ['event_id', 'user_id'],
  band_members: ['band_id', 'user_id'],
  rehearsal_poll_votes: ['option_id', 'user_id'],
  rehearsal_poll_unavailable: ['poll_id', 'user_id'],
  proposal_votes: ['proposal_id', 'user_id'],
};

type Result = { data: any; error: any; count?: number | null; status: number; statusText: string };

/** The e2e suite took the network away (dev builds only; the public demo always answers). */
const demoNetworkDown = () => !!import.meta.env.DEV && typeof navigator !== 'undefined' && navigator.onLine === false;

class DemoQuery implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private selectStr: string | undefined;
  private returning = false;
  private countMode: string | undefined;
  private head = false;
  private preds: Pred[] = [];
  private orders: { col: string; asc: boolean; nullsFirst?: boolean }[] = [];
  private lim: number | undefined;
  private from: number | undefined;
  private to: number | undefined;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private payload: Row | Row[] | undefined;
  private onConflict: string[] | undefined;
  private ignoreDuplicates = false;

  constructor(private readonly name: string) {}

  select(cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === 'select') {
      this.selectStr = cols;
      this.countMode = opts?.count;
      this.head = !!opts?.head;
    } else {
      this.returning = true;
      this.selectStr = cols;
    }
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = 'insert';
    this.payload = values;
    return this;
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = 'upsert';
    this.payload = values;
    if (opts?.onConflict) this.onConflict = opts.onConflict.split(',').map((s) => s.trim());
    this.ignoreDuplicates = !!opts?.ignoreDuplicates;
    return this;
  }
  update(values: Row) {
    this.op = 'update';
    // Like the real client (JSON): keys set to undefined are not sent, so they leave the column as it is.
    this.payload = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }

  private add(p: Pred) {
    this.preds.push(p);
    return this;
  }
  eq(c: string, v: any) { return this.add(opPred(c, 'eq', v)); }
  neq(c: string, v: any) { return this.add(opPred(c, 'neq', v)); }
  gt(c: string, v: any) { return this.add(opPred(c, 'gt', v)); }
  gte(c: string, v: any) { return this.add(opPred(c, 'gte', v)); }
  lt(c: string, v: any) { return this.add(opPred(c, 'lt', v)); }
  lte(c: string, v: any) { return this.add(opPred(c, 'lte', v)); }
  like(c: string, v: any) { return this.add(opPred(c, 'like', v)); }
  ilike(c: string, v: any) { return this.add(opPred(c, 'ilike', v)); }
  is(c: string, v: any) { return this.add(opPred(c, 'is', v)); }
  in(c: string, v: any[]) { return this.add(opPred(c, 'in', v)); }
  contains(c: string, v: any) { return this.add(opPred(c, 'contains', v)); }
  match(obj: Row) {
    Object.entries(obj).forEach(([c, v]) => this.add(opPred(c, 'eq', v)));
    return this;
  }
  not(c: string, op: string, v: any) {
    const p = opPred(c, op, v);
    return this.add((r) => !p(r));
  }
  or(expr: string) { return this.add(parseLogic(expr, 'or')); }
  filter(c: string, op: string, v: any) {
    if (op.startsWith('not.')) return this.not(c, op.slice(4), v);
    return this.add(opPred(c, op, v));
  }
  textSearch(c: string, q: string) { return this.add(opPred(c, 'ilike', `%${q}%`)); }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string; referencedTable?: string }) {
    if (!opts?.foreignTable && !opts?.referencedTable) {
      this.orders.push({ col, asc: opts?.ascending !== false, nullsFirst: opts?.nullsFirst });
    }
    return this;
  }
  limit(n: number, opts?: { foreignTable?: string; referencedTable?: string }) {
    if (!opts?.foreignTable && !opts?.referencedTable) this.lim = n;
    return this;
  }
  range(from: number, to: number) {
    this.from = from;
    this.to = to;
    return this;
  }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  abortSignal() { return this; }
  returns() { return this; }
  throwOnError() { return this; }
  overrideTypes() { return this; }

  private matches(): Row[] {
    const rows = table(this.name).filter((r) => this.preds.every((p) => p(r)));
    // Reads follow the date-on-hold rules (178): quotes stay with the admins.
    return this.op === 'select' ? rows.filter((r) => demoReadable(this.name, r)) : rows;
  }

  private shape(rows: Row[]): Result {
    const fields = parseSelect(this.selectStr);
    let data = rows.map((r) => project(this.name, r, fields)).filter(Boolean) as Row[];
    const count = this.countMode ? data.length : null;
    if (this.op === 'select') {
      for (const o of [...this.orders].reverse()) {
        data = [...data].sort((a, b) => {
          const av = a[o.col];
          const bv = b[o.col];
          if (av == null && bv == null) return 0;
          if (av == null) return o.nullsFirst ? -1 : 1;
          if (bv == null) return o.nullsFirst ? 1 : -1;
          const c = cmp(av, bv);
          return o.asc ? c : -c;
        });
      }
      if (this.from !== undefined) data = data.slice(this.from, (this.to ?? data.length) + 1);
      if (this.lim !== undefined) data = data.slice(0, this.lim);
    }
    if (this.head) return ok(null, count);
    if (this.op !== 'select' && !this.returning) return ok(null, count);
    if (this.mode === 'single') {
      if (data.length !== 1) {
        return {
          data: null,
          error: {
            code: 'PGRST116',
            message: 'JSON object requested, multiple (or no) rows returned',
            details: `The result contains ${data.length} rows`,
            hint: null,
          },
          count,
          status: 406,
          statusText: 'Not Acceptable',
        };
      }
      return ok(data[0], count);
    }
    if (this.mode === 'maybe') return ok(data[0] ?? null, count);
    return ok(data, count);
  }

  private withDefaults(row: Row): Row {
    const now = new Date().toISOString();
    const out: Row = { id: uuid(), created_at: now, updated_at: now, ...row };
    if (this.name === 'band_members' && out.is_active === undefined) out.is_active = true;
    if (this.name === 'notifications' && out.read === undefined) out.read = false;
    if (this.name === 'messages' && out.deleted === undefined) out.deleted = false;
    // 109: my notes and files are mine (user_id default auth.uid()).
    if ((this.name === 'song_personal_notes' || this.name === 'song_personal_files') && !out.user_id) out.user_id = demoUid();
    return out;
  }

  private run(): Result {
    const t = table(this.name);
    switch (this.op) {
      case 'select':
        return this.shape(this.matches());
      case 'insert': {
        const rows = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((r) => this.withDefaults(r));
        if (this.name === 'song_suggestions') rows.forEach(fillSuggestion);
        if (this.name === 'rehearsal_notes') rows.forEach((r) => guardNote(r));
        rows.forEach((r) => demoPlanWrite(this.name, r));
        t.push(...rows);
        rows.forEach((r) => emitChange({ table: this.name, eventType: 'INSERT', new: clone(r), old: null }));
        // 108's trigger: a member's suggested song gets its suggestion row.
        if (this.name === 'songs') rows.forEach(suggestedSongRow);
        persist();
        return this.shape(rows);
      }
      case 'upsert': {
        const keys = this.onConflict ?? UNIQUE_KEYS[this.name] ?? ['id'];
        const out: Row[] = [];
        for (const r of Array.isArray(this.payload) ? this.payload : [this.payload!]) {
          const existing = keys.every((k) => r[k] !== undefined)
            ? t.find((x) => keys.every((k) => x[k] === r[k]))
            : undefined;
          if (existing) {
            if (!this.ignoreDuplicates) {
              const before = { ...existing };
              Object.assign(existing, r, { updated_at: new Date().toISOString() });
              if (this.name === 'rehearsal_notes') guardNote(existing, before);
              emitChange({ table: this.name, eventType: 'UPDATE', new: clone(existing), old: before });
            }
            out.push(existing);
          } else {
            const row = this.withDefaults(r);
            if (this.name === 'rehearsal_notes') guardNote(row);
            t.push(row);
            emitChange({ table: this.name, eventType: 'INSERT', new: clone(row), old: null });
            out.push(row);
          }
        }
        persist();
        return this.shape(out);
      }
      case 'update': {
        const rows = this.matches();
        for (const r of rows) demoPlanWrite(this.name, { ...r, ...this.payload }, r);
        for (const r of rows) {
          const before = { ...r };
          Object.assign(r, this.payload, { updated_at: new Date().toISOString() });
          if (this.name === 'rehearsal_notes') guardNote(r, before);
          emitChange({ table: this.name, eventType: 'UPDATE', new: clone(r), old: before });
        }
        persist();
        return this.shape(rows);
      }
      case 'delete': {
        const rows = this.matches();
        const gone = new Set(rows);
        const kept = t.filter((r) => !gone.has(r));
        getDB()[this.name] = kept;
        // A note's assignees go with it (on delete cascade).
        if (this.name === 'rehearsal_notes') {
          const ids = new Set(rows.map((r) => r.id));
          getDB().rehearsal_note_assignees = table('rehearsal_note_assignees').filter((a) => !ids.has(a.note_id));
        }
        rows.forEach((r) => emitChange({ table: this.name, eventType: 'DELETE', new: null, old: clone(r) }));
        persist();
        return this.shape(rows);
      }
    }
  }

  then<A = Result, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: any) => B | PromiseLike<B>) | null
  ): Promise<A | B> {
    let res: Result;
    // Dev builds (the e2e suite): the browser is offline (context.setOffline)
    // → the request fails like a real one with no network, so offline
    // screens can be tested (live packs, plan §3).
    if (demoNetworkDown()) {
      return new Promise<Result>((r) =>
        setTimeout(() => r({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0, statusText: '' }), 40),
      ).then(onFulfilled, onRejected);
    }
    try {
      res = this.run();
    } catch (e: any) {
      res = e instanceof DemoPlanLimit
        ? { data: null, error: e.planLimit, status: 400, statusText: 'Bad Request' }
        : { data: null, error: { message: String(e?.message ?? e), code: 'DEMO' }, status: 500, statusText: 'Error' };
      // What planAwareFetch does on the real client.
      if (e instanceof DemoPlanLimit) reportPlanLimit(e.planLimit);
    }
    // Resolve on a later tick, like a network round-trip.
    return new Promise<Result>((r) => setTimeout(() => r(res), 40)).then(onFulfilled, onRejected);
  }
  catch<B = never>(onRejected?: ((reason: any) => B | PromiseLike<B>) | null) {
    return this.then(undefined, onRejected);
  }
  finally(cb?: (() => void) | null) {
    return this.then(
      (v) => { cb?.(); return v; },
      (e) => { cb?.(); throw e; }
    );
  }
}

const ok = (data: any, count: number | null = null): Result => ({ data, error: null, count, status: 200, statusText: 'OK' });

// -------------------------------------------------------------------- auth --

type AuthListener = (event: string, session: any) => void;
const listeners = new Set<AuthListener>();

const makeSession = () => ({
  access_token: 'demo-access-token',
  refresh_token: 'demo-refresh-token',
  token_type: 'bearer',
  expires_in: 3600 * 24,
  expires_at: Math.floor(Date.now() / 1000) + 3600 * 24,
  user: DEMO_USER,
});

const isSignedIn = () => readLS(SESSION_KEY) === '1';
const emit = (event: string) => {
  const s = isSignedIn() ? makeSession() : null;
  listeners.forEach((cb) => {
    try {
      cb(event, s);
    } catch (e) {
      console.error('[demo] auth listener failed', e);
    }
  });
};

const signInDemo = async () => {
  writeLS(SESSION_KEY, '1');
  getDB();
  setTimeout(() => emit('SIGNED_IN'), 0);
  return { data: { user: DEMO_USER, session: makeSession() }, error: null };
};

const auth = {
  getSession: async () => ({ data: { session: isSignedIn() ? makeSession() : null }, error: null }),
  getUser: async () => ({ data: { user: isSignedIn() ? DEMO_USER : null }, error: null }),
  refreshSession: async () => ({ data: { session: isSignedIn() ? makeSession() : null, user: DEMO_USER }, error: null }),
  onAuthStateChange: (cb: AuthListener) => {
    listeners.add(cb);
    return { data: { subscription: { id: uuid(), callback: cb, unsubscribe: () => listeners.delete(cb) } } };
  },
  // Any email/password opens the demo account.
  signInWithPassword: async () => signInDemo(),
  signUp: async () => signInDemo(),
  signInWithOAuth: async () => {
    await signInDemo();
    return { data: { provider: 'demo', url: null }, error: null };
  },
  signInWithOtp: async () => ({ data: {}, error: null }),
  signOut: async () => {
    writeLS(SESSION_KEY, null);
    writeLS(DB_KEY, null);
    db = null;
    setTimeout(() => emit('SIGNED_OUT'), 0);
    return { error: null };
  },
  resetPasswordForEmail: async () => ({ data: {}, error: null }),
  updateUser: async (attrs: Row) => {
    if (attrs?.data) Object.assign(DEMO_USER.user_metadata, attrs.data);
    return { data: { user: DEMO_USER }, error: null };
  },
  exchangeCodeForSession: async () => signInDemo(),
  setSession: async () => signInDemo(),
  verifyOtp: async () => signInDemo(),
};

// ---------------------------------------------------- realtime / storage --

/**
 * Demo channels: broadcast and presence reach the other tabs of the same demo
 * (BroadcastChannel), so two tabs can try live features such as Stage mode's
 * "follow the leader"; database changes arrive for REALTIME_TABLES only.
 */
const makeChannel = (name: string) => {
  const handlers: { type: string; event?: string; cb: (msg: any) => void }[] = [];
  let bc: BroadcastChannel | null = null;
  const key = Math.random().toString(36).slice(2);
  const open = () => {
    if (bc || typeof BroadcastChannel === 'undefined') return bc;
    bc = new BroadcastChannel(`bw-demo-rt:${name}`);
    bc.onmessage = (e: MessageEvent) => {
      const m = e.data || {};
      for (const h of handlers) {
        if (m.kind === 'broadcast' && h.type === 'broadcast' && (!h.event || h.event === '*' || h.event === m.event)) {
          h.cb({ type: 'broadcast', event: m.event, payload: m.payload });
        } else if (m.kind === 'join' && h.type === 'presence' && h.event === 'join') {
          h.cb({ event: 'join', key: m.key, newPresences: [m.meta], currentPresences: [] });
        }
      }
    };
    return bc;
  };
  const changes: { event: string; table: string; filter?: string; cb: (msg: any) => void }[] = [];
  const onChange = (c: DbChange) => {
    for (const h of changes) {
      if (h.table !== c.table || (h.event !== '*' && h.event !== c.eventType)) continue;
      if (h.filter) {
        // "column=eq.value" (the only filter the app uses); deletes can't be filtered.
        const [col, rest] = h.filter.split('=');
        const want = rest?.startsWith('eq.') ? rest.slice(3) : rest;
        const row = c.new ?? c.old;
        if (c.eventType !== 'DELETE' && String(row?.[col]) !== want) continue;
      }
      h.cb({ schema: 'public', table: c.table, eventType: c.eventType, new: c.new ?? {}, old: c.old ?? {} });
    }
  };
  const ch: any = {
    topic: name,
    on: (type: string, filter: { event?: string; table?: string; filter?: string } | undefined, cb: (msg: any) => void) => {
      if ((type === 'broadcast' || type === 'presence') && typeof cb === 'function') {
        handlers.push({ type, event: filter?.event, cb });
      } else if (type === 'postgres_changes' && filter?.table && typeof cb === 'function') {
        changes.push({ event: filter.event ?? '*', table: filter.table, filter: filter.filter, cb });
      }
      return ch;
    },
    subscribe: (cb?: (status: string) => void) => {
      if (changes.length > 0) {
        openDbBus();
        dbListeners.add(onChange);
      }
      if (handlers.length > 0) open();
      setTimeout(() => cb?.('SUBSCRIBED'), 0);
      return ch;
    },
    unsubscribe: async () => {
      dbListeners.delete(onChange);
      bc?.close();
      bc = null;
      return 'ok';
    },
    send: async (msg: { type?: string; event?: string; payload?: unknown }) => {
      if (msg?.type === 'broadcast') open()?.postMessage({ kind: 'broadcast', event: msg.event, payload: msg.payload });
      return 'ok';
    },
    track: async (meta?: unknown) => {
      open()?.postMessage({ kind: 'join', key, meta: meta ?? {} });
      return 'ok';
    },
    untrack: async () => 'ok',
    presenceState: () => ({}),
  };
  return ch;
};

const storage = {
  from: (bucket: string) => ({
    upload: async (path: string) => ({ data: { path, id: uuid(), fullPath: `${bucket}/${path}` }, error: null }),
    move: async () => ({ data: { message: 'Successfully moved' }, error: null }),
    update: async (path: string) => ({ data: { path }, error: null }),
    remove: async () => ({ data: [], error: null }),
    list: async () => ({ data: [], error: null }),
    download: async () => ({ data: null, error: { message: 'Not available in demo mode' } }),
    getPublicUrl: () => ({ data: { publicUrl: '' } }),
    createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
  }),
};

// ------------------------------------------------- song suggestions (108) --

/** The demo is always signed in as DEMO_USER (flip their band_members role to try a member). */
const demoUid = (): string => DEMO_USER.id;
const isDemoAdmin = (bandId: string, uid = demoUid()) =>
  table('band_members').some((m) => m.band_id === bandId && m.user_id === uid && m.role === 'admin' && m.is_active !== false);

// ------------------------------------------------------ date on hold (178) --

/** A band event still at quote stage that the demo user doesn't administer. */
const demoQuoteHidden = (eventId: unknown): boolean => {
  const ev = table('events').find((e) => e.id === eventId);
  return !!ev && !!ev.band_id && isQuoteStageEvent(ev) && !isDemoAdmin(ev.band_id);
};

/** What the database lets the demo user read, as 178 has it. */
function demoReadable(name: string, r: Row): boolean {
  switch (name) {
    case 'events':
      return !(r.band_id && isQuoteStageEvent(r) && !isDemoAdmin(r.band_id));
    case 'event_members':
    case 'event_stage':
    case 'event_gear_kits':
      return !demoQuoteHidden(r.event_id);
    case 'chats':
      return !(r.type === 'event' && demoQuoteHidden(r.event_id));
    case 'notifications':
      // Hold notices go to members only; other notices about a quote, to admins only.
      if (isDateHoldType(r.type)) return !r.band_id || !isDemoAdmin(r.band_id);
      return !demoQuoteHidden(r.data?.event_id ?? (r.reference_type === 'event' ? r.reference_id : null));
    default:
      return true;
  }
}

/** Live holds for the demo user: quote-stage band gigs from today on, in bands they don't run. */
function demoDateHolds(): Row[] {
  const today = new Date().toISOString().slice(0, 10);
  const mine = table('band_members').filter((m) => m.user_id === demoUid() && m.is_active !== false && m.role !== 'admin');
  const bandIds = new Set(mine.map((m) => m.band_id));
  const closed = (ev: Row) =>
    table('quotes').some(
      (q) => (q.id === ev.quote_id || q.converted_to_event_id === ev.id) && ['declined', 'rejected', 'expired', 'archived', 'cancelled'].includes(String(q.status).toLowerCase()),
    );
  return table('events')
    .filter((e) => bandIds.has(e.band_id) && isQuoteStageEvent(e) && !['cancelled', 'canceled', 'draft'].includes(String(e.status)) && String(e.event_date || e.date || '') >= today && !closed(e))
    .map((e) => {
      const a = table('event_hold_answers').find((x) => x.event_id === e.id && x.user_id === demoUid());
      return {
        event_id: e.id,
        band_id: e.band_id,
        band_name: table('bands').find((b) => b.id === e.band_id)?.name ?? '',
        event_date: e.event_date || e.date,
        start_time: e.start_time ?? null,
        end_time: e.end_time ?? null,
        venue_name: e.venue_name ?? null,
        venue_city: e.venue_city ?? null,
        my_answer: a?.answer ?? null,
        answered_at: a?.answered_at ?? null,
      };
    });
}

/** BEFORE INSERT: the server-side copy of the song, a pending row. */
function fillSuggestion(row: Row) {
  const song = table('songs').find((s) => s.id === row.song_id);
  row.created_by = row.created_by ?? demoUid();
  row.song_title = song?.title ?? '';
  row.status = 'pending';
  row.reason = null;
  row.applied = null;
  row.reviewed_by = null;
  row.reviewed_at = null;
  row.original =
    row.kind === 'note' ? { notes: song?.notes ?? null } : row.kind === 'new_song' ? {} : { lyrics: song?.lyrics ?? null, chord_chart: song?.chord_chart ?? null };
}

function suggestedSongRow(song: Row) {
  const by = song.added_by ?? demoUid();
  if (song.status !== 'suggested' || !by || isDemoAdmin(song.band_id, by)) return;
  const row: Row = { id: uuid(), band_id: song.band_id, song_id: song.id, kind: 'new_song', proposed: {}, message: null, created_by: by, created_at: new Date().toISOString() };
  fillSuggestion(row);
  table('song_suggestions').push(row);
}

function reviewSuggestion(args: Row): { data: any; error: any } {
  const g = table('song_suggestions').find((r) => r.id === args.p_id);
  if (!g || !isDemoAdmin(g.band_id)) return { data: null, error: { message: 'Only band admins can review suggestions', code: '42501' } };
  if (g.status !== 'pending') return { data: null, error: { message: 'This suggestion was already reviewed', code: '55000' } };
  const song = table('songs').find((s) => s.id === g.song_id);
  const now = new Date().toISOString();
  let files: string[] = [];
  g.reason = (args.p_reason || '').trim() || null;
  g.reviewed_by = demoUid();
  g.reviewed_at = now;
  if (args.p_decision === 'reject') {
    g.status = 'rejected';
    if (g.kind === 'new_song' && song && song.status === 'suggested') {
      files = [song.audio_url, song.chart_url].filter(Boolean);
      getDB().songs = table('songs').filter((s) => s.id !== song.id);
    }
  } else {
    if (!song) return { data: null, error: { message: 'The song no longer exists', code: '55000' } };
    g.status = args.p_edited ? 'accepted_edited' : 'accepted';
    if (g.kind === 'new_song') {
      if (song.status === 'suggested') song.status = 'learning';
    } else {
      let apply: Row;
      if (g.kind === 'note') {
        apply = args.p_applied && 'notes' in args.p_applied
          ? { notes: args.p_applied.notes }
          : { notes: song.notes?.trim() ? `${String(song.notes).trimEnd()}\n\n${g.proposed.note}` : g.proposed.note };
      } else {
        const src = args.p_applied ?? g.proposed;
        apply = {};
        if ('lyrics' in src) apply.lyrics = src.lyrics;
        if ('chord_chart' in src) apply.chord_chart = src.chord_chart;
      }
      g.applied = apply;
      Object.assign(song, apply, { updated_at: now });
    }
  }
  if (g.created_by !== g.reviewed_by) {
    table('notifications').push({
      id: uuid(), user_id: g.created_by, band_id: g.band_id, type: 'song_suggestion_reviewed',
      title: `${g.status === 'rejected' ? 'Suggestion not accepted' : g.status === 'accepted_edited' ? 'Accepted with changes' : 'Suggestion accepted'} · ${g.song_title}`,
      body: g.reason || '', data: { suggestion_id: g.id, song_id: g.song_id, status: g.status, reason: g.reason }, read: false,
      reference_id: g.id, reference_type: 'song_suggestion', created_at: now,
    });
  }
  persist();
  return { data: { status: g.status, song_id: g.song_id, files }, error: null };
}

function withdrawSuggestion(args: Row): { data: any; error: any } {
  const g = table('song_suggestions').find((r) => r.id === args.p_id);
  if (!g || g.created_by !== demoUid()) return { data: null, error: { message: 'Not your suggestion', code: '42501' } };
  if (g.status !== 'pending') return { data: null, error: { message: 'This suggestion was already reviewed', code: '55000' } };
  g.status = 'withdrawn';
  g.reviewed_at = new Date().toISOString();
  let files: string[] = [];
  const song = table('songs').find((s) => s.id === g.song_id);
  if (g.kind === 'new_song' && song && song.status === 'suggested') {
    files = [song.audio_url, song.chart_url].filter(Boolean);
    getDB().songs = table('songs').filter((s) => s.id !== song.id);
  }
  persist();
  return { data: { status: 'withdrawn', files }, error: null };
}

// ------------------------------------------------------------ plans --

/** bw_band_entitlements (160) from the demo's own rows, usage counted like bw_plan_count (161). */
function demoEntitlements(band: string): Entitlements | null {
  const me = table('band_members').find((r) => r.band_id === band && r.user_id === DEMO_USER.id && r.is_active !== false);
  const bandPlan = table('band_plans').find((r) => r.band_id === band) ?? null;
  const account = bandPlan?.billing_account_id ? table('billing_accounts').find((r) => r.id === bandPlan.billing_account_id) : null;
  const e = computeEntitlements({
    switches: table('platform_switches') as { key: string; enabled: boolean }[],
    planLimits: table('plan_limits') as { plan: string; key: string; value: number | null }[],
    settings: table('plan_settings') as { key: string; value: unknown }[],
    bandPlan: bandPlan as BandPlanRow | null,
    payerUserId: (account?.payer_user_id as string | undefined) ?? null,
    userId: DEMO_USER.id,
    isMember: !!me,
    isAdmin: me?.role === 'admin',
    now: new Date(),
  });
  if (e) e.usage = demoUsage(band);
  return e;
}

function demoUsage(band: string): Record<string, number> {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const sentThisMonth = (r: Row) => !!r.sent_at && Date.parse(String(r.sent_at)) >= monthStart;
  return {
    quotes_sent_month: table('quote_links').filter((r) => r.band_id === band && sentThisMonth(r)).length,
    contracts_sent_month: table('contracts').filter((r) => r.band_id === band && r.type !== 'rider' && sentThisMonth(r)).length,
    deputies: table('band_deputies').filter((r) => r.band_id === band).length,
    admins: table('band_members').filter((r) => r.band_id === band && r.role === 'admin' && r.is_active !== false).length,
    custom_templates: table('task_templates').filter((r) => r.band_id === band && !r.is_default).length,
    gear_items: table('inventory').filter((r) => r.band_id === band && !r.owner_id).length,
    storage_mb: 0,
  };
}

/** The server's shape of bw_band_entitlements (snake_case). */
function snakeEntitlements(e: Entitlements | null) {
  return e && {
    enforced: e.enforced,
    plan: e.plan,
    source: e.source,
    status: e.status,
    trial_ends_at: e.trialEndsAt,
    grant_until: e.grantUntil,
    is_payer: e.isPayer,
    is_admin: e.isAdmin,
    limits: e.limits,
    usage: e.usage,
    checkout: e.checkout,
    notice: e.notice,
  };
}

/** 164 bw_trial_days: plan_settings.trial_days, 1–90. */
function demoTrialDays(): number | null {
  const v = table('plan_settings').find((r) => r.key === 'trial_days')?.value;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 90 ? v : null;
}

/** 164 bw_trial_refusal, for the demo user. */
function demoTrialRefusal(band: string): string | null {
  const admin = table('band_members').some((r) => r.band_id === band && r.user_id === DEMO_USER.id && r.role === 'admin' && r.is_active !== false);
  if (!admin) return 'not_admin';
  if (!table('platform_switches').some((r) => r.key === 'plans_trial' && r.enabled === true) || demoTrialDays() === null) return 'off';
  if (table('plan_trials').some((r) => r.user_id === DEMO_USER.id)) return 'used';
  if (table('band_plans').some((r) => r.band_id === band)) return 'band_had_plan';
  return null;
}

/** The server's refusal (161 bw_plan_guard): P0001, the key in MESSAGE and DETAIL. */
class DemoPlanLimit extends Error {
  readonly planLimit: { code: string; message: string; details: string; hint: string };
  constructor(key: LimitKey, used: number, limit: number) {
    super(`BW_PLAN_LIMIT:${key}`);
    this.planLimit = {
      code: 'P0001',
      message: `BW_PLAN_LIMIT:${key}`,
      details: `BW_PLAN_LIMIT:${key} used=${used} limit=${limit}`,
      hint: 'Your band’s plan has no room for this. Update BandWith to see the plans.',
    };
  }
}

/** bw_plan_guard: passes when the plans are off or the key has no number. */
function demoPlanGuard(band: unknown, key: LimitKey, add = 1) {
  if (typeof band !== 'string' || !band) return;
  const switches = table('platform_switches');
  if (!switches.some((r) => r.key === 'plans_enforced' && r.enabled === true)) return;
  const e = demoEntitlements(band);
  const limit = limitFor(e ? { ...e, enforced: true } : null, key);
  if (limit === null) return;
  const used = demoUsage(band)[key] ?? 0;
  if (used + add > limit) throw new DemoPlanLimit(key, used, limit);
}

/** bw_plan_guard_new_band (161): the Free bands the person runs as an active admin. */
function demoNewBandGuard() {
  if (!table('platform_switches').some((r) => r.key === 'plans_enforced' && r.enabled === true)) return;
  const row = table('plan_limits').find((r) => r.plan === 'free' && r.key === 'bands_as_admin');
  if (!row || typeof row.value !== 'number') return;
  const free = (band: unknown) => {
    const p = table('band_plans').find((r) => r.band_id === band);
    return !p || p.plan === 'free' || !['active', 'trialing', 'past_due'].includes(String(p.status));
  };
  const used = table('band_members').filter((r) => r.user_id === DEMO_USER.id && r.role === 'admin' && r.is_active !== false && free(r.band_id)).length;
  if (used + 1 > row.value) throw new DemoPlanLimit('bands_as_admin', used, row.value);
}

/** 161's triggers, for the demo's writes. */
function demoPlanWrite(name: string, row: Row, before?: Row) {
  if (name === 'bands' && !before) demoNewBandGuard();
  if (name === 'band_deputies' && !before) demoPlanGuard(row.band_id, 'deputies');
  if (name === 'inventory' && !before && !row.owner_id) demoPlanGuard(row.band_id, 'gear_items');
  if (name === 'task_templates' && !before && !row.is_default) demoPlanGuard(row.band_id, 'custom_templates');
  if (name === 'contracts' && row.type !== 'rider' && row.sent_at && !before?.sent_at) demoPlanGuard(row.band_id, 'contracts_sent_month');
  if (name === 'band_members' && row.role === 'admin' && row.is_active !== false && (!before || before.role !== 'admin' || before.is_active === false)) {
    demoPlanGuard(row.band_id, 'admins');
  }
}

// -------------------------------------------------------------------- rpc --

let demoCalendarToken = '';

const rpc = (fn: string, args: Row = {}) => {
  let data: any = null;
  let error: any = null;
  switch (fn) {
    case 'generate_quote_number': {
      const n = table('quotes').length + 1;
      data = `Q-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
      break;
    }
    case 'bw_my_date_holds':
      data = demoDateHolds();
      break;
    case 'bw_answer_date_hold': {
      if (args.p_answer !== 'free' && args.p_answer !== 'busy') {
        error = { code: '22023', message: 'Answer free or busy' };
        break;
      }
      const held = demoDateHolds().find((h) => h.event_id === args.p_event_id);
      if (!held) {
        error = { code: 'P0002', message: 'This date is free again' };
        break;
      }
      // The day or time the card showed is not the hold's any more (178).
      if (args.p_date && String(held.event_date).slice(0, 10) !== args.p_date) {
        error = { code: 'BWD01', message: 'The date changed' };
        break;
      }
      if (args.p_date && (String(held.start_time || '').slice(0, 5) !== String(args.p_start_time || '')
        || String(held.end_time || '').slice(0, 5) !== String(args.p_end_time || ''))) {
        error = { code: 'BWD02', message: 'The time changed' };
        break;
      }
      const rows = table('event_hold_answers');
      const at = new Date().toISOString();
      const row = rows.find((x) => x.event_id === args.p_event_id && x.user_id === demoUid());
      if (row) Object.assign(row, { answer: args.p_answer, answered_at: at });
      else rows.push({ event_id: args.p_event_id, user_id: demoUid(), answer: args.p_answer, answered_at: at });
      persist();
      break;
    }
    case 'bw_date_hold_answers': {
      const ev = table('events').find((e) => e.id === args.p_event_id);
      if (!ev?.band_id || !isDemoAdmin(ev.band_id)) {
        error = { code: '42501', message: 'Only band admins see the answers' };
        break;
      }
      const people = table('band_members').filter((m) => m.band_id === ev.band_id && m.is_active !== false && m.role !== 'admin');
      data = people.map((m) => {
        const a = table('event_hold_answers').find((x) => x.event_id === ev.id && x.user_id === m.user_id);
        const p = table('profiles').find((x) => x.id === m.user_id);
        return {
          user_id: m.user_id,
          name: p?.full_name || p?.email || '',
          answer: a?.answer ?? null,
          answered_at: a?.answered_at ?? null,
          on_lineup: table('event_members').some((em) => em.event_id === ev.id && em.user_id === m.user_id && !['declined', 'dropped_out', 'removed'].includes(String(em.status))),
        };
      });
      break;
    }
    case 'bw_my_pending_invitations':
      data = [];
      break;
    // Calendar sync (165): a fixed link per demo session; rotate makes a new one.
    case 'bw_my_calendar_token': {
      if (args.p_rotate || !demoCalendarToken) {
        demoCalendarToken = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      }
      data = demoCalendarToken;
      break;
    }
    // Band members → Invited (166): the demo's own band_invitations rows.
    case 'bw_band_invitations': {
      const now = Date.now();
      data = table('band_invitations')
        .filter((r) => r.band_id === args.p_band_id && ['pending', 'expired', 'declined'].includes(String(r.status)))
        .map((r) => ({
          id: r.id,
          email: r.email,
          role: r.role === 'admin' ? 'admin' : 'member',
          status: r.status === 'pending' && r.expires_at && Date.parse(String(r.expires_at)) <= now ? 'expired' : r.status,
          created_at: r.created_at,
          expires_at: r.expires_at ?? null,
          email_sent_at: r.email_sent_at ?? null,
          token: r.token,
          inviter_name: null,
          has_account: table('profiles').some((p) => String(p.email ?? '').toLowerCase() === String(r.email).toLowerCase()),
        }));
      break;
    }
    case 'bw_cancel_invitation': {
      const rows = table('band_invitations');
      const i = rows.findIndex((r) => r.id === args.p_invitation_id && r.status !== 'accepted');
      if (i < 0) {
        error = { message: 'invite_not_found', code: 'P0002' };
        break;
      }
      rows.splice(i, 1);
      persist();
      break;
    }
    // Feature flags (130): platform switches, and the band's own for its members.
    case 'bw_band_features': {
      const bools = (rows: Row[]) => Object.fromEntries(rows.filter((r) => typeof r.enabled === 'boolean').map((r) => [r.key, r.enabled]));
      const member = table('band_members').some((r) => r.band_id === args.p_band_id && r.user_id === DEMO_USER.id);
      data = {
        platform: bools(table('platform_switches')),
        band: member ? bools(table('band_features').filter((r) => r.band_id === args.p_band_id)) : {},
      };
      break;
    }
    // Paid plans (160): same rules as the server, from the demo's own rows, so
    // e2e can switch plans on locally (platform_switches.plans_enforced).
    case 'bw_band_entitlements': {
      data = snakeEntitlements(demoEntitlements(String(args.p_band_id)));
      break;
    }
    // Grants (164): the trial, same rules as the server.
    case 'bw_trial_offer': {
      const band = String(args.p_band_id);
      data = demoTrialRefusal(band) ? null : { plan: 'pro', days: demoTrialDays() };
      break;
    }
    case 'bw_start_trial': {
      const band = String(args.p_band_id);
      const why = demoTrialRefusal(band);
      if (why) {
        error = { message: `BW_TRIAL:${why}`, code: 'P0001' };
        break;
      }
      const now = new Date();
      table('plan_trials').push({ user_id: DEMO_USER.id, band_id: band, started_at: now.toISOString() });
      table('band_plans').push({
        band_id: band, plan: 'pro', source: 'trial', status: 'trialing',
        trial_ends_at: new Date(now.getTime() + demoTrialDays()! * 86_400_000).toISOString(),
      });
      persist();
      data = snakeEntitlements(demoEntitlements(band));
      break;
    }
    // Minimum app version (162): the demo's own app_versions rows (none = no minimum).
    case 'bw_app_version': {
      const v = table('app_versions').find((r) => r.platform === args.p_platform);
      data = v ? { min_version: v.min_version ?? null, latest_version: v.latest_version ?? null, store_url: v.store_url ?? null } : null;
      break;
    }
    case 'bw_preview_invitation':
    case 'bw_accept_invitation':
    case 'bw_decline_invitation':
      error = { message: 'Invitations are not available in demo mode', code: 'DEMO' };
      break;
    case 'bw_search_invitable_users': {
      const q = String(args.p_query ?? '').trim().toLowerCase();
      const members = new Set(table('band_members').filter((r) => r.band_id === args.p_band_id).map((r) => r.user_id));
      data = q.length < 3 ? [] : table('profiles')
        .filter((p) => p.id !== DEMO_USER.id && !members.has(p.id))
        .filter((p) => String(p.email ?? '').toLowerCase() === q || String(p.full_name ?? '').toLowerCase().includes(q))
        .slice(0, 8)
        .map((p) => {
          const email = String(p.email ?? '');
          const exact = email.toLowerCase() === q;
          return {
            id: p.id,
            full_name: p.full_name ?? null,
            avatar_url: p.avatar_url ?? null,
            email_hint: exact ? email : `${email.split('@')[0].slice(0, 2)}•••@${email.split('@')[1] ?? ''}`,
            email_exact: exact,
          };
        });
      break;
    }
    // Free-slot heatmap (095): counts only, any active member may ask.
    case 'bw_band_free_slots': {
      const bandId = args.p_band_id;
      const members = table('band_members').filter((r) => r.band_id === bandId && r.user_id && r.is_active !== false && !r.left_at);
      if (!members.some((r) => r.user_id === DEMO_USER.id)) {
        data = [];
        break;
      }
      const ids = members.map((r) => String(r.user_id));
      const events = new Map(table('events').map((e) => [e.id, e]));
      const commitments: MemberCommitment[] = [
        ...table('event_members').filter((em) => events.has(em.event_id)).map((em) => {
          const e = events.get(em.event_id)!;
          return {
            user_id: String(em.user_id), event_id: String(e.id), event_date: String(e.event_date),
            start_time: e.start_time ?? null, end_time: e.end_time ?? null, event_status: e.status, answer: em.status ?? '',
          };
        }),
        ...table('events').filter((e) => !e.band_id && e.created_by).map((e) => ({
          user_id: String(e.created_by), event_id: String(e.id), event_date: String(e.event_date),
          start_time: e.start_time ?? null, end_time: e.end_time ?? null, event_status: e.status, answer: null,
        })),
        ...table('demo_member_busy').map((b) => ({ ...b, user_id: String(b.user_id), event_date: String(b.event_date), answer: null })),
      ];
      data = freeSlotsFromRows(ids, commitments, {
        from: String(args.p_from ?? ''), to: String(args.p_to ?? ''), start: args.p_start ?? null, end: args.p_end ?? null,
        slotMinutes: args.p_slot_minutes ?? null, excludeEventId: args.p_exclude_event ?? null,
      }).map((r) => ({ day: r.day, slot_start: r.slotStart, free_count: r.free, total_count: r.total }));
      break;
    }
    case 'bw_mark_chats_delivered':
      data = 0;
      break;
    // Member stats (083): every member for an admin, own row otherwise.
    case 'bw_member_stats': {
      const bandId = args.p_band_id;
      const from = String(args.p_from ?? '');
      const to = String(args.p_to ?? '');
      const members = table('band_members').filter((r) => r.band_id === bandId && r.user_id);
      const me = members.find((r) => r.user_id === DEMO_USER.id);
      const isAdmin = me?.role === 'admin' && me?.is_active !== false;
      const events = new Map(
        table('events')
          .filter((e) => e.band_id === bandId && e.event_date >= from && e.event_date <= to)
          .map((e) => [e.id, e]),
      );
      const rows = table('event_members')
        .filter((em) => events.has(em.event_id))
        .map((em) => {
          const e = events.get(em.event_id)!;
          return {
            user_id: String(em.user_id), answer: em.status, fee: em.fee, paid_at: em.paid_at,
            event_date: String(e.event_date), event_type: e.event_type, event_status: e.status,
          };
        });
      const visible = (isAdmin ? members : members.filter((r) => r.user_id === DEMO_USER.id))
        .map((r) => ({ user_id: String(r.user_id), is_active: r.is_active !== false }));
      data = memberStatsFromRows(rows, visible, String(args.p_today ?? new Date().toISOString().slice(0, 10)));
      break;
    }
    // Fees and payouts (071). The demo user is the band admin.
    case 'bw_event_member_money': {
      const ids: string[] | null = Array.isArray(args.p_event_ids) ? args.p_event_ids : null;
      data = table('event_members')
        .filter((r) => (ids ? ids.includes(r.event_id) : r.user_id === DEMO_USER.id))
        .map((r) => ({ event_id: r.event_id, user_id: r.user_id, fee: r.fee ?? 0, paid_at: r.paid_at ?? null }));
      break;
    }
    // Member fees (076): all rows of bands the user administers, own row elsewhere.
    case 'bw_band_member_fees': {
      const ids: string[] = Array.isArray(args.p_band_ids) ? args.p_band_ids : [];
      const members = table('band_members');
      const adminOf = new Set(members.filter((r) => r.user_id === DEMO_USER.id && r.role === 'admin').map((r) => r.band_id));
      data = members
        .filter((r) => ids.includes(r.band_id) && (r.user_id === DEMO_USER.id || adminOf.has(r.band_id)))
        .map((r) => ({ band_id: r.band_id, user_id: r.user_id, default_fee: r.default_fee ?? null, fee_percentage: r.fee_percentage ?? null }));
      break;
    }
    // Band banking, tax and pricing (077): bands the user administers only.
    case 'bw_band_private': {
      const ids: string[] = Array.isArray(args.p_band_ids) ? args.p_band_ids : [];
      const adminOf = new Set(table('band_members').filter((r) => r.user_id === DEMO_USER.id && r.role === 'admin').map((r) => r.band_id));
      const PRIVATE = [
        'pricing_settings', 'pricing_rules', 'extra_services', 'core_musician_fee', 'additional_musician_fee',
        'ceremony_musician_fee', 'cocktail_musician_fee', 'dj_hourly_rate', 'production_standard_fee',
        'production_pro_fee', 'production_extra_location_fee', 'travel_rate_per_km', 'default_payment_terms',
        'bank_account_holder', 'bank_iban', 'bank_bic_swift', 'bank_name', 'tax_vat_id', 'legal_company_name',
        'legal_address', 'signature_url', 'signer_name', 'signer_role', 'contact_email', 'contact_phone', 'stripe_customer_id',
      ];
      data = table('bands')
        .filter((b) => ids.includes(b.id) && adminOf.has(b.id))
        .map((b) => ({ band_id: b.id, private: Object.fromEntries(PRIVATE.map((k) => [k, b[k] ?? null])) }));
      break;
    }
    // Gig price, payments and client (078): events the user manages only.
    case 'bw_event_private': {
      const ids: string[] = Array.isArray(args.p_event_ids) ? args.p_event_ids : [];
      const adminOf = new Set(table('band_members').filter((r) => r.user_id === DEMO_USER.id && r.role === 'admin').map((r) => r.band_id));
      const PRIVATE = [
        'price', 'fee', 'pay', 'deposit_amount', 'deposit_paid', 'payment_status', 'client_name', 'client_email',
        'client_phone', 'client_company', 'internal_notes', 'contract_url', 'contract_signed',
      ];
      data = table('events')
        .filter((e) => ids.includes(e.id) && (e.band_id ? adminOf.has(e.band_id) : e.created_by === DEMO_USER.id))
        .map((e) => ({ event_id: e.id, private: Object.fromEntries(PRIVATE.map((k) => [k, e[k] ?? null])) }));
      break;
    }
    // Poll room cost (114): the total for admins, everyone's share.
    case 'bw_rehearsal_poll_costs': {
      const ids: string[] = Array.isArray(args.p_poll_ids) ? args.p_poll_ids : [];
      const members = table('band_members');
      const isAdminOf = (bandId: unknown) =>
        members.some((r) => r.band_id === bandId && r.user_id === DEMO_USER.id && r.role === 'admin' && r.is_active !== false);
      data = table('rehearsal_polls')
        .filter((p) => ids.includes(p.id) && members.some((r) => r.band_id === p.band_id && r.user_id === DEMO_USER.id && r.is_active !== false))
        .map((p) => {
          const invited: unknown[] = Array.isArray(p.invited_user_ids) ? p.invited_user_ids : [];
          const n = Math.max(1, invited.length || members.filter((r) => r.band_id === p.band_id && r.is_active !== false).length);
          const total = p.room_cost != null ? Number(p.room_cost) : null;
          return {
            poll_id: p.id,
            room_cost: isAdminOf(p.band_id) ? total : null,
            cost_share: total && total > 0 ? Math.round((total / n) * 100) / 100 : null,
            share_count: n,
          };
        });
      break;
    }
    // Gear purchase data (115): every item for admins, own personal gear otherwise.
    case 'bw_inventory_private': {
      const bandId = args.p_band_id;
      const me = table('band_members').find((r) => r.band_id === bandId && r.user_id === DEMO_USER.id && r.is_active !== false);
      const isAdmin = me?.role === 'admin';
      data = !me
        ? []
        : table('inventory')
            .filter((i) => i.band_id === bandId && (isAdmin || i.owner_id === DEMO_USER.id))
            .map((i) => ({
              inventory_id: i.id,
              serial_number: i.serial_number ?? null,
              purchase_date: i.purchase_date ?? null,
              purchase_price: i.purchase_price ?? null,
            }));
      break;
    }
    case 'bw_save_event_lineup': {
      const rows = table('event_members');
      const now = new Date().toISOString();
      const list: Row[] = Array.isArray(args.p_rows) ? args.p_rows : [];
      list.forEach((r) => {
        const existing = rows.find((x) => x.event_id === args.p_event_id && x.user_id === r.user_id);
        if (existing) {
          existing.role = r.role ?? null;
          existing.fee = r.fee ?? 0;
        } else {
          rows.push({ id: uuid(), created_at: now, event_id: args.p_event_id, user_id: r.user_id, role: r.role ?? null, fee: r.fee ?? 0, status: r.status ?? 'pending' });
        }
      });
      persist();
      data = list.length;
      break;
    }
    case 'bw_mark_event_paid': {
      const now = new Date().toISOString();
      data = table('event_members')
        .filter((r) => r.event_id === args.p_event_id && !r.paid_at && r.status !== 'declined')
        .map((r) => {
          r.paid_at = now;
          return { user_id: r.user_id, paid_at: now };
        });
      persist();
      break;
    }
    // One musician paid / not paid (093).
    case 'bw_set_member_paid': {
      const row = table('event_members').find(
        (r) => r.event_id === args.p_event_id && r.user_id === args.p_user_id && r.status !== 'declined',
      );
      if (!row) {
        error = { message: 'No such musician on this event', code: 'P0002' };
        break;
      }
      row.paid_at = args.p_paid ? row.paid_at || new Date().toISOString() : null;
      persist();
      data = [{ user_id: row.user_id, paid_at: row.paid_at }];
      break;
    }
    // Rider linked to a gig (093): latest version, members read it too.
    case 'bw_event_rider': {
      const r = table('contracts')
        .filter((c) => c.event_id === args.p_event_id && c.type === 'rider')
        .sort((a, b) => (b.version ?? 1) - (a.version ?? 1))[0];
      data = r
        ? [{ id: r.id, title: r.title, version: r.version ?? 1, status: r.status, sent_at: r.sent_at ?? null, viewed_at: r.viewed_at ?? null }]
        : [];
      break;
    }
    case 'bw_rider_share_link': {
      const r = table('contracts').find((c) => c.id === args.p_contract_id && c.type === 'rider');
      if (!r) {
        error = { message: 'Only riders have a web link', code: '22023' };
        break;
      }
      if (!r.view_token) {
        r.view_token = (uuid() + uuid()).replace(/-/g, '').slice(0, 64);
        persist();
      }
      data = r.view_token;
      break;
    }
    case 'bw_mark_chat_read': {
      const now = new Date().toISOString();
      table('chat_participants')
        .filter((r) => r.chat_id === args.p_chat_id && r.user_id === DEMO_USER.id)
        .forEach((r) => { r.last_read_at = now; r.last_delivered_at = now; });
      persist();
      data = true;
      break;
    }
    // Deputy reply links (084): the request is real in the demo, the page is not.
    case 'bw_deputy_request_open': {
      const rows = table('deputy_requests');
      let r = rows.find((x) => x.event_id === args.p_event_id && x.deputy_id === args.p_deputy_id && x.status !== 'cancelled');
      if (!r) {
        const dep = table('band_deputies').find((x) => x.id === args.p_deputy_id);
        const ev = table('events').find((x) => x.id === args.p_event_id);
        const now = new Date().toISOString();
        r = {
          id: uuid(), band_id: ev?.band_id, event_id: args.p_event_id, deputy_id: args.p_deputy_id,
          deputy_name: dep?.name || 'Deputy', replaces_user_id: args.p_replaces_user_id ?? null,
          role: args.p_role ?? null, fee_offered: args.p_fee ?? null, currency: ev?.currency ?? null,
          token: (uuid() + uuid()).replace(/-/g, ''), status: 'pending', reply_note: null,
          responded_at: null, answer_snapshot: null, created_at: now, updated_at: now,
        };
        rows.push(r);
        persist();
      }
      data = [{ id: r.id, token: r.token, status: r.status }];
      break;
    }
    case 'bw_deputy_request_view': {
      // The demo user's own deputy gigs (086) answer with their band, for the welcome screen.
      const g = table('demo_deputy_gigs').find((x) => x.token === args.p_token);
      data = g ? { band_name: g.band_name, status: g.status, changes: [] } : { changes: [] };
      break;
    }
    // Deputies in the app (086): the demo user is a deputy for "The Late Shift".
    case 'bw_deputy_request_ping':
      data = 'sent';
      break;
    case 'bw_deputy_unlink': {
      const d = table('band_deputies').find((x) => x.id === args.p_deputy_id);
      data = d?.user_id ? 'unlinked' : 'not_linked';
      if (d) d.user_id = null;
      persist();
      break;
    }
    case 'bw_deputy_claim':
      data = { status: 'already', band_name: 'The Late Shift', deputy_name: DEMO_USER.user_metadata.full_name };
      break;
    case 'bw_my_deputy_gigs': {
      const gigs = table('demo_deputy_gigs');
      data = {
        bands: gigs.length ? [{ band_name: 'The Late Shift', deputy_name: DEMO_USER.user_metadata.full_name }] : [],
        gigs: gigs.map((g) => ({ ...clone(g), venue_address: g.status === 'available' ? g.venue_address : null })),
      };
      break;
    }
    case 'bw_deputy_request_reply': {
      const g = table('demo_deputy_gigs').find((x) => x.token === args.p_token);
      if (!g) {
        data = null;
        break;
      }
      g.status = args.p_answer;
      g.reply_note = args.p_note ?? null;
      g.responded_at = new Date().toISOString();
      g.changes = [];
      g.before = {};
      persist();
      const { id: _id, token: _token, ...view } = clone(g);
      data = { ...view, venue_address: g.status === 'available' ? g.venue_address : null };
      break;
    }
    // Quote confirmation link (099): the link and timeline are real in the demo, the page is not.
    case 'bw_quote_link_publish': {
      const links = table('quote_links');
      const q = table('quotes').find((x) => x.id === args.p_quote_id);
      if (!q) {
        error = { message: 'Not allowed', code: '42501' };
        break;
      }
      const now = new Date().toISOString();
      let l = links.find((x) => x.quote_id === args.p_quote_id);
      if (!l) {
        l = { id: uuid(), quote_id: q.id, band_id: q.band_id, token: (uuid() + uuid()).replace(/-/g, ''), lang: 'en', version: 0, status: 'draft', snapshot: null, created_at: now };
        links.push(l);
      }
      if (JSON.stringify(l.snapshot) !== JSON.stringify(args.p_snapshot)) {
        // A draft (never sent) keeps its version (105).
        if (!(l.status === 'draft' && l.version >= 1)) l.version = (l.version || 0) + 1;
        l.version_at = now;
        l.pdf_url = null;
        l.pdf_version = null;
        if (l.status !== 'draft' && l.version > 1) {
          table('quote_activity').push({ id: uuid(), quote_id: q.id, band_id: q.band_id, kind: 'updated', version: l.version, body: null, channel: null, created_at: now });
        }
      }
      l.snapshot = args.p_snapshot;
      if (args.p_lang) l.lang = args.p_lang;
      if (args.p_pdf_url) {
        l.pdf_url = args.p_pdf_url;
        l.pdf_version = l.version;
      }
      l.updated_at = now;
      persist();
      data = [{ token: l.token, status: l.status, version: l.version, revoked: !!l.revoked_at }];
      break;
    }
    case 'bw_quote_link_mark_sent': {
      const l = table('quote_links').find((x) => x.quote_id === args.p_quote_id);
      if (!l) {
        error = { message: 'Publish the quote first', code: 'P0002' };
        break;
      }
      if (l.status === 'draft' && args.p_kind !== 'reminded') {
        try {
          demoPlanGuard(l.band_id, 'quotes_sent_month');
        } catch (e) {
          error = (e as DemoPlanLimit).planLimit;
          reportPlanLimit(error);
          break;
        }
      }
      const now = new Date().toISOString();
      const kind = args.p_kind === 'reminded' ? 'reminded' : l.status === 'draft' ? 'sent' : 'resent';
      table('quote_activity').push({ id: uuid(), quote_id: l.quote_id, band_id: l.band_id, kind, channel: args.p_channel ?? null, version: l.version, body: null, created_at: now });
      if (l.status === 'draft') {
        l.status = 'sent';
        l.sent_at = now;
      }
      const q = table('quotes').find((x) => x.id === l.quote_id);
      if (q && (q.status || 'draft') === 'draft') {
        q.status = 'sent';
        q.sent_at = now;
      }
      persist();
      data = l.status;
      break;
    }
    case 'bw_quote_reply': {
      const l = table('quote_links').find((x) => x.quote_id === args.p_quote_id);
      const body = String(args.p_body ?? '').trim();
      if (!l || !body) {
        error = { message: !l ? 'Publish the quote first' : 'Empty message', code: '22023' };
        break;
      }
      const row = { id: uuid(), quote_id: l.quote_id, band_id: l.band_id, kind: 'band_reply', channel: null, version: l.version, body, created_at: new Date().toISOString() };
      table('quote_activity').push(row);
      persist();
      data = row.id;
      break;
    }
    case 'bw_quote_link_set_outcome': {
      const l = table('quote_links').find((x) => x.quote_id === args.p_quote_id);
      const outcome = args.p_outcome === 'declined' ? 'declined' : 'accepted';
      if (!l || l.status === 'draft' || l.status === 'accepted' || l.status === outcome) {
        data = l ? l.status : null;
        break;
      }
      const now = new Date().toISOString();
      const q = table('quotes').find((x) => x.id === l.quote_id);
      l.status = outcome;
      l.responded_at = now;
      if (outcome === 'accepted') {
        l.accepted_name = q?.client_name || null;
        l.accepted_version = l.version;
        l.decline_reason = null;
      } else l.decline_reason = args.p_reason ?? null;
      table('quote_activity').push({ id: uuid(), quote_id: l.quote_id, band_id: l.band_id, kind: outcome, channel: null, version: l.version, body: outcome === 'accepted' ? l.accepted_name : l.decline_reason, created_at: now });
      persist();
      data = outcome;
      break;
    }
    case 'bw_quote_link_rotate':
    case 'bw_quote_link_revoke': {
      const l = table('quote_links').find((x) => x.quote_id === args.p_quote_id);
      if (!l) {
        error = { message: 'No link yet', code: 'P0002' };
        break;
      }
      const rotate = fn === 'bw_quote_link_rotate';
      if (rotate) {
        l.token = (uuid() + uuid()).replace(/-/g, '');
        l.revoked_at = null;
      } else l.revoked_at = new Date().toISOString();
      table('quote_activity').push({ id: uuid(), quote_id: l.quote_id, band_id: l.band_id, kind: rotate ? 'link_rotated' : 'link_revoked', channel: null, version: l.version, body: null, created_at: new Date().toISOString() });
      persist();
      data = rotate ? l.token : true;
      break;
    }
    // Final balance (168): the same checks and states as the database.
    case 'bw_quote_balance_publish': {
      const b = args.p_balance as Record<string, any> | null;
      const q = table('quotes').find((x) => x.id === args.p_quote_id);
      const gigId = q?.converted_to_event_id || table('events').find((e) => e.quote_id === args.p_quote_id)?.id || null;
      const g = gigId ? table('events').find((e) => e.id === gigId) : null;
      const l = table('quote_links').find((x) => x.quote_id === args.p_quote_id);
      const fail = (message: string, code = '22023') => (error = { message, code });
      if (!q) fail('Not allowed', '42501');
      else if (!b || typeof b !== 'object' || JSON.stringify(b).length > 16000) fail('Invalid balance');
      else if (!(Number(b.amount) > 0)) fail('Nothing left to pay');
      else if (!/^[A-Z]{3}$/.test(String(b.currency || ''))) fail('Invalid currency');
      else if (b.stripeUrl && !/^https:\/\/[^\s"'<>]+$/.test(String(b.stripeUrl))) fail('Invalid payment link');
      else if (!(b.bank?.length || b.stripeUrl || b.cash)) fail('Add a way to pay');
      else if (String(g?.status || '').toLowerCase() === 'cancelled') fail('The gig is cancelled');
      else if (!l) fail('Publish the quote first', 'P0002');
      else if (l.revoked_at) fail('The client link is turned off');
      else if (l.status !== 'accepted' && String(q.status || '').toLowerCase() !== 'accepted') fail('The quote is not accepted');
      if (error || !l || !q) break;
      const now = new Date().toISOString();
      if (l.status !== 'accepted') {
        l.status = 'accepted';
        l.responded_at ||= now;
        l.accepted_name = q.client_name || null;
        l.accepted_version = l.version;
        table('quote_activity').push({ id: uuid(), quote_id: q.id, band_id: q.band_id, kind: 'accepted', channel: null, version: l.version, body: l.accepted_name, created_at: now });
      }
      const changed = JSON.stringify(l.balance ?? null) !== JSON.stringify(b);
      if (changed) {
        l.balance = b;
        l.balance_version = (l.balance_version || 0) + 1;
        l.balance_at = now;
        l.balance_paid_at = null;
        if (l.balance_sent_at) {
          table('quote_activity').push({ id: uuid(), quote_id: q.id, band_id: q.band_id, kind: 'balance_updated', channel: null, version: l.balance_version, body: String(b!.amountLabel || '').slice(0, 60), created_at: now });
        }
      }
      l.updated_at = now;
      persist();
      data = { token: l.token, balance_version: l.balance_version, changed };
      break;
    }
    case 'bw_quote_balance_mark_sent': {
      const l = table('quote_links').find((x) => x.quote_id === args.p_quote_id);
      if (!l || !l.balance) {
        error = { message: 'Publish the balance first', code: 'P0002' };
        break;
      }
      if (l.revoked_at) {
        error = { message: 'The client link is turned off', code: '22023' };
        break;
      }
      const now = new Date().toISOString();
      const kind = args.p_kind === 'reminded' && l.balance_sent_at ? 'balance_reminded' : 'balance_requested';
      table('quote_activity').push({ id: uuid(), quote_id: l.quote_id, band_id: l.band_id, kind, channel: args.p_channel ?? null, version: l.balance_version, body: String(l.balance.amountLabel || '').slice(0, 60), created_at: now });
      l.balance_sent_at ||= now;
      // 185: what the client has now is the balance just sent.
      l.balance_sent = l.balance;
      l.updated_at = now;
      persist();
      data = kind;
      break;
    }
    case 'bw_quote_balance_mark_paid': {
      const paid = args.p_paid !== false;
      const q = table('quotes').find((x) => x.id === args.p_quote_id);
      if (!q) {
        error = { message: 'Not allowed', code: '42501' };
        break;
      }
      const gigId = q.converted_to_event_id || table('events').find((e) => e.quote_id === q.id)?.id || null;
      const g = gigId ? table('events').find((e) => e.id === gigId && e.band_id === q.band_id) : null;
      if (g) {
        g.payment_status = paid ? 'paid' : g.deposit_paid ? 'partial' : 'pending';
        if (paid) g.deposit_paid = true;
      }
      const l = table('quote_links').find((x) => x.quote_id === q.id);
      if (l && !!l.balance_paid_at !== paid) {
        const now = new Date().toISOString();
        l.balance_paid_at = paid ? now : null;
        l.updated_at = now;
        table('quote_activity').push({ id: uuid(), quote_id: q.id, band_id: q.band_id, kind: paid ? 'balance_paid' : 'balance_reopened', channel: null, version: l.balance_version ?? 0, body: String(l.balance?.amountLabel || '').slice(0, 60) || null, created_at: now });
      }
      persist();
      data = { paid, event_id: gigId };
      break;
    }
    // 168: the shared confirm step and the deposit received (as the SQL).
    case 'bw_quote_confirm_gig':
    case 'bw_quote_deposit_received': {
      const q = table('quotes').find((x) => x.id === args.p_quote_id);
      if (!q) {
        error = { message: 'Not allowed', code: '42501' };
        break;
      }
      const gigId = q.converted_to_event_id || table('events').find((e) => e.quote_id === q.id)?.id || null;
      const g = gigId ? table('events').find((e) => e.id === gigId && e.band_id === q.band_id) : null;
      const confirm = () => {
        if (g && String(g.status || '').toLowerCase() === 'tentative') g.status = 'confirmed';
        return !!g && String(g.status || '').toLowerCase() === 'confirmed';
      };
      if (fn === 'bw_quote_confirm_gig') {
        const confirmed = confirm();
        persist();
        data = { event_id: g ? gigId : null, confirmed };
        break;
      }
      const received = args.p_received !== false;
      const l = table('quote_links').find((x) => x.quote_id === q.id);
      if (String(q.status || '').toLowerCase() !== 'accepted' && l?.status !== 'accepted') {
        error = { message: 'The quote is not accepted', code: '22023' };
        break;
      }
      if (!g) {
        data = { event_id: null, received: false, confirmed: false, needs_gig: received };
        break;
      }
      if (String(g.status || '').toLowerCase() === 'cancelled') {
        error = { message: 'The gig is cancelled', code: '22023' };
        break;
      }
      const method = ['transfer', 'cash', 'other'].includes(String(args.p_method || '').toLowerCase()) ? String(args.p_method).toLowerCase() : 'other';
      const was = !!g.deposit_paid;
      g.deposit_paid = received;
      if (received && Number(args.p_amount) > 0) g.deposit_amount = Number(args.p_amount);
      if (String(g.payment_status || '').toLowerCase() !== 'paid') g.payment_status = received ? 'partial' : 'pending';
      const confirmed = received ? confirm() : String(g.status || '').toLowerCase() === 'confirmed';
      if (was !== received) {
        table('quote_activity').push({ id: uuid(), quote_id: q.id, band_id: q.band_id, kind: received ? 'deposit_received' : 'deposit_reopened', channel: null, version: l?.version ?? 1, body: received ? method : null, created_at: new Date().toISOString() });
      }
      persist();
      data = { event_id: gigId, received, confirmed, needs_gig: false };
      break;
    }
    case 'bw_review_song_suggestion':
      ({ data, error } = reviewSuggestion(args));
      break;
    case 'bw_withdraw_song_suggestion':
      ({ data, error } = withdrawSuggestion(args));
      break;
    // No one else to notify in the demo: keep the call for checks.
    case 'bw_notify_setlist_saved':
    case 'bw_notify_song_updated': {
      const g = globalThis as { __bwDemoNotifications?: unknown[] };
      (g.__bwDemoNotifications ||= []).push({ fn, args });
      data = 0;
      break;
    }
    // Offline readiness "Remind" (170): one push to that member; kept for checks.
    case 'bw_live_pack_remind': {
      const g = globalThis as { __bwDemoNotifications?: unknown[] };
      (g.__bwDemoNotifications ||= []).push({ fn, args });
      data = true;
      break;
    }
    case 'update_setlist_song_count': {
      const id = args.p_setlist_id ?? args.setlist_id;
      const s = table('setlists').find((r) => r.id === id);
      if (s) s.song_count = table('setlist_songs').filter((r) => r.setlist_id === id).length;
      persist();
      break;
    }
  }
  const res = { data, error, count: null, status: error ? 400 : 200, statusText: error ? 'Bad Request' : 'OK' };
  const p: any = Promise.resolve(res);
  // rpc() is sometimes chained with .single()/.maybeSingle().
  p.single = () => p;
  p.maybeSingle = () => p;
  p.select = () => p;
  return p;
};

// ------------------------------------------------------------------ client --

export const createDemoClient = () => {
  const channels = new Set<any>();
  return {
    from: (name: string) => new DemoQuery(name),
    rpc,
    auth,
    storage,
    functions: {
      invoke: async () => ({ data: { success: true, demo: true }, error: null }),
    },
    channel: (name: string) => {
      const ch = makeChannel(name);
      channels.add(ch);
      return ch;
    },
    removeChannel: async (ch: any) => {
      channels.delete(ch);
      await ch?.unsubscribe?.();
      return 'ok';
    },
    removeAllChannels: async () => {
      await Promise.all([...channels].map((ch) => ch?.unsubscribe?.()));
      channels.clear();
      return [];
    },
    getChannels: () => [...channels],
  };
};
