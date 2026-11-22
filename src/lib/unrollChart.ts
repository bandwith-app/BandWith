/**
 * A chord chart's road map played out into the bars in the order the band
 * plays them (Follow the tempo, plan §4.3 level 1).
 *
 * Read the way iReal Pro and most lead sheets mean it:
 * - `{ … }` plays twice ("3x" / "x4" written in the repeat: that many times);
 *   a `}` with no `{` repeats from the start, or from the last double bar;
 *   "4x" on a bar with no repeat sign repeats its section that many times.
 * - 1st / 2nd / 3rd endings: pass n plays ending n; a pass with no ending of
 *   its own plays the last one.
 * - D.C. (back to the start) and D.S. (back to the segno), "al Coda" (on the
 *   way, the first coda sign — or "To Coda" — jumps to the next coda after
 *   the D.C./D.S.), "al Fine" (stop at Fine, or at the End sign), "al 2nd
 *   ending". After a D.C./D.S. repeats are not taken again: the last ending
 *   plays, unless the jump names one.
 * - `%` repeats the bar before, `%%` the two bars before (one cell, two bars).
 * - Time signature changes stay with the bar they start on, also on a jump.
 * - Fermatas and "ad lib" / "vamp" / "on cue" bars are flagged: the playhead
 *   waits there until the leader taps.
 *
 * Pure: no React, no clock. A malformed road map never loops forever
 * (MAX_BARS).
 */
import type { ChartBar, SongChart } from './ireal';
import { textSymbols, type TextSymbol } from './musicSymbols';
import { DEFAULT_TIME, normalizeTime } from './meter';

export interface UnrolledBar {
  /** Where the bar is drawn: section index and bar index in `chart.sections` (ChordChart's data-bar). */
  section: number;
  bar: number;
  /** The second bar of a two-bar repeat (`%%`, one cell on the chart): 1. */
  part?: 1;
  /** The section's label ("A", "Verse"…), null before the first mark. */
  label: string | null;
  /** Chords to play, with `%` / `%%` resolved to the bars they repeat. */
  chords: string[];
  /** Time signature in force ("4/4"). */
  time: string;
  /** Pass through the repeat this bar belongs to (1 the first time). */
  pass: number;
  /** Fermata, "ad lib", "vamp", "on cue": the playhead waits at the end of this bar. */
  hold?: boolean;
}

/** Longest a played-out chart can get (a 3-minute song is ~90 bars; long jams ~400). */
export const MAX_BARS = 2000;

interface Cell {
  section: number;
  bar: number;
  data: ChartBar;
  marks: TextSymbol[];
  time: string;
  label: string | null;
}

const HOLD_TEXT = /\b(?:ad\.? ?lib|vamp|on cue|until cue|open)\b/i;
const has = (c: Cell, ...ids: TextSymbol['id'][]) => c.marks.some((m) => ids.includes(m.id));
const timesOf = (c: Cell) => c.marks.find((m) => m.id === 'repeat-times')?.n;

type Jump = { kind: 'dc' | 'ds'; until: 'coda' | 'fine' | 'end' | 'ending'; ending?: number };

const jumpOf = (c: Cell): Jump | null => {
  for (const m of c.marks) {
    switch (m.id) {
      case 'dc':
        return { kind: 'dc', until: 'end' };
      case 'dc-al-coda':
        return { kind: 'dc', until: 'coda' };
      case 'dc-al-fine':
        return { kind: 'dc', until: 'fine' };
      case 'dc-al-ending':
        return { kind: 'dc', until: 'ending', ending: m.n };
      case 'ds':
        return { kind: 'ds', until: 'end' };
      case 'ds-al-coda':
        return { kind: 'ds', until: 'coda' };
      case 'ds-al-fine':
        return { kind: 'ds', until: 'fine' };
      case 'ds-al-ending':
        return { kind: 'ds', until: 'ending', ending: m.n };
      default:
        break;
    }
  }
  return null;
};

function cellsOf(chart: SongChart, baseTime?: string | null): Cell[] {
  const cells: Cell[] = [];
  let time = normalizeTime(baseTime) ?? normalizeTime(chart.time) ?? DEFAULT_TIME;
  chart.sections.forEach((s, si) =>
    s.bars.forEach((b, bi) => {
      if (b.time) time = normalizeTime(b.time) ?? time;
      cells.push({ section: si, bar: bi, data: b, marks: textSymbols(b.text), time, label: s.label });
    }),
  );
  return cells;
}

/** How many times the repeat that starts at `start` is played: 2, the highest ending, or the "3x" written in it. */
function repeatTotal(cells: Cell[], start: number): number {
  let total = 2;
  let closed = false;
  for (let j = start; j < cells.length; j++) {
    const c = cells[j];
    if (j > start && c.data.repeatStart) break;
    if (c.data.ending) total = Math.max(total, c.data.ending);
    else if (closed) break;
    const n = timesOf(c);
    if (n && n >= 2) total = Math.max(total, Math.min(n, 16));
    if (c.data.repeatEnd) closed = true;
  }
  return total;
}

/** Where a `}` with no `{` repeats from: after the last double / final bar before it, else the start. */
function implicitStart(cells: Cell[], end: number, floor: number): number {
  for (let j = end - 1; j >= floor; j--) {
    const d = cells[j].data;
    if (d.doubleEnd || d.final || d.repeatEnd) return j + 1;
  }
  return floor;
}

/** The bar that plays pass `pass` among the endings from `from`: that ending, else the last one; -1 if none. */
function endingFor(cells: Cell[], from: number, pass: number): number {
  let last = -1;
  for (let j = from; j < cells.length; j++) {
    const d = cells[j].data;
    if (j > from && d.repeatStart) break;
    if (d.ending === pass) return j;
    if (d.ending && d.ending < pass) last = j;
    // Past the last ending of this group: a bar with no ending after one that closed the repeat.
    if (!d.ending && j > from && cells[j - 1].data.repeatEnd) break;
  }
  return last;
}

/** The bar after the ending block that starts at `from` (to skip an ending no pass wants). */
function afterEnding(cells: Cell[], from: number): number {
  for (let j = from; j < cells.length; j++) {
    if (cells[j].data.repeatEnd) return j + 1;
    if (j > from && cells[j].data.ending) return j;
  }
  return cells.length;
}

export function unrollChart(chart: SongChart | null | undefined, opts: { time?: string | null } = {}): UnrolledBar[] {
  if (!chart?.sections?.length) return [];
  const cells = cellsOf(chart, opts.time);
  if (!cells.length) return [];
  const out: UnrolledBar[] = [];
  const segno = cells.findIndex((c) => c.data.segno);
  const codas = cells.map((c, i) => (c.data.coda || has(c, 'to-coda') ? i : -1)).filter((i) => i >= 0);

  let rep = null as { start: number; pass: number; total: number } | null;
  /** After D.C./D.S.: where it was, what it plays to. */
  let jump = null as (Jump & { from: number }) | null;
  /** Start of the music a `}` with no `{` may repeat (moves to the segno after D.S.). */
  let floor = 0;
  /** Sections repeated by "4x" with no repeat sign: section index → passes played. */
  const sectionPasses = new Map<number, number>();
  let i = 0;
  let steps = 0;

  const emit = (c: Cell, pass: number) => {
    const d = c.data;
    const hold = !!d.fermata || has(c, 'on-cue') || c.marks.some((m) => m.id === 'comment' && HOLD_TEXT.test(m.text || ''));
    const base = { section: c.section, bar: c.bar, label: c.label, time: c.time, pass };
    const prev = out[out.length - 1];
    if (d.chords.length === 1 && d.chords[0] === '%%') {
      const a = out[out.length - 2] ?? prev;
      out.push({ ...base, chords: a ? [...a.chords] : [] });
      out.push({ ...base, part: 1, chords: prev ? [...prev.chords] : [], ...(hold ? { hold } : {}) });
      return;
    }
    const chords = d.chords.length === 1 && d.chords[0] === '%' ? (prev ? [...prev.chords] : []) : [...d.chords];
    out.push({ ...base, chords, ...(hold ? { hold } : {}) });
  };

  while (i < cells.length && out.length < MAX_BARS && steps++ < MAX_BARS * 4) {
    const c = cells[i];
    const d = c.data;

    if (d.repeatStart && rep?.start !== i) {
      const total = repeatTotal(cells, i);
      // After a jump the repeat is not taken again: straight to the ending the jump names, or the last.
      rep = { start: i, pass: jump ? (jump.until === 'ending' && jump.ending ? jump.ending : total) : 1, total };
    }

    if (d.ending) {
      const pass = rep?.pass ?? (jump ? (jump.until === 'ending' && jump.ending ? jump.ending : 99) : 1);
      if (d.ending !== pass) {
        const j = endingFor(cells, i, pass);
        if (j > i) {
          i = j;
          continue;
        }
        if (j < 0) {
          // No ending for this pass: past this one.
          i = afterEnding(cells, i);
          continue;
        }
      }
    }

    emit(c, rep?.pass ?? sectionPasses.get(c.section) ?? 1);

    // Al Fine / al ending: the song ends here.
    if (jump && (jump.until === 'fine' || jump.until === 'end') && (has(c, 'fine', 'end') || d.end) && i < jump.from) break;
    if (jump && jump.until === 'ending' && d.ending && d.ending === jump.ending && d.final) break;

    // Al Coda: the first coda sign on the way jumps to the coda after the D.C./D.S.
    if (jump?.until === 'coda' && codas.includes(i)) {
      const target = codas.find((k) => k > jump!.from) ?? codas.find((k) => k > i);
      if (target != null && target > i) {
        jump = { ...jump, until: 'end' };
        rep = null;
        i = target;
        continue;
      }
    }

    // Repeat back.
    const times = timesOf(c);
    const implied = !d.repeatEnd && !rep && times && times >= 2 && !cells.slice(i + 1).some((x) => x.section === c.section && x.data.repeatEnd);
    if (d.repeatEnd || implied) {
      if (implied) {
        // "4x" with no signs: the whole section, that many times.
        const played = (sectionPasses.get(c.section) ?? 1) + 1;
        if (!jump && played <= Math.min(times!, 16)) {
          sectionPasses.set(c.section, played);
          i = cells.findIndex((x) => x.section === c.section);
          continue;
        }
      } else {
        if (!rep) {
          const start = implicitStart(cells, i, floor);
          const total = repeatTotal(cells, start);
          rep = { start, pass: jump ? total : 1, total };
        }
        if (rep.pass < rep.total) {
          rep.pass += 1;
          i = rep.start;
          // Re-entering a "{" keeps this repeat's pass count.
          continue;
        }
        rep = null;
      }
    }

    // D.C. / D.S. (once).
    const j = !jump ? jumpOf(c) : null;
    if (j) {
      jump = { ...j, from: i };
      rep = null;
      floor = j.kind === 'ds' && segno >= 0 ? segno : 0;
      sectionPasses.clear();
      i = floor;
      continue;
    }

    // Final bar: the chart ends here (a coda written after it is reached only by the jump).
    if (d.final && (!jump || !codas.some((k) => k > i))) break;
    i++;
  }
  return out;
}

/** A played-out section: consecutive bars of one chart section in one pass. */
export interface UnrolledSection {
  label: string | null;
  /** Chart section index. */
  section: number;
  /** First bar (index in the unrolled bars) and how many. */
  start: number;
  length: number;
}

export function unrolledSections(bars: UnrolledBar[]): UnrolledSection[] {
  const out: UnrolledSection[] = [];
  bars.forEach((b, i) => {
    const last = out[out.length - 1];
    const prev = bars[i - 1];
    // A new section: another chart section, or the same one again (a repeat, a jump back).
    const again = !!prev && prev.section === b.section && (b.bar < prev.bar || (b.bar === prev.bar && !b.part));
    if (!last || last.section !== b.section || again) out.push({ label: b.label, section: b.section, start: i, length: 1 });
    else last.length += 1;
  });
  return out;
}
