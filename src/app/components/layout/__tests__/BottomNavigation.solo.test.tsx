import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';

/**
 * Owner's report, 11-24: a solo account (no band) was offered "Propose
 * rehearsal · Suggest a date or topic to the band admin" in the Create menu,
 * and a Chat tab that opened something else under the name "Chat".
 */
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ profile: { full_name: 'Leo M.', email: 'demo@example.com' } }) }));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { BottomNavigation } from '../BottomNavigation';

afterEach(cleanup);

const renderNav = (over: Partial<React.ComponentProps<typeof BottomNavigation>> = {}) => {
  const props = {
    activeTab: 'Home' as const,
    setActiveTab: vi.fn(),
    isPlusMenuOpen: true,
    setIsPlusMenuOpen: vi.fn(),
    isIdentityOpen: false,
    closeMenus: vi.fn(),
    onCreateEvent: vi.fn(),
    isHidden: false,
    isAdmin: false,
    onBandRequired: vi.fn(),
    ...over,
  };
  render(<BottomNavigation {...props} />);
  return props;
};

const createMenu = () => within(screen.getByRole('dialog'));
const chatTab = () => screen.getByRole('button', { name: /^chat$/i });

describe('Create menu and Chat tab with no band', () => {
  it('the Create menu offers the personal gig only', () => {
    const props = renderNav({ isSolo: true });
    expect(createMenu().getByRole('button', { name: /^add personal gig/i })).toBeTruthy();
    expect(createMenu().queryByRole('button', { name: /rehearsal/i })).toBeNull();
    expect(createMenu().queryByRole('button', { name: /new gig|new quote/i })).toBeNull();
    expect(screen.queryByText(/band admin/i)).toBeNull();
    fireEvent.click(createMenu().getByRole('button', { name: /^add personal gig/i }));
    expect(props.onCreateEvent).toHaveBeenCalledWith('personal');
  });

  it('even if the account is flagged admin, with no band nothing of a band is offered', () => {
    renderNav({ isSolo: true, isAdmin: true });
    expect(createMenu().queryByRole('button', { name: /rehearsal|new gig|new quote/i })).toBeNull();
    expect(createMenu().getByRole('button', { name: /^add personal gig/i })).toBeTruthy();
  });

  it('Chat asks for a band instead of opening a tab', () => {
    const props = renderNav({ isSolo: true, isPlusMenuOpen: false });
    fireEvent.click(chatTab());
    expect(props.onBandRequired).toHaveBeenCalledWith('chat');
    expect(props.setActiveTab).not.toHaveBeenCalled();
    // The other tabs still work.
    fireEvent.click(screen.getByRole('button', { name: /^calendar$/i }));
    expect(props.setActiveTab).toHaveBeenCalledWith('Events');
  });
});

describe('Create menu and Chat tab in a band (unchanged)', () => {
  it('a member proposes a rehearsal and opens Chat', () => {
    const props = renderNav();
    expect(createMenu().getByRole('button', { name: /^propose rehearsal/i })).toBeTruthy();
    fireEvent.click(chatTab());
    expect(props.setActiveTab).toHaveBeenCalledWith('Chat');
    expect(props.onBandRequired).not.toHaveBeenCalled();
  });

  it('an admin schedules a rehearsal, a gig and a quote', () => {
    renderNav({ isAdmin: true });
    for (const name of [/^new rehearsal/i, /^new gig/i, /^new quote/i, /^log personal gig/i]) {
      expect(createMenu().getByRole('button', { name })).toBeTruthy();
    }
  });
});
