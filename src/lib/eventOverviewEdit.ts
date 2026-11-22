/**
 * Editing a gig or rehearsal from its overview (EventDetail), card by card,
 * instead of the separate Edit page. Pure helpers: which card edits which
 * field, and the events-table update each card saves. They write the same
 * columns, with the same rules, as the Edit page did (handleEventCreate in
 * AuthenticatedApp), so the database triggers notify the lineup exactly as
 * before (bw_trg_event_changed: date, time, load-in / soundcheck, venue).
 */
import { addressWithoutCity } from '@/lib/eventAddress';
import { mergeRecurrenceRule } from '@/lib/recurrenceSkips';

export type EditKind = 'gig' | 'rehearsal';

/** The overview cards that open an editor. */
export type EditCard = 'event' | 'venue' | 'lineup' | 'fee' | 'cost' | 'setlist' | 'tasks' | 'notes';

/** The cards each kind of event shows an edit action on. */
export const EDIT_CARDS: Record<EditKind, EditCard[]> = {
  gig: ['event', 'venue', 'lineup', 'fee', 'setlist', 'tasks', 'notes'],
  rehearsal: ['event', 'venue', 'lineup', 'cost', 'setlist', 'tasks', 'notes'],
};

/**
 * Every field of the Edit page (gig: CreateEventModal, rehearsal:
 * RehearsalCreationWizard) and the card that edits it now. `card: null` is a
 * field the Edit page showed but never saved (form-only), so it has nothing
 * to move. `columns`: what the card writes for it.
 */
export const EDIT_PAGE_FIELDS: {
  field: string;
  kinds: EditKind[];
  card: EditCard | null;
  columns?: string[];
}[] = [
  { field: 'title', kinds: ['gig', 'rehearsal'], card: 'event', columns: ['title'] },
  { field: 'eventType', kinds: ['gig'], card: 'event', columns: ['event_type'] },
  { field: 'recurrence', kinds: ['rehearsal'], card: 'event', columns: ['is_recurring', 'recurrence_rule'] },
  { field: 'date', kinds: ['gig', 'rehearsal'], card: 'event', columns: ['event_date'] },
  { field: 'startTime', kinds: ['gig', 'rehearsal'], card: 'event', columns: ['start_time'] },
  { field: 'endTime', kinds: ['gig', 'rehearsal'], card: 'event', columns: ['end_time'] },
  { field: 'loadInTime', kinds: ['gig'], card: 'event', columns: ['load_in_time'] },
  { field: 'soundcheckTime', kinds: ['gig'], card: 'event', columns: ['soundcheck_time'] },
  { field: 'venue', kinds: ['gig', 'rehearsal'], card: 'venue', columns: ['venue_name', 'venue'] },
  { field: 'address', kinds: ['gig', 'rehearsal'], card: 'venue', columns: ['venue_address'] },
  { field: 'city', kinds: ['gig'], card: 'venue', columns: ['venue_city'] },
  { field: 'setting', kinds: ['gig'], card: 'venue', columns: ['indoor_outdoor'] },
  { field: 'clientName', kinds: ['gig'], card: 'notes', columns: ['client_name'] },
  // A rehearsal's note was set only by the iPad composer (new events): now editable too.
  { field: 'notes', kinds: ['gig', 'rehearsal'], card: 'notes', columns: ['notes'] },
  { field: 'lineup', kinds: ['gig', 'rehearsal'], card: 'lineup' },
  { field: 'memberFees', kinds: ['gig'], card: 'fee', columns: ['fee'] },
  { field: 'extraBandFee', kinds: ['gig'], card: 'fee', columns: ['fee'] },
  { field: 'feeTbd', kinds: ['gig'], card: 'fee', columns: ['fee', 'payment_status'] },
  { field: 'studioCost', kinds: ['rehearsal'], card: 'cost', columns: ['fee'] },
  { field: 'setlist', kinds: ['gig', 'rehearsal'], card: 'setlist' },
  { field: 'tasks', kinds: ['gig', 'rehearsal'], card: 'tasks' },
  // Shortcuts that fill a card's fields (not stored themselves): in the same card.
  { field: 'lineupPreset', kinds: ['gig'], card: 'lineup' },
  { field: 'setlistTemplate', kinds: ['gig', 'rehearsal'], card: 'setlist' },
  { field: 'taskTemplate', kinds: ['gig', 'rehearsal'], card: 'tasks' },
  // Shown by the Edit page, never saved by it.
  { field: 'guests', kinds: ['gig'], card: null },
  { field: 'duration', kinds: ['gig'], card: null },
  { field: 'sessionType', kinds: ['rehearsal'], card: null },
  { field: 'gearChecklist', kinds: ['rehearsal'], card: null },
];

/** The event as EventDetail has it (EventData), only what the editors read. */
export interface EditableEvent {
  title: string;
  eventType?: string;
  date: string;
  /** Opened on a later date of a repeating rehearsal: the series' first date. */
  seriesDate?: string;
  time: string;
  timeSet?: boolean;
  endTime?: string;
  loadInTime?: string;
  soundcheckTime?: string;
  location?: string;
  venueName?: string;
  venueAddress?: string;
  venueCity?: string;
  indoorOutdoor?: string;
  clientName?: string;
  notes?: string;
  price?: string;
  paymentStatus?: string;
  is_recurring?: boolean;
  recurrence_rule?: { freq?: string; frequency?: string; interval?: number; skip_dates?: string[]; [key: string]: unknown } | null;
}

export type Recurrence = 'once' | 'weekly' | 'biweekly' | 'monthly';

/** The rehearsal's repeat as the wizard offers it ("every 2 weeks" = biweekly). */
export function recurrenceOf(isRecurring?: boolean, rule?: EditableEvent['recurrence_rule']): Recurrence {
  const freq = String(rule?.frequency || rule?.freq || '').toLowerCase();
  if (freq === 'weekly') return (rule?.interval ?? 1) === 2 ? 'biweekly' : 'weekly';
  if (freq === 'biweekly') return 'biweekly';
  if (freq === 'monthly') return 'monthly';
  return isRecurring ? 'weekly' : 'once';
}

/** is_recurring + recurrence_rule, as the rehearsal wizard saves them. */
export function recurrencePatch(r: Recurrence): { is_recurring: boolean; recurrence_rule: { frequency: string; interval: number } | null } {
  if (r === 'once') return { is_recurring: false, recurrence_rule: null };
  return {
    is_recurring: true,
    recurrence_rule: { frequency: r === 'biweekly' ? 'weekly' : r, interval: r === 'biweekly' ? 2 : 1 },
  };
}

const hhmm = (t?: string | null) => (t ? String(t).slice(0, 5) : '');

/* ─── "Event" card: title, type / repeat, date and times ─── */

export interface EventCardValues {
  title: string;
  eventType: string;
  recurrence: Recurrence;
  date: string;
  startTime: string;
  endTime: string;
  loadInTime: string;
  soundcheckTime: string;
}

export function eventCardValues(ev: EditableEvent): EventCardValues {
  return {
    title: ev.title || '',
    eventType: (ev.eventType || '').toLowerCase(),
    recurrence: recurrenceOf(ev.is_recurring, ev.recurrence_rule),
    date: ev.date || '',
    // No start time yet: 20:00, as the Edit page offered.
    startTime: (ev.timeSet === false ? '' : hhmm(ev.time)) || '20:00',
    endTime: hhmm(ev.endTime),
    loadInTime: hhmm(ev.loadInTime),
    soundcheckTime: hhmm(ev.soundcheckTime),
  };
}

/**
 * `saved`: the event as opened. A rehearsal's rule changes only its
 * cadence: deleted dates (skip_dates) and other keys stay (Codex #297 B2).
 * Opened on a later date of the series (`seriesDate`), the series start is
 * not written unless the whole series moves (`moveScope` 'series'); switched
 * to "once", the event keeps the date on screen.
 */
export function eventCardPatch(
  kind: EditKind,
  v: EventCardValues,
  saved?: Partial<Pick<EditableEvent, 'recurrence_rule' | 'date' | 'seriesDate'>>,
  /** A new date for one date of a series: that date only, or the whole series. */
  moveScope?: 'date' | 'series',
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    title: v.title.trim(),
    event_date: v.date,
    start_time: v.startTime || '20:00',
    end_time: v.endTime || null,
  };
  if (kind === 'rehearsal') {
    const r = recurrencePatch(v.recurrence);
    // One later date of a series that still repeats: the series start is
    // written only when the whole series moves on purpose (Codex #297 round 3).
    // Switched to "once", it keeps the date on screen.
    const start = occurrenceStart(saved, v.date, v.recurrence !== 'once', moveScope);
    if (start === null) delete base.event_date;
    else if (start !== undefined) base.event_date = start;
    return { ...base, ...r, recurrence_rule: mergeRecurrenceRule(saved?.recurrence_rule, r.recurrence_rule) };
  }
  return {
    ...base,
    ...(v.eventType ? { event_type: v.eventType } : {}),
    load_in_time: v.loadInTime || null,
    soundcheck_time: v.soundcheckTime || null,
  };
}

/**
 * The series start to save when one later date of it (`saved.seriesDate`)
 * was edited and it still repeats: null (not written: the date was left
 * alone, or moved for this date only), the start moved by the same days
 * (the whole series), or undefined (not such a date: save the date as is).
 */
export function occurrenceStart(
  saved: { date?: string; seriesDate?: string } | null | undefined,
  newDate: string,
  repeating: boolean,
  moveScope?: 'date' | 'series',
): string | null | undefined {
  if (!saved?.seriesDate || !saved.date || !repeating) return undefined;
  if (newDate !== saved.date && moveScope === 'series') return shiftDay(saved.seriesDate, daysApart(saved.date, newDate));
  return null;
}

const noonOf = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
const daysApart = (a: string, b: string) => Math.round((noonOf(b).getTime() - noonOf(a).getTime()) / 86_400_000);
const shiftDay = (ymd: string, n: number) => {
  const t = noonOf(ymd);
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

/* ─── "Venue" card ─── */

export interface VenueCardValues {
  venue: string;
  address: string;
  city: string;
  setting: string;
}

export function venueCardValues(kind: EditKind, ev: EditableEvent): VenueCardValues {
  return {
    venue: ev.venueName || '',
    // The gig form edits the street apart from the city (lib/eventAddress).
    address: kind === 'gig' ? addressWithoutCity(ev.venueAddress, ev.venueCity) : ev.venueAddress || '',
    city: ev.venueCity || '',
    setting: ev.indoorOutdoor || '',
  };
}

export function venueCardPatch(kind: EditKind, v: VenueCardValues): Record<string, unknown> {
  const venue = v.venue.trim() || null;
  if (kind === 'rehearsal') {
    // The rehearsal form has no city: the address is saved as typed.
    return { venue_name: venue, venue, venue_address: v.address.trim() || null };
  }
  const city = v.city.trim();
  const street = addressWithoutCity(v.address, city);
  const sameAsCity = !!city && street.toLocaleLowerCase() === city.toLocaleLowerCase();
  return {
    venue_name: venue,
    venue,
    venue_address: [sameAsCity ? '' : street, city].filter(Boolean).join(', ') || null,
    venue_city: city || null,
    indoor_outdoor: v.setting || null,
  };
}

/* ─── "Client & notes" / "Notes" card ─── */

export function notesCardPatch(kind: EditKind, v: { clientName: string; notes: string }): Record<string, unknown> {
  const notes = v.notes.trim() ? v.notes : null;
  return kind === 'gig' ? { client_name: v.clientName.trim() || null, notes } : { notes };
}

/* ─── Money ─── */

export const amountOf = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The extra band fee isn't stored on its own: the gig fee is the musicians'
 * fees plus the extra, so it is what the saved fee has beyond them.
 */
export function extraFeeOf(price: unknown, memberFees: number[]): number {
  const extra = round2(amountOf(price) - memberFees.reduce((a, b) => a + (Number(b) || 0), 0));
  return extra > 0 ? extra : 0;
}

/**
 * events.fee and payment_status of a gig, as the Edit page saved them:
 * "Fee TBD" saves 0 and 'tbd'; leaving TBD sets 'pending'; a total of 0
 * keeps the fee already saved.
 */
export function gigFeePatch(opts: {
  memberFees: number[];
  extra: number;
  tbd: boolean;
  wasTbd: boolean;
  previousPrice: unknown;
}): Record<string, unknown> {
  const total = round2(opts.memberFees.reduce((a, b) => a + (Number(b) || 0), 0) + (Number(opts.extra) || 0));
  const fee = opts.tbd ? 0 : total || amountOf(opts.previousPrice);
  return {
    fee,
    ...(opts.tbd ? { payment_status: 'tbd' } : opts.wasTbd ? { payment_status: 'pending' } : {}),
  };
}

/** Rehearsal studio cost: free is 0, paid is the total (split between who goes). */
export function costCardPatch(v: { paid: boolean; amount: string }): Record<string, unknown> {
  return { fee: v.paid ? amountOf(v.amount) : 0 };
}

/* ─── Comparing with what is saved ─── */

const norm = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** What the event has now for a column a card writes. */
export function savedValue(ev: EditableEvent, column: string): unknown {
  switch (column) {
    case 'title':
      return ev.title;
    case 'event_type':
      return (ev.eventType || '').toLowerCase();
    case 'event_date':
      return ev.seriesDate || ev.date;
    case 'start_time':
      return ev.timeSet === false ? '' : hhmm(ev.time);
    case 'end_time':
      return hhmm(ev.endTime);
    case 'load_in_time':
      return hhmm(ev.loadInTime);
    case 'soundcheck_time':
      return hhmm(ev.soundcheckTime);
    case 'venue_name':
    case 'venue':
      return ev.venueName;
    case 'venue_address':
      return ev.venueAddress;
    case 'venue_city':
      return ev.venueCity;
    case 'indoor_outdoor':
      return ev.indoorOutdoor;
    case 'client_name':
      return ev.clientName;
    case 'notes':
      return ev.notes;
    case 'fee':
      return amountOf(ev.price);
    case 'payment_status':
      return ev.paymentStatus;
    case 'is_recurring':
      return !!ev.is_recurring;
    case 'recurrence_rule': {
      const r = recurrenceOf(ev.is_recurring, ev.recurrence_rule);
      return mergeRecurrenceRule(ev.recurrence_rule, recurrencePatch(r).recurrence_rule);
    }
    default:
      return undefined;
  }
}

/**
 * The card's update when something in it changed, else null (nothing to
 * write). Like the Edit page, a card that changed saves all its fields.
 */
export function changedPatch(ev: EditableEvent, patch: Record<string, unknown>): Record<string, unknown> | null {
  const changed = Object.entries(patch).some(([col, value]) => {
    const before = savedValue(ev, col);
    if (col === 'fee') return amountOf(value) !== before;
    if (col.endsWith('_time')) return hhmm(value as string) !== before;
    return norm(value) !== norm(before);
  });
  return changed ? patch : null;
}

/**
 * The saved columns as EventData fields: the overview shows a save at once,
 * before the events list reloads.
 */
export function eventDataPatch(patch: Record<string, unknown>, ev: EditableEvent): Partial<EditableEvent> {
  const out: Partial<EditableEvent> = {};
  const str = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : String(v));
  for (const [col, value] of Object.entries(patch)) {
    switch (col) {
      case 'title':
        out.title = String(value ?? '');
        break;
      case 'event_type':
        out.eventType = str(value);
        break;
      case 'event_date':
        // The series start kept under one date of it: that date stays on screen.
        out.date = ev.seriesDate && value === ev.seriesDate ? ev.date : String(value ?? '');
        break;
      case 'start_time':
        out.time = String(value || '20:00');
        out.timeSet = true;
        break;
      case 'end_time':
        out.endTime = str(value);
        break;
      case 'load_in_time':
        out.loadInTime = str(value);
        break;
      case 'soundcheck_time':
        out.soundcheckTime = str(value);
        break;
      case 'venue_name':
        out.venueName = str(value);
        break;
      case 'venue_address':
        out.venueAddress = str(value);
        break;
      case 'venue_city':
        out.venueCity = str(value);
        break;
      case 'indoor_outdoor':
        out.indoorOutdoor = str(value);
        break;
      case 'client_name':
        out.clientName = str(value);
        break;
      case 'notes':
        out.notes = str(value);
        break;
      case 'fee':
        out.price = String(amountOf(value));
        break;
      case 'payment_status':
        out.paymentStatus = str(value);
        break;
      case 'is_recurring':
        out.is_recurring = !!value;
        break;
      case 'recurrence_rule':
        out.recurrence_rule = (value as EditableEvent['recurrence_rule']) ?? undefined;
        break;
    }
  }
  // The list shows the venue, else the city, else TBD (eventToEventItem).
  if ('venue_name' in patch || 'venue_city' in patch) {
    const name = 'venue_name' in patch ? out.venueName : ev.venueName;
    const city = 'venue_city' in patch ? out.venueCity : ev.venueCity;
    out.location = name || city || 'TBD';
  }
  return out;
}
