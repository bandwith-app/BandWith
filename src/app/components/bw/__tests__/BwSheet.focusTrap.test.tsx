import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { BwSheet } from '../Screen';
import { ComposerShell } from '@/app/components/composer/Composer';

afterEach(cleanup);

const tab = (shift = false) => fireEvent.keyDown(document.activeElement || document.body, { key: 'Tab', shiftKey: shift });

/** A screen with a button behind the sheet ("Behind") and the sheet's own controls. */
const Screen: React.FC<{ nested?: boolean }> = ({ nested }) => {
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Add transaction
      </button>
      <button type="button">Behind</button>
      <BwSheet open={open} onClose={() => setOpen(false)} title="Add transaction" footer={<button type="button">Save</button>}>
        <input aria-label="Amount" />
        {nested && (
          <button type="button" onClick={() => setInner(true)}>
            Pick a date
          </button>
        )}
      </BwSheet>
      {nested && (
        <BwSheet open={inner} onClose={() => setInner(false)} title="Date" footer={<button type="button">Done</button>}>
          <button type="button">Today</button>
        </BwSheet>
      )}
    </div>
  );
};

const openSheet = async () => {
  const opener = screen.getByRole('button', { name: 'Add transaction' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(document.activeElement).toBe(dialog));
  return { opener, dialog };
};

describe('BwSheet keeps keyboard focus inside', () => {
  it('Shift+Tab from the start of the sheet goes to its last control, not behind the scrim', async () => {
    render(<Screen />);
    await openSheet();
    tab(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
  });

  it('Tab from the last control wraps to the first (the close button)', async () => {
    render(<Screen />);
    const { dialog } = await openSheet();
    screen.getByRole('button', { name: 'Save' }).focus();
    tab();
    expect(document.activeElement).toBe(dialog.querySelector('button'));
    expect(dialog.contains(document.activeElement)).toBe(true);
    // And back again.
    tab(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
  });

  it('focus that ended up behind comes back into the sheet on Tab', async () => {
    render(<Screen />);
    const { dialog } = await openSheet();
    screen.getByRole('button', { name: 'Behind' }).focus();
    tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('only the top sheet traps; closing it returns focus to what opened it', async () => {
    render(<Screen nested />);
    await openSheet();
    const picker = screen.getByRole('button', { name: 'Pick a date' });
    picker.focus();
    fireEvent.click(picker);
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2));
    const top = screen.getAllByRole('dialog')[1];
    await waitFor(() => expect(document.activeElement).toBe(top));
    screen.getByRole('button', { name: 'Done' }).focus();
    tab();
    expect(top.contains(document.activeElement)).toBe(true);
    tab(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done' }));
    // Escape closes the top sheet only, and focus goes back to "Pick a date".
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pick a date' })));
    // The first sheet traps again.
    screen.getByRole('button', { name: 'Save' }).focus();
    tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it("when the browser's own tab order leaves the sheet (Safari skips buttons), focus wraps back in", async () => {
    render(<Screen />);
    const { dialog, opener } = await openSheet();
    // The amount field is not the last control, so the browser moves focus
    // itself: Safari's next stop can be past the sheet (the page's end guard)…
    const amount = screen.getByRole('textbox', { name: 'Amount' });
    amount.focus();
    tab();
    const guards = document.querySelectorAll<HTMLElement>('[data-bw-focus-guard]');
    expect(guards).toHaveLength(2);
    guards[1].focus();
    expect(document.activeElement).toBe(dialog.querySelector('button'));
    // …or a control behind it, backwards.
    amount.focus();
    tab(true);
    opener.focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
    // Focus moved by a pointer (not Tab) is left where it went.
    await new Promise((r) => setTimeout(r, 5));
    opener.focus();
    expect(document.activeElement).toBe(opener);
    // Closing removes the guards.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelectorAll('[data-bw-focus-guard]')).toHaveLength(0);
  });

  it('Tab typed in a control that handles it itself is left alone', async () => {
    render(<Screen />);
    await openSheet();
    const save = screen.getByRole('button', { name: 'Save' });
    save.focus();
    save.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
    tab();
    expect(document.activeElement).toBe(save);
  });
});

describe('Composer (iPad full-screen editor) keeps keyboard focus inside', () => {
  const Host: React.FC = () => {
    const [open, setOpen] = useState(true);
    return (
      <div>
        <button type="button">Behind</button>
        {open && (
          <ComposerShell title="New gig" closeLabel="Close" onClose={() => setOpen(false)} ready={{ done: 0, total: 3 }} accent="#000" kind="gig">
            <input aria-label="Title" />
            <button type="button">Publish</button>
          </ComposerShell>
        )}
      </div>
    );
  };

  it('moves focus in, wraps Tab and Shift+Tab, and pulls stray focus back', async () => {
    render(<Host />);
    const dialog = screen.getByRole('dialog', { name: 'New gig' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    screen.getByRole('button', { name: 'Publish' }).focus();
    tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    tab(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Publish' }));
    screen.getByRole('button', { name: 'Behind' }).focus();
    tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
