import React from 'react';
import { BwSheet } from '@/app/components/bw/Screen';
import { FormError, PillButton, PillField, Selector } from '@/app/components/bw';
import { BookOpen, CheckCircle2, Send, StickyNote } from '@/app/components/icons';
import { useT } from '@/lib/i18n';
import { userMessage } from '@/lib/userError';
import { correctionKind, diffLines } from '@/lib/songSuggestions';
import {
  closeSuggestChange,
  suggestSongChange,
  useSuggestChangeTarget,
} from '@/lib/services/songSuggestions';

/**
 * A member suggests a change to a band song (108): a correction to the lyrics
 * or chords (the same text as the song, chords inline), or a note for the
 * whole band. The admin reviews it; the band's song stays the same for
 * everyone until then. Mounted once (AuthenticatedApp) and opened with
 * openSuggestChange(song).
 */
export const SuggestSongChangeSheet: React.FC = () => {
  const t = useT();
  const song = useSuggestChangeTarget();
  const [mode, setMode] = React.useState<'text' | 'note'>('text');
  const [text, setText] = React.useState('');
  const [note, setNote] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const sentTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => {
    if (!song) return;
    setMode(song.start ?? 'text');
    setText(song.lyrics || '');
    setNote('');
    setMessage('');
    setError(null);
    setSent(false);
  }, [song]);
  React.useEffect(() => () => clearTimeout(sentTimer.current), []);

  const kind = song ? correctionKind(song.lyrics, text) : null;
  // Lines touched: a changed line counts once (removed + added).
  const lines = React.useMemo(() => {
    if (!song || !kind) return 0;
    const d = diffLines(song.lyrics, text);
    return Math.max(d.filter((x) => x.op === 'add').length, d.filter((x) => x.op === 'del').length);
  }, [song, kind, text]);
  const canSend = mode === 'text' ? !!kind : note.trim().length > 0;

  const close = () => {
    if (busy) return;
    clearTimeout(sentTimer.current);
    closeSuggestChange();
  };

  const send = async () => {
    if (!song || !canSend || busy) return;
    setBusy(true);
    setError(null);
    const { error: e } =
      mode === 'text'
        ? await suggestSongChange({ bandId: song.band_id, songId: song.id, kind: kind!, lyrics: text, message })
        : await suggestSongChange({ bandId: song.band_id, songId: song.id, kind: 'note', note });
    setBusy(false);
    if (e) {
      setError(userMessage(e, t('Could not send the suggestion.')));
      return;
    }
    setSent(true);
    sentTimer.current = setTimeout(() => closeSuggestChange(), 1600);
  };

  const status =
    mode !== 'text'
      ? null
      : !kind
        ? t('Change the text above: your version goes to the band admin.')
        : kind === 'chords'
          ? lines === 1 ? t('Chords changed on 1 line') : t('Chords changed on {count} lines', { count: lines })
          : lines === 1 ? t('Lyrics changed on 1 line') : t('Lyrics changed on {count} lines', { count: lines });

  return (
    <BwSheet
      open={!!song}
      onClose={close}
      overline={t('Suggest to the band')}
      title={song?.title || ''}
      closeLabel={t('Close')}
      zIndex={160}
      portal
      footer={
        sent ? (
          <p className="flex items-center justify-center gap-2 bw-label-md min-h-14" role="status">
            <CheckCircle2 className="w-5 h-5" /> {t('Sent to the admin')}
          </p>
        ) : (
          <PillButton icon={<Send className="w-4 h-4" />} onClick={send} disabled={!canSend} loading={busy}>
            {t('Send suggestion')}
          </PillButton>
        )
      }
    >
      <div className="dark flex flex-col gap-4">
        <p className="bw-body-sm text-muted-foreground">
          {t('The band’s song stays the same for everyone until the admin accepts your suggestion.')}
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('What do you want to suggest?')}>
          <Selector size="md" selected={mode === 'text'} onClick={() => setMode('text')}>
            {t('Lyrics or chords')}
          </Selector>
          <Selector size="md" selected={mode === 'note'} onClick={() => setMode('note')}>
            {t('Note for the band')}
          </Selector>
        </div>

        {mode === 'text' ? (
          <>
            <label className="flex flex-col gap-2 p-4 rounded-[24px] bg-field border border-border focus-within:border-2 focus-within:border-foreground transition-[border-color]">
              <span className="flex items-center gap-2 bw-label-sm text-muted-foreground">
                <BookOpen className="w-4 h-4" />
                {t('Lyrics with chords')}
              </span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={[`# ${t('Verse 1')}`, `[C]${t('First line…')}`].join('\n')}
                rows={10}
                spellCheck={false}
                className="w-full bg-transparent outline-none text-foreground placeholder:text-muted-foreground/60 min-h-[200px] resize-y font-mono text-[15px] leading-6"
              />
              <span className="bw-body-sm text-muted-foreground">{t('Chords go in brackets before the word: [Am]word.')}</span>
            </label>
            {status && <p className="bw-body-sm text-muted-foreground" aria-live="polite">{status}</p>}
            <PillField
              label={t('Message for the admin (optional)')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              placeholder={t('e.g. The second verse is sung twice')}
            />
          </>
        ) : (
          <label className="flex flex-col gap-2 p-4 rounded-[24px] bg-field border border-border focus-within:border-2 focus-within:border-foreground transition-[border-color]">
            <span className="flex items-center gap-2 bw-label-sm text-muted-foreground">
              <StickyNote className="w-4 h-4" />
              {t('Note for the whole band')}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('e.g. We end on the chorus twice')}
              rows={4}
              maxLength={2000}
              className="w-full bg-transparent outline-none bw-body-lg text-foreground placeholder:text-muted-foreground/60 min-h-[96px] resize-none"
            />
          </label>
        )}
        {error && <FormError>{error}</FormError>}
      </div>
    </BwSheet>
  );
};
