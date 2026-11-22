// Which functions a migration file (re)defines (docs/release-checklist.md,
// supabase/checks/redefined_functions.sql). Used by
// scripts/release-checklist.test.ts on the migrations on main and by
// scripts/fn-redefinitions.mjs on the release branch heads.
//
// Counted as a definition of a function:
//   static    CREATE [OR REPLACE] FUNCTION at the top level;
//   dynamic   the same text inside a DO block (EXECUTE '…', EXECUTE $sql$…$sql$,
//             EXECUTE format(…)). conditional: the DO block can RETURN before
//             it (a live body is kept, e.g. 178 keeps 175's bw_chat_scope_ok),
//             or it sits inside an IF … THEN … END IF (195 redefines
//             bw_band_free_slots only when the live body lacks skip_dates);
//   patched   a DO block that reads a live body (pg_get_functiondef) and runs
//             an expression (EXECUTE v_new, EXECUTE replace(def, …)), e.g. 191;
//   declared  a "-- defines: a, b" line: needed when the SQL builds the name at
//             run time (format('CREATE FUNCTION public.%I…')), which no scan
//             can read. Without that line the file is refused.
// Whole-line comments are not definitions. Matched on text: a scan, not a
// parser; anything it can't read is an error rather than a silent miss.

const CREATE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
const CREATE_BUILT_NAME = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?%[IsL]/i;
const DO_BLOCK = /\bDO\s+(\$\w*\$)([\s\S]*?)\1/g;
const READS_BODY = /pg_get_functiondef\(\s*(?:to_regprocedure\(\s*)?'(?:public\.)?"?(\w+)"?\s*\(/gi;
// EXECUTE of an expression (a variable, replace(…)); not a literal, not
// format(), not EXECUTE FUNCTION (triggers) nor GRANT EXECUTE ON.
const EXECUTES_EXPRESSION = /\bEXECUTE\s+(?!format\s*\(|'|\$\w*\$|FUNCTION\b|PROCEDURE\b|ON\b)[a-z_(]/i;
const RETURNS_EARLY = /\bRETURN\s*;/i;
// Inside an IF that is still open at that point of the DO block (IF … THEN
// without its END IF yet). "IF EXISTS" / "IF NOT EXISTS" of DDL have no THEN
// before their ";" and don't count.
const insideIf = (before) => (before.match(/\bIF\b[^;]*?\bTHEN\b/gi) ?? []).length > (before.match(/\bEND\s+IF\b/gi) ?? []).length;
const canSkip = (before) => RETURNS_EARLY.test(before) || insideIf(before);

const withoutComments = (sql) =>
  sql
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');

/** name → { how: 'static' | 'dynamic' | 'patched' | 'declared', conditional: boolean } */
export function definedFunctions(sql) {
  const declared = [...sql.matchAll(/^\s*--\s*defines:\s*(.+)$/gim)].flatMap((m) =>
    m[1].split(',').map((s) => s.trim()).filter(Boolean),
  );
  const text = withoutComments(sql);
  const blocks = [...text.matchAll(DO_BLOCK)].map((m) => ({ from: m.index, to: m.index + m[0].length, body: m[0] }));
  const blockAt = (i) => blocks.find((b) => i >= b.from && i < b.to);
  const out = new Map();

  for (const m of text.matchAll(CREATE)) {
    const block = blockAt(m.index);
    if (!block) out.set(m[1], { how: 'static', conditional: false });
    else if (!out.has(m[1]) || out.get(m[1]).how !== 'static')
      out.set(m[1], { how: 'dynamic', conditional: canSkip(text.slice(block.from, m.index)) });
  }
  for (const b of blocks) {
    const exec = b.body.search(EXECUTES_EXPRESSION);
    if (exec < 0) continue;
    for (const m of b.body.matchAll(READS_BODY)) {
      if (!out.has(m[1])) out.set(m[1], { how: 'patched', conditional: RETURNS_EARLY.test(b.body.slice(0, exec)) });
    }
  }
  if (CREATE_BUILT_NAME.test(text) && !declared.length) {
    throw new Error('a function name is built at run time (format %I/%s): name it in a "-- defines: name, …" line');
  }
  for (const n of declared) if (!out.has(n)) out.set(n, { how: 'declared', conditional: false });
  return out;
}
