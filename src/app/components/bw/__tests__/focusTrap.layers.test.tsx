/**
 * Layers that open above a trapped sheet or composer (portals on <body>,
 * like the input-list editor from Rider & stage): the trap hands over to the
 * newest layer, focus moves into it, Tab cycles inside it, and closing it
 * gives focus back to what opened it, inside the layer beneath.
 */
import React, { useState } from 'react';
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
import { ComposerShell } from '@/app/components/composer/Composer';
import { InputListEditor } from '@/app/components/event/rider/InputListEditor';

afterEach(cleanup);

const tab = (shift = false) => fireEvent.keyDown(document.activeElement || document.body, { key: 'Tab', shiftKey: shift });

/** A full-screen editor on <body>, the way the app's portal layers are built. */
const PortalEditor: React.FC<{ onClose: () => void }> = ({ onClose }) =>
  createPortal(
    <div role="dialog" aria-modal="true" aria-label="Portal editor">
      <button type="button" onClick={onClose}>
        Cancel edit
      </button>
      <input aria-label="Channel" />
      <button type="button">Done editing</button>
    </div>,
    document.body,
  );

const InSheet: React.FC = () => {
  const [editor, setEditor] = useState(false);
  return (
    <BwSheet open onClose={() => {}} title="Rider & stage" footer={<button type="button">Save rider</button>}>
      <button type="button" onClick={() => setEditor(true)}>
        Edit list
      </button>
      {editor && <PortalEditor onClose={() => setEditor(false)} />}
    </BwSheet>
  );
};

const InComposer: React.FC<{ real?: boolean }> = ({ real }) => {
  const [editor, setEditor] = useState(false);
  return (
    <ComposerShell title="New gig" closeLabel="Close" onClose={() => {}} ready={{ done: 0, total: 3 }} accent="#000" kind="gig">
      <button type="button" onClick={() => setEditor(true)}>
        Edit list
      </button>
      <button type="button">Publish</button>
      {editor &&
        (real ? (
          <InputListEditor eventTitle="Rooftop" inputs={[]} people={[]} onCancel={() => setEditor(false)} onSave={async () => true} />
        ) : (
          <PortalEditor onClose={() => setEditor(false)} />
        ))}
    </ComposerShell>
  );
};

/** Opens the editor from the keyboard (Enter on the focused trigger). */
const openEditor = async (name = 'Portal editor') => {
  const trigger = screen.getByRole('button', { name: 'Edit list' });
  await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  trigger.focus();
  fireEvent.click(trigger);
  const editor = await screen.findByRole('dialog', { name });
  await waitFor(() => expect(editor.contains(document.activeElement)).toBe(true));
  return { trigger, editor };
};

describe('a portal layer above a trapped layer', () => {
  it('above a BwSheet: focus moves into it, Tab and Shift+Tab stay in it, closing returns focus', async () => {
    render(<InSheet />);
    const { trigger, editor } = await openEditor();
    // Tab past the editor (Safari's order) reaches the page's end guard, which stays last.
    expect(document.body.lastElementChild?.hasAttribute('data-bw-focus-guard')).toBe(true);
    screen.getByRole('button', { name: 'Done editing' }).focus();
    tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel edit' }));
    tab(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done editing' }));
    // Focus left behind in the sheet comes back to the editor.
    trigger.focus();
    tab();
    expect(editor.contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Portal editor' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    // The sheet traps again.
    screen.getByRole('button', { name: 'Save rider' }).focus();
    tab();
    expect(screen.getByRole('dialog', { name: 'Rider & stage' }).contains(document.activeElement)).toBe(true);
  });

  it('above the iPad composer: same hand-over', async () => {
    render(<InComposer />);
    const { trigger } = await openEditor();
    screen.getByRole('button', { name: 'Done editing' }).focus();
    tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('the real input-list editor (Rider & stage → Edit list) above the composer is reachable by keyboard', async () => {
    render(<InComposer real />);
    const { editor } = await openEditor('Edit input list');
    const buttons = Array.from(editor.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    buttons[buttons.length - 1].focus();
    tab();
    expect(editor.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('stack order decides, not the page: a dialog placed before the sheet in the DOM still takes over', async () => {
    const early = document.createElement('div');
    document.body.prepend(early);
    const Early: React.FC = () => {
      const [open, setOpen] = useState(false);
      return (
        <BwSheet open onClose={() => {}} title="Rider & stage" footer={<button type="button">Save rider</button>}>
          <button type="button" onClick={() => setOpen(true)}>
            Edit list
          </button>
          {open &&
            createPortal(
              <div role="dialog" aria-label="Portal editor">
                <button type="button" onClick={() => setOpen(false)}>
                  Cancel edit
                </button>
                <button type="button">Done editing</button>
              </div>,
              early,
            )}
        </BwSheet>
      );
    };
    render(<Early />);
    const { trigger } = await openEditor();
    screen.getByRole('button', { name: 'Done editing' }).focus();
    tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel edit' }));
    // The trigger was removed meanwhile: closing still gives focus back to the sheet.
    trigger.remove();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Rider & stage' }).contains(document.activeElement)).toBe(true));
    early.remove();
  });

  it('a popover or list opened above (a select) keeps its own focus; when it goes, focus is back in the sheet', async () => {
    const Picker: React.FC = () => {
      const [open, setOpen] = useState(false);
      return (
        <BwSheet open onClose={() => {}} title="Rider & stage" footer={<button type="button">Save rider</button>}>
          <button type="button" onClick={() => setOpen(true)}>
            Pick a mic
          </button>
          {open &&
            createPortal(
              <div role="listbox" aria-label="Mics">
                <div role="option" aria-selected="false" tabIndex={0} onClick={() => setOpen(false)}>
                  SM58
                </div>
                <div role="option" aria-selected="false" tabIndex={0}>
                  Beta 91
                </div>
              </div>,
              document.body,
            )}
        </BwSheet>
      );
    };
    render(<Picker />);
    const sheet = screen.getByRole('dialog', { name: 'Rider & stage' });
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    fireEvent.click(screen.getByRole('button', { name: 'Pick a mic' }));
    const sm58 = await screen.findByRole('option', { name: 'SM58' });
    sm58.focus();
    // Its own Tab: the trap beneath does not pull focus back.
    const ev = fireEvent.keyDown(sm58, { key: 'Tab' });
    expect(ev).toBe(true);
    expect(document.activeElement).toBe(sm58);
    fireEvent.click(sm58);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
  });

  it('wrapping scrolls the control it lands on into view', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    render(<InSheet />);
    const sheet = screen.getByRole('dialog', { name: 'Rider & stage' });
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    tab(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save rider' }));
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' });
    expect(spy.mock.contexts[spy.mock.contexts.length - 1]).toBe(screen.getByRole('button', { name: 'Save rider' }));
  });
});
