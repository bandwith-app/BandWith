/**
 * Gigs and rehearsals are edited from their overview, card by card: every
 * field of the old Edit page has a card, and each card writes the columns
 * the Edit page wrote, with its rules.
 */
import { describe, it, expect } from 'vitest';
import {
  EDIT_CARDS,
  EDIT_PAGE_FIELDS,
  changedPatch,
  costCardPatch,
  eventCardPatch,
  eventCardValues,
  eventDataPatch,
  extraFeeOf,
  gigFeePatch,
  notesCardPatch,
  recurrenceOf,
  recurrencePatch,
  savedValue,
  venueCardPatch,
  venueCardValues,
  type EditableEvent,
} from '../eventOverviewEdit';

const gig: EditableEvent = {
  title: 'Wedding at Villa Rosa',
  eventType: 'wedding',
  date: '2026-12-05',
  time: '20:30:00',
  endTime: '23:30:00',
  loadInTime: '17:00:00',
  soundcheckTime: '18:00:00',
  venueName: 'Villa Rosa',
  venueAddress: 'Via Roma 1, Como',
  venueCity: 'Como',
  indoorOutdoor: 'outdoor',
  clientName: 'Rossi',
  notes: 'Dress code: black',
  price: '1500',
  paymentStatus: 'pending',
};

const rehearsal: EditableEvent = {
  title: 'Weekly rehearsal',
  date: '2026-12-02',
  time: '19:00',
  endTime: '22:00',
  venueName: 'Studio 5',
  venueAddress: 'Via Po 3, Milano',
  price: '60',
  is_recurring: true,
  recurrence_rule: { frequency: 'weekly', interval: 2 },
};

describe('field → card coverage', () => {
  it('gives every field the Edit page saved a card of its own kind of event', () => {
    for (const f of EDIT_PAGE_FIELDS) {
      if (f.card === null) continue;
      for (const kind of f.kinds) expect(EDIT_CARDS[kind], `${kind}.${f.field}`).toContain(f.card);
    }
  });

  it('lists each Edit page field once per kind', () => {
    for (const kind of ['gig', 'rehearsal'] as const) {
      const names = EDIT_PAGE_FIELDS.filter((f) => f.kinds.includes(kind)).map((f) => f.field);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('has a field behind every card', () => {
    for (const kind of ['gig', 'rehearsal'] as const) {
      for (const card of EDIT_CARDS[kind]) {
        expect(EDIT_PAGE_FIELDS.some((f) => f.card === card && f.kinds.includes(kind)), `${kind}:${card}`).toBe(true);
      }
    }
  });

  it('only leaves out the fields the Edit page never saved', () => {
    expect(EDIT_PAGE_FIELDS.filter((f) => f.card === null).map((f) => f.field).sort()).toEqual(
      ['duration', 'gearChecklist', 'guests', 'sessionType'].sort(),
    );
  });

  it('writes, from the cards, every column the Edit page wrote', () => {
    const gigCols = new Set([
      ...Object.keys(eventCardPatch('gig', eventCardValues(gig))),
      ...Object.keys(venueCardPatch('gig', venueCardValues('gig', gig))),
      ...Object.keys(notesCardPatch('gig', { clientName: 'x', notes: 'y' })),
      ...Object.keys(gigFeePatch({ memberFees: [1], extra: 0, tbd: true, wasTbd: false, previousPrice: 0 })),
    ]);
    const rehCols = new Set([
      ...Object.keys(eventCardPatch('rehearsal', eventCardValues(rehearsal))),
      ...Object.keys(venueCardPatch('rehearsal', venueCardValues('rehearsal', rehearsal))),
      ...Object.keys(notesCardPatch('rehearsal', { clientName: '', notes: 'y' })),
      ...Object.keys(costCardPatch({ paid: true, amount: '1' })),
    ]);
    for (const f of EDIT_PAGE_FIELDS) {
      for (const col of f.columns ?? []) {
        for (const kind of f.kinds) expect((kind === 'gig' ? gigCols : rehCols).has(col), `${kind}.${f.field} → ${col}`).toBe(true);
      }
    }
    // Saved values can be read back for each of them (the Save button's "changed").
    for (const col of [...gigCols, ...rehCols]) expect(savedValue(gig, col) !== undefined || col === 'is_recurring' || col === 'recurrence_rule' || col === 'event_type').toBe(true);
  });
});

describe('event card', () => {
  it('opens on what is saved, times as HH:MM', () => {
    expect(eventCardValues(gig)).toMatchObject({
      title: 'Wedding at Villa Rosa',
      eventType: 'wedding',
      startTime: '20:30',
      endTime: '23:30',
      loadInTime: '17:00',
      soundcheckTime: '18:00',
    });
  });

  it('saves the gig columns like the Edit page (empty times null, start 20:00 by default)', () => {
    const v = { ...eventCardValues(gig), title: '  New title ', startTime: '', endTime: '', loadInTime: '', soundcheckTime: '' };
    expect(eventCardPatch('gig', v)).toEqual({
      title: 'New title',
      event_date: '2026-12-05',
      start_time: '20:00',
      end_time: null,
      event_type: 'wedding',
      load_in_time: null,
      soundcheck_time: null,
    });
  });

  it('saves a rehearsal with its repeat and without gig-only columns', () => {
    const patch = eventCardPatch('rehearsal', eventCardValues(rehearsal));
    expect(patch).toEqual({
      title: 'Weekly rehearsal',
      event_date: '2026-12-02',
      start_time: '19:00',
      end_time: '22:00',
      is_recurring: true,
      recurrence_rule: { frequency: 'weekly', interval: 2 },
    });
    expect(patch).not.toHaveProperty('load_in_time');
    expect(patch).not.toHaveProperty('event_type');
  });

  it('reads and writes the repeat as the rehearsal wizard does', () => {
    expect(recurrenceOf(true, { frequency: 'weekly', interval: 2 })).toBe('biweekly');
    expect(recurrenceOf(true, { freq: 'monthly' })).toBe('monthly');
    expect(recurrenceOf(false, null)).toBe('once');
    expect(recurrencePatch('once')).toEqual({ is_recurring: false, recurrence_rule: null });
    expect(recurrencePatch('biweekly')).toEqual({ is_recurring: true, recurrence_rule: { frequency: 'weekly', interval: 2 } });
  });
});

describe('venue card', () => {
  it('edits the street apart from the city on a gig, and joins them on save', () => {
    const v = venueCardValues('gig', gig);
    expect(v).toEqual({ venue: 'Villa Rosa', address: 'Via Roma 1', city: 'Como', setting: 'outdoor' });
    expect(venueCardPatch('gig', { ...v, address: 'Via Milano 9', city: 'Lecco' })).toEqual({
      venue_name: 'Villa Rosa',
      venue: 'Villa Rosa',
      venue_address: 'Via Milano 9, Lecco',
      venue_city: 'Lecco',
      indoor_outdoor: 'outdoor',
    });
  });

  it('keeps a rehearsal address as typed and never touches the city', () => {
    const patch = venueCardPatch('rehearsal', { venue: 'Studio 6', address: 'Via Po 4, Milano', city: '', setting: '' });
    expect(patch).toEqual({ venue_name: 'Studio 6', venue: 'Studio 6', venue_address: 'Via Po 4, Milano' });
  });
});

describe('notes, fee and cost', () => {
  it('saves client and notes on a gig, notes only on a rehearsal', () => {
    expect(notesCardPatch('gig', { clientName: ' ', notes: ' ' })).toEqual({ client_name: null, notes: null });
    expect(notesCardPatch('rehearsal', { clientName: 'x', notes: 'Bring the click' })).toEqual({ notes: 'Bring the click' });
  });

  it('works out the extra band fee from the saved total', () => {
    expect(extraFeeOf('1500', [400, 400, 400])).toBe(300);
    expect(extraFeeOf('1000', [600, 600])).toBe(0);
  });

  it('saves the fee as the Edit page did', () => {
    expect(gigFeePatch({ memberFees: [400, 400], extra: 200, tbd: false, wasTbd: false, previousPrice: '900' })).toEqual({ fee: 1000 });
    expect(gigFeePatch({ memberFees: [400], extra: 0, tbd: true, wasTbd: false, previousPrice: '900' })).toEqual({ fee: 0, payment_status: 'tbd' });
    expect(gigFeePatch({ memberFees: [300], extra: 0, tbd: false, wasTbd: true, previousPrice: '0' })).toEqual({ fee: 300, payment_status: 'pending' });
    // A total of 0 keeps the fee already saved.
    expect(gigFeePatch({ memberFees: [0], extra: 0, tbd: false, wasTbd: false, previousPrice: '750' })).toEqual({ fee: 750 });
  });

  it('saves a free rehearsal as 0', () => {
    expect(costCardPatch({ paid: false, amount: '80' })).toEqual({ fee: 0 });
    expect(costCardPatch({ paid: true, amount: '80' })).toEqual({ fee: 80 });
  });
});

describe('changedPatch / eventDataPatch', () => {
  it('saves nothing when nothing changed', () => {
    expect(changedPatch(gig, eventCardPatch('gig', eventCardValues(gig)))).toBeNull();
    expect(changedPatch(gig, venueCardPatch('gig', venueCardValues('gig', gig)))).toBeNull();
    expect(changedPatch(rehearsal, eventCardPatch('rehearsal', eventCardValues(rehearsal)))).toBeNull();
    expect(changedPatch(gig, { fee: 1500 })).toBeNull();
  });

  it('saves the whole card once one field changed', () => {
    const patch = eventCardPatch('gig', { ...eventCardValues(gig), soundcheckTime: '18:30' });
    expect(changedPatch(gig, patch)).toBe(patch);
    expect(changedPatch(rehearsal, eventCardPatch('rehearsal', { ...eventCardValues(rehearsal), recurrence: 'monthly' }))).not.toBeNull();
  });

  it('shows the save at once in the overview', () => {
    expect(
      eventDataPatch({ venue_name: 'Teatro', venue_city: null, start_time: '21:00', fee: 1200, payment_status: 'pending' }, gig),
    ).toEqual({ venueName: 'Teatro', venueCity: undefined, time: '21:00', timeSet: true, price: '1200', paymentStatus: 'pending', location: 'Teatro' });
    expect(eventDataPatch({ venue_name: null }, { ...gig, venueCity: 'Como' }).location).toBe('Como');
  });
});
