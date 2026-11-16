import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Download, Link, Pencil, Plus, ScrollText, Share2, Trash2 } from '@/app/components/icons';
import { BwSheet, IconButton, NavBackButton } from '@/app/components/bw/Screen';
import { PillButton } from '@/app/components/bw/Form';
import { cn } from '@/app/components/ui/utils';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { springs } from '@/styles/motion';
import {
  duplicatePlot,
  inputsFromLineup,
  keepInputs,
  lineupInputsOffer,
  newId,
  stageSize,
  syncInputs,
  type StageData,
  type StagePlot,
} from '@/lib/stagePlot';
import { CardHead, InputListTable, PlotTabs, RiderStatusCard, VenueAgreedTag, WhoBringsWhat, shortDate } from './RiderParts';
import { StagePlotView, plotRatio } from './StagePlotView';
import { InputListEditor } from './InputListEditor';
import { FoldSplit, useLaptopPose } from '@/app/components/duo/FoldSplit';
import type { EventStageState } from './useEventStage';
import { useSystemBack } from '@/lib/backStack';
import { useUnsavedGuard } from '@/lib/unsavedGuard';
import { UnsavedChangesSheet } from '@/app/components/bw/UnsavedChanges';

type T = ReturnType<typeof useT>;

interface RiderStageProps {
  state: EventStageState;
  isAdmin: boolean;
  eventTitle: string;
  /** "SAT 12 DEC" for the overline. */
  dateLabel?: string;
  /** First names on the lineup (WHO column suggestions). */
  people: string[];
  /** Tablets: the plot can be edited (canvas editing stays on iPad). */
  canEditPlot: boolean;
  /**
   * The gig is still being created (iPad composer): edits are kept until the
   * gig is saved, there is nothing to share yet, and CREATE RIDER only marks
   * the rider to create with the gig (`riderWanted`).
   */
  draft?: { riderWanted: boolean };
}

/** Width of an element, kept up to date. */
function useWidth<E extends HTMLElement>(): [React.RefObject<E | null>, number] {
  const ref = useRef<E>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Edit action of a section, at its top right (plot, input list, who brings what). */
const SectionEdit: React.FC<{ label: string; ariaLabel?: string; onClick: () => void }> = ({ label, ariaLabel, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    className="h-9 px-1 shrink-0 bw-button-sm inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
  >
    <Pencil className="w-3.5 h-3.5" />
    {label}
  </button>
);

/** Under a section's title: its meta (channels, venue agreed) and its edit action. */
const SectionBar: React.FC<{ meta?: React.ReactNode; action?: React.ReactNode }> = ({ meta, action }) =>
  meta || action ? (
    <div className="flex items-center justify-between gap-3 min-h-9 -my-1">
      <span className="min-w-0 bw-label-xs text-muted-foreground">{meta}</span>
      {action}
    </div>
  ) : null;

/**
 * Everything on the Rider & stage page, shared by the pushed screen (phone,
 * iPhone Duo) and the iPad "Rider & stage" tab. Wide containers lay the cards
 * out in columns (Figma "iPad · 03 Event detail / Gig – Rider & stage").
 */
/** Laptop pose: the screen's header and its back / share row, placed on the Display and the Deck. */
interface FoldParts {
  zIndex: number;
  head: React.ReactNode;
  controls: React.ReactNode;
}

export const RiderStageContent: React.FC<RiderStageProps & { layout: 'stack' | 'board'; fold?: FoldParts }> = ({
  state,
  isAdmin,
  eventTitle,
  people,
  canEditPlot,
  layout,
  draft,
  fold,
}) => {
  const t = useT();
  const { stage, rider, isSuggestion } = state;
  const [plotId, setPlotId] = useState<string | undefined>(undefined);
  const [editingPlot, setEditingPlot] = useState<StagePlot | null>(null);
  const [editingInputs, setEditingInputs] = useState(false);
  const [editingBrings, setEditingBrings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [ref, width] = useWidth<HTMLDivElement>();
  const plots = stage?.plots ?? [];
  const plot = plots.find((p) => p.id === plotId) ?? plots[0];
  const cols = layout === 'stack' ? 1 : width >= 900 ? 3 : width >= 560 ? 2 : 1;

  // Plot changes wait for SAVE PLOT. Back, Escape, the tab bar or closing the
  // gig ask first instead of throwing them away (iPad: Back closed the gig).
  const savedPlot = editingPlot ? plots.find((p) => p.id === editingPlot.id) : undefined;
  const plotDirty = !!editingPlot && (savedPlot ? JSON.stringify(savedPlot) !== JSON.stringify(editingPlot) : editingPlot.items.length > 0);
  const [plotLeave, setPlotLeave] = useState<null | (() => void)>(null);
  const [plotSaveError, setPlotSaveError] = useState<string | null>(null);
  useSystemBack(!!editingPlot, () => {
    if (plotDirty) setPlotLeave(() => () => {});
    else setEditingPlot(null);
    return true;
  });
  useUnsavedGuard(plotDirty, (proceed) => setPlotLeave(() => proceed));
  const savePlot = async (): Promise<boolean> => {
    if (!editingPlot) return true;
    let ok = false;
    await run('plot', async () => {
      const next = plots.some((p) => p.id === editingPlot.id)
        ? plots.map((p) => (p.id === editingPlot.id ? editingPlot : p))
        : [...plots, editingPlot];
      // The input list follows the plot: channels for new instruments, none for removed ones.
      const inputs = syncInputs(plots.find((p) => p.id === editingPlot.id), editingPlot, base.inputs, t);
      ok = !!(await save({ ...base, plots: next, inputs }));
      if (ok) setEditingPlot(null);
    });
    return ok;
  };

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(id);
  }, [notice]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const save = (next: StageData) => state.save(next);
  const base: StageData = stage ?? { plots: [], inputs: [], mixer: '', bandBrings: [], venueProvides: [], venueAgreed: false };
  // The input list from the lineup's instruments: offered when the list is
  // empty, or when the lineup changed since the list was made from it. A list
  // edited by hand is only replaced after asking.
  const offer = isAdmin && !isSuggestion ? lineupInputsOffer(base.inputs, state.lineup, t) : null;
  const fromLineup = () => inputsFromLineup(state.lineup, t, plots[0]);
  const rebuildInputs = () =>
    run('rebuild', async () => {
      if (await save({ ...base, inputs: fromLineup() })) setConfirmRebuild(false);
    });

  if (!stage && !isAdmin) {
    return (
      <div ref={ref} className="bg-card rounded-[20px] p-5 bw-body-md text-muted-foreground">
        {state.loading ? t('LOADING…') : t("The band hasn't set up the stage for this gig yet.")}
      </div>
    );
  }

  // ─── cards ───
  const riderCard =
    layout === 'board' ? (
      <section className="bg-card rounded-[24px] p-4 flex items-center gap-4 flex-wrap" aria-label={t('Technical rider')}>
        <span className="w-12 h-12 rounded-[12px] bg-black text-[var(--accent)] flex items-center justify-center shrink-0" aria-hidden>
          <ScrollText className="w-6 h-6" />
        </span>
        <span className="flex-1 min-w-[160px] flex flex-col gap-1">
          <span className="bw-h3 normal-case">
            {rider ? t('Technical rider · v{version}', { version: rider.version }) : t('Technical rider')}
          </span>
          <span className="bw-label-xs text-muted-foreground">
            {draft ? (draft.riderWanted ? t('CREATED WITH THE GIG') : t('NO RIDER LINKED YET')) : riderMeta(rider, t)}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {draft ? (
            isAdmin && (
              <PillButton
                size="sm"
                fullWidth={false}
                variant={draft.riderWanted ? 'outline' : 'dark'}
                aria-pressed={draft.riderWanted}
                onClick={() => run('create', state.createRider)}
              >
                {draft.riderWanted ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {draft.riderWanted ? t('RIDER ADDED') : t('CREATE RIDER')}
              </PillButton>
            )
          ) : (
          <>
          {isAdmin && !rider && (
            <PillButton size="sm" fullWidth={false} variant="dark" loading={busy === 'create'} onClick={() => run('create', state.createRider)}>
              <Plus className="w-4 h-4" />
              {t('CREATE RIDER')}
            </PillButton>
          )}
          {isAdmin && rider && (
            <PillButton size="sm" fullWidth={false} variant="outline" loading={busy === 'link'} onClick={() => run('link', shareLinkNow)}>
              <Share2 className="w-4 h-4" />
              {t('SHARE')}
            </PillButton>
          )}
          <PillButton size="sm" fullWidth={false} variant="dark" loading={busy === 'pdf'} onClick={() => run('pdf', state.shareRiderPdf)}>
            <Download className="w-4 h-4" />
            {t('PDF')}
          </PillButton>
          </>
          )}
        </span>
      </section>
    ) : (
      // Everything that sends the rider sits together on its card: the venue's
      // link (or creating the rider first) and the PDF.
      <RiderStatusCard
        rider={rider}
        eventTitle={eventTitle}
        action={
          <div className="flex flex-col gap-2">
            {isAdmin &&
              (rider ? (
                <PillButton variant="white" size="md" loading={busy === 'link'} onClick={() => run('link', shareLinkNow)}>
                  <Link className="w-4 h-4" />
                  {t('SHARE LINK WITH THE VENUE')}
                </PillButton>
              ) : (
                <PillButton variant="primary" size="md" loading={busy === 'create'} onClick={() => run('create', state.createRider)}>
                  <Plus className="w-4 h-4" />
                  {t('CREATE RIDER')}
                </PillButton>
              ))}
            {!draft && (
              <PillButton
                variant={isAdmin ? 'outline' : 'white'}
                size="md"
                className={isAdmin ? 'border-white text-white' : undefined}
                loading={busy === 'pdf'}
                onClick={() => run('pdf', state.shareRiderPdf)}
              >
                <Share2 className="w-4 h-4" />
                {t('SHARE RIDER PDF')}
              </PillButton>
            )}
          </div>
        }
      />
    );

  async function shareLinkNow() {
    const res = await state.shareRiderLink();
    if (res === 'copied') setNotice(t('Link copied. The venue sees the rider without an account.'));
    else if (res === 'shared') setNotice(t('Link shared with the venue.'));
  }

  const plotEditing = editingPlot && plot && editingPlot.id === plot.id;
  const plotCard = (
    <section className={cn('rounded-[24px] p-4 flex flex-col gap-3', layout === 'board' ? 'bg-card' : 'bg-card')} aria-label={t('Stage plot')}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {layout === 'board' && <h3 className="bw-h2">{t('STAGE PLOT')}</h3>}
        <PlotTabs plots={plots} active={plot?.id} onPick={(id) => !editingPlot && setPlotId(id)} />
        <span className="flex items-center gap-2 ml-auto">
          {plot && layout === 'stack' && <span className="bw-label-xs text-muted-foreground">{stageSize(plot).toUpperCase()}</span>}
          {isAdmin && canEditPlot && !editingPlot && (
            <SectionEdit
              label={t('EDIT')}
              ariaLabel={t('Edit the stage plot')}
              onClick={() => setEditingPlot(plot ?? { id: newId(), name: t('Full band'), widthM: 6, depthM: 4, items: [] })}
            />
          )}
        </span>
      </div>
      {plotEditing || (editingPlot && !plot) ? (
        <PlotEditor
          plot={editingPlot!}
          plots={plots}
          onChange={setEditingPlot}
          onCancel={() => setEditingPlot(null)}
          busy={busy === 'plot'}
          onDelete={
            plots.length > 1
              ? () =>
                  run('plot', async () => {
                    if (await save({ ...base, plots: plots.filter((p) => p.id !== editingPlot!.id) })) {
                      setEditingPlot(null);
                      setPlotId(undefined);
                    }
                  })
              : undefined
          }
          onDuplicate={() => {
            const copy = duplicatePlot(editingPlot!, t('Trio'));
            run('plot', async () => {
              const others = plots.some((p) => p.id === editingPlot!.id)
                ? plots.map((p) => (p.id === editingPlot!.id ? editingPlot! : p))
                : [...plots, editingPlot!];
              if (await save({ ...base, plots: [...others, copy] })) {
                setPlotId(copy.id);
                setEditingPlot(copy);
              }
            });
          }}
          onSave={() => void savePlot()}
        />
      ) : plot ? (
        layout === 'stack' ? (
          // Short screens (Duo closed in landscape): the whole plot stays in view.
          <div className="w-full mx-auto" style={{ maxWidth: `max(260px, calc((100dvh - 150px) * ${plotRatio(plot)}))` }}>
            <StagePlotView plot={plot} size="md" />
          </div>
        ) : (
          <StagePlotView plot={plot} size={cols === 1 ? 'sm' : 'md'} />
        )
      ) : (
        <p className="bw-body-sm text-muted-foreground py-4">{t('No stage plot yet.')}</p>
      )}
    </section>
  );

  // Each section has its edit action at its top right, under its title.
  const inputsBar = (
    <SectionBar
      meta={[t('{count} CH', { count: base.inputs.length }), base.mixer.toUpperCase()].filter(Boolean).join(' · ')}
      action={isAdmin && <SectionEdit label={t('EDIT LIST')} onClick={() => setEditingInputs(true)} />}
    />
  );
  const bringsBar = (
    <SectionBar
      meta={<VenueAgreedTag agreed={base.venueAgreed} />}
      action={isAdmin && <SectionEdit label={t('EDIT')} ariaLabel={t('Edit who brings what')} onClick={() => setEditingBrings(true)} />}
    />
  );

  const lineupNote = offer && offer.kind !== 'none' && (
    <div className="mb-2 rounded-[16px] border-[1.5px] border-dashed border-foreground/30 p-3 flex items-center gap-3 flex-wrap">
      <span className="flex-1 min-w-[180px] bw-body-sm text-muted-foreground">
        {offer.kind === 'build'
          ? t('Make the channels from the instruments on the lineup.')
          : t('The lineup changed since this list was made from it.')}
      </span>
      <span className="flex items-center gap-2 flex-wrap">
        {offer.kind === 'update' && (
          <PillButton
            size="sm"
            variant="outline"
            fullWidth={false}
            loading={busy === 'keep'}
            disabled={!!busy}
            onClick={() => run('keep', () => save({ ...base, inputs: keepInputs(base.inputs, state.lineup) }))}
          >
            {t('KEEP THIS LIST')}
          </PillButton>
        )}
        <PillButton
          size="sm"
          fullWidth={false}
          loading={busy === 'rebuild'}
          disabled={!!busy}
          onClick={() => (offer.edited ? setConfirmRebuild(true) : rebuildInputs())}
        >
          {offer.kind === 'build' ? t('BUILD FROM LINEUP') : t('UPDATE FROM LINEUP')}
        </PillButton>
      </span>
    </div>
  );

  const inputsCard = (
    <section className="bg-card rounded-[24px] p-4 flex flex-col gap-1" aria-label={t('Input list')}>
      {layout === 'board' && (
        <>
          <CardHead title={t('INPUT LIST')} />
          {inputsBar}
        </>
      )}
      {lineupNote}
      <InputListTable inputs={base.inputs} limit={layout === 'stack' ? 8 : undefined} />
    </section>
  );

  const bringsCard = (
    <section
      className={cn('flex flex-col gap-3', layout === 'board' && 'bg-card rounded-[24px] p-4')}
      aria-label={t('Who brings what')}
    >
      {layout === 'board' && (
        <div className="flex flex-col gap-1">
          <h3 className="bw-h2">{t('WHO BRINGS WHAT')}</h3>
          {bringsBar}
        </div>
      )}
      <WhoBringsWhat stage={base} />
    </section>
  );

  const suggestionNote = isAdmin && isSuggestion && (
    <section className="rounded-[20px] border-[1.5px] border-dashed border-foreground/30 p-4 flex items-center gap-3 flex-wrap">
      <span className="flex-1 min-w-[180px] bw-body-sm text-muted-foreground">
        {draft
          ? t('Suggested from the lineup. Save it and it is added when you create the gig.')
          : t('Suggested from the lineup. Check it and save it, then the band sees it.')}
      </span>
      <PillButton size="sm" fullWidth={false} loading={busy === 'save'} onClick={() => stage && run('save', () => save(stage))}>
        {t('SAVE')}
      </PillButton>
    </section>
  );

  const feedback = (
    <>
      {state.error && (
        <p role="alert" className="bw-body-sm text-destructive">
          {state.error}
        </p>
      )}
      {notice && (
        <p role="status" className="bw-body-sm text-success">
          {notice}
        </p>
      )}
    </>
  );

  const editors = (
    <>
      <UnsavedChangesSheet
        open={!!plotLeave}
        title={t('Save your changes?')}
        saving={busy === 'plot'}
        error={plotSaveError}
        onKeepEditing={() => {
          setPlotLeave(null);
          setPlotSaveError(null);
        }}
        onDiscard={() => {
          const go = plotLeave;
          setPlotLeave(null);
          setPlotSaveError(null);
          setEditingPlot(null);
          go?.();
        }}
        onSave={async () => {
          const go = plotLeave;
          if (await savePlot()) {
            setPlotLeave(null);
            setPlotSaveError(null);
            go?.();
          } else setPlotSaveError(t('Could not save. Try again.'));
        }}
      />
      {editingInputs && (
        <InputListEditor
          eventTitle={eventTitle}
          inputs={base.inputs}
          people={people}
          fromLineup={inputsFromLineup(state.lineup, t).length > 0 ? fromLineup : undefined}
          onCancel={() => setEditingInputs(false)}
          onSave={async (inputs) => {
            const ok = await save({ ...base, inputs });
            if (ok) setEditingInputs(false);
            return ok;
          }}
        />
      )}
      <BwSheet
        open={confirmRebuild}
        onClose={() => setConfirmRebuild(false)}
        closeLabel={t('Close')}
        zIndex={130}
        overline={t('Input list')}
        title={t('Rebuild the input list?')}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <PillButton variant="outline" className="border-sheet-foreground text-sheet-foreground" disabled={busy === 'rebuild'} onClick={() => setConfirmRebuild(false)}>
              {t('CANCEL')}
            </PillButton>
            <PillButton loading={busy === 'rebuild'} onClick={rebuildInputs}>
              {t('REBUILD LIST')}
            </PillButton>
          </div>
        }
      >
        <p className="bw-body-md text-sheet-foreground/80">
          {t('The channels of the current lineup replace this list, and your changes to it are lost.')}
        </p>
      </BwSheet>
      <BringsEditorSheet
        open={editingBrings}
        stage={base}
        onClose={() => setEditingBrings(false)}
        onSave={async (next) => {
          const ok = await save(next);
          if (ok) setEditingBrings(false);
          return ok;
        }}
      />
    </>
  );

  if (layout === 'board') {
    return (
      <div ref={ref} className="flex flex-col gap-4">
        {feedback}
        {suggestionNote}
        {/* The rider and its sending actions first, then plot, inputs, who brings what. */}
        {cols === 3 ? (
          <>
            {riderCard}
            <div className="grid grid-cols-[1.15fr_1fr_1fr] gap-4 items-start">
              <div className="min-w-0">{plotCard}</div>
              <div className="min-w-0">{inputsCard}</div>
              <div className="min-w-0">{bringsCard}</div>
            </div>
          </>
        ) : cols === 2 ? (
          <>
            {riderCard}
            <div className="grid grid-cols-2 gap-4 items-start">
              <div className="flex flex-col gap-4 min-w-0">
                {plotCard}
                {bringsCard}
              </div>
              <div className="min-w-0">{inputsCard}</div>
            </div>
          </>
        ) : (
          <>
            {riderCard}
            {plotCard}
            {inputsCard}
            {bringsCard}
          </>
        )}
        {editors}
      </div>
    );
  }

  const plotSection = (
    <section className="flex flex-col gap-4">
      <h2 className="bw-h1">{t('STAGE PLOT')}</h2>
      {plotCard}
    </section>
  );
  const rest = (
    <>
      <section className="flex flex-col gap-4">
        <h2 className="bw-h1">{t('INPUT LIST')}</h2>
        {inputsBar}
        {inputsCard}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="bw-h1 min-w-0">{t('WHO BRINGS WHAT')}</h2>
        {bringsBar}
        {bringsCard}
      </section>
      {editors}
    </>
  );

  // iPhone Duo in Laptop pose: the plot stands on the upright Display, the
  // rider, lists and every control lie on the Deck (Figma "Duo · 11 Laptop pose").
  if (fold) {
    return (
      <FoldSplit
        zIndex={fold.zIndex}
        displayLabel={t('Stage plot')}
        deckLabel={t('Rider & stage')}
        display={
          <div ref={ref} className="bw-fold-pad flex flex-col gap-3 pt-3 pb-4">
            {fold.head}
            {/* The whole plot fits the Display's height: the box is as wide as its ratio allows. */}
            <div
              className="w-full mx-auto"
              style={{ maxWidth: `max(280px, calc((var(--bw-display-h, 454px) - 190px) * ${plot ? plotRatio(plot) : 1.6}))` }}
            >
              {plotCard}
            </div>
          </div>
        }
        deck={
          <div className="flex flex-col gap-6 px-4 pt-3" style={{ paddingBottom: 'var(--content-bottom-clearance, 96px)' }}>
            {fold.controls}
            {riderCard}
            {feedback}
            {suggestionNote}
            {rest}
          </div>
        }
      />
    );
  }

  return (
    <div ref={ref} className="flex flex-col gap-6">
      {riderCard}
      {feedback}
      {suggestionNote}
      {plotSection}
      {rest}
    </div>
  );
};

/** "SENT TO THE VENUE 1 DEC" (whether the venue opened it isn't shown: a PDF can't tell). */
function riderMeta(rider: EventStageState['rider'], t: T): string {
  if (!rider) return t('NO RIDER LINKED YET');
  return rider.sentAt ? t('SENT TO THE VENUE {date}', { date: shortDate(rider.sentAt).toUpperCase() }) : t('NOT SENT YET');
}

/** Plot editing on every device: name, size, move and add items, save. */
const PlotEditor: React.FC<{
  plot: StagePlot;
  plots: StagePlot[];
  busy: boolean;
  onChange: (p: StagePlot) => void;
  onCancel: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  onDelete?: () => void;
}> = ({ plot, busy, onChange, onCancel, onSave, onDuplicate, onDelete }) => {
  const t = useT();
  const num = (v: string) => {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.min(100, n) : null;
  };
  const input = 'h-9 rounded-full bg-background px-3 bw-body-sm outline-none focus:ring-2 focus:ring-foreground';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={t('Layout name')}
          value={plot.name}
          maxLength={30}
          onChange={(e) => onChange({ ...plot, name: e.target.value })}
          className={cn(input, 'flex-1 min-w-[120px]')}
        />
        <input
          aria-label={t('Stage width (m)')}
          inputMode="decimal"
          defaultValue={plot.widthM ?? ''}
          onChange={(e) => onChange({ ...plot, widthM: num(e.target.value) })}
          className={cn(input, 'w-16 text-center')}
        />
        <span className="bw-label-sm">×</span>
        <input
          aria-label={t('Stage depth (m)')}
          inputMode="decimal"
          defaultValue={plot.depthM ?? ''}
          onChange={(e) => onChange({ ...plot, depthM: num(e.target.value) })}
          className={cn(input, 'w-16 text-center')}
        />
        <span className="bw-label-sm">m</span>
      </div>
      <StagePlotView plot={plot} editable onChange={onChange} />
      <div className="flex flex-wrap items-center gap-2">
        <PillButton size="sm" fullWidth={false} loading={busy} onClick={onSave}>
          {t('SAVE PLOT')}
        </PillButton>
        <PillButton size="sm" fullWidth={false} variant="outline" disabled={busy} onClick={onCancel}>
          {t('CANCEL')}
        </PillButton>
        <button type="button" onClick={onDuplicate} disabled={busy} className="h-9 px-2 bw-button-sm text-muted-foreground hover:text-foreground cursor-pointer">
          {t('+ NEW LAYOUT')}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="ml-auto h-9 px-2 bw-button-sm text-destructive-solid inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('DELETE LAYOUT')}
          </button>
        )}
      </div>
    </div>
  );
};

/** Band brings / venue provides / mixer / venue agreed. One item per line. */
const BringsEditorSheet: React.FC<{
  open: boolean;
  stage: StageData;
  onClose: () => void;
  onSave: (next: StageData) => Promise<boolean>;
}> = ({ open, stage, onClose, onSave }) => {
  const t = useT();
  const [brings, setBrings] = useState('');
  const [provides, setProvides] = useState('');
  const [mixer, setMixer] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setBrings(stage.bandBrings.join('\n'));
    setProvides(stage.venueProvides.join('\n'));
    setMixer(stage.mixer);
    setAgreed(stage.venueAgreed);
  }, [open, stage]);
  const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const area = 'w-full min-h-[132px] rounded-[16px] bg-foreground/[0.08] p-3 bw-body-md outline-none focus:ring-2 focus:ring-white/60 resize-y';
  return (
    <BwSheet
      open={open}
      onClose={onClose}
      closeLabel={t('Close')}
      zIndex={130}
      overline={t('Rider & stage')}
      title={t('Who brings what')}
      footer={
        <PillButton
          loading={saving}
          onClick={async () => {
            setSaving(true);
            await onSave({ ...stage, bandBrings: lines(brings), venueProvides: lines(provides), mixer: mixer.trim(), venueAgreed: agreed });
            setSaving(false);
          }}
        >
          {t('SAVE')}
        </PillButton>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="bw-label-sm text-sheet-foreground/70">{t('BAND BRINGS · one per line')}</span>
          <textarea className={area} value={brings} onChange={(e) => setBrings(e.target.value)} />
        </label>
        <label className="flex flex-col gap-2">
          <span className="bw-label-sm text-sheet-foreground/70">{t('VENUE PROVIDES · one per line')}</span>
          <textarea className={area} value={provides} onChange={(e) => setProvides(e.target.value)} />
        </label>
        <label className="flex flex-col gap-2">
          <span className="bw-label-sm text-sheet-foreground/70">{t('MIXER')}</span>
          <input
            className="h-12 rounded-full bg-foreground/[0.08] px-4 bw-body-md outline-none focus:ring-2 focus:ring-white/60"
            value={mixer}
            maxLength={60}
            placeholder="XR18"
            onChange={(e) => setMixer(e.target.value)}
          />
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={agreed}
          onClick={() => {
            haptic.tap();
            setAgreed((a) => !a);
          }}
          className="flex items-center justify-between gap-3 min-h-12 rounded-full bg-foreground/[0.08] px-4 cursor-pointer"
        >
          <span className="bw-body-md">{t('The venue agreed to this')}</span>
          <span className={cn('w-11 h-6 rounded-full p-0.5 transition-colors', agreed ? 'bg-accent' : 'bg-white/25')}>
            <span className={cn('block w-5 h-5 rounded-full bg-black transition-transform', agreed && 'translate-x-5')} />
          </span>
        </button>
      </div>
    </BwSheet>
  );
};

/**
 * The pushed Rider & stage screen (Figma "Phone Next / Rider & stage – read
 * mode"). On the iPhone Duo open it takes the trailing page and the gig moves
 * to the leading page (Figma "Duo Next / Event detail": gig left, Rider &
 * stage right): it is marked as a picker layer for duo-panes.css.
 */
export const RiderStageScreen: React.FC<RiderStageProps & { onClose: () => void; zIndex?: number }> = ({
  onClose,
  zIndex = 104,
  dateLabel,
  ...props
}) => {
  const t = useT();
  const { state, isAdmin, eventTitle } = props;
  const [busy, setBusy] = useState(false);
  const laptop = useLaptopPose();
  // Android Back, the browser's Back and Escape go back to the gig (or
  // wherever the screen was opened from), not past it to Home. Editors and
  // sheets opened on top register later, so they close first.
  useSystemBack(true, () => {
    onClose();
    return true;
  });
  const share = async () => {
    setBusy(true);
    try {
      if (isAdmin && state.rider) await state.shareRiderLink();
      else await state.shareRiderPdf();
    } finally {
      setBusy(false);
    }
  };
  const controls = (
    <div className="flex items-center justify-between h-11 -mt-1 empty:hidden">
      <NavBackButton pane size="sm" onClick={onClose} />
      <IconButton
        label={isAdmin && state.rider ? t('Share rider link') : t('Share rider PDF')}
        icon={<Share2 />}
        size="sm"
        variant="outline"
        className="ml-auto"
        disabled={busy}
        onClick={share}
      />
    </div>
  );
  const head = (
    <div className="flex flex-col gap-2">
      <span className="bw-label-sm text-muted-foreground truncate">
        {[eventTitle.toUpperCase(), dateLabel].filter(Boolean).join(' · ')}
      </span>
      {/* The Display is half the height: a smaller title leaves room for the plot. */}
      <h1 className={laptop ? 'bw-h1' : 'bw-display-lg'}>{t('RIDER & STAGE')}</h1>
    </div>
  );
  if (laptop) return <RiderStageContent {...props} layout="stack" fold={{ zIndex, head, controls }} />;
  return (
    <motion.div
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={springs.smooth}
      className="bw-rail-sheet bw-picker bw-rider-stage fixed top-0 bottom-0 left-0 right-0 bg-background text-foreground flex flex-col"
      style={{ zIndex }}
      data-state="open"
      role="dialog"
      aria-modal="true"
      aria-label={t('Rider & stage')}
    >
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div
          className="max-w-[640px] mx-auto w-full px-4 flex flex-col gap-6"
          style={{ paddingBottom: 'calc(var(--safe-bottom) + 48px)' }}
        >
          {/* Back and Share stay at the top, and the page scrolls under them,
              not under the status bar. */}
          <div
            className="bw-rider-top sticky top-0 z-10 -mx-4 px-4 pb-1 bg-background"
            style={{ paddingTop: 'calc(max(var(--safe-top), 44px) + 4px)' }}
          >
            {controls}
          </div>
          {head}
          <RiderStageContent {...props} layout="stack" />
        </div>
      </div>
    </motion.div>
  );
};

