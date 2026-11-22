import { supabase } from '@/lib/supabase';
import { parseLocalDate } from '@/lib/dates';
import { dateName } from '@/lib/i18n';

/**
 * Date on hold (migration 178). While a gig is still a quote, band members
 * who aren't admins don't see it: they get a hold card with the day, the time
 * and the place only, and answer "I'm free" / "I can't". Admins see the
 * answers on the quote. All of it comes from RPCs; the event itself stays
 * admin-only in the database.
 */

export type HoldAnswer = 'free' | 'busy';

export interface DateHold {
  eventId: string;
  bandId: string;
  bandName: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  venueName: string | null;
  venueCity: string | null;
  myAnswer: HoldAnswer | null;
  answeredAt: string | null;
}

export interface DateHoldAnswerRow {
  userId: string;
  name: string;
  answer: HoldAnswer | null;
  answeredAt: string | null;
  onLineup: boolean;
}

/** Fired after an answer, so every hold list on screen loads again. */
export const DATE_HOLDS_CHANGED = 'bw:date-holds-changed';

export { DATE_HOLD_TYPES, isDateHoldType, isQuoteStageEvent, refreshesDateHolds } from '@/lib/dateHoldRules';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const answerOf = (v: unknown): HoldAnswer | null => (v === 'free' || v === 'busy' ? v : null);

/** "TBD" and blanks are not a place. */
const place = (v: unknown): string | null => {
  const s = str(v);
  return s && s.toUpperCase() !== 'TBD' ? s : null;
};

export function toDateHold(row: Record<string, unknown>): DateHold | null {
  const eventId = str(row.event_id);
  const date = str(row.event_date);
  if (!eventId || !date) return null;
  return {
    eventId,
    bandId: str(row.band_id) ?? '',
    bandName: str(row.band_name) ?? '',
    date: date.slice(0, 10),
    startTime: str(row.start_time),
    endTime: str(row.end_time),
    venueName: place(row.venue_name),
    venueCity: place(row.venue_city),
    myAnswer: answerOf(row.my_answer),
    answeredAt: str(row.answered_at),
  };
}

export function toAnswerRow(row: Record<string, unknown>): DateHoldAnswerRow | null {
  const userId = str(row.user_id);
  if (!userId) return null;
  return {
    userId,
    name: str(row.name) ?? '',
    answer: answerOf(row.answer),
    answeredAt: str(row.answered_at),
    onLineup: row.on_lineup === true,
  };
}

/** "20:00" from "20:00:00", "8:00 PM" or "8 PM"; '' when it isn't a time. */
export function clock24(value: string | null | undefined): string {
  const m = String(value ?? '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (!m || (m[2] === undefined && !m[3])) return '';
  let h = parseInt(m[1], 10);
  const ampm = m[3]?.toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  if (h > 23) return '';
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
}

/** "20:00–23:00", "20:00" or '' (no time yet). */
export function holdTime(hold: Pick<DateHold, 'startTime' | 'endTime'>): string {
  const start = clock24(hold.startTime);
  const end = clock24(hold.endTime);
  if (start && end && end !== start) return `${start}–${end}`;
  return start;
}

/** "Blue Note, New York", the venue or the city alone, or ''. */
export function holdPlace(hold: Pick<DateHold, 'venueName' | 'venueCity'>): string {
  const venue = place(hold.venueName);
  const city = place(hold.venueCity);
  if (venue && city && venue.toLocaleLowerCase().includes(city.toLocaleLowerCase())) return venue;
  return [venue, city].filter(Boolean).join(', ');
}

/** "Sat 5 Dec" in the app language. */
export function holdDay(date: string): string {
  const d = parseLocalDate(date);
  if (isNaN(d.getTime())) return date;
  return dateName(d, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Holds by date, soonest first. */
export function sortHolds(holds: DateHold[]): DateHold[] {
  return [...holds].sort((a, b) => (a.date + (clock24(a.startTime) || '99')).localeCompare(b.date + (clock24(b.startTime) || '99')));
}

/** The admin's view: who is free, who can't, who hasn't answered. */
export function groupAnswers(rows: DateHoldAnswerRow[]): { free: DateHoldAnswerRow[]; busy: DateHoldAnswerRow[]; none: DateHoldAnswerRow[] } {
  const byName = (a: DateHoldAnswerRow, b: DateHoldAnswerRow) => a.name.localeCompare(b.name);
  return {
    free: rows.filter((r) => r.answer === 'free').sort(byName),
    busy: rows.filter((r) => r.answer === 'busy').sort(byName),
    none: rows.filter((r) => !r.answer).sort(byName),
  };
}

/**
 * A database without migration 178 has no such RPC: that's "no holds", not
 * an error to show.
 */
const isMissingRpc = (error: { code?: string; message?: string } | null | undefined): boolean =>
  !!error && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message || ''));

/** The holds this account should keep free, across its bands. */
export async function fetchMyDateHolds(): Promise<{ data: DateHold[]; error: string | null }> {
  const { data, error } = await supabase.rpc('bw_my_date_holds');
  if (error) return { data: [], error: isMissingRpc(error) ? null : error.message || 'error' };
  const rows = Array.isArray(data) ? data : [];
  return { data: sortHolds(rows.map((r) => toDateHold(r as Record<string, unknown>)).filter((h): h is DateHold => !!h)), error: null };
}

/**
 * The answer RPC's arguments: with the day and time the card showed, so an
 * answer never lands on a date that changed meanwhile (178, BWD01).
 */
export function answerArgs(eventId: string, answer: HoldAnswer, shown?: Pick<DateHold, 'date' | 'startTime'> | null) {
  const args: Record<string, unknown> = { p_event_id: eventId, p_answer: answer };
  if (shown?.date) {
    args.p_date = shown.date.slice(0, 10);
    args.p_start_time = shown.startTime ? shown.startTime.slice(0, 5) : null;
  }
  return args;
}

/** P0002: the date is free again (quote declined, gig cancelled…). BWD01: the date or time changed. */
export function answerRefusal(code: string | undefined | null): 'gone' | 'changed' | null {
  return code === 'P0002' ? 'gone' : code === 'BWD01' ? 'changed' : null;
}

export async function answerDateHold(
  eventId: string,
  answer: HoldAnswer,
  shown?: Pick<DateHold, 'date' | 'startTime'> | null,
): Promise<{ error: string | null; gone?: boolean; changed?: boolean }> {
  const { error } = await supabase.rpc('bw_answer_date_hold', answerArgs(eventId, answer, shown));
  if (!error) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DATE_HOLDS_CHANGED));
    return { error: null };
  }
  const refusal = answerRefusal(error.code);
  // The card shows the new date after a reload.
  if (refusal === 'changed' && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DATE_HOLDS_CHANGED));
  return { error: error.message || 'error', gone: refusal === 'gone', changed: refusal === 'changed' };
}

/** Admins only (the RPC refuses anyone else). */
export async function fetchDateHoldAnswers(eventId: string): Promise<{ data: DateHoldAnswerRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc('bw_date_hold_answers', { p_event_id: eventId });
  if (error) return { data: [], error: isMissingRpc(error) ? null : error.message || 'error' };
  const rows = Array.isArray(data) ? data : [];
  return { data: rows.map((r) => toAnswerRow(r as Record<string, unknown>)).filter((r): r is DateHoldAnswerRow => !!r), error: null };
}

