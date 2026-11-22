/**
 * Closing a layer while typing in its own field (iPad with a keyboard, web):
 * Enter submits, or the field's Escape closes it. The layer stays on the page
 * for its exit animation with the focus still in that field; when it goes,
 * focus goes back to what opened it, not to the page body. (A field outside
 * the layer, e.g. on the other Duo page, keeps the focus: see the urgent
 * pop-up tests.)
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

import { BwSheet } from '../Screen';
import { ComposerShell } from '@/app/components/composer/Composer';
import { CreateBandModal } from '@/app/components/profile/CreateBandModal';

afterEach(cleanup);

const SheetPage: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add song
      </button>
      <BwSheet open={open} onClose={() => setOpen(false)} title="New song">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(false);
          }}
        >
          <input
            aria-label="Song title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          />
        </form>
      </BwSheet>
    </>
  );
};

const ComposerPage: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New gig
      </button>
      {open && (
        <ComposerShell title="New gig" closeLabel="Close" onClose={() => setOpen(false)} ready={{ done: 0, total: 3 }} accent="#000" kind="gig">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setOpen(false);
            }}
          >
            <input aria-label="Gig name" />
          </form>
        </ComposerShell>
      )}
    </>
  );
};

const openWith = async (name: string, dialogName: RegExp | string) => {
  const opener = screen.getByRole('button', { name });
  opener.focus();
  fireEvent.click(opener);
  const layer = await screen.findByRole('dialog', { name: dialogName });
  await waitFor(() => expect(layer.contains(document.activeElement)).toBe(true));
  return opener;
};

describe('closing a layer from its own text field', () => {
  it('BwSheet, Enter: focus goes back to the opener', async () => {
    render(<SheetPage />);
    const opener = await openWith('Add song', 'New song');
    const field = screen.getByRole('textbox', { name: 'Song title' });
    field.focus();
    fireEvent.change(field, { target: { value: 'Blue in Green' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New song' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('BwSheet, Escape in the field: focus goes back to the opener', async () => {
    render(<SheetPage />);
    const opener = await openWith('Add song', 'New song');
    const field = screen.getByRole('textbox', { name: 'Song title' });
    field.focus();
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New song' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('the iPad composer, Enter: focus goes back to the opener', async () => {
    render(<ComposerPage />);
    const opener = await openWith('New gig', /New gig/);
    const field = screen.getByRole('textbox', { name: 'Gig name' });
    field.focus();
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Gig name' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('Create band, closed while its name field has the focus: focus goes back to the opener', async () => {
    const Page: React.FC<{ open: boolean }> = ({ open }) => (
      <>
        <button type="button">Create band</button>
        <CreateBandModal isOpen={open} onClose={() => {}} />
      </>
    );
    const { rerender } = render(<Page open={false} />);
    const opener = screen.getByRole('button', { name: 'Create band' });
    opener.focus();
    rerender(<Page open />);
    const modal = await screen.findByRole('dialog', { name: 'Create' });
    await waitFor(() => expect(modal.contains(document.activeElement)).toBe(true));
    (modal.querySelector('input') as HTMLInputElement).focus();
    rerender(<Page open={false} />);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
