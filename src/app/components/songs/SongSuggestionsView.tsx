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
  listSongSuggestions,
  reviewSongSuggestion,
  SUGGESTIONS_CHANGED,
  useSongSuggestionsScreen,
  withdrawSongSuggestion,
} from '@/lib/services/songSuggestions';

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

  const [tab, setTab] = React.useState<'pending' | 'reviewed'>('pending');
  const [items, setItems] = React.useState<SongSuggestion[] | null>(null);
  const [songs, setSongs] = React.useState<Record<string, SongRow>>({});
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!bandId || !user?.id) return;
    const { data, error } = await listSongSuggestions(bandId, isAdmin ? {} : { createdBy: user.id });
    if (error || !data) {
      setLoadError(userMessage(error, t('Could not load the suggestions.')));
      return;
    }
    setLoadError(null);
    setItems(data.filter((s) => s.status !== 'withdrawn'));
    const ids = [...new Set(data.map((s) => s.song_id).filter((id): id is string => !!id))];
    if (ids.length) {
      const { data: rows } = await supabase
        .from('songs')
        .select('id, band_id, title, artist, key, bpm, duration_seconds, status, lyrics, notes, audio_url, chart_url, youtube_url, genre, chord_chart, created_at, updated_at, priority')
        .in('id', ids);
      setSongs(Object.fromEntries(((rows || []) as SongRow[]).map((r) => [r.id, r])));
    } else setSongs({});
  }, [bandId, user?.id, isAdmin, t]);

  React.useEffect(() => {
    if (!open) return;
    setSelectedId(screen?.suggestionId ?? null);
    setTab('pending');
    void load();
  }, [open, screen]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Opened from a notification on a suggestion that is no longer listed.
  React.useEffect(() => {
    if (items && selectedId && !items.some((s) => s.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

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
          className="bw-pane-detail fixed inset-0 z-[74] bg-background text-foreground flex flex-col overflow-y-auto overflow-x-hidden"
          style={{ overscrollBehaviorX: 'none', touchAction: 'pan-y' }}
          role="dialog"
          aria-label={t('Suggestions')}
        >
          <span ref={raiseAboveOpenPanes} hidden aria-hidden />
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
                <div className="flex flex-wrap gap-2 pb-1" role="tablist">
                  <Selector size="md" selected={tab === 'pending'} onClick={() => setTab('pending')} count={pending.length}>
                    {t('Waiting')}
                  </Selector>
                  <Selector size="md" selected={tab === 'reviewed'} onClick={() => setTab('reviewed')} count={reviewed.length}>
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
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

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
  const diff = React.useMemo(() => (text ? diffLines(text.before, text.after) : []), [text]);
  const hasChartChange = !!s.proposed.chord_chart;

  const run = async (kind: 'accept' | 'edit' | 'reject') => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    const applied =
      kind === 'edit' && text
        ? s.kind === 'note'
          ? { notes: edited }
          : { lyrics: edited, ...(s.proposed.chord_chart ? { chord_chart: s.proposed.chord_chart } : {}) }
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
    setEdited(text?.after ?? '');
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
              value={edited}
              onChange={(e) => setEdited(e.target.value)}
              rows={12}
              spellCheck={false}
              className="w-full bg-transparent outline-none text-foreground min-h-[220px] resize-y font-mono text-[15px] leading-6"
            />
          </label>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('Before and after')}>
              <Selector size="md" selected={view === 'changes'} onClick={() => setView('changes')}>{t('Changes')}</Selector>
              <Selector size="md" selected={view === 'before'} onClick={() => setView('before')}>{t('Before')}</Selector>
              <Selector size="md" selected={view === 'after'} onClick={() => setView('after')}>{t('After')}</Selector>
            </div>
            {view === 'changes' ? (
              <DiffView diff={diff} />
            ) : (
              <pre className="rounded-[24px] bg-card text-card-foreground p-4 font-mono text-[14px] leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {(view === 'before' ? text?.before : text?.after) || <span className="text-muted-foreground">{t('Empty')}</span>}
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
            <div className="flex flex-wrap gap-2 [&>*]:flex-1 [&>*]:min-w-[11rem]">
              {editing ? (
                <>
                  <PillButton size="md" icon={<Check className="w-4 h-4" />} onClick={() => void run('edit')} loading={busy === 'edit'} disabled={!!busy} className="!flex-[2]">
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
    song.chord_chart ? t('Chords') : null,
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
