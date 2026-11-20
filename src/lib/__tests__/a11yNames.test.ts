import { describe, it, expect } from 'vitest';
import { badgeText, unreadName, withVisibleText } from '../a11yNames';

// WCAG 2.5.3 label in name: what a button shows must be in its name, outside
// brackets (axe removes bracketed text before it compares).
const t = (s: string, v?: Record<string, unknown>) => (v ? s.replace(/\{(\w+)\}/g, (_, k) => String(v[k])) : s);

describe('accessible names that contain the visible text', () => {
  it('a count badge: the count as shown, not in brackets', () => {
    expect(unreadName(t as never, 'Notifications', 3)).toBe('Notifications, 3 unread');
    expect(unreadName(t as never, 'Chat', 140)).toBe('Chat, 99+ unread');
    expect(unreadName(t as never, 'Chat', 0)).toBe('Chat');
    expect(unreadName(t as never, 'Chat', undefined)).toBe('Chat');
    expect(badgeText(99)).toBe('99');
  });

  it('a face with initials: initials first, then what it does', () => {
    expect(withVisibleText('LM', 'Open profile')).toBe('LM, Open profile');
    expect(withVisibleText('', 'Open profile')).toBe('Open profile');
    expect(withVisibleText(null, 'Open profile')).toBe('Open profile');
  });
});
