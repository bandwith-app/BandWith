import { createIcon, type IconComponent } from './IconBase';
import { arc, dot, ring, seg } from './dots';

/* ═══════════════════════════════════════════════════════════════════════════
   BandWith Dot Icons — music symbols for chord charts
   Same kit as ./custom-icons.tsx (pills and dots, see ./dots.tsx), no music
   font and no glyphs. Bar lines are tall and narrow (viewBox 24 high), so
   they line up with the bar they close; the rest are 24×24.
   The registry that says which marker is which symbol: src/lib/musicSymbols.ts.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A heavier pill, as the thick line of a repeat or final bar line. */
const thick = (d: string, scale = 1.9) => (sw: number | string) => (
  <path d={d} fill="none" strokeWidth={Number(sw) * scale} />
);

const icon = (name: string, viewBox: string, thin: string, heavy?: string): IconComponent =>
  createIcon(
    name,
    (sw) => (
      <>
        {thin && <path d={thin} fill="none" />}
        {heavy && thick(heavy)(sw)}
      </>
    ),
    viewBox,
  );

/** 𝄆 thick line, thin line, two dots. */
export const RepeatStartSign = icon('RepeatStartSign', '0 0 13 24', `M7.5 3V21${dot(11, 9.5, 11, 14.5)}`, 'M2.5 3V21');

/** 𝄇 two dots, thin line, thick line. */
export const RepeatEndSign = icon('RepeatEndSign', '0 0 13 24', `M5.5 3V21${dot(2, 9.5, 2, 14.5)}`, 'M10.5 3V21');

/** Final bar line: thin, then thick. */
export const FinalBarSign = icon('FinalBarSign', '0 0 11 24', 'M2 3V21', 'M7.5 3V21');

/** Double bar line: two thin lines. */
export const DoubleBarSign = icon('DoubleBarSign', '0 0 9 24', 'M2 3V21M7 3V21');

/** Repeat the previous bar (%): a slash between two dots. */
export const RepeatBarSign = icon('RepeatBarSign', '0 0 24 24', `${seg(6, 19, 18, 5)}${dot(7, 8.5, 17, 15.5)}`);

/** Repeat the previous two bars: two slashes between two dots. */
export const RepeatTwoBarsSign = icon(
  'RepeatTwoBarsSign',
  '0 0 30 24',
  `${seg(5, 19, 13, 5)}${seg(17, 19, 25, 5)}${dot(5, 9, 25, 15)}`,
);

/** Rhythm slash: the same chord on the next beat. */
export const SlashSign = icon('SlashSign', '0 0 24 24', '', seg(9.5, 18.5, 14.5, 5.5));

/** Segno: an S crossed by a slash, a dot either side. */
export const SegnoSign = icon(
  'SegnoSign',
  '0 0 24 24',
  `M15.5 6.75A3.75 3.4 0 1 0 12 12A3.75 3.4 0 1 1 8.5 17.25${seg(7, 20, 17, 4)}${dot(7.5, 10.5, 16.5, 13.5)}`,
);

/** Coda: a ring of dots crossed by two pills. */
export const CodaSign = icon('CodaSign', '0 0 24 24', `${ring(12, 12, 6.5, 12, -90, [0, 3, 6, 9])}M12 2V22M2 12H22`);

/** Fermata: an arch over a dot. */
export const FermataSign = icon('FermataSign', '0 0 24 24', `${arc(12, 18, 8.5, 180, 360)}${dot(12, 16)}`);

/* ── Full screen ── */

/** Four corners pointing out. */
export const Maximize = createIcon('Maximize', () => (
  <path d="M3 8.5V3H8.5M15.5 3H21V8.5M21 15.5V21H15.5M8.5 21H3V15.5" fill="none" />
));

/** Four corners pointing in. */
export const Minimize = createIcon('Minimize', () => (
  <path d="M8.5 3V8.5H3M21 8.5H15.5V3M15.5 21V15.5H21M3 15.5H8.5V21" fill="none" />
));
