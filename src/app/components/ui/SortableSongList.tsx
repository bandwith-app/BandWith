import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from '@/app/components/icons';
import { IconButton } from '@/app/components/bw/Screen';
import { cn } from '@/app/components/ui/utils';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { moveSongBy, moveSongTo, playNumber, projectedOrder } from '@/lib/setlistOrder';

/**
 * A set's songs in play order (01, 02, …). For the band admin each row can
 * be reordered:
 * - touch / Apple Pencil: long-press the row (~0.4 s, haptic tick), then drag;
 *   a quick swipe still scrolls the page;
 * - mouse: drag the row;
 * - keyboard: focus the grip and press the up/down arrows.
 * The dragged row is drawn in an overlay portalled to <body> (a fixed layer
 * inside a scrolling box gets clipped in WKWebView), above the z-100 edit
 * sheets and below the Duo rail (z-190). The list auto-scrolls near its
 * scroll area's edges. Members get the same rows without any of this.
 */
export interface SortableSong {
  uid: string;
  title?: string;
  artist?: string;
}

interface SortableSongListProps<S extends SortableSong> {
  songs: S[];
  /** Play number of the first song (numbers run across sets). */
  startNumber?: number;
  canReorder: boolean;
  onReorder?: (songs: S[]) => void;
  onRemove?: (uid: string) => void;
  /** Accessible name of the list, e.g. the set name. */
  label?: string;
  className?: string;
  /** Called with the old and new index of a moved song (instead of onReorder's full list). */
  onMove?: (from: number, to: number) => void;
  /** Custom row content (number, title, details); the default is number, title and artist. */
  renderRow?: (song: S, row: { index: number; number: string; overlay: boolean }) => React.ReactNode;
  /** Tap on a row (ignored right after a drag). */
  onRowClick?: (song: S, index: number) => void;
  /** Accessible name of a row's tap target. */
  rowLabel?: (song: S, index: number) => string;
  /** A control at the end of a row (before the grip), e.g. Stage mode's strike-off. */
  rowAction?: (song: S, index: number) => React.ReactNode;
  /** The row playing now (aria-current). */
  isCurrent?: (song: S, index: number) => boolean;
  /** Extra classes for every row. */
  rowClassName?: string;
  /** 'stage': white on black, for Stage mode. */
  tone?: 'default' | 'stage';
}

const LONG_PRESS_MS = 400;
/** Overlay layer: above full-screen sheets (z-100), under the Duo rail (z-190). */
const OVERLAY_Z = 150;

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const SongRowBody: React.FC<{ number: string; title: string; artist?: string }> = ({ number, title, artist }) => (
  <>
    <span className="bw-label-sm text-muted-foreground min-w-5 shrink-0 tabular-nums">{number}</span>
    <span className="flex-1 min-w-0 flex flex-col">
      <span className="bw-body-md text-foreground truncate">{title}</span>
      {artist && <span className="bw-label-xs text-muted-foreground truncate mt-1">{artist}</span>}
    </span>
  </>
);

const ROW = 'relative flex items-center gap-3 min-h-11 min-w-0 rounded-[12px] pl-1';
/** A click this soon after a drop is the drop itself, not a tap. */
const CLICK_AFTER_DROP_MS = 350;

interface RowView {
  body: React.ReactNode;
  onClick?: () => void;
  label?: string;
  current?: boolean;
  /** Custom content: roomier rows (Stage mode). */
  custom?: boolean;
}

/** The row's content: a button when the row can be tapped. */
const RowContent: React.FC<{ view: RowView }> = ({ view }) =>
  view.onClick ? (
    <button
      type="button"
      onClick={view.onClick}
      aria-label={view.label}
      aria-current={view.current ? 'true' : undefined}
      className={cn('flex flex-1 min-w-0 items-center text-left', view.custom ? 'gap-4 py-3' : 'gap-3 py-2')}
    >
      {view.body}
    </button>
  ) : (
    <span className={cn('flex flex-1 min-w-0 items-center', view.custom ? 'gap-4 py-3' : 'gap-3')}>{view.body}</span>
  );

function SortableRow({
  song,
  title,
  view,
  canReorder,
  describedBy,
  onRemove,
  onKeyMove,
  handleRef,
  rowClassName,
  stage,
  action,
}: {
  action?: React.ReactNode;
  song: SortableSong;
  title: string;
  view: RowView;
  canReorder: boolean;
  describedBy: string;
  onRemove?: () => void;
  onKeyMove: (delta: number) => void;
  handleRef: (el: HTMLButtonElement | null) => void;
  rowClassName?: string;
  stage?: boolean;
}) {
  const t = useT();
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: song.uid,
    disabled: !canReorder,
  });
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <li
      ref={setNodeRef}
      {...(canReorder ? listeners : {})}
      onContextMenu={canReorder ? (e) => e.preventDefault() : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        ROW,
        canReorder &&
          cn(
            'select-none [-webkit-touch-callout:none] cursor-grab transition-colors duration-300',
            stage ? 'active:bg-white/[0.06]' : 'active:bg-foreground/[0.06]'
          ),
        rowClassName,
        isDragging && 'opacity-30'
      )}
    >
      <RowContent view={view} />
      {action && (
        <span className="shrink-0 flex" onMouseDown={stop} onTouchStart={stop} onPointerDown={stop}>
          {action}
        </span>
      )}
      {onRemove && (
        <IconButton
          label={t('Remove song')}
          variant="ghost"
          size="sm"
          icon={<X />}
          className="w-8 h-8 -my-1 shrink-0"
          onMouseDown={stop}
          onTouchStart={stop}
          onClick={onRemove}
        />
      )}
      {canReorder && (
        <button
          ref={handleRef}
          type="button"
          aria-label={t('Reorder {title}', { title })}
          aria-describedby={describedBy}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              onKeyMove(e.key === 'ArrowUp' ? -1 : 1);
            }
          }}
          className={cn(
            'w-8 h-11 -mr-1 flex items-center justify-center shrink-0 rounded-full cursor-grab focus-visible:outline-2',
            stage ? 'text-white/50 focus-visible:outline-white' : 'text-muted-foreground focus-visible:outline-foreground'
          )}
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}
    </li>
  );
}

export function SortableSongList<S extends SortableSong>({
  songs,
  startNumber = 1,
  canReorder,
  onReorder,
  onRemove,
  label,
  className,
  onMove,
  renderRow,
  onRowClick,
  rowLabel,
  rowAction,
  isCurrent,
  rowClassName,
  tone = 'default',
}: SortableSongListProps<S>) {
  const t = useT();
  const stage = tone === 'stage';
  const droppedAt = useRef(0);
  const instructionsId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  // Android WebView: a finger held still on the lifted row fires a context
  // menu on the drag overlay (portaled to <body>, outside the rows that block
  // it), and that cancels the touch, dropping the song. While a drag is on,
  // no context menu anywhere.
  useEffect(() => {
    if (!activeId) return;
    const block = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', block, true);
    return () => document.removeEventListener('contextmenu', block, true);
  }, [activeId]);
  const [overId, setOverId] = useState<string | null>(null);
  const [liveText, setLiveText] = useState('');
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: LONG_PRESS_MS, tolerance: 8 } })
  );

  const uids = useMemo(() => songs.map((s) => s.uid), [songs]);
  const order = useMemo(() => projectedOrder(uids, activeId, overId), [uids, activeId, overId]);
  const numberOf = (uid: string) => playNumber(startNumber + Math.max(0, order.indexOf(uid)));
  const titleOf = useCallback(
    (uid: string | number | null | undefined) => {
      const s = songs.find((x) => x.uid === uid);
      return s?.title || t('Untitled song');
    },
    [songs, t]
  );
  const positionOf = (uid: string, list: string[]) => list.indexOf(uid) + 1;

  // Keyboard moves re-render the list; keep focus on the moved song's grip.
  useEffect(() => {
    const uid = refocus.current;
    if (!uid) return;
    refocus.current = null;
    const el = handles.current.get(uid);
    if (el && document.activeElement !== el) el.focus();
  }, [songs]);

  /** Applies a move: onMove gets the indices, onReorder the new list. */
  const apply = (next: S[], uid: string) => {
    if (onMove) onMove(songs.findIndex((s) => s.uid === uid), next.findIndex((s) => s.uid === uid));
    else onReorder?.(next);
  };

  const keyMove = (uid: string, delta: number) => {
    const next = moveSongBy(songs, uid, delta);
    if (next === songs) return;
    refocus.current = uid;
    apply(next, uid);
    haptic.selection();
    setLiveText(
      t('{title} moved to position {position} of {total}', {
        title: titleOf(uid),
        position: next.findIndex((s) => s.uid === uid) + 1,
        total: next.length,
      })
    );
  };

  const reset = () => {
    setActiveId(null);
    setOverId(null);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setOverId(String(active.id));
    haptic.pickUp();
  };
  const onDragOver = ({ over }: DragOverEvent) => {
    const next = over ? String(over.id) : null;
    if (next && next !== overId) haptic.dragTick();
    setOverId(next);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    reset();
    haptic.drop();
    droppedAt.current = Date.now();
    if (over && active.id !== over.id) apply(moveSongTo(songs, String(active.id), String(over.id)), String(active.id));
  };
  const onDragCancel = () => {
    reset();
    haptic.drop();
    droppedAt.current = Date.now();
  };

  const viewOf = (song: S, index: number, number: string, overlay = false): RowView => ({
    body: renderRow ? (
      renderRow(song, { index, number, overlay })
    ) : (
      <SongRowBody number={number} title={song.title || t('Untitled song')} artist={song.artist} />
    ),
    label: rowLabel?.(song, index),
    current: isCurrent?.(song, index),
    custom: !!renderRow,
    onClick:
      onRowClick && !overlay
        ? () => {
            if (Date.now() - droppedAt.current < CLICK_AFTER_DROP_MS) return;
            onRowClick(song, index);
          }
        : undefined,
  });

  const announcements: Announcements = {
    onDragStart: ({ active }) => t('Picked up {title}', { title: titleOf(active.id as string) }),
    onDragOver: ({ active, over }) =>
      over
        ? t('{title} moved to position {position} of {total}', {
            title: titleOf(active.id as string),
            position: positionOf(String(over.id), uids),
            total: uids.length,
          })
        : undefined,
    onDragEnd: ({ active, over }) =>
      t('{title} moved to position {position} of {total}', {
        title: titleOf(active.id as string),
        position: positionOf(String(over?.id ?? active.id), uids),
        total: uids.length,
      }),
    onDragCancel: ({ active }) => t('Reordering cancelled: {title} stays where it was', { title: titleOf(active.id as string) }),
  };

  const activeSong = activeId ? songs.find((s) => s.uid === activeId) : undefined;

  if (!canReorder) {
    return (
      <ol aria-label={label} className={cn('flex flex-col', className)}>
        {songs.map((song, i) => (
          <li key={song.uid} className={cn(ROW, rowClassName)}>
            <RowContent view={viewOf(song, i, playNumber(startNumber + i))} />
            {rowAction && <span className="shrink-0 flex">{rowAction(song, i)}</span>}
            {onRemove && (
              <IconButton
                label={t('Remove song')}
                variant="ghost"
                size="sm"
                icon={<X />}
                className="w-8 h-8 -my-1 shrink-0"
                onClick={() => onRemove(song.uid)}
              />
            )}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      autoScroll={{ threshold: { x: 0, y: 0.15 }, acceleration: 12 }}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t('Long-press a song and drag it to change the order. With a keyboard, focus the grip and use the up and down arrow keys.') },
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <SortableContext items={uids} strategy={verticalListSortingStrategy}>
        <ol aria-label={label} className={cn('flex flex-col', className)}>
          {songs.map((song, i) => (
            <SortableRow
              key={song.uid}
              song={song}
              view={viewOf(song, i, numberOf(song.uid))}
              title={song.title || t('Untitled song')}
              rowClassName={rowClassName}
              stage={stage}
              action={rowAction?.(song, i)}
              canReorder
              describedBy={instructionsId}
              onRemove={onRemove ? () => onRemove(song.uid) : undefined}
              onKeyMove={(delta) => keyMove(song.uid, delta)}
              handleRef={(el) => {
                if (el) handles.current.set(song.uid, el);
                else handles.current.delete(song.uid);
              }}
            />
          ))}
        </ol>
      </SortableContext>
      <span id={instructionsId} className="sr-only">
        {t('Long-press a song and drag it to change the order. With a keyboard, focus the grip and use the up and down arrow keys.')}
      </span>
      <span role="status" aria-live="polite" className="sr-only">
        {liveText}
      </span>
      {typeof document !== 'undefined' &&
        createPortal(
          <DragOverlay zIndex={OVERLAY_Z} modifiers={[verticalOnly]}>
            {activeSong ? (
              <div
                onContextMenu={(e) => e.preventDefault()}
                className={cn(
                  ROW,
                  rowClassName,
                  '-mx-2 px-3 scale-[1.02] cursor-grabbing',
                  stage
                    ? 'bg-[#1c1c1c] text-white border-0 shadow-[0_12px_32px_rgba(0,0,0,0.6)] ring-1 ring-white/25'
                    : 'bg-card text-card-foreground shadow-[0_12px_32px_rgba(0,0,0,0.28)] ring-1 ring-border'
                )}
              >
                <RowContent
                  view={{ ...viewOf(activeSong, songs.indexOf(activeSong), numberOf(activeSong.uid), true), onClick: undefined }}
                />
                <GripVertical className={cn('w-4 h-4 shrink-0', stage ? 'text-white/60' : 'text-muted-foreground')} />
              </div>
            ) : null}
          </DragOverlay>,
          document.body
        )}
    </DndContext>
  );
}
