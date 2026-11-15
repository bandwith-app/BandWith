import { describe, expect, it } from 'vitest';
import { irealLinkFrom } from './irealForum';
import { canEditInventoryItem } from './services/inventory';

const data = (types: Record<string, string>) => ({ getData: (type: string) => types[type] ?? '' });

describe('irealLinkFrom', () => {
  it('reads a dragged link list, plain text or HTML', () => {
    expect(irealLinkFrom(data({ 'text/uri-list': 'irealb://Song%3DA' }))).toBe('irealb://Song%3DA');
    expect(irealLinkFrom(data({ 'text/plain': 'see irealbook://X%3DY here' }))).toBe('irealbook://X%3DY');
    expect(irealLinkFrom(data({ 'text/html': '<a href="irealb://Z%3D1">Z</a>' }))).toBe('irealb://Z%3D1');
  });
  it('ignores anything else', () => {
    expect(irealLinkFrom(data({ 'text/plain': 'https://forums.irealpro.com/' }))).toBeNull();
    expect(irealLinkFrom(null)).toBeNull();
  });
});

describe('canEditInventoryItem', () => {
  it('lets admins change any item and members only their own', () => {
    expect(canEditInventoryItem({ owner_id: null }, 'u1', true)).toBe(true);
    expect(canEditInventoryItem({ owner_id: 'u2' }, 'u1', true)).toBe(true);
    expect(canEditInventoryItem({ owner_id: null }, 'u1', false)).toBe(false);
    expect(canEditInventoryItem({ owner_id: 'u2' }, 'u1', false)).toBe(false);
    expect(canEditInventoryItem({ owner_id: 'u1' }, 'u1', false)).toBe(true);
    expect(canEditInventoryItem({ owner_id: 'u1' }, null, false)).toBe(false);
  });
});
