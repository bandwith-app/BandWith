/**
 * "Same gig, three views": one gig and what each role's phone receives.
 * Demo gig: Client A — Wedding, Villa Necchi, Sat 21 Nov 2026 (Academy demo data).
 * Rules follow the Academy article what-members-see-on-a-gig and the deputy
 * articles: a member sees their own fee and the logistics, setlist and rider
 * read-only; a deputy sees only their request (times, venue, role, fee
 * offered) and the street address once they say yes. No role but the admin
 * sees the client, the band fee, the contract or other people's fees.
 * site/test/roles.test.ts holds these rules.
 */

export type Role = 'admin' | 'member' | 'deputy';
export const ROLES: Role[] = ['admin', 'member', 'deputy'];

export type Field = {
  id: string;
  label: string;
  /** What each role sees. A role that is missing never receives the field. */
  value: Partial<Record<Role, string>>;
  /** Shown instead of the value until something happens (the deputy's yes). */
  later?: Partial<Record<Role, string>>;
};

export type Section = { title: string; fields: Field[] };

export const GIG = {
  kicker: 'Gig · Confirmed',
  title: 'Client A — Wedding',
  when: 'Sat 21 Nov 2026 · 20:30',
};

export const SECTIONS: Section[] = [
  {
    title: 'The night',
    fields: [
      { id: 'times', label: 'Call times', value: { admin: 'Load-in 15:00 · Soundcheck 16:30', member: 'Load-in 15:00 · Soundcheck 16:30', deputy: 'Load-in 15:00 · Soundcheck 16:30' } },
      { id: 'venue', label: 'Venue', value: { admin: 'Villa Necchi, Milan', member: 'Villa Necchi, Milan', deputy: 'Villa Necchi, Milan' } },
      { id: 'address', label: 'Address', value: { admin: 'Via Mozart 14', member: 'Via Mozart 14', deputy: 'Via Mozart 14' }, later: { deputy: 'After they say yes' } },
      { id: 'lineup', label: 'Lineup', value: { admin: '5 of 5 confirmed', member: '5 of 5 confirmed' } },
    ],
  },
  {
    title: 'Money',
    fields: [
      { id: 'price', label: 'Band fee', value: { admin: '€2,400' } },
      { id: 'fees', label: 'Fees', value: { admin: 'Five fees · €1,900 to pay out', member: 'Your fee · €400', deputy: 'Fee offered · €180' } },
      { id: 'deposit', label: 'Deposit', value: { admin: '€600 · paid' } },
    ],
  },
  {
    title: 'Client & paperwork',
    fields: [
      { id: 'client', label: 'Client', value: { admin: 'Client A · contact & notes' } },
      { id: 'quote', label: 'Quote', value: { admin: 'Accepted by the client' } },
      { id: 'contract', label: 'Contract', value: { admin: 'Signed' } },
    ],
  },
  {
    title: 'Music & band',
    fields: [
      { id: 'setlist', label: 'Setlist', value: { admin: '8 songs · you edit', member: '8 songs · read-only' } },
      { id: 'rider', label: 'Rider', value: { admin: 'v3 · sent to the venue', member: 'v3 · read-only' } },
      { id: 'ready', label: 'Readiness', value: { admin: '5 of 6 ready', member: '3 of 4 ready' } },
      { id: 'chat', label: 'Gig chat', value: { admin: '12 messages', member: '12 messages' } },
    ],
  },
];

export const FIELDS = SECTIONS.flatMap((s) => s.fields);

export const WHO: Record<Role, { name: string; person: string; line: string }> = {
  admin: { name: 'Admin', person: 'Leo M., who books the gigs', line: 'Runs the deal: the client, the quote, the contract, the deposit and every fee.' },
  member: { name: 'Member', person: 'Sara, who sings', line: 'Gets what she needs to play: times, the address, setlist and rider to read, and her own fee.' },
  deputy: { name: 'Deputy', person: 'Ivo M., covering keys', line: 'Gets only the request: when, where, the role and the fee offered. The street address arrives once he says yes.' },
};

/** Why a field isn't on this role's phone. */
export function hiddenWhy(f: Field, r: Role) {
  if (f.value[r]) return '';
  return f.value.member && r === 'deputy' ? 'Band only' : 'Admin only';
}

export const countFor = (r: Role) => FIELDS.filter((f) => f.value[r]).length;
