import React from 'react';
import { useT } from '@/lib/i18n';
import { loadScore } from '@/lib/scoreCache';
import { osmdChordLabelTexts, osmdCustomChordNames, scoreFacts, scoreTextAlternative, type ScoreFacts } from '@/lib/score';
import { transposeKey } from '@/lib/transpose';
import { useTranspose } from './Transpose';
import { cn } from './utils';

/**
 * A song's score, note by note (sheet music plan §4.2): MusicXML drawn by
 * OpenSheetMusicDisplay as one SVG that reflows to the width it has (a
 * closed Duo, a phone turned sideways, an iPad, the floor wedge).
 *
 * - OSMD (≈380 KB gzip) is its own chunk, fetched the first time a score is
 *   shown: the app never loads it for songs without one.
 * - Transpose is the reader's (the same control and semitones as the chords),
 *   zoom follows the reader's text size, and the ink is the text colour
 *   around it, so dark mode and Stage mode's black need nothing else.
 * - Chord names use the chart's own spelling (chordLabel): "G6", not "Gmaj6".
 * - The SVG is one picture for screen readers (role="img"), described by the
 *   same facts in words: bars, key and chords, transposed.
 */

type Osmd = import('opensheetmusicdisplay').OpenSheetMusicDisplay;
type State = 'loading' | 'ready' | 'error';

/** The reader's text size (24 px by default) → OSMD zoom. */
export const scoreZoom = (size: number) => Math.max(0.6, Math.min(2, size / 24));

const inkOf = (el: Element | null) => (el ? getComputedStyle(el).color : '') || '#111111';

/** The host is the one picture (role="img"): OSMD's own SVG is not a second one. */
const hideSvg = (host: HTMLElement | null) => host?.querySelectorAll('svg').forEach((svg) => svg.setAttribute('aria-hidden', 'true'));

const colorOptions = (ink: string) => ({
  defaultColorMusic: ink,
  defaultColorNotehead: ink,
  defaultColorStem: ink,
  defaultColorRest: ink,
  defaultColorLabel: ink,
  defaultColorTitle: ink,
  defaultColorChordSymbol: ink,
});

export const ScoreView: React.FC<{
  /** songs.score_path (or a demo:// score). */
  scoreRef: string;
  title: string;
  /** The reader's text size: the score's zoom. */
  size: number;
  className?: string;
  /** Classes of the status lines (loading, offline). */
  muted?: string;
}> = ({ scoreRef, title, size, className, muted = 'text-muted-foreground' }) => {
  const t = useT();
  const { semitones } = useTranspose();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const osmdRef = React.useRef<Osmd | null>(null);
  const applied = React.useRef<{ semitones: number; zoom: number; ink: string; width: number } | null>(null);
  const [xml, setXml] = React.useState<string | null>(null);
  const [facts, setFacts] = React.useState<ScoreFacts | null>(null);
  const [state, setState] = React.useState<State>('loading');
  const [error, setError] = React.useState<string | null>(null);
  const [ink, setInk] = React.useState('');
  const [width, setWidth] = React.useState(0);
  const descId = React.useId();
  const zoom = scoreZoom(size);

  // 1. The file (from the device when it is there).
  React.useEffect(() => {
    let live = true;
    setState('loading');
    setError(null);
    setXml(null);
    loadScore(scoreRef)
      .then((text) => {
        if (!live) return;
        setFacts(scoreFacts(text));
        setXml(text);
      })
      .catch((e: Error) => {
        if (!live) return;
        setState('error');
        setError(e?.message || 'error');
      });
    return () => {
      live = false;
    };
  }, [scoreRef]);

  // The colour and the width it is drawn for: the theme (class on <html>), Stage mode's black, the Duo hinge, rotation.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const read = () => {
      setInk(inkOf(root));
      setWidth(Math.round(root.clientWidth));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    let frame = 0;
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(read);
      });
      ro.observe(root);
    } catch {
      /* no ResizeObserver: drawn for the width it had */
    }
    return () => {
      mo.disconnect();
      ro?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // 2. OSMD (its own chunk), once per score.
  React.useEffect(() => {
    if (!xml || !hostRef.current) return;
    let live = true;
    const host = hostRef.current;
    (async () => {
      try {
        const mod = await import('opensheetmusicdisplay');
        if (!live) return;
        const currentInk = inkOf(rootRef.current);
        const o = new mod.OpenSheetMusicDisplay(host, {
          backend: 'svg',
          autoResize: false,
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawLyricist: false,
          drawCredits: false,
          drawPartNames: false,
          drawPartAbbreviations: false,
          drawingParameters: 'compacttight',
          disableCursor: true,
          pageBackgroundColor: 'transparent',
          ...colorOptions(currentInk),
        });
        o.TransposeCalculator = new mod.TransposeCalculator();
        const rules = o.EngravingRules;
        rules.resetChordAccidentalTexts?.(rules.ChordAccidentalTexts, true);
        const kinds = mod.ChordSymbolEnum as unknown as Record<string, number>;
        for (const [name, label] of Object.entries(osmdChordLabelTexts())) {
          if (typeof kinds[name] === 'number') rules.ChordSymbolLabelTexts.setValue(kinds[name], label);
        }
        const renames = osmdCustomChordNames();
        for (const c of (rules.CustomChords ?? []) as { alternateName: string }[]) {
          if (renames[c.alternateName]) c.alternateName = renames[c.alternateName];
        }
        await o.load(xml);
        if (!live) return;
        o.Zoom = zoom;
        o.Sheet.Transpose = semitones;
        o.render();
        hideSvg(host);
        osmdRef.current = o;
        applied.current = { semitones, zoom, ink: currentInk, width: Math.round(rootRef.current?.clientWidth ?? 0) };
        setState('ready');
      } catch {
        if (!live) return;
        setState('error');
        setError('not-musicxml');
      }
    })();
    return () => {
      live = false;
      osmdRef.current?.clear?.();
      osmdRef.current = null;
      applied.current = null;
      host.innerHTML = '';
    };
    // Transpose, zoom and colour after the first drawing are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml]);

  // 3. Transpose, zoom, colour and width: drawn again only when one changed.
  React.useEffect(() => {
    const o = osmdRef.current;
    const last = applied.current;
    if (!o || !last || state !== 'ready') return;
    const next = { semitones, zoom, ink: ink || last.ink, width: width || last.width };
    if (next.semitones === last.semitones && next.zoom === last.zoom && next.ink === last.ink && next.width === last.width) return;
    try {
      if (next.ink !== last.ink) o.setOptions(colorOptions(next.ink));
      o.Zoom = next.zoom;
      o.Sheet.Transpose = next.semitones;
      o.render();
      hideSvg(hostRef.current);
      applied.current = next;
    } catch {
      setState('error');
      setError('not-musicxml');
    }
  }, [semitones, zoom, ink, width, state]);

  const key = facts?.key ? transposeKey(facts.key, semitones) : null;
  const description = facts ? scoreTextAlternative(facts, title, semitones, t) : '';
  const message =
    state === 'error'
      ? error === 'offline'
        ? t('No internet: this score isn’t on this device yet. Open it once online to keep it for the stage.')
        : t('This score couldn’t be shown. Check that the file is MusicXML (.musicxml or .mxl).')
      : state === 'loading'
        ? t('Loading score…')
        : null;

  return (
    <div
      ref={rootRef}
      data-score
      data-score-state={state}
      data-score-bars={facts?.bars ?? undefined}
      data-score-key={key ?? undefined}
      className={cn('w-full min-w-0 max-w-full', className)}
    >
      <div
        ref={hostRef}
        role="img"
        aria-label={t('Score: {title}', { title })}
        aria-describedby={descId}
        className={cn('w-full overflow-hidden [&_svg]:max-w-full', state !== 'ready' && 'min-h-0')}
      />
      <p id={descId} className="sr-only">
        {description}
      </p>
      {message && (
        <p role={state === 'error' ? 'alert' : 'status'} className={cn('bw-body-md py-4', muted)}>
          {message}
        </p>
      )}
    </div>
  );
};
