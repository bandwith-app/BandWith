import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSystemBack } from '@/lib/backStack';
import { Plus, Trash2 } from '@/app/components/icons';
import { cn } from '@/app/components/ui/utils';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { LIMITS, PLOT_PRESETS, freeSpot, moveItem, newId, presetItem, presetName, stageSize, type PlotItem, type PlotItemKind, type StagePlot } from '@/lib/stagePlot';

/** Width / depth of the drawn stage: wider stages draw wider, never too flat or too tall. */
export function plotRatio(plot: StagePlot): number {
  return plot.widthM && plot.depthM ? Math.min(2.1, Math.max(1.3, plot.widthM / plot.depthM)) : 1.6;
}

/** How long a finger rests on the stage before an item lifts (or the add menu opens). */
const HOLD_MS = 320;
/** Finger travel (px) that turns a press into a page scroll. */
const SLOP = 8;

/** One finger (or mouse button) on the stage. `id` null = an empty spot. */
interface Press {
  id: string | null;
  pointerId: number;
  x0: number;
  y0: number;
  timer: number | null;
  lifted: boolean;
  moved: boolean;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Stage plot (Figma "iPad · 03 Rider & stage", "Phone · Next"): a dashed
 * stage seen from above, players as circles with their code, wedges, side
 * speakers and DI boxes; the audience is below. Read-only unless `editable`
 * (admins, every device): press and hold an item to lift it, drag, let go;
 * tap it to rename or remove it; press and hold an empty spot to add an item
 * right there. A quick swipe still scrolls the page.
 */
export const StagePlotView: React.FC<{
  plot: StagePlot;
  /** Smaller circles (Duo thumbnail, gig card). */
  size?: 'md' | 'sm' | 'xs';
  editable?: boolean;
  onChange?: (plot: StagePlot) => void;
  /** Caption under the stage ("AUDIENCE · stage 6 × 4 m"). */
  caption?: boolean;
  className?: string;
}> = ({ plot, size = 'md', editable = false, onChange, caption = true, className }) => {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null);
  // The hold menu is the top layer: Back and Escape close just the menu.
  useSystemBack(!!addAt, () => setAddAt(null));
  // Above the spot low on the plot, below it high up; but a wide, short plot
  // (iPad in landscape) can push it off the screen: then it takes the side
  // that fits.
  const [menuSide, setMenuSide] = useState<'above' | 'below' | null>(null);
  useLayoutEffect(() => {
    setMenuSide(null);
  }, [addAt]);
  useLayoutEffect(() => {
    const el = menu.current;
    if (!addAt || !el || menuSide) return;
    const r = el.getBoundingClientRect();
    // --safe-top is a calc(): measure it (status bar, Duo hinge header).
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;height:var(--safe-top,0px);visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    const top = probe.getBoundingClientRect().height + 8;
    probe.remove();
    const side = addAt.y > 0.5 ? 'above' : 'below';
    const bottom = window.innerHeight - 8;
    if (r.top < top && side === 'above') setMenuSide('below');
    else if (r.bottom > bottom && side === 'below') setMenuSide('above');
    else if (r.top < top || r.bottom > bottom) {
      // No room on either side (the plot is at the screen's edge): bring the
      // menu into view, clear of the status bar.
      setMenuSide(side);
      el.style.scrollMarginTop = `${top}px`;
      el.style.scrollMarginBottom = '8px';
      el.scrollIntoView({ block: 'nearest' });
    }
  });
  const size2 = stageSize(plot);
  const ratio = plotRatio(plot);
  const canAdd = plot.items.length < LIMITS.items;

  // Musicians by instrument (code, caption and input channels filled in, all
  // editable), a generic one, then the gear.
  const instruments: [string, string][] = PLOT_PRESETS.map((k) => [k, presetName(k, t)]);
  const kinds: [PlotItemKind, string][] = [
    ['player', t('Other musician')],
    ['wedge', t('Wedge')],
    ['speaker', t('Speaker')],
    ['di', t('DI box')],
  ];

  const rel = (clientX: number, clientY: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return { x: 0.5, y: 0.5 };
    return { x: clamp01((clientX - r.left) / r.width), y: clamp01((clientY - r.top) / r.height) };
  };

  const clearPress = () => {
    if (press.current?.timer) window.clearTimeout(press.current.timer);
    press.current = null;
    setLiftedId(null);
  };

  // While an item is lifted the finger drags it, not the page. iOS only stops
  // a scroll from a non-passive touchmove listener, so it is attached here.
  useEffect(() => {
    const el = box.current;
    if (!editable || !el) return;
    const stop = (e: TouchEvent) => {
      if (press.current?.lifted) e.preventDefault();
    };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, [editable]);

  // The add menu closes on a tap anywhere else, or Escape.
  useEffect(() => {
    if (!addAt) return;
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setAddAt(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAddAt(null);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', esc);
    };
  }, [addAt]);

  // A pending hold never outlives the view.
  useEffect(() => () => {
    if (press.current?.timer) window.clearTimeout(press.current.timer);
  }, []);

  const startPress = (e: React.PointerEvent, id: string | null) => {
    if (!editable || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (press.current?.timer) window.clearTimeout(press.current.timer);
    const p: Press = { id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, timer: null, lifted: false, moved: false };
    press.current = p;
    const lift = () => {
      if (press.current !== p) return;
      p.timer = null;
      if (id) {
        p.lifted = true;
        try {
          box.current?.setPointerCapture(p.pointerId);
        } catch {
          /* the finger already left */
        }
        setLiftedId(id);
        haptic.medium();
      } else if (canAdd) {
        press.current = null;
        setSelected(null);
        setAddAt(rel(p.x0, p.y0));
        haptic.medium();
      }
    };
    // A mouse picks an item up at once; a finger holds first, so swipes scroll.
    if (id && e.pointerType === 'mouse') lift();
    else p.timer = window.setTimeout(lift, HOLD_MS);
  };

  const onMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    if (!p.lifted) {
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > SLOP) clearPress();
      return;
    }
    p.moved = true;
    const { x, y } = rel(e.clientX, e.clientY);
    onChange?.(moveItem(plot, p.id!, x, y));
  };

  const onUp = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    if (p.lifted) {
      if (p.moved) haptic.tap();
      else setSelected(p.id);
    } else if (p.timer) {
      // A tap: an item toggles its edit row, an empty spot clears it.
      setSelected(p.id && p.id !== selected ? p.id : null);
    }
    clearPress();
  };

  // Keyboard (web, iPad with a keyboard, screen readers): every item is a
  // control. Enter or Space selects it (rename, remove), arrows move it,
  // Shift + arrow in bigger steps, Escape lets it go.
  const hintId = React.useId();
  const markName = (item: PlotItem): string =>
    item.kind === 'player'
      ? [item.label, item.code && item.code !== '??' ? item.code : ''].filter(Boolean).join(' · ') || t('Other musician')
      : item.kind === 'wedge'
        ? t('Wedge')
        : item.kind === 'speaker'
          ? t('Speaker')
          : t('DI box');
  const onMarkKey = (e: React.KeyboardEvent, item: PlotItem) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelected(selected === item.id ? null : item.id);
      return;
    }
    if (e.key === 'Escape' && selected === item.id) {
      // Only the selection: the sheet or screen around stays open.
      e.preventDefault();
      setSelected(null);
      return;
    }
    const step = e.shiftKey ? 0.1 : 0.02;
    const d =
      e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, -step] : e.key === 'ArrowDown' ? [0, step] : null;
    if (!d) return;
    e.preventDefault();
    onChange?.(moveItem(plot, item.id, clamp01(item.x + d[0]), clamp01(item.y + d[1])));
  };

  const selectedItem = plot.items.find((i) => i.id === selected) || null;
  const update = (patch: Partial<PlotItem>) =>
    selectedItem && onChange?.({ ...plot, items: plot.items.map((i) => (i.id === selectedItem.id ? { ...i, ...patch } : i)) });
  const add = (kind: PlotItemKind, at?: { x: number; y: number }) => {
    if (!canAdd) return;
    const item: PlotItem = {
      id: newId(),
      kind,
      x: at ? at.x : kind === 'speaker' ? 0.97 : 0.5,
      y: at ? at.y : kind === 'wedge' ? 0.9 : kind === 'speaker' ? 0.8 : 0.5,
      ...(kind === 'player' ? { code: '??', label: '' } : {}),
    };
    place(item, !!at);
  };
  const addPreset = (key: string, at?: { x: number; y: number }) => {
    if (!canAdd) return;
    place(presetItem(key, t, at ?? undefined), !!at);
  };
  const place = (item: PlotItem, exact = false) => {
    // From the chip row: next to what is already there, never on top of it.
    if (!exact) {
      const width = box.current?.getBoundingClientRect().width || 0;
      // A circle (44 px) and 8 px of air, at the stage's drawn size.
      item = { ...item, ...freeSpot(plot.items, item, { ratio, gap: width ? 52 / width : undefined }) };
    }
    onChange?.({ ...plot, items: [...plot.items, item] });
    setSelected(item.id);
    setAddAt(null);
    haptic.tap();
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        ref={box}
        // Editable: a group of controls (an image hides what is inside it).
        role={editable ? 'group' : 'img'}
        aria-label={t('Stage plot: {names}', {
          names:
            plot.items
              .filter((i) => i.kind === 'player')
              .map((i) => i.label || i.code)
              .filter(Boolean)
              .join(', ') || t('empty'),
        })}
        className="relative w-full rounded-[16px] border-[1.5px] border-dashed border-foreground/25 bg-white dark:bg-white/[0.06] select-none"
        style={{ aspectRatio: String(ratio), ...(editable ? { WebkitTouchCallout: 'none' } : null) }}
        onPointerDown={editable ? (e) => e.target === box.current && startPress(e, null) : undefined}
        onPointerMove={editable ? onMove : undefined}
        onPointerUp={editable ? onUp : undefined}
        onPointerCancel={editable ? clearPress : undefined}
        onContextMenu={editable ? (e) => e.preventDefault() : undefined}
      >
        {plot.items.map((item) => (
          <PlotMark
            key={item.id}
            item={item}
            size={size}
            selected={editable && selected === item.id}
            lifted={liftedId === item.id}
            name={editable ? markName(item) : undefined}
            describedBy={editable ? hintId : undefined}
            onKeyDown={editable ? (e) => onMarkKey(e, item) : undefined}
            onPointerDown={
              editable
                ? (e) => {
                    e.stopPropagation();
                    startPress(e, item.id);
                  }
                : undefined
            }
          />
        ))}
        {editable && (
          <span id={hintId} hidden>
            {t('Enter to edit, arrow keys to move.')}
          </span>
        )}
        {addAt && (
          <>
            <span
              aria-hidden
              className="absolute w-5 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-black pointer-events-none"
              style={{ left: `${addAt.x * 100}%`, top: `${addAt.y * 100}%` }}
            />
            <div
              ref={menu}
              role="menu"
              aria-label={t('Add here')}
              className="absolute left-1/2 -translate-x-1/2 z-20 w-max max-w-[calc(100%-16px)] p-1 rounded-[20px] bg-white text-black border border-black/10 shadow-[0_10px_28px_rgba(0,0,0,0.35)] flex flex-wrap justify-center gap-0.5"
              style={(menuSide ?? (addAt.y > 0.5 ? 'above' : 'below')) === 'above' ? { bottom: `calc(${(1 - addAt.y) * 100}% + 16px)` } : { top: `calc(${addAt.y * 100}% + 16px)` }}
            >
              {instruments.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  onClick={() => addPreset(key, addAt)}
                  className="h-9 px-2.5 rounded-full bw-label-sm inline-flex items-center gap-1 cursor-pointer hover:bg-black/5 active:bg-black/10 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  {label}
                </button>
              ))}
              <span aria-hidden className="basis-full h-px my-0.5 bg-black/10" />
              {kinds.map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={() => add(kind, addAt)}
                  className="h-9 px-2.5 rounded-full bw-label-sm inline-flex items-center gap-1 cursor-pointer hover:bg-black/5 active:bg-black/10 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {caption && (
        <p className="bw-label-xs text-muted-foreground text-center">
          {[t('AUDIENCE'), size2 ? t('stage {size}', { size: size2 }) : ''].filter(Boolean).join(' · ')}
        </p>
      )}

      {editable && (
        <div className="flex flex-col gap-2">
          {canAdd && (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('Add a musician')}>
              {instruments.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => addPreset(key)}
                  className="h-8 px-3 rounded-full border border-foreground/30 bw-label-sm inline-flex items-center gap-1.5 cursor-pointer active:scale-[var(--press-scale)]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          )}
          {canAdd && (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('Add gear')}>
              {kinds.map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => add(kind)}
                  className="h-8 px-3 rounded-full border border-foreground/30 bw-label-sm inline-flex items-center gap-1.5 cursor-pointer active:scale-[var(--press-scale)]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          )}
          {selectedItem ? (
            <div className="rounded-[16px] bg-background p-3 flex flex-wrap items-center gap-2">
              {selectedItem.kind === 'player' && (
                <>
                  <input
                    aria-label={t('Code')}
                    value={selectedItem.code ?? ''}
                    maxLength={3}
                    onChange={(e) => update({ code: e.target.value.toUpperCase() })}
                    className="w-14 h-9 rounded-full bg-card px-3 bw-label-md text-center outline-none focus:ring-2 focus:ring-foreground"
                  />
                  <input
                    aria-label={t('Caption')}
                    placeholder={t('Caption')}
                    value={selectedItem.label ?? ''}
                    maxLength={40}
                    onChange={(e) => update({ label: e.target.value })}
                    className="flex-1 min-w-[120px] h-9 rounded-full bg-card px-3 bw-body-sm outline-none focus:ring-2 focus:ring-foreground"
                  />
                  <button
                    type="button"
                    aria-pressed={!!selectedItem.lead}
                    onClick={() => update({ lead: !selectedItem.lead || undefined })}
                    className={cn(
                      'h-9 px-3 rounded-full bw-label-sm cursor-pointer',
                      selectedItem.lead ? 'bg-accent text-accent-foreground' : 'border border-foreground/30',
                    )}
                  >
                    {t('Lead')}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  onChange?.({ ...plot, items: plot.items.filter((i) => i.id !== selectedItem.id) });
                  setSelected(null);
                }}
                className="h-9 px-3 rounded-full bw-label-sm text-destructive-solid inline-flex items-center gap-1.5 cursor-pointer ml-auto"
              >
                <Trash2 className="w-4 h-4" />
                {t('Remove')}
              </button>
            </div>
          ) : (
            <p className="bw-body-sm text-muted-foreground">
              {t('Hold an item, then drag it to move it. Tap it to rename or remove it. Hold an empty spot to add one there.')}{' '}
              {t('With a keyboard: Tab to an item, Enter to edit it, arrow keys to move it.')}{' '}
              {t('Saving adds the channels of new instruments and DI boxes to the input list, and removes those of deleted ones.')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const DIAMETER = { md: 44, sm: 34, xs: 18 } as const;

const PlotMark: React.FC<{
  item: PlotItem;
  size: 'md' | 'sm' | 'xs';
  selected?: boolean;
  /** Picked up by a long press: drawn a little bigger, with a shadow. */
  lifted?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  /** Editable: the item is a control with this name (keyboard, screen readers). */
  name?: string;
  describedBy?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}> = ({ item, size, selected, lifted, onPointerDown, name, describedBy, onKeyDown }) => {
  const d = DIAMETER[size];
  const control = name
    ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': name,
        'aria-pressed': !!selected,
        'aria-describedby': describedBy,
        onKeyDown,
      }
    : { 'aria-hidden': true as const };
  const focusRing = name ? 'outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-foreground focus-visible:ring-offset-white' : '';
  const style: React.CSSProperties = { left: `${item.x * 100}%`, top: `${item.y * 100}%` };
  const ring = selected ? 'ring-2 ring-offset-2 ring-foreground ring-offset-white' : '';
  const grab = cn(
    onPointerDown && 'cursor-grab active:cursor-grabbing transition-[scale,filter] duration-150',
    lifted && 'scale-[1.2] z-10 drop-shadow-[0_6px_10px_rgba(0,0,0,0.35)]',
  );
  if (item.kind === 'player') {
    return (
      <div
        className={cn('absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 rounded-full', grab, focusRing)}
        style={{ ...style, width: d }}
        onPointerDown={onPointerDown}
        {...(name ? control : null)}
      >
        <span
          className={cn(
            'rounded-full flex items-center justify-center font-semibold shrink-0',
            item.lead ? 'bg-accent text-accent-foreground' : 'bg-black text-white',
            size === 'xs' ? 'text-[0px]' : size === 'sm' ? 'text-[11px]' : 'text-[13px]',
            ring,
          )}
          style={{ width: d, height: d, fontFamily: 'var(--font-sans)' }}
        >
          {size !== 'xs' && item.code}
        </span>
        {item.label && size !== 'xs' && (
          <span className="absolute top-full mt-1 bw-label-xs text-muted-foreground whitespace-nowrap normal-case text-[10px]">
            {item.label}
          </span>
        )}
      </div>
    );
  }
  if (item.kind === 'speaker') {
    const w = size === 'xs' ? 4 : size === 'sm' ? 12 : 16;
    return (
      <span
        className={cn('absolute -translate-x-1/2 -translate-y-1/2 rounded-[4px] bg-black', ring, grab, focusRing)}
        style={{ ...style, width: w, height: w * 2.8 }}
        onPointerDown={onPointerDown}
        {...control}
      />
    );
  }
  if (item.kind === 'di') {
    return (
      <span
        className={cn(
          'absolute -translate-x-1/2 -translate-y-1/2 rounded-[3px] border-[1.5px] border-black text-black flex items-center justify-center font-mono',
          ring,
          grab,
          focusRing,
        )}
        style={{ ...style, width: size === 'xs' ? 6 : 22, height: size === 'xs' ? 6 : 14, fontSize: 7 }}
        onPointerDown={onPointerDown}
        {...control}
      >
        {size !== 'xs' && 'DI'}
      </span>
    );
  }
  // Wedge monitor.
  const w = size === 'xs' ? 8 : size === 'sm' ? 22 : 30;
  return (
    <span
      className={cn('absolute -translate-x-1/2 -translate-y-1/2 rounded-[5px] border-[1.5px] border-black bg-white', ring, grab, focusRing)}
      style={{ ...style, width: w, height: Math.round(w * 0.45) }}
      onPointerDown={onPointerDown}
      {...control}
    />
  );
};
