import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Folder, MapPin, Plus, X } from '@/app/components/icons';
import { BwSheet, IconButton } from '@/app/components/bw/Screen';
import { FormError, PillButton, PillField, Selector } from '@/app/components/bw/Form';
import { UnsavedChangesSheet } from '@/app/components/bw/UnsavedChanges';
import { Segmented } from '@/app/components/composer/Composer';
import { DotCheckbox } from '@/app/components/ui/DotCheckbox';
import { VenueAutocomplete } from '@/app/components/ui/VenueAutocomplete';
import { TimePicker } from '@/app/components/ui/TimePicker';
import { DatePicker, toDatePickerEvents } from '@/app/components/ui/DatePicker';
import { cn } from '@/app/components/ui/utils';
import type { EventData } from '@/app/components/dashboard/EventCard';
import type { ResolvedMember } from '@/app/components/event/parts';
import { useBand } from '@/lib/BandContext';
import { useT, intlLocale } from '@/lib/i18n';
import { getActiveSymbol as sym } from '@/lib/currency';
import { venueFields } from '@/lib/services/location';
import { getBandPricing, DEFAULT_BAND_PRICING, type BandPricingSettings } from '@/lib/services/pricing';
import type { EventTask } from '@/lib/services/eventTasks';
import { listTemplates, type TaskTemplate } from '@/lib/services/taskTemplates';
import type { LineupRow } from '@/lib/services/eventMemberMoney';
import { personInitials, personName } from '@/lib/personName';
import { memberInstrument } from '@/lib/bandMembership';
import { instrumentText } from '@/lib/instruments';
import { lineupPresetMembers, selectedLineupPreset } from '@/lib/lineupPresets';
import {
  amountOf,
  changedPatch,
  costCardPatch,
  eventCardPatch,
  eventCardValues,
  extraFeeOf,
  gigFeePatch,
  notesCardPatch,
  venueCardPatch,
  venueCardValues,
  type EditCard,
  type EditKind,
  type EventCardValues,
  type Recurrence,
  type VenueCardValues,
} from '@/lib/eventOverviewEdit';
import type { OverviewEditApi } from './useOverviewEdit';

/**
 * The editors behind the overview's EDIT actions (one sheet per card), so a
 * gig or a rehearsal is edited where it is read instead of on a separate
 * Edit page. Same fields, rules and saves as that page (lib/eventOverviewEdit,
 * lib/services/eventEdits). Each sheet starts from what is saved every time
 * it opens; closing it (✕, Cancel, the scrim, a swipe, system Back) with
 * edits asks first: save them, discard them or keep editing.
 */

const PICKER_FIELD =
  'h-[52px] px-4 pb-0 gap-3 rounded-full bg-field border border-border text-foreground text-lg font-medium hover:border-foreground focus:border-2 focus:border-foreground';
const AREA =
  'w-full rounded-[24px] bg-field border border-border p-4 bw-body-md text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:border-2 focus:border-foreground';

const Label: React.FC<{ children: React.ReactNode; htmlFor?: string; trailing?: React.ReactNode }> = ({ children, htmlFor, trailing }) => (
  <div className="flex items-center justify-between gap-2">
    <label htmlFor={htmlFor} className="bw-label-sm text-muted-foreground">
      {children}
    </label>
    {trailing}
  </div>
);

interface SheetBase {
  open: boolean;
  onClose: () => void;
  event: EventData;
  kind: EditKind;
  api: OverviewEditApi;
}

/** Another card's pencil was tapped while this editor is open (iPhone Duo rail). */
const SwitchRequest = createContext<{ pending: boolean; resolve: (go: boolean) => void } | null>(null);

/** Save / Cancel under every editor; Save stays off until something changed. */
const EditSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  overline: string;
  dirty: boolean;
  canSave?: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  children: React.ReactNode;
}> = ({ open, onClose, title, overline, dirty, canSave = true, saving, error, onSave, children }) => {
  const t = useT();
  // Leaving with edits (closing, or opening another card's editor) asks
  // first: Save changes / Discard / Keep editing.
  const [leaveFor, setLeaveFor] = useState<'close' | 'switch' | null>(null);
  const switchRequest = useContext(SwitchRequest);
  useEffect(() => {
    if (!open) setLeaveFor(null);
  }, [open]);
  useEffect(() => {
    if (!open || !switchRequest?.pending) return;
    if (dirty && !saving) setLeaveFor('switch');
    else switchRequest.resolve(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, switchRequest?.pending]);
  const requestClose = () => {
    if (dirty && !saving) setLeaveFor('close');
    else onClose();
  };
  const stay = () => {
    if (leaveFor === 'switch') switchRequest?.resolve(false);
    setLeaveFor(null);
  };
  return (
    <>
    <BwSheet
      open={open}
      onClose={requestClose}
      closeLabel={t('Close')}
      tone="light"
      picker
      zIndex={112}
      overline={overline}
      title={title}
      footer={
        <div className="flex flex-col gap-2">
          {error && <FormError>{error}</FormError>}
          <div className="grid grid-cols-[2fr_3fr] gap-3">
            <PillButton variant="outline" size="lg" onClick={requestClose} disabled={saving}>
              {t('Cancel')}
            </PillButton>
            <PillButton variant="primary" size="lg" onClick={onSave} loading={saving} disabled={!dirty || !canSave}>
              {t('Save')}
            </PillButton>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">{children}</div>
    </BwSheet>
    <UnsavedChangesSheet
      open={open && !!leaveFor}
      title={t('Save your changes?')}
      saving={saving}
      error={error}
      onSave={
        canSave
          ? () => {
              stay();
              onSave();
            }
          : undefined
      }
      onDiscard={() => {
        const target = leaveFor;
        setLeaveFor(null);
        if (target === 'switch') switchRequest?.resolve(true);
        else onClose();
      }}
      onKeepEditing={stay}
    />
    </>
  );
};

/** Runs a save: the sheet closes once it worked, or shows why it didn't. */
function useSaving(onClose: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (save: () => Promise<string | null>) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const err = await save();
    setSaving(false);
    if (err) setError(err);
    else onClose();
  };
  return { saving, error, setError, run };
}

const timeOverlineOf = (t: ReturnType<typeof useT>, kind: EditKind, date: string) => {
  const label = kind === 'rehearsal' ? t('Rehearsal') : t('Gig');
  const d = date ? new Date(date + 'T00:00:00') : null;
  if (!d || isNaN(d.getTime())) return label;
  return `${label} · ${d.toLocaleDateString(intlLocale('en-GB'), { weekday: 'short', day: 'numeric', month: 'short' })}`;
};

/* ─────────────── Title, type / repeat, date and times ─────────────── */

const GIG_TYPES = ['wedding', 'corporate', 'private', 'festival', 'club', 'pub', 'other'] as const;

const EventFieldsSheet: React.FC<SheetBase & { allEvents?: EventData[] }> = ({ open, onClose, event, kind, api, allEvents }) => {
  const t = useT();
  const { saving, error, setError, run } = useSaving(onClose);
  const [v, setV] = useState<EventCardValues>(() => eventCardValues(event));
  const [initial, setInitial] = useState(v);
  useEffect(() => {
    if (!open) return;
    const now = eventCardValues(event);
    setV(now);
    setInitial(now);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (p: Partial<EventCardValues>) => setV((prev) => ({ ...prev, ...p }));
  // Only what the admin changed (a gig with no start time yet opens on 20:00).
  const patch = JSON.stringify(v) !== JSON.stringify(initial) ? changedPatch(event, eventCardPatch(kind, v)) : null;
  const accent = kind === 'rehearsal' ? 'var(--accent-rehearsal)' : 'var(--accent-gig)';
  const overline = timeOverlineOf(t, kind, v.date);
  const pickerEvents = useMemo(() => toDatePickerEvents(allEvents, event.eventId), [allEvents, event.eventId]);
  const typeLabels: Record<string, string> = {
    wedding: t('Wedding'),
    corporate: t('Corporate'),
    private: t('Private party'),
    festival: t('Festival'),
    club: t('Club'),
    pub: t('Pub'),
    other: t('Other'),
  };
  const repeat: { value: Recurrence; label: string }[] = [
    { value: 'once', label: t('One time') },
    { value: 'weekly', label: t('Weekly') },
    { value: 'biweekly', label: t('Biweekly') },
    { value: 'monthly', label: t('Monthly') },
  ];
  return (
    <EditSheet
      open={open}
      onClose={onClose}
      overline={event.title}
      title={t('Title, date & times')}
      dirty={!!patch}
      canSave={!!v.title.trim() && !!v.date}
      saving={saving}
      error={error}
      onSave={() => run(() => api.saveFields(patch))}
    >
      <PillField
        label={kind === 'rehearsal' ? t('Session title') : t('Event title')}
        value={v.title}
        onChange={(e) => set({ title: e.target.value })}
      />
      {kind === 'gig' && (
        <div className="flex flex-col gap-2">
          <Label>{t('Event type')}</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('Event type')}>
            {GIG_TYPES.map((type) => (
              <Selector key={type} size="md" selected={v.eventType === type} onClick={() => set({ eventType: type })}>
                {typeLabels[type]}
              </Selector>
            ))}
          </div>
        </div>
      )}
      {kind === 'rehearsal' && (
        <div className="flex flex-col gap-2">
          <Label>{t('Recurrence')}</Label>
          <Segmented label={t('Recurrence')} value={v.recurrence} options={repeat} onChange={(r) => set({ recurrence: r })} size="sm" />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="ovw-date">{kind === 'rehearsal' ? t('Rehearsal date') : t('Event date')}</Label>
        <DatePicker
          id="ovw-date"
          value={v.date}
          onChange={(d) => set({ date: d })}
          accentColor={accent}
          placeholder={t('Select event date')}
          className={PICKER_FIELD}
          events={pickerEvents}
          availability={{ bandId: event.band_id, start: v.startTime, end: v.endTime, excludeEventId: event.eventId }}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2 min-w-0">
          <Label htmlFor="ovw-start">{t('Start time')}</Label>
          <TimePicker id="ovw-start" value={v.startTime} onChange={(x) => set({ startTime: x })} accentColor={accent} textSize="text-lg" showIcon className={PICKER_FIELD} overline={overline} />
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <Label htmlFor="ovw-end">{t('End time')}</Label>
          <TimePicker id="ovw-end" value={v.endTime} onChange={(x) => set({ endTime: x })} accentColor={accent} align="end" textSize="text-lg" showIcon allowEmpty emptyLabel={t('Add')} className={PICKER_FIELD} overline={overline} />
        </div>
      </div>
      {kind === 'gig' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2 min-w-0">
            <Label htmlFor="ovw-loadin">{t('Load-in (optional)')}</Label>
            <TimePicker id="ovw-loadin" value={v.loadInTime} onChange={(x) => set({ loadInTime: x })} accentColor={accent} textSize="text-lg" showIcon allowEmpty emptyLabel={t('Add')} className={PICKER_FIELD} overline={overline} />
          </div>
          <div className="flex flex-col gap-2 min-w-0">
            <Label htmlFor="ovw-soundcheck">{t('Soundcheck (optional)')}</Label>
            <TimePicker id="ovw-soundcheck" value={v.soundcheckTime} onChange={(x) => set({ soundcheckTime: x })} accentColor={accent} align="end" textSize="text-lg" showIcon allowEmpty emptyLabel={t('Add')} className={PICKER_FIELD} overline={overline} />
          </div>
        </div>
      )}
    </EditSheet>
  );
};

/* ─────────────── Venue ─────────────── */

const VenueSheet: React.FC<SheetBase> = ({ open, onClose, event, kind, api }) => {
  const t = useT();
  const { saving, error, setError, run } = useSaving(onClose);
  const [v, setV] = useState<VenueCardValues>(() => venueCardValues(kind, event));
  const [initial, setInitial] = useState(v);
  useEffect(() => {
    if (!open) return;
    const now = venueCardValues(kind, event);
    setV(now);
    setInitial(now);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Only what the admin changed (an address saved in another shape stays as it is).
  const patch = JSON.stringify(v) !== JSON.stringify(initial) ? changedPatch(event, venueCardPatch(kind, v)) : null;
  return (
    <EditSheet
      open={open}
      onClose={onClose}
      overline={event.title}
      title={t('Venue & location')}
      dirty={!!patch}
      saving={saving}
      error={error}
      onSave={() => run(() => api.saveFields(patch))}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="ovw-venue">{kind === 'rehearsal' ? t('Location / studio') : t('Venue / location')}</Label>
        <div className="relative">
          <MapPin className="w-5 h-5 absolute left-4 top-4 z-[1] pointer-events-none text-foreground" />
          <VenueAutocomplete
            inputId="ovw-venue"
            value={v.venue}
            onChange={(val) => setV((prev) => ({ ...prev, venue: val }))}
            onSelect={(place) => {
              const f = venueFields(place);
              setV((prev) =>
                kind === 'rehearsal'
                  ? { ...prev, venue: f.location, address: f.address }
                  : {
                      ...prev,
                      venue: f.location,
                      // The street is the venue itself when the pick is just an address.
                      address: f.isNamedPlace ? place.address || '' : '',
                      // A new place never keeps the previous place's city.
                      city: place.city || '',
                    },
              );
            }}
            placeholder={kind === 'rehearsal' ? t('Venue or studio name') : t('Search venue or location...')}
            className="h-[52px] pl-12 pr-10 pb-0 rounded-full bg-field border border-border text-foreground text-lg font-medium normal-case placeholder:text-muted-foreground/60 focus:border-2 focus:border-foreground"
          />
        </div>
      </div>
      <PillField
        label={t('Address')}
        value={v.address}
        onChange={(e) => setV((prev) => ({ ...prev, address: e.target.value }))}
        placeholder={t('Street, city, ZIP, country')}
      />
      {kind === 'gig' && (
        <>
          <PillField label={t('City')} value={v.city} onChange={(e) => setV((prev) => ({ ...prev, city: e.target.value }))} />
          <div className="flex flex-col gap-2">
            <Label>{t('Setting')}</Label>
            <div className="flex gap-2">
              {/* No setting saved reads as indoor, as on the calendar card and
                  the old Edit page; only a tap saves one. */}
              <Selector size="md" selected={(v.setting || 'indoor') === 'indoor'} onClick={() => setV((prev) => ({ ...prev, setting: 'indoor' }))}>
                {t('Indoor')}
              </Selector>
              <Selector size="md" selected={v.setting === 'outdoor'} onClick={() => setV((prev) => ({ ...prev, setting: 'outdoor' }))}>
                {t('Outdoor')}
              </Selector>
            </div>
          </div>
        </>
      )}
    </EditSheet>
  );
};

/* ─────────────── Lineup (gig: with fees · rehearsal: who is invited) ─────────────── */

interface Person {
  userId: string;
  /** In the band's roster (not just on this lineup). */
  inRoster: boolean;
  name: string;
  initials: string;
  label: string;
  /** Role saved for someone new on the lineup, as the Edit page wrote it. */
  newRole: string;
  defaultFee: number;
}

/** The band's roster, then anyone on the lineup who isn't in it (left the band, a deputy). */
function usePeople(event: EventData, kind: EditKind, lineup: ResolvedMember[], currentUserId?: string): Person[] {
  const t = useT();
  const { bands, selectedBand } = useBand();
  const band = bands.find((b) => b.id === event.band_id) || (selectedBand?.id === event.band_id ? selectedBand : null);
  return useMemo(() => {
    const out: Person[] = [];
    (band?.members || [])
      .filter((m) => m.is_active !== false && !!m.user_id)
      .forEach((m) => {
        const instrument = memberInstrument(m);
        const role = instrument ? instrumentText(instrument) : m.role === 'admin' ? t('Admin') : t('Member');
        out.push({
          userId: m.user_id,
          inRoster: true,
          name: personName(m.profile, t('Unknown musician')),
          initials: personInitials(m.profile, 'M'),
          label: m.user_id === currentUserId ? t('You · {role}', { role }) : role,
          newRole: kind === 'rehearsal' ? instrument || m.role || 'Member' : m.role || m.instrument || 'Member',
          defaultFee: Number(m.default_fee || 0),
        });
      });
    lineup.forEach((m) => {
      if (!m.userId || out.some((p) => p.userId === m.userId)) return;
      out.push({ userId: m.userId, inRoster: false, name: m.name, initials: m.initials, label: m.role, newRole: 'Member', defaultFee: 0 });
    });
    return out;
  }, [band, lineup, kind, currentUserId, t]);
}

function usePricing(bandId: string | undefined, enabled: boolean): BandPricingSettings {
  const [pricing, setPricing] = useState<BandPricingSettings>(DEFAULT_BAND_PRICING);
  useEffect(() => {
    if (!enabled || !bandId) return;
    let cancelled = false;
    getBandPricing(bandId).then((p) => {
      if (!cancelled) setPricing(p);
    });
    return () => {
      cancelled = true;
    };
  }, [bandId, enabled]);
  return pricing;
}

const Avatar: React.FC<{ initials: string }> = ({ initials }) => (
  <span className="w-7 h-7 rounded-full bg-white text-black border-[1.5px] border-border flex items-center justify-center bw-label-sm shrink-0">
    {initials}
  </span>
);

const FeeInput: React.FC<{ name: string; value: string; placeholder?: string; onChange: (v: string) => void }> = ({ name, value, placeholder, onChange }) => {
  const t = useT();
  return (
    <label className="flex items-center gap-1 h-10 px-3 rounded-full bg-field border border-border focus-within:border-foreground shrink-0 cursor-text">
      <span className="bw-body-md text-muted-foreground">{sym()}</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        aria-label={t('Fee for {name}', { name })}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-16 bg-transparent text-right bw-label-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
      />
    </label>
  );
};

const money = (n: number) => `${sym()}${(Math.round(n * 100) / 100).toLocaleString(intlLocale('en-US'))}`;

const LineupSheet: React.FC<SheetBase & { lineup: ResolvedMember[]; currentUserId?: string }> = ({
  open,
  onClose,
  event,
  kind,
  api,
  lineup,
  currentUserId,
}) => {
  const t = useT();
  const { saving, error, setError, run } = useSaving(onClose);
  const people = usePeople(event, kind, lineup, currentUserId);
  const pricing = usePricing(event.band_id, open && kind === 'gig');
  const tbd = event.paymentStatus === 'tbd';
  const initial = useMemo(() => {
    const ids = lineup.map((m) => m.userId).filter((id): id is string => !!id);
    const fees: Record<string, string> = {};
    lineup.forEach((m) => {
      if (m.userId) fees[m.userId] = String(m.fee || 0);
    });
    return { ids, fees };
  }, [lineup]);
  const [selected, setSelected] = useState<string[]>(initial.ids);
  const [fees, setFees] = useState<Record<string, string>>(initial.fees);
  useEffect(() => {
    if (!open) return;
    setSelected(initial.ids);
    setFees(initial.fees);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A new musician's fee: their default, else the band's core / session rate.
  const autoFee = (p: Person | undefined, index: number) => {
    if (p && p.defaultFee > 0) return String(p.defaultFee);
    const core = index < (pricing.core_members_count ?? 1);
    return String((core ? pricing.core_member_rate : pricing.session_musician_rate) || (core ? 300 : 250));
  };
  const toggle = (userId: string) => {
    if (selected.includes(userId)) {
      setSelected((prev) => prev.filter((id) => id !== userId));
      setFees((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    } else {
      const p = people.find((x) => x.userId === userId);
      setSelected((prev) => [...prev, userId]);
      setFees((prev) => ({ ...prev, [userId]: kind === 'gig' ? prev[userId] ?? autoFee(p, selected.length) : prev[userId] ?? '0' }));
    }
  };
  const allSelected = people.length > 0 && people.every((p) => selected.includes(p.userId));
  // Gig presets (Solo, Duo, Trio, Full band): a shortcut that ticks the first musicians, you among them.
  const rosterIds = people.filter((p) => p.inRoster).map((p) => p.userId);
  const presets = [
    { label: t('Solo'), count: 1, type: 'solo' },
    { label: t('Duo'), count: 2, type: 'duo' },
    { label: t('Trio'), count: 3, type: 'trio' },
    { label: t('Full band'), count: rosterIds.length || 1, type: 'full_band' },
  ];
  const [presetType, setPresetType] = useState<string | null>(null);
  const shownPreset = selectedLineupPreset(presets, selected, rosterIds, currentUserId, presetType);
  const applyPreset = (preset: (typeof presets)[number]) => {
    setPresetType(preset.type);
    const next = lineupPresetMembers(preset.count, rosterIds, currentUserId);
    setSelected(next);
    setFees((prev) => {
      const out: Record<string, string> = {};
      next.forEach((id, i) => {
        out[id] = prev[id] && prev[id] !== '0' ? prev[id] : autoFee(people.find((p) => p.userId === id), i);
      });
      return out;
    });
  };

  const known = new Set(initial.ids);
  const feesUnknown = lineup.some((m) => m.feeUnknown);
  const feeOf = (id: string) => (kind === 'gig' && tbd ? 0 : amountOf(fees[id]));
  const wanted: LineupRow[] = selected.map((id) => ({
    user_id: id,
    // Someone already on it keeps their role; the save keeps their RSVP.
    role: known.has(id) ? undefined : people.find((p) => p.userId === id)?.newRole ?? 'Member',
    fee: feeOf(id),
    status: id === currentUserId ? 'confirmed' : 'pending',
  }));
  const dirty =
    JSON.stringify([...selected].sort()) !== JSON.stringify([...initial.ids].sort()) ||
    (kind === 'gig' && selected.some((id) => amountOf(fees[id]) !== amountOf(initial.fees[id])));
  // A gig's fee follows its lineup: the musicians' fees plus the extra band fee.
  const extra = extraFeeOf(event.price, initial.ids.map((id) => amountOf(initial.fees[id])));
  const feePatch =
    kind === 'gig'
      ? changedPatch(event, gigFeePatch({ memberFees: wanted.map((r) => Number(r.fee) || 0), extra, tbd, wasTbd: tbd, previousPrice: event.price }))
      : null;
  const total = wanted.reduce((n, r) => n + (Number(r.fee) || 0), 0) + extra;

  return (
    <EditSheet
      open={open}
      onClose={onClose}
      overline={event.title}
      title={kind === 'rehearsal' ? t('Band roster') : t('Lineup')}
      dirty={dirty}
      // A rehearsal for nobody isn't one (the Edit page read an empty list as the whole band).
      // 05 #5: a gig's lineup saves fees: not while the real fees are unknown.
      canSave={kind === 'gig' ? !feesUnknown : selected.length > 0}
      saving={saving}
      error={kind === 'gig' && feesUnknown ? t('The fees could not be loaded, so the lineup cannot be saved yet. Try again when you are back online.') : error}
      onSave={() => {
        if (kind === 'gig' && feesUnknown) return;
        run(() => api.saveLineup(wanted, feePatch, tbd));
      }}
    >
      {kind === 'gig' && rosterIds.length > 1 && (
        <div className="flex flex-col gap-2">
          <Label>{t('Lineup preset')}</Label>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Selector key={preset.type} size="md" selected={shownPreset === preset.type} onClick={() => applyPreset(preset)}>
                {preset.label}
              </Selector>
            ))}
          </div>
        </div>
      )}
      {kind === 'rehearsal' && people.length > 1 && (
        <div className="flex gap-2">
          <Selector
            size="md"
            selected={allSelected}
            onClick={() => {
              const add = people.map((p) => p.userId).filter((id) => !selected.includes(id));
              setSelected((prev) => [...prev, ...add]);
            }}
          >
            {t('Select all')} · {people.length}
          </Selector>
        </div>
      )}
      <div className="flex flex-col">
        {people.map((p) => {
          const on = selected.includes(p.userId);
          return (
            <div key={p.userId} className="flex items-center gap-3 py-2 min-h-[57px]">
              <div
                role="checkbox"
                aria-checked={on}
                aria-label={p.name}
                tabIndex={0}
                onClick={() => toggle(p.userId)}
                onKeyDown={(e) => {
                  if (e.key !== ' ' && e.key !== 'Enter') return;
                  e.preventDefault();
                  toggle(p.userId);
                }}
                className="flex items-center gap-3 min-w-0 flex-1 rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
              >
                <DotCheckbox
                  checked={on}
                  activeColor={kind === 'rehearsal' ? 'var(--accent-rehearsal)' : 'var(--fg)'}
                  checkColor={kind === 'rehearsal' ? 'var(--accent-rehearsal-fg)' : 'var(--bg)'}
                  inactiveColor="var(--dot-mid)"
                />
                <Avatar initials={p.initials} />
                <span className="min-w-0 flex flex-col">
                  <span className={cn('bw-label-md truncate', on ? 'text-foreground' : 'text-muted-foreground')}>{p.name}</span>
                  <span className="bw-body-sm text-muted-foreground truncate">{p.label}</span>
                </span>
              </div>
              {kind === 'gig' && on && !tbd && (
                <FeeInput name={p.name} value={fees[p.userId] ?? ''} onChange={(val) => setFees((prev) => ({ ...prev, [p.userId]: val }))} />
              )}
            </div>
          );
        })}
      </div>
      {kind === 'gig' && (
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
          <span className="bw-label-sm text-muted-foreground">{t('Total estimate')}</span>
          <span className="bw-h2 tabular-nums">{tbd ? t('TBD') : money(total)}</span>
        </div>
      )}
    </EditSheet>
  );
};

/* ─────────────── Gig fee: musicians, extra band fee, Fee TBD ─────────────── */

const FeeSheet: React.FC<SheetBase & { lineup: ResolvedMember[] }> = ({ open, onClose, event, kind, api, lineup }) => {
  const t = useT();
  const { saving, error, setError, run } = useSaving(onClose);
  const pricing = usePricing(event.band_id, open);
  const members = useMemo(() => lineup.filter((m): m is ResolvedMember & { userId: string } => !!m.userId), [lineup]);
  const feesUnknown = lineup.some((m) => m.feeUnknown);
  const wasTbd = event.paymentStatus === 'tbd';
  const initial = useMemo(() => {
    const fees: Record<string, string> = {};
    members.forEach((m) => (fees[m.userId] = String(m.fee || 0)));
    const extra = extraFeeOf(event.price, members.map((m) => Number(m.fee) || 0));
    return { fees, extra: extra > 0 ? String(extra) : '' };
  }, [members, event.price]);
  const [tbd, setTbd] = useState(wasTbd);
  const [fees, setFees] = useState(initial.fees);
  const [extra, setExtra] = useState(initial.extra);
  useEffect(() => {
    if (!open) return;
    setTbd(wasTbd);
    setFees(initial.fees);
    setExtra(initial.extra);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const memberFee = (id: string) => (tbd ? 0 : amountOf(fees[id]));
  const feesChanged = members.some((m) => memberFee(m.userId) !== amountOf(initial.fees[m.userId]));
  const feePatch = gigFeePatch({
    memberFees: members.map((m) => memberFee(m.userId)),
    extra: tbd ? 0 : amountOf(extra),
    tbd,
    wasTbd,
    previousPrice: event.price,
  });
  const eventPatch = changedPatch(event, feePatch);
  const dirty = feesChanged || !!eventPatch;
  const services = (pricing.custom_services || []).filter((s) => s.is_active);
  const total = members.reduce((n, m) => n + memberFee(m.userId), 0) + (tbd ? 0 : amountOf(extra));

  const save = () =>
    run(() =>
      feesChanged
        ? api.saveLineup(
            // Same people, new fees: roles and answers stay as they are.
            members.map((m) => ({ user_id: m.userId, fee: memberFee(m.userId), status: 'pending' })),
            eventPatch,
            tbd,
          )
        : api.saveFields(eventPatch),
    );

  return (
    <EditSheet
      open={open}
      onClose={onClose}
      overline={event.title}
      title={t('Edit fee')}
      dirty={dirty}
      // 05 #5: the fees shown are not the real ones: nothing to save from them.
      canSave={!feesUnknown}
      saving={saving}
      error={feesUnknown ? t('The fees could not be loaded, so they cannot be changed yet. Try again when you are back online.') : error}
      onSave={() => {
        if (!feesUnknown) save();
      }}
    >
      {kind === 'gig' && (
        <div className="flex flex-col gap-3">
          <Selector selected={tbd} onClick={() => setTbd((v) => !v)}>
            {t('Fee to be discussed (TBD)')}
          </Selector>
          {tbd && <span className="bw-body-sm text-muted-foreground">{t('The gig is confirmed on the calendar; set the fees once the deal is closed.')}</span>}
        </div>
      )}
      {!tbd && (
        <>
          {members.length > 0 && (
            <div className="flex flex-col">
              {members.map((m) => (
                <div key={m.userId} className={cn('flex items-center gap-3 py-2 min-h-[57px]', m.status === 'declined' && 'opacity-60')}>
                  <Avatar initials={m.initials} />
                  <span className="min-w-0 flex-1 flex flex-col">
                    <span className="bw-label-md truncate">{m.name}</span>
                    <span className="bw-body-sm text-muted-foreground truncate">{m.role}</span>
                  </span>
                  <FeeInput name={m.name} value={fees[m.userId] ?? ''} onChange={(val) => setFees((prev) => ({ ...prev, [m.userId]: val }))} />
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-3">
            <PillField
              label={t('Extra band fee / services')}
              type="number"
              inputMode="decimal"
              icon={<span className="bw-body-lg text-muted-foreground w-5 text-center">{sym()}</span>}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="0"
            />
            {services.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {services.map((s) => (
                  <Selector key={s.id} size="sm" selected={false} onClick={() => setExtra(String(amountOf(extra) + s.price))}>
                    + {s.name} ({sym()}
                    {s.price})
                  </Selector>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
        <span className="bw-label-sm text-muted-foreground">{t('Total estimate')}</span>
        <span className="bw-h2 tabular-nums">{tbd ? t('TBD') : money(total)}</span>
      </div>
    </EditSheet>
  );
};

/* ─────────────── Rehearsal studio cost ─────────────── */

const CostSheet: React.FC<SheetBase & { going: number }> = ({ open, onClose, event, api, going }) => {
  const t = useT();
  const { saving, error, setError, run } = useSaving(onClose);
  const saved = amountOf(event.price);
  const [paid, setPaid] = useState(saved > 0);
  const [amount, setAmount] = useState(saved > 0 ? String(saved) : '');
  useEffect(() => {
    if (!open) return;
    setPaid(saved > 0);
    setAmount(saved > 0 ? String(saved) : '');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const patch = changedPatch(event, costCardPatch({ paid, amount }));
  const cost = paid ? amountOf(amount) : 0;
  const perPerson = cost / Math.max(going, 1);
  return (
    <EditSheet
      open={open}
      onClose={onClose}
      overline={event.title}
      title={t('Studio cost')}
      dirty={!!patch}
      saving={saving}
      error={error}
      onSave={() => run(() => api.saveFields(patch))}
    >
      <Segmented
        label={t('Studio cost')}
        value={paid ? 'paid' : 'free'}
        options={[
          { value: 'free', label: t('Free') },
          { value: 'paid', label: t('Paid') },
        ]}
        onChange={(v) => setPaid(v === 'paid')}
      />
      {paid && (
        <div className="flex items-end justify-between gap-3 rounded-[24px] bg-card p-4">
          <label className="flex flex-col gap-2 min-w-0">
            <span className="bw-label-sm text-muted-foreground">{t('Total studio cost')}</span>
            <span className="flex items-baseline gap-2">
              <span className="bw-value-lg">{sym()}</span>
              <input
                type="number"
                min="0"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-28 min-w-0 bg-transparent outline-none bw-value-lg text-foreground placeholder:text-muted-foreground/40"
                placeholder="0"
              />
            </span>
          </label>
          <div className="flex flex-col gap-2 items-end text-right shrink-0">
            <span className="bw-label-sm text-muted-foreground">{t('Per person')}</span>
            <span className="bw-value-md">{`${sym().trim()} ${Number.isInteger(perPerson) ? perPerson : perPerson.toFixed(2)}`}</span>
          </div>
        </div>
      )}
    </EditSheet>
  );
};

/* ─────────────── To-dos ─────────────── */

const TasksSheet: React.FC<SheetBase & { tasks: EventTask[] }> = ({ open, onClose, event, api, tasks }) => {
  const t = useT();
  const { saving, error, setError, run } = useSaving(onClose);
  const [rows, setRows] = useState<{ key: string; id?: string; title: string; dueOffset?: number }[]>([]);
  const [newText, setNewText] = useState('');
  // The band's to-do lists, offered while the event has no tasks (as on the Edit page).
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  useEffect(() => {
    if (!open) return;
    setRows(tasks.map((task) => ({ key: task.id, id: task.id, title: task.title })));
    setNewText('');
    setError(null);
    if (!event.band_id) return;
    let cancelled = false;
    listTemplates(event.band_id).then(({ data }) => {
      if (!cancelled && data) setTemplates(data.filter((tpl) => tpl.tasks.length > 0));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const add = () => {
    const title = newText.trim();
    if (!title) return;
    setRows((prev) => [...prev, { key: `new-${Date.now()}-${prev.length}`, title }]);
    setNewText('');
  };
  // A task typed but not added with the button still counts.
  const drafts: { id?: string; title: string; dueOffset?: number }[] = [
    ...rows.map((r) => ({ id: r.id, title: r.title, ...(r.dueOffset != null ? { dueOffset: r.dueOffset } : {}) })),
    ...(newText.trim() ? [{ title: newText.trim() }] : []),
  ];
  const dirty =
    JSON.stringify(drafts.map((d) => [d.id ?? null, d.title.trim()])) !== JSON.stringify(tasks.map((task) => [task.id, task.title.trim()]));
  return (
    <EditSheet
      open={open}
      onClose={onClose}
      overline={event.title}
      title={t('Tasks')}
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => run(() => api.saveTasks(drafts, tasks.map((task) => task.id)))}
    >
      <div className="flex items-center gap-2">
        <PillField
          label={t('New task')}
          hideLabel
          className="flex-1"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t('Add a preparation task...')}
        />
        <PillButton variant="primary" size="md" fullWidth={false} onClick={add} disabled={!newText.trim()} icon={<Plus className="w-4 h-4" />}>
          {t('Add')}
        </PillButton>
      </div>
      {rows.length === 0 && templates.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>{t('Load a to-do list')}</Label>
          <div className="flex flex-wrap gap-2">
            {templates.map((tpl) => (
              <Selector
                key={tpl.id}
                size="sm"
                selected={false}
                onClick={() =>
                  setRows(tpl.tasks.map((task, i) => ({ key: `tpl-${tpl.id}-${i}`, title: task.title, dueOffset: task.dueOffset })))
                }
              >
                <Folder className="w-3.5 h-3.5" />
                {tpl.name}
                <span className="opacity-60">({tpl.tasks.length})</span>
              </Selector>
            ))}
          </div>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="bw-body-sm text-muted-foreground">{t('No tasks assigned yet.')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={row.key} className="flex items-center gap-2">
              <input
                type="text"
                aria-label={t('Task {number}', { number: i + 1 })}
                value={row.title}
                onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, title: e.target.value } : r)))}
                className="flex-1 min-w-0 h-11 px-4 rounded-full bg-field border border-border bw-body-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-foreground"
              />
              <IconButton label={t('Delete task')} variant="ghost" size="sm" icon={<X />} onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))} />
            </div>
          ))}
        </div>
      )}
    </EditSheet>
  );
};

/* ─────────────── Client & notes ─────────────── */

const NotesSheet: React.FC<SheetBase> = ({ open, onClose, event, kind, api }) => {
  const t = useT();
  const { saving, error, setError, run } = useSaving(onClose);
  const [clientName, setClientName] = useState(event.clientName || '');
  const [notes, setNotes] = useState(event.notes || '');
  useEffect(() => {
    if (!open) return;
    setClientName(event.clientName || '');
    setNotes(event.notes || '');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const patch = changedPatch(event, notesCardPatch(kind, { clientName, notes }));
  return (
    <EditSheet
      open={open}
      onClose={onClose}
      overline={event.title}
      title={kind === 'gig' ? t('Client & notes') : t('Notes')}
      dirty={!!patch}
      saving={saving}
      error={error}
      onSave={() => run(() => api.saveFields(patch))}
    >
      {kind === 'gig' && (
        <PillField label={t('Client / promoter')} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder={t('e.g. Rossi / Red Bull')} />
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="ovw-notes">{t('Notes for the band')}</Label>
        <textarea
          id="ovw-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('Any details or notes for the band...')}
          rows={5}
          className={AREA}
        />
      </div>
    </EditSheet>
  );
};

/* ─────────────── All of them ─────────────── */

export const OverviewEditSheets: React.FC<{
  card: EditCard | null;
  onClose: () => void;
  event: EventData;
  kind: EditKind;
  api: OverviewEditApi;
  lineup: ResolvedMember[];
  tasks: EventTask[];
  allEvents?: EventData[];
  currentUserId?: string;
  /** Another card's editor was asked for while `card` is open. */
  switchTo?: EditCard | null;
  /** The open editor let it go (true) or kept it (false). */
  onSwitch?: (go: boolean) => void;
}> = ({ card, onClose, event, kind, api, lineup, tasks, allEvents, currentUserId, switchTo, onSwitch }) => {
  const base = { onClose, event, kind, api };
  const going = lineup.filter((m) => m.status === 'confirmed').length;
  const switchRequest = useMemo(
    () => ({ pending: !!switchTo, resolve: (go: boolean) => onSwitch?.(go) }),
    [switchTo, onSwitch],
  );
  return (
    <SwitchRequest.Provider value={switchRequest}>
      <EventFieldsSheet {...base} open={card === 'event'} allEvents={allEvents} />
      <VenueSheet {...base} open={card === 'venue'} />
      <LineupSheet {...base} open={card === 'lineup'} lineup={lineup} currentUserId={currentUserId} />
      {kind === 'gig' && <FeeSheet {...base} open={card === 'fee'} lineup={lineup} />}
      {kind === 'rehearsal' && <CostSheet {...base} open={card === 'cost'} going={going || lineup.length} />}
      <TasksSheet {...base} open={card === 'tasks'} tasks={tasks} />
      <NotesSheet {...base} open={card === 'notes'} />
    </SwitchRequest.Provider>
  );
};
