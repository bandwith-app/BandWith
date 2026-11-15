/**
 * Payment state of a past gig in the Past events archive.
 *
 * Two different payments, by the viewer's role in the gig's band:
 * - who manages the gig (band admin, or the owner of a personal gig) sees the
 *   client's payment to the band (`paymentStatus`, admin-only);
 * - a member sees their own payout (event_members.paid_at, own row from
 *   bw_event_member_money), when it is known. They never see the client's.
 */

export type PastPayKind = 'client' | 'own';

export interface PastPayState {
  kind: PastPayKind;
  paid: boolean;
}

export interface PastPayEvent {
  eventId?: string;
  status?: string;
  paymentStatus?: string;
}

/** Rehearsals, quotes and drafts are not billable; they never carry a payment state. */
export function isBillableEvent(e: PastPayEvent): boolean {
  const s = e.status?.toUpperCase();
  return s === 'CONFIRMED' || s === 'COMPLETED';
}

/**
 * `manages`: the viewer manages this gig. `ownPaid`: the viewer's payout, by
 * event id (absent = unknown). Null: no state to show.
 */
export function pastPayState(
  e: PastPayEvent,
  manages: boolean,
  ownPaid: Record<string, boolean>,
): PastPayState | null {
  if (!isBillableEvent(e)) return null;
  if (manages) return { kind: 'client', paid: e.paymentStatus === 'paid' };
  if (!e.eventId || ownPaid[e.eventId] === undefined) return null;
  return { kind: 'own', paid: ownPaid[e.eventId] };
}

/** The kinds shown in a list: decides the filter's labels (none: no filter). */
export function pastPayKinds(states: ReadonlyArray<PastPayState | null>): PastPayKind | 'mixed' | null {
  const kinds = new Set(states.filter((s): s is PastPayState => !!s).map((s) => s.kind));
  if (kinds.size === 0) return null;
  if (kinds.size > 1) return 'mixed';
  return kinds.has('client') ? 'client' : 'own';
}
