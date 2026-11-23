/**
 * On the iPhone Duo, "Create band" in the band switcher keeps the switcher
 * docked on the leading page and opens Create band on the trailing page.
 * The switcher's focus trap must hand over: Create band is a modal dialog.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
vi.mock('@/lib/BandContext', () => ({ useBand: () => ({ refreshBands: vi.fn() }) }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ refreshProfile: vi.fn() }) }));
vi.mock('@/lib/services/bands', () => ({ createBand: vi.fn() }));
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { BwSheet } from '@/app/components/bw/Screen';
import { CreateBandModal } from '../CreateBandModal';

afterEach(cleanup);

const tab = (shift = false) => fireEvent.keyDown(document.activeElement || document.body, { key: 'Tab', shiftKey: shift });

/** The switcher stays open (docked) while Create band opens beside it. */
const DuoSwitcher: React.FC = () => {
  const [create, setCreate] = useState(false);
  return (
    <>
      <BwSheet open onClose={() => {}} title="Your bands" leading>
        <button type="button">Velvet Static</button>
        <button type="button" onClick={() => setCreate(true)}>
          Create band
        </button>
      </BwSheet>
      {create && <CreateBandModal isOpen onClose={() => setCreate(false)} />}
    </>
  );
};

describe('Create band above the docked band switcher', () => {
  it('is a modal dialog: focus moves in, Tab stays in it, closing returns to the switcher', async () => {
    render(<DuoSwitcher />);
    const sheet = screen.getByRole('dialog', { name: 'Your bands' });
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    const trigger = screen.getByRole('button', { name: 'Create band' });
    trigger.focus();
    fireEvent.click(trigger);
    const modal = await screen.findByRole('dialog', { name: 'Create' });
    expect(modal.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(modal.contains(document.activeElement)).toBe(true));
    const buttons = Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled])'));
    buttons[buttons.length - 1].focus();
    tab();
    expect(modal.contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).find((b) => modal.contains(b))!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create' })).toBeNull());
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
  });
});

describe('Create band on a phone (the switcher closes as it opens)', () => {
  it('takes the focus itself and keeps Tab inside', async () => {
    const Phone: React.FC = () => {
      const [create, setCreate] = useState(false);
      return (
        <>
          <button type="button">Switch band</button>
          <BwSheet open={!create} onClose={() => {}} title="Your bands">
            <button type="button" onClick={() => setCreate(true)}>
              Create band
            </button>
          </BwSheet>
          {create && <CreateBandModal isOpen onClose={() => setCreate(false)} />}
        </>
      );
    };
    render(<Phone />);
    const trigger = screen.getByRole('button', { name: 'Create band' });
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Your bands' }).contains(document.activeElement)).toBe(true));
    trigger.focus();
    fireEvent.click(trigger);
    const modal = await screen.findByRole('dialog', { name: 'Create' });
    await waitFor(() => expect(modal.contains(document.activeElement)).toBe(true));
    const buttons = Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled])'));
    buttons[buttons.length - 1].focus();
    tab();
    expect(modal.contains(document.activeElement)).toBe(true);
  });
});
