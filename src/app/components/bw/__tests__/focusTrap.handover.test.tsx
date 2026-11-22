/**
 * A layer found above a trapped sheet (a dialog on <body>) that then turns on
 * its own trap as the sheet closes beneath it: what opened it was in the
 * sheet, which is gone, so it inherits the sheet's opener. Closing it gives
 * the focus back to the bell that opened the sheet, not to the page body.
 */
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { BwSheet } from '../Screen';
import { useFocusTrap } from '@/lib/focusTrap';

afterEach(cleanup);

const Editor: React.FC<{ active: boolean; onDone: () => void }> = ({ active, onDone }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, active);
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Editor" tabIndex={-1}>
      <button type="button" onClick={onDone}>
        Done
      </button>
    </div>,
    document.body,
  );
};

const Page: React.FC = () => {
  const [sheet, setSheet] = useState(false);
  const [editor, setEditor] = useState<'off' | 'found' | 'trapped'>('off');
  return (
    <>
      <button type="button" onClick={() => setSheet(true)}>
        Bell
      </button>
      <BwSheet open={sheet} onClose={() => setSheet(false)} title="Inbox">
        <button type="button" onClick={() => setEditor('found')}>
          Edit
        </button>
        <button
          type="button"
          onClick={() => {
            setSheet(false);
            setEditor('trapped');
          }}
        >
          Keep editor only
        </button>
      </BwSheet>
      {editor !== 'off' && <Editor active={editor === 'trapped'} onDone={() => setEditor('off')} />}
    </>
  );
};

describe('a found layer that takes its own trap as the sheet beneath closes', () => {
  it("inherits the sheet's opener: closing it goes back to the bell", async () => {
    render(<Page />);
    const bell = screen.getByRole('button', { name: 'Bell' });
    bell.focus();
    fireEvent.click(bell);
    const sheet = await screen.findByRole('dialog', { name: 'Inbox' });
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    const edit = screen.getByRole('button', { name: 'Edit' });
    edit.focus();
    fireEvent.click(edit);
    const editor = await screen.findByRole('dialog', { name: 'Editor' });
    // Found above the sheet: focus moves into it (its opener: Edit, in the sheet).
    await waitFor(() => expect(editor.contains(document.activeElement)).toBe(true));
    // The sheet closes and the editor turns its own trap on, in one go.
    fireEvent.click(screen.getByRole('button', { name: 'Keep editor only' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Inbox' })).toBeNull());
    screen.getByRole('button', { name: 'Done' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editor' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(bell));
  });
});
