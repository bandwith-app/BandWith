/**
 * Try the song reader: a made-up song in the band's lyrics-and-chords format
 * ("# Verse 1", "[G]word"), read as Lyrics, Chords or Structure, and moved
 * with − key + on this screen only. The band's copy and the other players'
 * screens stay in the song's key. Transposition rules mirror src/lib/transpose.ts
 * of the app: spelling follows the target key, offsets fold to −5…+6.
 */

/* ── Transposition (pure, tested in test/demo-songs.test.ts) ─────────── */

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Major keys written with flats (pitch class): F, Bb, Eb, Ab, Db, and C. F# rather than Gb. */
const FLAT_MAJORS = new Set([5, 10, 3, 8, 1, 0]);
/** Minor keys written with flats: Dm, Gm, Cm, Fm, Bbm, Ebm. */
const FLAT_MINORS = new Set([2, 7, 0, 5, 10, 3]);
const mod12 = (n: number) => ((n % 12) + 12) % 12;

export function pitchClass(note: string): number | null {
  const m = note.match(/^([A-G])([b#♭♯]*)$/);
  if (!m) return null;
  let pc = PC[m[1]];
  for (const c of m[2]) pc += c === '#' || c === '♯' ? 1 : -1;
  return mod12(pc);
}

/** −11…+11 folded the nearest way round (−5…+6): +7 is −5. */
export const foldSemitones = (n: number) => { const m = mod12(n); return m > 6 ? m - 12 : m; };
/** "+2", "−3", "0". */
export const semitoneLabel = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** Flats or sharps for a key ("G", "F#m") moved by `semitones`. */
export function prefersFlats(key: string, semitones: number): boolean {
  const m = key.match(/^([A-G][b#]?)(m?)/);
  const pc = m ? pitchClass(m[1]) : null;
  if (pc == null) return true;
  const to = mod12(pc + semitones);
  return m![2] ? FLAT_MINORS.has(to) : FLAT_MAJORS.has(to);
}

const moveNote = (note: string, n: number, flats: boolean) => {
  const pc = pitchClass(note);
  return pc == null ? note : (flats ? FLATS : SHARPS)[mod12(pc + n)];
};

/** One chord moved: root and bass note, the quality untouched ("G/B" +1 in Ab → "Ab/C"). */
export function transposeChord(chord: string, semitones: number, flats: boolean): string {
  if (!semitones) return chord;
  const m = chord.match(/^([A-G][b#]?)(.*?)(?:\/([A-G][b#]?))?$/);
  if (!m) return chord;
  return `${moveNote(m[1], semitones, flats)}${m[2]}${m[3] ? `/${moveNote(m[3], semitones, flats)}` : ''}`;
}

/** The song's key moved, keeping its style ("G" +1 → "Ab", "Em" +2 → "F#m"). */
export function transposeKey(key: string, semitones: number): string {
  const m = key.match(/^([A-G][b#]?)(.*)$/);
  if (!m || !semitones) return key;
  return `${moveNote(m[1], semitones, prefersFlats(key, semitones))}${m[2]}`;
}

/** Every chord of the song for a reader `semitones` away from the band's key. */
export const transposeAll = (chords: string[], key: string, semitones: number) =>
  chords.map((c) => transposeChord(c, semitones, prefersFlats(key, semitones)));

/** "Bb" → "B♭", "F#m" → "F♯m": how the reader prints accidentals. */
export const pretty = (s: string) => s.replace(/([A-G])b/g, '$1♭').replace(/#/g, '♯');

/* ── The song, in the band's format ─────────────────────────────────── */

export const SONG = {
  title: 'Lanterns on the Canal',
  key: 'G',
  bpm: 92,
  dur: '3:24',
  text: [
    '# Verse 1',
    '[G]Lanterns on the [G/B]water, [Em]counting every [C]light',
    '[G]Someone left the [D]tram doors [C]open to the [D]night',
    '',
    '# Chorus',
    '[C]Hold the [D]line, we [Em]find the [Bm7]tune',
    '[C]Every [D]window [G]humming [G7]soon',
    '',
    '# Verse 2',
    '[G]Paper maps and [C/E]coffee, [Em]humming in the [C]rain',
    '[Am7]Nobody is [D]hurrying, [G]walking home [D]again',
  ].join('\n'),
};

type Seg = { chord: string | null; words: string };
export type Section = { name: string; lines: Seg[][] };

/** "# Verse 1" starts a section; "[Am]word" puts a chord on the word after it. */
export function parseSong(text: string): Section[] {
  const out: Section[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#\s*(.+)$/);
    if (h) { out.push({ name: h[1], lines: [] }); continue; }
    if (!out.length) out.push({ name: '', lines: [] });
    const segs: Seg[] = [];
    const re = /\[([^\]]+)\]([^[]*)/g;
    const first = line.indexOf('[');
    if (first !== 0) segs.push({ chord: null, words: first < 0 ? line : line.slice(0, first) });
    for (const m of line.matchAll(re)) segs.push({ chord: m[1], words: m[2] });
    out[out.length - 1].lines.push(segs);
  }
  return out;
}

/** Each section's chord progression, repeats in a row folded (the Structure view). */
export const progression = (s: Section) =>
  s.lines.flat().map((x) => x.chord).filter((c): c is string => !!c).filter((c, i, a) => c !== a[i - 1]);

export type View = 'lyrics' | 'chords' | 'structure';
export const VIEWS: { id: View; label: string }[] = [{ id: 'lyrics', label: 'Lyrics' }, { id: 'chords', label: 'Chords' }, { id: 'structure', label: 'Structure' }];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The song is English on every page: its lines keep their words (section names are translated). */
const LINE = ' lang="en" data-i18n-skip';

/** The reader's body for a view, chords moved by `semitones`. Plain strings: also used at build time. */
export function songBody(view: View, semitones: number): string {
  const flats = prefersFlats(SONG.key, semitones);
  const ch = (c: string) => `<b class="sgc">${esc(pretty(transposeChord(c, semitones, flats)))}</b>`;
  return parseSong(SONG.text).map((s) => {
    const head = `<h4 class="sgr__sec">${esc(s.name)}</h4>`;
    if (view === 'structure') {
      return `<section>${head}<div class="sgr__bars">${progression(s).map((c) => `<span>${ch(c)}</span>`).join('')}</div></section>`;
    }
    const lines = s.lines.map((l) => view === 'lyrics'
      ? `<p class="sgr__line"${LINE}>${esc(l.map((x) => x.words).join(''))}</p>`
      : `<p class="sgr__line sgr__line--ch"${LINE}>${l.map((x) => `<span class="sgs">${x.chord ? ch(x.chord) : '<b class="sgc sgc--none"></b>'}<span>${esc(x.words) || '&nbsp;'}</span></span>`).join('')}</p>`);
    return `<section>${head}${lines.join('')}</section>`;
  }).join('');
}

/** The band: what each player's own screen shows (default view by instrument, nobody else moved). */
export const PLAYERS = [
  { name: 'Sara', inst: 'Vocals', view: 'Lyrics' },
  { name: 'Leo M.', inst: 'Bass', view: 'Chords' },
  { name: 'Nico', inst: 'Drums', view: 'Structure' },
];

/* ── The demo ───────────────────────────────────────────────────────── */

export function initSongsDemo(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const body = root.querySelector<HTMLElement>('[data-sg-body]');
  const keyBtn = root.querySelector<HTMLButtonElement>('[data-sg-key]');
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-sg-view]'));
  const note = root.querySelector<HTMLElement>('[data-sg-note]');
  const mine = root.querySelector<HTMLElement>('[data-sg-mine]');
  const kick = root.querySelector<HTMLElement>('[data-sg-kick]');
  if (!body || !keyBtn) return;
  root.classList.add('is-live');

  let view: View = 'chords';
  let semis = 0;

  const render = (dir = 0) => {
    body.innerHTML = songBody(view, semis);
    const key = pretty(transposeKey(SONG.key, semis));
    keyBtn.innerHTML = `<b>${key}</b><i>${semitoneLabel(semis)}</i>`;
    keyBtn.disabled = semis === 0;
    keyBtn.setAttribute('aria-label', semis ? `Key of ${key}, ${semitoneLabel(semis)}. Back to the original key` : `Original key, ${key}`);
    root.classList.toggle('is-moved', semis !== 0);
    tabs.forEach((t) => {
      const on = t.dataset.sgView === view;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    body.setAttribute('aria-labelledby', `sg-tab-${view}`);
    if (kick) kick.textContent = `${VIEWS.find((v) => v.id === view)!.label} · Velvet Static`;
    if (mine) mine.innerHTML = `<b>${key}</b>${semis ? ` <em>${semitoneLabel(semis)}</em>` : ''}`;
    if (dir && !reduce) {
      body.querySelectorAll('.sgc:not(.sgc--none)').forEach((el, i) => el.animate(
        [{ transform: `translateY(${dir > 0 ? 9 : -9}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 320, delay: Math.min(i * 12, 180), easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
      ));
    }
  };

  const say = (msg: string) => { if (note) note.textContent = msg; };
  const keyLine = () => {
    const key = pretty(transposeKey(SONG.key, semis));
    return semis
      ? `Your screen: key of ${key} (${semitoneLabel(semis)}). The band’s copy stays in ${SONG.key}.`
      : `Your screen is back in ${SONG.key}, the band’s key.`;
  };

  const setView = (v: View, focus = false) => {
    if (v === view) return;
    view = v;
    render();
    if (focus) root.querySelector<HTMLElement>(`[data-sg-view="${v}"]`)?.focus();
    say(v === 'lyrics' ? 'Lyrics: the words only, chords hidden.' : v === 'chords' ? 'Chords: the words with their chords above them.' : 'Structure: each section’s chord progression in boxes.');
    if (!reduce) body.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  };

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled || !root.contains(b)) return;
    if (b.dataset.sgView) return setView(b.dataset.sgView as View);
    const step = b.dataset.sgStep;
    if (step) {
      const raw = semis + Number(step);
      semis = foldSemitones(raw);
      render(Number(step));
      say(keyLine() + (raw !== semis ? ' The count takes the shorter way round.' : ''));
      return;
    }
    if (b === keyBtn) { semis = 0; render(-1); say(keyLine()); keyBtn.blur(); root.querySelector<HTMLElement>('[data-sg-step="1"]')?.focus(); return; }
    if (b.hasAttribute('data-sg-reset')) { view = 'chords'; semis = 0; render(); say('Back to the start: Chords, in the band’s key of G.'); }
  });

  // Tabs: arrow keys move between Lyrics, Chords and Structure.
  root.querySelector('[role="tablist"]')?.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    const i = VIEWS.findIndex((v) => v.id === view);
    const to = k === 'ArrowRight' ? i + 1 : k === 'ArrowLeft' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? VIEWS.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    setView(VIEWS[(to + VIEWS.length) % VIEWS.length].id, true);
  });

  render();
}
