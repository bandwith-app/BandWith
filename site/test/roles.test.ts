import { describe, expect, it } from 'vitest';
import { FIELDS, ROLES, countFor, hiddenWhy } from '../src/content/roles';
import { rolesCard } from '../src/content/render';

const get = (id: string) => FIELDS.find((f) => f.id === id)!;

// The Academy rules (what-members-see-on-a-gig, deputy articles), as the site shows them.
describe('same gig, three views', () => {
  it('keeps the deal with the admin: band fee, client, quote, contract, deposit', () => {
    for (const id of ['price', 'client', 'quote', 'contract', 'deposit']) {
      expect(get(id).value.admin, id).toBeTruthy();
      expect(get(id).value.member, id).toBeUndefined();
      expect(get(id).value.deputy, id).toBeUndefined();
      expect(hiddenWhy(get(id), 'member')).toBe('Admin only');
    }
  });

  it('shows a member only their own fee, and setlist and rider read-only', () => {
    expect(get('fees').value.member).toMatch(/^Your fee/);
    expect(get('fees').value.member).not.toMatch(/€1,900|Five/);
    expect(get('setlist').value.member).toMatch(/read-only/);
    expect(get('rider').value.member).toMatch(/read-only/);
  });

  it('gives a deputy only the request, and the address after their yes', () => {
    const deputy = FIELDS.filter((f) => f.value.deputy).map((f) => f.id).sort();
    expect(deputy).toEqual(['address', 'fees', 'times', 'venue']);
    expect(get('address').later?.deputy).toMatch(/yes/i);
    expect(get('fees').value.deputy).toMatch(/^Fee offered/);
    for (const id of ['setlist', 'chat', 'lineup', 'ready']) expect(hiddenWhy(get(id), 'deputy'), id).toBe('Band only');
  });

  it('counts fewer details for each role down the line', () => {
    const [a, m, d] = ROLES.map(countFor);
    expect(a).toBe(FIELDS.length);
    expect(m).toBeLessThan(a);
    expect(d).toBeLessThan(m);
  });

  it('renders the admin view with a radio switch for the three roles', () => {
    const html = rolesCard();
    expect(html.match(/role="radio"/g)?.length).toBe(3);
    expect(html).toContain('aria-checked="true" data-rv-role="admin"');
    expect(html.match(/data-f="/g)?.length).toBe(FIELDS.length);
    expect(html).toContain('€2,400');
  });
});
