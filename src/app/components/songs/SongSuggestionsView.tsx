import React from 'react';
import { raiseAboveOpenPanes } from '@/lib/raiseLayer';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { FormError, PillButton, Selector, Tag } from '@/app/components/bw';
import { Card, ListRow, ScreenHeader } from '@/app/components/bw/Screen';
import { AlertTriangle, BookOpen, Check, Edit3, Music2, RotateCcw, StickyNote, X } from '@/app/components/icons';
import { cn } from '@/app/components/ui/utils';
import { AddSongModal } from '@/app/components/rehearsal/AddSongModal';
import { useBand } from '@/lib/BandContext';
import { useAuth } from '@/lib/AuthContext';
import { useSystemBack } from '@/lib/backStack';
import { supabase } from '@/lib/supabase';
import { intlLocale, useT } from '@/lib/i18n';
import { personName } from '@/lib/personName';
import { userMessage } from '@/lib/userError';
import type { Song } from '@/lib/services/songs';
import {
  diffHunks,
  diffLines,
  notesWithNote,
  songChangedSince,
  type DiffLine,
  type SongSuggestion,
  type SuggestionKind,
  type SuggestionStatus,
} from '@/lib/songSuggestions';
import {
  closeSongSuggestions,
  countSongSuggestions,
  getSongSuggestion,
  listSongSuggestions,
  reviewSongSuggestion,
  SUGGESTIONS_CHANGED,
  useSongSuggestionsScreen,
  withdrawSongSuggestion,
} from '@/lib/services/songSuggestions';
import { keepVoiceParts, stripVoiceMarkers } from '@/lib/voiceParts';
import { useVoiceSafeText } from './VoiceSafeText';

type SongRow = Pick<Song, 'id' | 'band_id' | 'title' | 'artist' | 'key' | 'bpm' | 'duration_seconds' | 'status' | 'lyrics' | 'notes' | 'audio_url' | 'chart_url' | 'youtube_url' | 'genre' | 'chord_chart' | 'created_at' | 'updated_at' | 'priority'>;

const KIND_ICON: Record<SuggestionKind, React.ReactNode> = {
  new_song: <Music2 />,
  lyrics: <BookOpen />,
  chords: <Music2 />,
  note: <StickyNote />,
};

/**
 * Suggestions from members (108). Admins: the band's suggestions, to accept,
 * accept with changes or reject (with a reason the member receives). Members:
 * their own, with the outcome, and they can take a pending one back.
 * A `bw-pane-detail`: full screen on a phone and the closed Duo, the trailing
 * page beside the repertoire on the open Duo and iPad. Mounted once
 * (AuthenticatedApp), opened with openSongSuggestions().
 */
export const SongSuggestionsView: React.FC = () => {
  const t = useT();
  const screen = useSongSuggestionsScreen();
  const { selectedBand, isAdmin } = useBand();
  const { user } = useAuth();
  const bandId = selectedBand?.id;
  const open = !!screen && !!bandId;

  const [tab, setTab] = React.useState<Tab>('pending');
  const [songs, setSongs] = React.useState<Record<string, SongRow>>({});
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // Each tab asks the server for its own status, a page at a time (keyset:
  // older than the last one shown, so no row cap hides the oldest): an old
  // correction still waiting never hides behind newer reviewed ones, and a
  // notification's suggestion is fetched by id (audit 09 #10).
  const [pages, setPages] = React.useState<Record<Tab, SongSuggestion[]>>({ pending: [], reviewed: [] });
  const [more, setMore] = React.useState<Record<Tab, boolean>>({ pending: false, reviewed: false });
  const [extra, setExtra] = React.useState<SongSuggestion | null>(null);
  // Each tab's total on the server (null: not known, the loaded rows count).
  const [totals, setTotals] = React.useState<Record<Tab, number | null>>({ pending: null, reviewed: null });
  // The notification target the shown items were loaded for (until then, a
  // target missing from the old items is not "gone": it is being fetched).
  const [loadedFor, setLoadedFor] = React.useState<{ focus: string | undefined } | null>(null);
  const pagesRef = React.useRef(pages);
  pagesRef.current = pages;
  const focusId = screen?.suggestionId;
  const mine = React.useMemo(() => (isAdmin || !user?.id ? {} : { createdBy: user.id }), [isAdmin, user?.id]);
  // Whose list is shown: a response for another band (or person) is dropped,
  // and another band's pages never set how far a refresh pages down.
  const scope = `${bandId ?? ''}|${mine.createdBy ?? ''}`;
  const scopeRef = React.useRef(scope);
  scopeRef.current = scope;
  const pagesScope = React.useRef<string | null>(null);
  const loadSeq = React.useRef(0);

  const loadSongs = React.useCallback(async (list: SongSuggestion[]) => {
    const ids = [...new Set(list.map((s) => s.song_id).filter((id): id is string => !!id))];
    if (!ids.length) return;
    // A request per 100 ids: every page of a long list in one `in.(...)`
    // would pass the URL length the server accepts.
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += SONG_CHUNK) chunks.push(ids.slice(i, i + SONG_CHUNK));
    const results = await Promise.all(
      chunks.map((chunk) =>
        supabase
          .from('songs')
          .select('id, band_id, title, artist, key, bpm, duration_seconds, status, lyrics, notes, audio_url, chart_url, youtube_url, genre, chord_chart, created_at, updated_at, priority')
          .in('id', chunk),
      ),
    );
    const rows = results.flatMap((r) => ((r.data || []) as SongRow[]));
    setSongs((prev) => ({ ...prev, ...Object.fromEntries(rows.map((r) => [r.id, r])) }));
  }, []);

  /** One tab from the newest, page by page, down to `through` (what was shown before a refresh). */
  const fetchTab = React.useCallback(
    async (tab: Tab, through?: SongSuggestion) => {
      if (!bandId) return { data: null, more: false, error: null as Error | null };
      const out: SongSuggestion[] = [];
      let before: SongSuggestion | undefined;
      for (let n = 0; n < 200; n++) {
        const { data, error } = await listSongSuggestions(bandId, { ...mine, status: STATUS[tab], limit: PAGE + 1, before });
        if (error || !data) return { data: null, more: false, error };
        const page = data.slice(0, PAGE);
        out.push(...page);
        const hasMore = data.length > PAGE;
        const last = page[page.length - 1];
        if (!hasMore || !last || !through || !olderThan(through, last)) return { data: out, more: hasMore, error: null };
        before = last;
      }
      return { data: out, more: true, error: null };
    },
    [bandId, mine],
  );

  const load = React.useCallback(async () => {
    if (!bandId || !user?.id) return;
    const seq = ++loadSeq.current;
    const forScope = scope;
    const shown = pagesScope.current === forScope ? pagesRef.current : { pending: [], reviewed: [] };
    const [p, r, nPending, nReviewed] = await Promise.all([
      fetchTab('pending', shown.pending[shown.pending.length - 1]),
      fetchTab('reviewed', shown.reviewed[shown.reviewed.length - 1]),
      countSongSuggestions(bandId, { ...mine, status: STATUS.pending }),
      countSongSuggestions(bandId, { ...mine, status: STATUS.reviewed }),
    ]);
    // A newer load, or another band meanwhile: this one is stale.
    if (seq !== loadSeq.current || scopeRef.current !== forScope) return;
    if (p.error || r.error || !p.data || !r.data) {
      setLoadError(userMessage(p.error || r.error, t('Could not load the suggestions.')));
      setLoadedFor({ focus: focusId });
      return;
    }
    let one: SongSuggestion | null = null;
    if (focusId && !p.data.some((s) => s.id === focusId) && !r.data.some((s) => s.id === focusId)) {
      const { data } = await getSongSuggestion(focusId);
      if (seq !== loadSeq.current || scopeRef.current !== forScope) return;
      if (data && data.band_id === bandId && data.status !== 'withdrawn') one = data;
    }
    setLoadError(null);
    pagesScope.current = forScope;
    setPages({ pending: p.data, reviewed: r.data });
    setMore({ pending: p.more, reviewed: r.more });
    setExtra(one);
    setTotals({ pending: nPending, reviewed: nReviewed });
    setLoadedFor({ focus: focusId });
    await loadSongs([...p.data, ...r.data, ...(one ? [one] : [])]);
  }, [bandId, user?.id, t, focusId, fetchTab, loadSongs, scope, mine]);

  const [loadingMore, setLoadingMore] = React.useState(false);
  // Another band (or person): the pages shown are of the old one until it loads.
  React.useEffect(() => {
    setLoadingMore(false);
    setPages({ pending: [], reviewed: [] });
    setMore({ pending: false, reviewed: false });
    setTotals({ pending: null, reviewed: null });
    setExtra(null);
    setLoadedFor(null);
    pagesScope.current = null;
  }, [scope]);
  const showMore = async () => {
    const last = pages[tab][pages[tab].length - 1];
    if (!bandId || !last || loadingMore || pagesScope.current !== scope) return;
    const forScope = scope;
    const forTab = tab;
    setLoadingMore(true);
    const { data, error } = await listSongSuggestions(bandId, { ...mine, status: STATUS[forTab], limit: PAGE + 1, before: last });
    // The user moved to another band meanwhile: drop it.
    if (scopeRef.current !== forScope || pagesScope.current !== forScope) return;
    setLoadingMore(false);
    if (error || !data) {
      setLoadError(userMessage(error, t('Could not load the suggestions.')));
      return;
    }
    const page = data.slice(0, PAGE);
    setPages((prev) => ({ ...prev, [forTab]: [...prev[forTab], ...page.filter((s) => !prev[forTab].some((x) => x.id === s.id))] }));
    setMore((prev) => ({ ...prev, [forTab]: data.length > PAGE }));
    void loadSongs(page);
  };

  const items = React.useMemo(() => {
    if (!loadedFor) return null;
    // One row per suggestion: a page loaded later can hold one already shown
    // in the other tab (reviewed meanwhile). Its latest status wins: a
    // review only ever moves it out of pending.
    const byId = new Map<string, SongSuggestion>();
    for (const s of [...pages.pending, ...pages.reviewed, ...(extra ? [extra] : [])]) {
      const seen = byId.get(s.id);
      if (!seen || (seen.status === 'pending' && s.status !== 'pending')) byId.set(s.id, s);
    }
    return [...byId.values()];
  }, [pages, extra, loadedFor]);

  React.useEffect(() => {
    if (!open) return;
    setSelectedId(screen?.suggestionId ?? null);
    setTab('pending');
  }, [open, screen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opening (also again, from a notification), another band: (re)load.
  React.useEffect(() => {
    if (open) void load();
  }, [open, screen, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // A suggestion arrives or is reviewed elsewhere: refresh.
  React.useEffect(() => {
    if (!open || !bandId) return;
    const reload = () => void load();
    window.addEventListener(SUGGESTIONS_CHANGED, reload);
    const ch = supabase
      .channel(`song-suggestions:${bandId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'song_suggestions', filter: `band_id=eq.${bandId}` }, reload)
      .subscribe();
    return () => {
      window.removeEventListener(SUGGESTIONS_CHANGED, reload);
      void supabase.removeChannel(ch);
    };
  }, [open, bandId, load]);

  const selected = items?.find((s) => s.id === selectedId) ?? null;
  // Opened from a notification on a suggestion that is no longer listed (once
  // the items were loaded for it: before that it is still being fetched).
  React.useEffect(() => {
    if (!items || !selectedId || loadedFor?.focus !== focusId) return;
    if (!items.some((s) => s.id === selectedId)) setSelectedId(null);
  }, [items, selectedId, loadedFor, focusId]);

  const back = () => {
    if (selected) setSelectedId(null);
    else closeSongSuggestions();
  };
  useSystemBack(open, () => {
    back();
    return true;
  });

  const pending = (items || []).filter((s) => s.status === 'pending');
  const reviewed = (items || []).filter((s) => s.status !== 'pending');
  const shown = tab === 'pending' ? pending : reviewed;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="song-suggestions"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.3, ease: 'easeOut' }}
          // Laptop pose: a form that scrolls as one (`.bw-fold-form`): its
          // header (the first child) holds the Display and the review
          // scrolls on the Deck, so nothing rests across the fold.
          className="bw-pane-detail bw-fold-form fixed inset-0 z-[74] bg-background text-foreground flex flex-col overflow-y-auto overflow-x-hidden"
          style={{ overscrollBehaviorX: 'none', touchAction: 'pan-y' }}
          role="dialog"
          aria-label={t('Suggestions')}
        >
          {selected ? (
            <SuggestionDetail
              key={selected.id}
              s={selected}
              song={selected.song_id ? songs[selected.song_id] : undefined}
              isAdmin={isAdmin}
              isMine={selected.created_by === user?.id}
              onBack={back}
              onDone={() => void load()}
            />
          ) : (
            <>
              <ScreenHeader
                pane
                onBack={back}
                overline={selectedBand?.name}
                title={isAdmin ? t('Suggestions') : t('My suggestions')}
                titleSize="h1"
              >
                <div className="flex flex-wrap gap-2 pb-1" role="group" aria-label={isAdmin ? t('Suggestions') : t('My suggestions')}>
                  <Selector size="md" selected={tab === 'pending'} onClick={() => setTab('pending')} count={totals.pending ?? pending.length}>
                    {t('Waiting')}
                  </Selector>
                  <Selector size="md" selected={tab === 'reviewed'} onClick={() => setTab('reviewed')} count={totals.reviewed ?? reviewed.length}>
                    {t('Reviewed')}
                  </Selector>
                </div>
              </ScreenHeader>
              <div className="flex flex-col gap-3 px-4 pt-3 w-full" style={{ paddingBottom: 'calc(var(--safe-bottom) + 32px)' }}>
                {loadError && <FormError>{loadError}</FormError>}
                {items && shown.length === 0 && (
                  <Card className="items-center text-center py-10 gap-3">
                    <StickyNote className="w-9 h-9 text-muted-foreground" />
                    <p className="bw-body-md text-muted-foreground max-w-sm">
                      {tab === 'pending'
                        ? isAdmin
                          ? t('Nothing to review. Members’ suggestions for songs appear here.')
                          : t('Nothing waiting. In the repertoire, open a song’s menu and choose Suggest a change.')
                        : t('No reviewed suggestions yet.')}
                    </p>
                  </Card>
                )}
                {shown.map((s) => (
                  <ListRow
                    key={s.id}
                    icon={KIND_ICON[s.kind]}
                    title={s.song_title || t('Song')}
                    subtitle={[kindLabel(s.kind, t), isAdmin ? personName(s.author || {}, t('Member')) : null, shortDate(s.created_at)].filter(Boolean).join(' · ')}
                    trailing={s.status !== 'pending' ? <StatusTag status={s.status} /> : undefined}
                    onClick={() => setSelectedId(s.id)}
                  />
                ))}
                {items && more[tab] && (
                  <PillButton size="md" variant="outline" loading={loadingMore} onClick={() => void showMore()}>
                    {t('Load older suggestions')}
                  </PillButton>
                )}
              </div>
            </>
          )}
          <span ref={raiseAboveOpenPanes} hidden aria-hidden />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

/** Suggestions per page, in each tab. */
const PAGE = 100;
/** Song ids per request (URL length). */
const SONG_CHUNK = 100;
type Tab = 'pending' | 'reviewed';
const STATUS: Record<Tab, SuggestionStatus | SuggestionStatus[]> = {
  pending: 'pending',
  reviewed: ['accepted', 'accepted_edited', 'rejected'],
};
/** `a` comes after `b` in the list (older, or as old with a smaller id). */
const olderThan = (a: Pick<SongSuggestion, 'created_at' | 'id'>, b: Pick<SongSuggestion, 'created_at' | 'id'>) =>
  a.created_at < b.created_at || (a.created_at === b.created_at && a.id < b.id);

const kindLabel = (k: SuggestionKind, t: (s: string) => string) =>
  k === 'new_song' ? t('New song') : k === 'lyrics' ? t('Lyrics correction') : k === 'chords' ? t('Chords correction') : t('Note for the band');

const shortDate = (iso?: string | null) => {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short' }).format(new Date(iso));
  } catch {
    return '';
  }
};

const StatusTag: React.FC<{ status: SuggestionStatus }> = ({ status }) => {
  const t = useT();
  if (status === 'accepted') return <Tag variant="accent">{t('Accepted')}</Tag>;
  if (status === 'accepted_edited') return <Tag variant="accent">{t('Accepted with changes')}</Tag>;
  if (status === 'rejected') return <Tag variant="outline">{t('Not accepted')}</Tag>;
  if (status === 'withdrawn') return <Tag variant="outline">{t('Withdrawn')}</Tag>;
  return <Tag variant="outline">{t('Waiting')}</Tag>;
};

// ───────────────────────────── Detail ─────────────────────────────

type View = 'changes' | 'before' | 'after';

const SuggestionDetail: React.FC<{
  s: SongSuggestion;
  song?: SongRow;
  isAdmin: boolean;
  isMine: boolean;
  onBack: () => void;
  onDone: () => void;
}> = ({ s, song, isAdmin, isMine, onBack, onDone }) => {
  const t = useT();
  const [view, setView] = React.useState<View>('changes');
  const [reason, setReason] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [edited, setEdited] = React.useState('');
  const [busy, setBusy] = React.useState<null | 'accept' | 'edit' | 'reject' | 'withdraw'>(null);
  const [confirmWithdraw, setConfirmWithdraw] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editSong, setEditSong] = React.useState(false);

  const pending = s.status === 'pending';
  const canReview = isAdmin && pending;
  const author = personName(s.author || {}, t('Member'));
  const changedSince = pending && songChangedSince(s, song);

  // What the song has now, and what it would have.
  const text = React.useMemo(() => {
    if (s.kind === 'lyrics' || s.kind === 'chords') {
      const before = pending ? song?.lyrics ?? s.original?.lyrics ?? '' : s.original?.lyrics ?? '';
      const after = s.status === 'accepted_edited' && s.applied && 'lyrics' in s.applied ? s.applied.lyrics ?? '' : s.proposed.lyrics ?? before;
      return { before, after };
    }
    if (s.kind === 'note') {
      const before = pending ? song?.notes ?? '' : s.original?.notes ?? '';
      const after =
        s.status === 'accepted_edited' && s.applied && 'notes' in s.applied ? s.applied.notes ?? '' : notesWithNote(before, s.proposed.note || '');
      return { before, after };
    }
    return null;
  }, [s, song, pending]);
  const isLyrics = s.kind === 'lyrics' || s.kind === 'chords';
  // Voice part markers never show: compare and show the words.
  const words = (v: string | undefined) => (isLyrics ? stripVoiceMarkers(v) : v ?? '');
  const diff = React.useMemo(() => (text ? diffLines(words(text.before), words(text.after)) : []), [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const editedField = useVoiceSafeText(edited, setEdited);
  const hasChartChange = !!s.proposed.chord_chart;

  const run = async (kind: 'accept' | 'edit' | 'reject') => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    // Accepting as it is keeps the voice parts the song has now (marked after the suggestion was sent).
    const kept = kind === 'accept' && isLyrics && text && s.proposed.lyrics != null ? keepVoiceParts(text.before, s.proposed.lyrics) : null;
    const applied =
      kind === 'edit' && text
        ? s.kind === 'note'
          ? { notes: edited }
          : { lyrics: edited, ...(s.proposed.chord_chart ? { chord_chart: s.proposed.chord_chart } : {}) }
        : kept != null && kept !== s.proposed.lyrics
          ? { lyrics: kept, ...(s.proposed.chord_chart ? { chord_chart: s.proposed.chord_chart } : {}) }
          : undefined;
    const { error: e } = await reviewSongSuggestion(s, kind === 'reject' ? 'reject' : 'accept', {
      reason,
      applied,
      edited: kind === 'edit',
      song: song ? { audio_url: song.audio_url, chart_url: song.chart_url } : null,
    });
    setBusy(null);
    if (e) return setError(userMessage(e, t('Could not save the review.')));
    setEditing(false);
    onDone();
  };

  const withdraw = async () => {
    if (busy) return;
    setBusy('withdraw');
    setError(null);
    const { error: e } = await withdrawSongSuggestion(s.id);
    setBusy(null);
    if (e) return setError(userMessage(e, t('Could not withdraw the suggestion.')));
    onDone();
    onBack();
  };

  const startEdit = () => {
    if (s.kind === 'new_song') {
      setEditSong(true);
      return;
    }
    setEdited(isLyrics && text ? keepVoiceParts(text.before, text.after) : text?.after ?? '');
    setEditing(true);
  };

  return (
    <>
      <ScreenHeader pane onBack={onBack} overline={kindLabel(s.kind, t)} title={s.song_title || t('Song')} titleSize="h1" />
      <div className="flex flex-col gap-4 px-4 pt-2 w-full" style={{ paddingBottom: 'calc(var(--safe-bottom) + 32px)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="bw-body-sm text-muted-foreground">
            {isMine ? t('You suggested this · {date}', { date: shortDate(s.created_at) }) : t('{name} suggested this · {date}', { name: author, date: shortDate(s.created_at) })}
          </span>
          <StatusTag status={s.status} />
        </div>

        {s.message && (
          <Card className="gap-1">
            <span className="bw-label-sm text-muted-foreground">{t('Message')}</span>
            <p className="bw-body-md whitespace-pre-wrap [overflow-wrap:anywhere]">{s.message}</p>
          </Card>
        )}

        {s.kind === 'note' && (
          <Card className="gap-1">
            <span className="bw-label-sm text-muted-foreground">{t('Note for the band')}</span>
            <p className="bw-body-md whitespace-pre-wrap [overflow-wrap:anywhere]">{s.proposed.note}</p>
          </Card>
        )}

        {changedSince && (
          <p className="flex items-start gap-2 bw-body-sm text-muted-foreground" role="note">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {t('The song changed after this suggestion: you are comparing with its current version.')}
          </p>
        )}

        {s.kind === 'new_song' ? (
          <NewSongSummary song={song} />
        ) : editing ? (
          <label className="flex flex-col gap-2 p-4 rounded-[24px] bg-field border border-border focus-within:border-2 focus-within:border-foreground transition-[border-color]">
            <span className="bw-label-sm text-muted-foreground">{s.kind === 'note' ? t('Song notes after your changes') : t('Text after your changes')}</span>
            <textarea
              {...editedField}
              rows={12}
              spellCheck={false}
              className="w-full bg-transparent outline-none text-foreground min-h-[220px] resize-y font-mono text-[15px] leading-6"
            />
          </label>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('Before and after')}>
              <Selector size="md" selected={view === 'changes'} onClick={() => setView('changes')}>{t('Changes')}</Selector>
              <Selector size="md" selected={view === 'before'} onClick={() => setView('before')}>{t('Before')}</Selector>
              <Selector size="md" selected={view === 'after'} onClick={() => setView('after')}>{t('After')}</Selector>
            </div>
            {view === 'changes' ? (
              <DiffView diff={diff} />
            ) : (
              <pre className="rounded-[24px] bg-card text-card-foreground p-4 font-mono text-[14px] leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {words(view === 'before' ? text?.before : text?.after) || <span className="text-muted-foreground">{t('Empty')}</span>}
              </pre>
            )}
            {hasChartChange && <p className="bw-body-sm text-muted-foreground">{t('Also replaces the song’s chord chart.')}</p>}
          </>
        )}

        {!pending && s.reason && (
          <Card className="gap-1">
            <span className="bw-label-sm text-muted-foreground">
              {t('Reason from {name}', { name: personName(s.reviewer || {}, t('the admin')) })}
            </span>
            <p className="bw-body-md whitespace-pre-wrap [overflow-wrap:anywhere]">{s.reason}</p>
          </Card>
        )}

        {canReview && (
          <>
            <label className="flex flex-col gap-2 p-4 rounded-[24px] bg-field border border-border focus-within:border-2 focus-within:border-foreground transition-[border-color]">
              <span className="bw-label-sm text-muted-foreground">{t('Reason (optional, {name} will see it)', { name: author })}</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder={t('e.g. Thanks, we’ll try it at the next rehearsal')}
                className="w-full bg-transparent outline-none bw-body-lg text-foreground placeholder:text-muted-foreground/60 min-h-[56px] resize-none"
              />
            </label>
            {error && <FormError>{error}</FormError>}
            {/* Wraps on the real width: in the iPad/Duo pane a viewport breakpoint squeezed three labels into one row. */}
            <div className="flex flex-wrap gap-2 [&>*]:flex-[1_1_13rem]">
              {editing ? (
                <>
                  <PillButton size="md" icon={<Check className="w-4 h-4" />} onClick={() => void run('edit')} loading={busy === 'edit'} disabled={!!busy} className="!flex-[2_1_13rem]">
                    {t('Accept with these changes')}
                  </PillButton>
                  <PillButton size="md" variant="outline" onClick={() => setEditing(false)} disabled={!!busy}>
                    {t('Cancel')}
                  </PillButton>
                </>
              ) : (
                <>
                  <PillButton size="md" icon={<Check className="w-4 h-4" />} onClick={() => void run('accept')} loading={busy === 'accept'} disabled={!!busy || !song}>
                    {t('Accept')}
                  </PillButton>
                  <PillButton size="md" variant="outline" icon={<Edit3 className="w-4 h-4" />} onClick={startEdit} disabled={!!busy || !song}>
                    {t('Accept with changes')}
                  </PillButton>
                  <PillButton size="md" variant="outline" icon={<X className="w-4 h-4" />} onClick={() => void run('reject')} loading={busy === 'reject'} disabled={!!busy}>
                    {t('Reject')}
                  </PillButton>
                </>
              )}
            </div>
          </>
        )}

        {!isAdmin && isMine && pending && (
          <>
            {error && <FormError>{error}</FormError>}
            {/* One tap would withdraw at once: ask first. */}
            {confirmWithdraw ? (
              <div className="flex flex-col gap-3 p-4 rounded-[24px] bg-field border border-border">
                <p className="bw-body-md text-foreground">{t('Withdraw this suggestion? The admins will no longer see it.')}</p>
                <div className="flex flex-wrap gap-2">
                  <PillButton size="md" icon={<RotateCcw className="w-4 h-4" />} onClick={() => void withdraw()} loading={busy === 'withdraw'} disabled={!!busy} fullWidth={false}>
                    {t('Withdraw suggestion')}
                  </PillButton>
                  <PillButton size="md" variant="outline" onClick={() => setConfirmWithdraw(false)} disabled={!!busy} fullWidth={false}>
                    {t('Keep it')}
                  </PillButton>
                </div>
              </div>
            ) : (
              <PillButton size="md" variant="outline" icon={<RotateCcw className="w-4 h-4" />} onClick={() => setConfirmWithdraw(true)} fullWidth={false} className="self-start">
                {t('Withdraw suggestion')}
              </PillButton>
            )}
          </>
        )}
      </div>

      {s.kind === 'new_song' && song && (
        <AddSongModal
          isOpen={editSong}
          onClose={() => setEditSong(false)}
          bandId={song.band_id}
          song={song as unknown as Song}
          onSongAdded={() => {
            setEditSong(false);
            void run('edit');
          }}
        />
      )}
    </>
  );
};

const DiffView: React.FC<{ diff: DiffLine[] }> = ({ diff }) => {
  const t = useT();
  const hunks = diffHunks(diff, 2);
  if (!diff.some((d) => d.op !== 'same')) {
    return <p className="bw-body-sm text-muted-foreground">{t('No differences from the current version.')}</p>;
  }
  return (
    <div className="rounded-[24px] bg-card text-card-foreground p-3 font-mono text-[14px] leading-6 overflow-x-auto" aria-label={t('Changes')}>
      {hunks.map((h, i) =>
        h === null ? (
          <div key={`gap-${i}`} className="px-2 text-muted-foreground select-none" aria-hidden>
            ⋯
          </div>
        ) : (
          <div
            key={i}
            className={cn(
              'flex gap-2 px-2 rounded-lg whitespace-pre-wrap [overflow-wrap:anywhere]',
              h.op === 'add' && 'bg-accent/25',
              h.op === 'del' && 'text-muted-foreground line-through decoration-1',
            )}
          >
            <span className="w-3 shrink-0 select-none" aria-label={h.op === 'add' ? t('Added') : h.op === 'del' ? t('Removed') : undefined}>
              {h.op === 'add' ? '+' : h.op === 'del' ? '−' : ' '}
            </span>
            <span className="min-w-0">{h.text || ' '}</span>
          </div>
        ),
      )}
    </div>
  );
};

const NewSongSummary: React.FC<{ song?: SongRow }> = ({ song }) => {
  const t = useT();
  if (!song) return <p className="bw-body-sm text-muted-foreground">{t('This song is no longer in the repertoire.')}</p>;
  const facts = [
    song.artist,
    song.key ? t('Key {key}', { key: song.key }) : null,
    song.bpm ? `${song.bpm} BPM` : null,
    song.duration_seconds ? `${Math.floor(song.duration_seconds / 60)}:${String(song.duration_seconds % 60).padStart(2, '0')}` : null,
  ].filter(Boolean);
  const extras = [
    song.lyrics?.trim() ? t('Lyrics') : null,
    song.chord_chart ? t('Chord chart') : null,
    song.audio_url ? t('Recording') : null,
    song.chart_url ? t('Chart') : null,
    song.youtube_url ? 'YouTube' : null,
  ].filter(Boolean);
  return (
    <Card className="gap-2">
      <span className="bw-h3">{song.title}</span>
      {facts.length > 0 && <span className="bw-body-sm text-muted-foreground">{facts.join(' · ')}</span>}
      {extras.length > 0 && <span className="bw-body-sm">{t('Includes: {list}', { list: extras.join(', ') })}</span>}
      {song.notes?.trim() && <p className="bw-body-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{song.notes}</p>}
    </Card>
  );
};
