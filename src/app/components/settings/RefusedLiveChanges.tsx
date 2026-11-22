import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import {
  LIVE_REFUSED_EVENT, readRefusedLiveOps, REFUSED_LIMIT, refusedId, refusedKey, removeRefusedLiveOp, restoreRefusedLiveOp,
  type LiveOp, type RefusedLiveOp,
} from '@/lib/liveOutbox';
import { getSongTitles } from '@/lib/services/songs';
import { asSongChart } from '@/lib/ireal';
import { chartSectionChords } from '@/lib/songFormat';

type T = ReturnType<typeof useT>;

/** A chord chart as text: title and key, then each section's bars ("A | Cmaj7 | Am7 D7 |"). */
function chartText(raw: unknown): string | null {
  const chart = asSongChart(raw);
  if (!chart) return null;
  const head = [chart.title, chart.key].filter(Boolean).join(' · ');
  const body = chart.sections.map((s) => `${s.label ? `${s.label} ` : ''}| ${chartSectionChords(s).map((bar) => bar.join(' ')).join(' | ')} |`);
  return [head, ...body, chart.link ?? ''].filter(Boolean).join('\n');
}

/** What the person wrote or did, in words they can copy. `titles`: song id → title, for an order. */
export function refusedText(op: LiveOp, t: T, titles: Record<string, string> = {}): string {
  switch (op.kind) {
    case 'note':
      return op.body;
    case 'noteDelete':
      return t('Deleting one of my notes');
    case 'suggestion': {
      const proposed = (op.row.proposed ?? {}) as { note?: unknown; lyrics?: unknown; chord_chart?: unknown };
      const parts = [proposed.note, proposed.lyrics, chartText(proposed.chord_chart), op.row.message].filter(
        (x): x is string => typeof x === 'string' && !!x.trim(),
      );
      return parts.length ? parts.join('\n\n') : t('A suggestion to the band');
    }
    case 'order': {
      const rows = [...op.rows].sort((a, b) => (a.set_number ?? 1) - (b.set_number ?? 1) || a.position - b.position);
      const named = rows.map((r) => titles[r.song_id]);
      if (!rows.length || named.some((x) => !x)) return t('A new setlist order');
      return [t('A new setlist order'), ...named.map((title, i) => `${i + 1}. ${title}`)].join('\n');
    }
  }
}

/**
 * Changes made on this phone that the server refused for this account (the
 * note was gone, no longer allowed, the setlist changed meanwhile): kept on
 * the phone, never deleted unseen. Copy what you need, then remove them.
 * Settings › Offline & live.
 */
export const RefusedLiveChanges: React.FC<{ userId?: string | null }> = ({ userId }) => {
  const t = useT();
  const [ops, setOps] = useState<RefusedLiveOp[]>(() => readRefusedLiveOps(userId));
  const [copied, setCopied] = useState<string | null>(null);
  /** The clipboard refused (none in this browser, or blocked): said, the text stays selectable. */
  const [copyFailed, setCopyFailed] = useState<string | null>(null);
  /** The change just removed, and where it was: Undo puts it back. */
  const [removed, setRemoved] = useState<{ op: RefusedLiveOp; index: number } | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLUListElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<string | null | 'undo'>(null);

  useEffect(() => {
    const sync = () => setOps(readRefusedLiveOps(userId));
    sync();
    // Another tab changed the list (it removed one, or one more was refused).
    const fromOtherTab = (e: StorageEvent) => {
      if (!userId || e.key === null || e.key === refusedKey(userId)) sync();
    };
    window.addEventListener(LIVE_REFUSED_EVENT, sync);
    window.addEventListener('storage', fromOtherTab);
    return () => {
      window.removeEventListener(LIVE_REFUSED_EVENT, sync);
      window.removeEventListener('storage', fromOtherTab);
    };
  }, [userId]);

  // An order names its songs (best effort: without a connection it says "A new setlist order").
  const orderSongs = ops.flatMap((op) => (op.kind === 'order' ? op.rows.map((r) => r.song_id) : [])).filter((id) => !titles[id]);
  const orderKey = [...new Set(orderSongs)].sort().join(',');
  useEffect(() => {
    if (!orderKey) return;
    let live = true;
    void getSongTitles(orderKey.split(',')).then((found) => {
      if (live && Object.keys(found).length) setTitles((prev) => ({ ...prev, ...found }));
    });
    return () => {
      live = false;
    };
  }, [orderKey]);

  // After Remove: focus on the next change's Copy, or on Undo when none is left.
  useEffect(() => {
    const next = focusAfter.current;
    if (next === null) return;
    focusAfter.current = null;
    if (next === 'undo') undoRef.current?.focus();
    else listRef.current?.querySelector<HTMLButtonElement>(`[data-rid="${CSS.escape(next)}"]`)?.focus();
  });

  if (!userId || (!ops.length && !removed)) return null;

  const copy = async (rid: string, text: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setCopyFailed(null);
      setCopied(rid);
    } catch {
      setCopied(null);
      setCopyFailed(rid);
    }
  };
  const remove = (op: RefusedLiveOp, index: number) => {
    const rid = refusedId(op);
    const next = ops[index + 1] ?? ops[index - 1];
    setCopied(null);
    setCopyFailed(null);
    setRemoved({ op, index });
    focusAfter.current = next ? refusedId(next) : 'undo';
    removeRefusedLiveOp(userId, rid);
    setOps((prev) => prev.filter((o) => refusedId(o) !== rid));
  };
  const undo = () => {
    if (!removed) return;
    restoreRefusedLiveOp(userId, removed.op, removed.index);
    focusAfter.current = refusedId(removed.op);
    setRemoved(null);
    setOps(readRefusedLiveOps(userId));
  };
  const pill = 'flex items-center min-h-11 px-3 rounded-full bw-label-sm whitespace-nowrap border border-border text-foreground';

  return (
    <section aria-label={t('Not sent')} className="bg-card text-card-foreground rounded-[24px] p-4 flex flex-col gap-2 min-w-0">
      {/* Static text: read once as a status, not an alert. */}
      <span className="bw-label-sm" role="status">
        {t("These changes weren't sent: the band didn't accept them. Copy what you need, then remove them.")}
      </span>
      {ops.length >= REFUSED_LIMIT && (
        <span className="bw-body-sm text-destructive">{t('This list is full. Copy and remove some changes so new ones can be kept.')}</span>
      )}
      {/* "Copied" is said out loud, not only drawn on the button. */}
      <span className="sr-only" aria-live="polite">
        {copied ? t('Change copied.') : ''}
      </span>
      {removed && (
        <span className="flex flex-wrap items-center gap-2">
          <span className="bw-body-sm text-muted-foreground" aria-live="polite">{t('Change removed.')}</span>
          <button ref={undoRef} type="button" className={pill} onClick={undo}>
            {t('Undo')}
          </button>
        </span>
      )}
      <ul ref={listRef} className="flex flex-col">
        {ops.map((op, i) => {
          const rid = refusedId(op);
          const text = refusedText(op, t, titles);
          const short = text.length > 60 ? `${text.slice(0, 59)}…` : text;
          return (
            <li key={rid} className={cn('flex flex-col gap-2 py-2 border-b border-border last:border-b-0 min-w-0')}>
              <span className="bw-body-sm whitespace-pre-wrap break-words select-text">{text}</span>
              <span className="flex flex-wrap gap-2">
                <button type="button" data-rid={rid} className={pill} aria-label={t('Copy change: {change}', { change: short })} onClick={() => void copy(rid, text)}>
                  {copied === rid ? t('Copied') : t('Copy')}
                </button>
                <button type="button" className={pill} aria-label={t('Remove change: {change}', { change: short })} onClick={() => remove(op, i)}>
                  {t('Remove')}
                </button>
              </span>
              <span className="bw-body-sm text-destructive" aria-live="polite">
                {copyFailed === rid ? t('Couldn’t copy this change. Select the text and copy it yourself.') : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
