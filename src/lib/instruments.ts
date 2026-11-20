/**
 * Instruments are free text (band_members.instrument, band_deputies.instrument,
 * lineup roles like "Bass · Band leader"). These helpers turn them into
 * canonical keys so "Bass guitar", "basso" and "Electric bass" match, while
 * "Double bass" stays a different instrument.
 */

import { t } from '@/lib/i18n';

/** Canonical key → phrases that mean it (lowercase, accents removed). Longer phrases are tried first. */
const ALIASES: Record<string, string[]> = {
  'double-bass': ['double bass', 'upright bass', 'contrabass', 'contrabbasso', 'contrebasse', 'kontrabass', 'contrabajo', 'contrabaixo', 'standup bass', 'stand up bass'],
  bass: ['bass guitar', 'electric bass', 'bass', 'basso', 'bassista', 'bassist', 'basse', 'bajo', 'baixo'],
  drums: ['drums', 'drum kit', 'drummer', 'batteria', 'batterista', 'batterie', 'bateria', 'schlagzeug', 'schlagzeuger', 'drum'],
  percussion: ['percussion', 'percussions', 'percussioni', 'percussionist', 'percusion', 'percussao', 'perkussion', 'cajon', 'congas'],
  keys: ['keyboards', 'keyboard', 'keys', 'piano', 'pianist', 'pianoforte', 'pianista', 'tastiere', 'tastiera', 'synth', 'synths', 'synthesizer', 'organ', 'organo', 'hammond', 'teclados', 'teclado', 'claviers', 'clavier', 'keyboarder'],
  guitar: ['electric guitar', 'acoustic guitar', 'lead guitar', 'rhythm guitar', 'guitar', 'guitarist', 'chitarra', 'chitarrista', 'guitare', 'guitarra', 'gitarre', 'gitarrist'],
  vocals: ['lead vocals', 'backing vocals', 'vocals', 'vocal', 'vocalist', 'voice', 'singer', 'voce', 'cantante', 'chant', 'chanteur', 'chanteuse', 'voz', 'gesang', 'sanger', 'cori'],
  sax: ['saxophone', 'sax', 'sassofono', 'saxofon', 'saxofone', 'saxophon', 'alto sax', 'tenor sax'],
  trumpet: ['trumpet', 'tromba', 'trompette', 'trompeta', 'trompete', 'flugelhorn'],
  trombone: ['trombone', 'posaune', 'trombon'],
  violin: ['violin', 'violino', 'violon', 'violin', 'violino', 'geige', 'fiddle'],
  cello: ['cello', 'violoncello', 'violoncelle', 'violonchelo', 'violoncelo'],
  dj: ['dj', 'deejay', 'disc jockey'],
};

const ORDERED = Object.entries(ALIASES)
  .flatMap(([key, words]) => words.map((w) => ({ key, w })))
  .sort((a, b) => b.w.length - a.w.length);

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = ORDERED.map(({ key, w }) => ({ key, re: new RegExp(`(^|\\s)${escape(w)}(?=\\s|$)`) }));

/** Words in roles that aren't instruments ("Bass · Band leader"). */
const NOT_INSTRUMENTS = new Set(['band leader', 'leader', 'admin', 'member', 'musician', 'musicista', 'bandleader', 'capobanda']);

/**
 * Canonical instruments in a free-text field, in the order written.
 * "Guitar / Backing vocals" → ['guitar', 'vocals']; unknown words keep their
 * own folded text ("Harp" → 'harp').
 */
export function instrumentKeys(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (text || '').split(/[·,/;&+|]|\band\b|\be\b|\by\b|\bet\b|\bund\b/i)) {
    let rest = fold(part);
    if (!rest || NOT_INSTRUMENTS.has(rest)) continue;
    const found: string[] = [];
    for (const { key, re } of PATTERNS) {
      if (re.test(rest)) {
        found.push(key);
        rest = rest.replace(re, ' ').trim();
      }
    }
    const keys = found.length > 0 ? found : [rest];
    for (const k of keys) if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** The main instrument (first one written), or null. */
export const mainInstrument = (text: string | null | undefined): string | null => instrumentKeys(text)[0] ?? null;

/** True when two fields share an instrument. */
export const sharesInstrument = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const bk = new Set(instrumentKeys(b));
  return instrumentKeys(a).some((k) => bk.has(k));
};

export interface CoverageMember {
  name: string;
  instrument?: string | null;
}
export interface CoverageDeputy {
  id: string;
  name: string;
  instrument?: string | null;
}
export interface InstrumentCoverage<D extends CoverageDeputy = CoverageDeputy> {
  key: string;
  /** How the band writes it (first spelling met). */
  label: string;
  members: string[];
  deputies: D[];
  /** How many instruments the row stands for (keys · vocals = 2). */
  instruments: number;
}

/**
 * Who covers what: for each instrument the band plays, its members and the
 * deputies who can stand in. Instruments played by the same members and
 * covered by the same deputies share one row ("keys · vocals"), so a player
 * with two instruments isn't listed twice. Rows without a deputy come first
 * (they are the gaps), then by name. Deputies for instruments nobody in the
 * band plays are returned apart.
 */
export function deputyCoverage<D extends CoverageDeputy>(
  members: CoverageMember[],
  deputies: D[],
): { rows: InstrumentCoverage<D>[]; others: D[] } {
  const rows = new Map<string, InstrumentCoverage<D>>();
  for (const m of members) {
    const raw = (m.instrument || '').split(/[·,/;&+|]/);
    instrumentKeys(m.instrument).forEach((key, i) => {
      if (!rows.has(key)) rows.set(key, { key, label: (raw[i] || raw[0] || key).trim() || key, members: [], deputies: [], instruments: 1 });
      const row = rows.get(key)!;
      if (!row.members.includes(m.name)) row.members.push(m.name);
    });
  }
  const others: D[] = [];
  for (const d of deputies) {
    let placed = false;
    for (const key of instrumentKeys(d.instrument)) {
      const row = rows.get(key);
      if (row) {
        if (!row.deputies.some((x) => x.id === d.id)) row.deputies.push(d);
        placed = true;
      }
    }
    if (!placed) others.push(d);
  }
  const merged = new Map<string, InstrumentCoverage<D>>();
  for (const row of rows.values()) {
    const sig = `${[...row.members].sort().join('\u0000')}\u0001${row.deputies.map((d) => d.id).sort().join('\u0000')}`;
    const same = merged.get(sig);
    if (same) {
      same.key += `+${row.key}`;
      same.label += ` · ${row.label}`;
      same.instruments += 1;
    } else merged.set(sig, { ...row, members: [...row.members], deputies: [...row.deputies] });
  }
  const list = [...merged.values()].sort(
    (a, b) => Number(a.deputies.length > 0) - Number(b.deputies.length > 0) || a.label.localeCompare(b.label),
  );
  return { rows: list, others };
}

/** Instrument names the app translates (the chips in profile and onboarding, plus roles). */
const LABELS = ['Vocals', 'Guitar', 'Bass', 'Drums', 'Keys', 'Sax', 'Piano', 'Trumpet', 'Violin', 'Cello', 'DJ', 'Producer', 'Percussion', 'Trombone', 'Double bass', 'Band leader', 'Other'];
const LABEL_BY_FOLD = new Map(LABELS.map((l) => [fold(l), l]));
const SEPARATOR = /(\s*[·,/;&+|]\s*)/;

/**
 * A free-text instrument or lineup role, ready to show: the names the app
 * offers ("Vocals", onboarding's "guitar") are translated, anything else is
 * shown as written. "Vocals · Band leader" → "Voci · Capobanda".
 */
export function instrumentText(text: string | null | undefined): string {
  return (text || '')
    .trim()
    .split(SEPARATOR)
    .map((part) => {
      if (SEPARATOR.test(part) || !part.trim()) return part;
      const label = LABEL_BY_FOLD.get(fold(part));
      if (label) return t(label);
      return part === part.toLowerCase() ? part.charAt(0).toUpperCase() + part.slice(1) : part;
    })
    .join('');
}
