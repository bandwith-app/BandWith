import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ScreenHeader, IconButton, Card } from '@/app/components/bw/Screen';
import { FormError, PillButton } from '@/app/components/bw';
import { UnsavedChangesSheet } from '@/app/components/bw/UnsavedChanges';
import { AlertTriangle, Check, Copy, Music2, Plus, RotateCcw, Sparkles } from '@/app/components/icons';
import { cn } from '@/app/components/ui/utils';
import { supabase } from '@/lib/supabase';
import { useT } from '@/lib/i18n';
import { userMessage } from '@/lib/userError';
import { useSystemBack } from '@/lib/backStack';
import { useUnsavedGuard } from '@/lib/unsavedGuard';
import { isChordToken } from '@/lib/lyrics';
import { asSongChart, chordLabel, keyLabel, type SongChart } from '@/lib/ireal';
import { ChordToken } from '@/app/components/ui/MusicSymbol';
import { notifySongUpdated } from '@/lib/services/setlistNotify';
import {
  applyKeyFix,
  chartChords,
  checkKey,
  chordsMissingFromChart,
  copySectionChords,
  matchChartSection,
  normalizeLyrics,
  parseLine,
  proposeChordsFromChart,
  sectionLabel,
  serializeLine,
  setWordChord,
  songChords,
  textSections,
  wordChord,
  type TextSection,
} from '@/lib/songFormat';
import { applyVoiceSuggestions, setLineVoice, suggestVoiceParts, VOICE_PARTS, wordVoices, type VoicePart } from '@/lib/voiceParts';
import { voiceClass, voicePartLabel } from '@/app/components/ui/VoiceParts';

/**
 * The admin's chord editor for a band song (`songs.lyrics`): tap a word and
 * pick a chord from the song's palette, drag a chord to another word, copy a
 * verse's chords onto another, or take them from the matching iReal section.
 * Checks flag chords the chart doesn't play and a key that doesn't match.
 * The Voice row marks a line, or a few words of it, as second voice,
 * backing, all or spoken (src/lib/voiceParts.ts); tap the part again to
 * clear it. Opened from anywhere with openChordEditor(songId).
 */

// ── Store ──
let openId: string | null = null;
const listeners = new Set<() => void>();
export const openChordEditor = (songId: string) => {
  openId = songId;
  listeners.forEach((l) => l());
};
export const closeChordEditor = () => {
  openId = null;
  listeners.forEach((l) => l());
};
const useOpenId = () =>
  React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => openId,
    () => openId,
  );

/** Fired after a song's lyrics are saved here: lists and readers refresh. */
export const SONG_SAVED = 'bw:song-saved';

interface EditedSong {
  id: string;
  band_id: string;
  title: string;
  key: string | null;
  lyrics: string;
  chart: SongChart | null;
}

type Pos = { line: number; word: number };
const samePos = (a: Pos | null, b: Pos | null) => !!a && !!b && a.line === b.line && a.word === b.word;

export const ChordEditor: React.FC = () => {
  const t = useT();
  const id = useOpenId();
  const [song, setSong] = React.useState<EditedSong | null>(null);
  const [text, setText] = React.useState('');
  const [history, setHistory] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<Pos | null>(null);
  const [newChord, setNewChord] = React.useState('');
  const [copyTo, setCopyTo] = React.useState<number | null>(null);
  // Voice parts: the whole line of the selected word, or "just these words" (tap more words of that line).
  const [wordsMode, setWordsMode] = React.useState(false);
  const [rangeEnd, setRangeEnd] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Closing with chord changes not saved asks first (the app's sheet, not a native confirm).
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  // Leaving through the tab bar with changes: ask, then go where the user tapped.
  const pendingLeave = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    setLeaveOpen(false);
    pendingLeave.current = null;
  }, [id]);
  const [drag, setDrag] = React.useState<{ from: Pos; chord: string; x: number; y: number; moved: boolean } | null>(null);
  // The click that ends a drag lands on whatever word is under it: ignore it.
  const dropClick = React.useRef(false);
  const tapWord = (pos: Pos, isSel: boolean) => {
    if (dropClick.current) return;
    if (wordsMode && selected && pos.word >= 0 && selected.word >= 0 && pos.line === selected.line && !isSel) {
      setRangeEnd(pos.word);
      return;
    }
    setRangeEnd(null);
    setSelected(isSel ? null : pos);
  };

  React.useEffect(() => {
    setSong(null);
    setSelected(null);
    setHistory([]);
    setError(null);
    setCopyTo(null);
    if (!id) return;
    let alive = true;
    void (async () => {
      const { data, error: e } = await supabase.from('songs').select('id, band_id, title, key, lyrics, chord_chart').eq('id', id).single();
      if (!alive) return;
      if (e || !data) {
        setError(userMessage(e, t('Could not load the song.')));
        return;
      }
      const row = data as { id: string; band_id: string; title: string; key: string | null; lyrics: string | null; chord_chart: unknown };
      // Songs written before the unified format (chords on their own line above
      // the words) are edited in it: otherwise a chord placed on a word would
      // sit under the old chord line and both would be saved.
      const lyrics = normalizeLyrics(row.lyrics) || row.lyrics || '';
      setSong({ id: row.id, band_id: row.band_id, title: row.title, key: row.key, lyrics, chart: asSongChart(row.chord_chart) });
      setText(lyrics);
    })();
    return () => {
      alive = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!song && text !== song.lyrics;
  useUnsavedGuard(!!id && dirty, (proceed) => {
    pendingLeave.current = proceed;
    setLeaveOpen(true);
  });
  const close = () => {
    if (saving) return;
    if (dirty) {
      setLeaveOpen(true);
      return;
    }
    closeChordEditor();
  };
  useSystemBack(!!id, () => {
    // The chord picker for a word is the top layer: Back closes just that.
    if (copyTo !== null) {
      setCopyTo(null);
      return true;
    }
    if (selected) {
      setSelected(null);
      return true;
    }
    close();
    return true;
  });

  const edit = (next: string) => {
    if (next === text) return;
    setHistory((h) => [...h.slice(-49), text]);
    setText(next);
  };
  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      setText(h[h.length - 1]);
      return h.slice(0, -1);
    });
  };

  const lines = React.useMemo(() => text.split('\n'), [text]);
  const sections = React.useMemo(() => textSections(text), [text]);
  const palette = React.useMemo(() => {
    const out = songChords(text);
    for (const c of chartChords(song?.chart)) if (!out.includes(c)) out.push(c);
    return out;
  }, [text, song?.chart]);
  const missing = React.useMemo(() => chordsMissingFromChart(text, song?.chart), [text, song?.chart]);
  const keyFix = React.useMemo(() => checkKey(text, song?.key, song?.chart?.key), [text, song?.key, song?.chart?.key]);
  const tidy = React.useMemo(() => normalizeLyrics(text), [text]);
  const canTidy = !!text.trim() && tidy !== text.trim();
  // Lines in parentheses → backing, "All:" → all: proposed, applied only on a tap.
  const voiceHints = React.useMemo(() => suggestVoiceParts(text), [text]);

  const putChord = (pos: Pos, chord: string | null) => {
    const next = [...lines];
    next[pos.line] = setWordChord(next[pos.line], pos.word, chord);
    edit(next.join('\n'));
  };
  const moveChord = (from: Pos, to: Pos) => {
    if (samePos(from, to)) return;
    const next = [...lines];
    const src = parseLine(next[from.line]);
    const chord = from.word < 0 ? src.tail[0] : wordChord(src.words[from.word]);
    if (!chord) return;
    if (from.word < 0) src.tail = src.tail.slice(1);
    else src.words[from.word].chords = src.words[from.word].chords.slice(1);
    next[from.line] = serializeLine(src);
    next[to.line] = setWordChord(next[to.line], to.word, chord);
    edit(next.join('\n'));
    setSelected(to);
  };

  const addNewChord = () => {
    const c = newChord.trim().replace(/^\[|\]$/g, '');
    if (!c || !isChordToken(c) || !selected) return;
    putChord(selected, c);
    setNewChord('');
  };

  // Drag a chord chip onto another word (pointer events: touch, pen and mouse alike).
  const onChipDown = (e: React.PointerEvent, from: Pos, chord: string) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ from, chord, x: e.clientX, y: e.clientY, moved: false });
  };
  const onChipMove = (e: React.PointerEvent) => {
    setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, moved: d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 } : d));
  };
  const onChipUp = (e: React.PointerEvent) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (!d.moved) {
      setSelected(d.from);
      return;
    }
    dropClick.current = true;
    setTimeout(() => (dropClick.current = false), 0);
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-word]');
    if (!target) return;
    moveChord(d.from, { line: Number(target.dataset.line), word: Number(target.dataset.word) });
  };

  const save = async () => {
    if (!song || saving) return;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.from('songs').update({ lyrics: text }).eq('id', song.id);
    setSaving(false);
    if (e) {
      setError(userMessage(e, t('Could not save the chords.')));
      return;
    }
    void notifySongUpdated(song.id, ['chords']);
    try {
      window.dispatchEvent(new CustomEvent(SONG_SAVED, { detail: { id: song.id, lyrics: text } }));
    } catch {
      /* no window */
    }
    setSong({ ...song, lyrics: text });
    closeChordEditor();
    const next = pendingLeave.current;
    pendingLeave.current = null;
    next?.();
  };

  const selWord = selected ? parseLine(lines[selected.line] || '').words[selected.word] : null;
  const range = selected && selected.word >= 0 ? (wordsMode ? { from: Math.min(selected.word, rangeEnd ?? selected.word), to: Math.max(selected.word, rangeEnd ?? selected.word) } : null) : null;
  const selVoices = selected && selected.word >= 0 ? wordVoices(lines[selected.line] || '') : [];
  const shownVoices = range ? selVoices.slice(range.from, range.to + 1) : selVoices;
  const selVoice: VoicePart | null = shownVoices.length && shownVoices.every((v) => v === shownVoices[0]) ? shownVoices[0] : null;
  const putVoice = (v: VoicePart) => {
    if (!selected || selected.word < 0) return;
    const next = [...lines];
    next[selected.line] = setLineVoice(next[selected.line], v, range ?? undefined);
    edit(next.join('\n'));
  };
  const selChord = selected ? (selected.word < 0 ? parseLine(lines[selected.line] || '').tail[0] ?? null : selWord ? wordChord(selWord) : null) : null;

  const renderLine = (li: number) => {
    const model = parseLine(lines[li]);
    const voices = wordVoices(lines[li]);
    return (
      <div key={li} className="flex flex-wrap items-end gap-x-[0.3em] gap-y-1 font-mono text-[17px] leading-6">
        {model.words.map((w, wi) => {
          const pos = { line: li, word: wi };
          const chord = wordChord(w);
          const isSel = samePos(selected, pos);
          const inRange = !isSel && !!range && selected?.line === li && wi >= range.from && wi <= range.to;
          return (
            <span
              key={wi}
              role="button"
              tabIndex={0}
              data-word={wi}
              data-line={li}
              aria-pressed={isSel}
              aria-label={chord ? t('{word}, chord {chord}', { word: w.text, chord }) : w.text}
              onClick={() => tapWord(pos, isSel)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelected(isSel ? null : pos);
                }
              }}
              className={cn(
                'inline-flex flex-col items-start rounded-lg px-1 -mx-0.5 min-h-11 justify-end cursor-pointer select-none',
                isSel ? 'bg-accent text-accent-foreground' : inRange ? 'bg-accent/50' : 'hover:bg-foreground/5',
                drag?.moved && 'outline-dashed outline-1 outline-foreground/20',
              )}
            >
              {chord ? (
                <span
                  onPointerDown={(e) => onChipDown(e, pos, chord)}
                  onPointerMove={onChipMove}
                  onPointerUp={onChipUp}
                  onPointerCancel={() => setDrag(null)}
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    'px-1.5 rounded-md bw-label-sm normal-case font-bold leading-5 touch-none',
                    isSel ? 'bg-background/30' : 'bg-foreground text-background',
                    drag && samePos(drag.from, pos) && drag.moved && 'opacity-30',
                  )}
                >
                  <ChordToken token={chord} />
                </span>
              ) : (
                <span className="h-5" aria-hidden />
              )}
              <span className={voiceClass(voices[wi])} data-voice={voices[wi] === 'lead' ? undefined : voices[wi]}>{w.text}</span>
            </span>
          );
        })}
        {(model.tail.length > 0 || model.words.length === 0) && (
          <span
            role="button"
            tabIndex={0}
            data-word={-1}
            data-line={li}
            onClick={() => tapWord({ line: li, word: -1 }, false)}
            className={cn(
              'inline-flex items-end gap-1 rounded-lg px-1 min-h-11 cursor-pointer',
              samePos(selected, { line: li, word: -1 }) ? 'bg-accent text-accent-foreground' : 'hover:bg-foreground/5',
            )}
            aria-label={t('Chords at the end of the line')}
          >
            {model.tail.length ? (
              model.tail.map((c, k) => (
                <span key={k} className="px-1.5 rounded-md bg-foreground text-background bw-label-sm normal-case font-bold leading-5">
                  <ChordToken token={c} />
                </span>
              ))
            ) : (
              <Plus className="w-4 h-4 mb-1" />
            )}
          </span>
        )}
      </div>
    );
  };

  const sectionsWithChords = sections.filter((s) => s.lines.some((li) => /\[[A-G]/.test(lines[li])));

  const renderSection = (s: TextSection, si: number) => {
    const chartSection = matchChartSection(song?.chart, s.name);
    const sources = sectionsWithChords.filter((x) => x !== s);
    return (
      <section key={si} className="flex flex-col gap-2">
        {(s.name || sources.length > 0 || chartSection) && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <h3 className="bw-label-md uppercase text-muted-foreground basis-full">{s.name ? sectionLabel(s.name, t) : t('Untitled section')}</h3>
            {sources.length > 0 && (
              <PillButton size="sm" variant="outline" fullWidth={false} icon={<Copy className="w-4 h-4" />} onClick={() => setCopyTo(copyTo === si ? null : si)} aria-expanded={copyTo === si}>
                {t('Copy chords from…')}
              </PillButton>
            )}
            {chartSection && (
              <PillButton
                size="sm"
                variant="outline"
                fullWidth={false}
                icon={<Sparkles className="w-4 h-4" />}
                onClick={() => edit(proposeChordsFromChart(text, s, chartSection))}
              >
                {t('From iReal ({section})', { section: chartSection.label || '' })}
              </PillButton>
            )}
          </div>
        )}
        {copyTo === si && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('Copy chords from…')}>
            {sources.map((src, k) => (
              <PillButton
                key={k}
                size="sm"
                variant="dark"
                fullWidth={false}
                onClick={() => {
                  edit(copySectionChords(text, src, s));
                  setCopyTo(null);
                }}
              >
                {src.name ? sectionLabel(src.name, t) : t('Untitled section')}
              </PillButton>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1">{s.lines.map(renderLine)}</div>
      </section>
    );
  };

  return createPortal(
    <>
    <AnimatePresence>
      {id && (
        <motion.div
          key="chord-editor"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.3, ease: 'easeOut' }}
          className="bw-pane-detail fixed inset-0 z-[155] bg-background text-foreground flex flex-col"
          role="dialog"
          aria-label={t('Edit chords')}
        >
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" style={{ touchAction: 'pan-y' }}>
            <ScreenHeader
              pane
              onBack={close}
              backLabel={t('Close')}
              overline={t('Edit chords')}
              title={song?.title || ''}
              titleSize="h1"
              actions={
<IconButton label={t('Undo')} icon={<RotateCcw />} onClick={undo} disabled={!history.length} />
              }
            />
            <div className="flex flex-col gap-3 px-4 pt-2 pb-6">
              {!song && !error && <p className="bw-body-md text-muted-foreground">{t('Loading…')}</p>}
              {song && (
                <>
                  <p className="bw-body-sm text-muted-foreground">
                    {t('Tap a word to put a chord on it. Drag a chord to move it to another word.')}
                  </p>
                  {canTidy && (
                    <Card className="flex flex-col gap-2">
                      <p className="bw-body-md">{t('Section names and chords can be put in the band’s format.')}</p>
                      <PillButton size="sm" variant="outline" fullWidth={false} className="self-start" icon={<Sparkles className="w-4 h-4" />} onClick={() => edit(tidy)}>
                        {t('Tidy the format')}
                      </PillButton>
                    </Card>
                  )}
                  {voiceHints.length > 0 && (
                    <Card className="flex flex-col gap-2">
                      <p className="bw-body-md">
                        {voiceHints.length === 1
                          ? t('1 line looks like backing vocals or all together.')
                          : t('{n} lines look like backing vocals or all together.', { n: voiceHints.length })}
                      </p>
                      <PillButton size="sm" variant="outline" fullWidth={false} className="self-start" icon={<Sparkles className="w-4 h-4" />} onClick={() => edit(applyVoiceSuggestions(text, voiceHints))}>
                        {t('Mark the voice parts')}
                      </PillButton>
                    </Card>
                  )}
                  {missing.length > 0 && (
                    <Card role="status">
                      <p className="bw-body-md flex gap-3 items-start">
                        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                        {t('Not in the iReal chart: {chords}', { chords: missing.map(chordLabel).join(', ') })}
                      </p>
                    </Card>
                  )}
                  {keyFix && (
                    <Card className="flex flex-col gap-2" role="status">
                      <p className="bw-body-md flex gap-3 items-start">
                        <Music2 className="w-5 h-5 shrink-0 mt-0.5" />
                        {t('The chords sound in {found}, the song is in {expected}.', {
                          found: keyFix.found,
                          expected: song.key || keyLabel(song.chart?.key) || keyFix.expected,
                        })}
                      </p>
                      <PillButton size="sm" variant="outline" fullWidth={false} className="self-start" onClick={() => edit(applyKeyFix(text, keyFix))}>
                        {keyFix.semitones > 0
                          ? t('Transpose up {n} semitones', { n: keyFix.semitones })
                          : t('Transpose down {n} semitones', { n: -keyFix.semitones })}
                      </PillButton>
                    </Card>
                  )}
                  {!text.trim() ? (
                    <p className="bw-body-md text-muted-foreground">{t('This song has no lyrics yet. Add them in Edit song, then come back for the chords.')}</p>
                  ) : (
                    sections.map(renderSection)
                  )}
                </>
              )}
              {error && <FormError>{error}</FormError>}
            </div>
          </div>

          {song && (
            <div className="shrink-0 border-t border-border bg-background px-4 pt-3 flex flex-col gap-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}>
              {selected ? (
                <>
                  {selected.word >= 0 && (
                    <div className="flex flex-col gap-2" role="group" aria-label={t('Voice')}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="bw-label-sm text-muted-foreground">{t('Voice')}</span>
                        {([false, true] as const).map((words) => (
                          <button
                            key={String(words)}
                            type="button"
                            aria-pressed={wordsMode === words}
                            onClick={() => {
                              setWordsMode(words);
                              setRangeEnd(null);
                            }}
                            className={cn('min-h-9 px-3 rounded-full bw-label-sm border border-border', wordsMode === words && 'bg-foreground text-background border-foreground')}
                          >
                            {words ? t('Just these words') : t('Whole line')}
                          </button>
                        ))}
                      </div>
                      {wordsMode && <p className="bw-body-sm text-muted-foreground">{t('Tap more words of this line to add them.')}</p>}
                      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
                        {VOICE_PARTS.map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => putVoice(v)}
                            aria-pressed={selVoice === v}
                            className={cn(
                              'h-11 px-3 rounded-full bw-label-md normal-case shrink-0 border-[1.5px] border-foreground',
                              selVoice === v && 'bg-foreground text-background',
                            )}
                          >
                            <span className={selVoice === v ? undefined : voiceClass(v)}>{voicePartLabel(v, t)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="bw-label-sm text-muted-foreground">
                    {selWord ? t('Chord on “{word}”', { word: selWord.text }) : t('Chords at the end of the line')}
                  </p>
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4" role="group" aria-label={t('Chords of the song')}>
                    {palette.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => putChord(selected, c)}
                        aria-pressed={selChord === c}
                        className={cn(
                          'h-11 min-w-11 px-3 rounded-full bw-label-md normal-case shrink-0 border-[1.5px] border-foreground',
                          selChord === c ? 'bg-foreground text-background' : '',
                        )}
                      >
                        <ChordToken token={c} />
                      </button>
                    ))}
                    {selChord && (
                      <button type="button" onClick={() => putChord(selected, null)} className="h-11 px-3 rounded-full bw-label-sm shrink-0 text-destructive">
                        {t('No chord')}
                      </button>
                    )}
                  </div>
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addNewChord();
                    }}
                  >
                    <input
                      value={newChord}
                      onChange={(e) => setNewChord(e.target.value)}
                      placeholder={t('New chord, e.g. F#m7')}
                      aria-label={t('New chord')}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      className="flex-1 min-w-0 h-11 px-4 rounded-full bg-field border border-border bw-body-md outline-none focus:border-foreground"
                    />
                    <PillButton type="submit" size="md" variant="dark" fullWidth={false} icon={<Plus className="w-4 h-4" />} disabled={!isChordToken(newChord.trim())}>
                      {t('Add')}
                    </PillButton>
                    <PillButton size="md" variant="outline" fullWidth={false} onClick={() => setSelected(null)}>
                      {t('Done')}
                    </PillButton>
                  </form>
                </>
              ) : (
                <PillButton icon={<Check className="w-4 h-4" />} onClick={save} loading={saving} disabled={!dirty}>
                  {t('Save chords')}
                </PillButton>
              )}
            </div>
          )}

          {drag?.moved && (
            <span
              className="fixed z-[200] pointer-events-none px-2 py-1 rounded-md bg-foreground text-background bw-label-md normal-case shadow-lg"
              style={{ left: drag.x, top: drag.y, transform: 'translate(-50%, -130%)' }}
              aria-hidden
            >
              <ChordToken token={drag.chord} />
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
    <UnsavedChangesSheet
      open={!!id && leaveOpen}
      title={t('Save your changes?')}
      saving={saving}
      error={leaveOpen ? error : null}
      onKeepEditing={() => {
        pendingLeave.current = null;
        setLeaveOpen(false);
      }}
      onDiscard={() => {
        setLeaveOpen(false);
        closeChordEditor();
        const next = pendingLeave.current;
        pendingLeave.current = null;
        next?.();
      }}
      onSave={() => {
        // Success closes the editor; an error stays on the sheet.
        void save();
      }}
    />
    </>,
    document.body,
  );
};
