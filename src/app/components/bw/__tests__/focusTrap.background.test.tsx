/**
 * Dialogs and lists that appear while a sheet or the iPad composer traps focus
 * but are not above it: a band invite card arriving under the scrim, a popup
 * that waits hidden for the sheet to close, the venue suggestions inside the
 * composer. None of them takes the focus or switches the trap off, and when
 * the last trapped layer closes the trap lets go of the page.
 */
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
vi.mock('@/lib/services/location', () => ({
  searchVenues: vi.fn(async () => [
    { name: 'Blue Note', address: '131 W 3rd St, New York', provider: 'osm' },
    { name: 'Bowery Ballroom', address: '6 Delancey St, New York', provider: 'osm' },
  ]),
  getGooglePlaceDetails: vi.fn(async () => null),
  rememberPickedPlace: vi.fn(),
  venueFields: (p: { name: string; address?: string }) => ({ location: p.name, address: p.address ?? '' }),
}));
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { BwSheet } from '../Screen';
import { ComposerShell } from '@/app/components/composer/Composer';
import { VenueAutocomplete } from '@/app/components/ui/VenueAutocomplete';
import { StagePlotView } from '@/app/components/event/rider/StagePlotView';
import type { StagePlot } from '@/lib/stagePlot';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tab = (shift = false) => fireEvent.keyDown(document.activeElement || document.body, { key: 'Tab', shiftKey: shift });
const frame = () => act(() => new Promise<void>((r) => window.requestAnimationFrame(() => r())));

/** PendingInvitesPrompt / InviteLinkNotice: a card on the page, not modal, under the sheet's scrim. */
const InviteCard: React.FC<{ modal?: boolean; z?: number; hide?: React.HTMLAttributes<HTMLDivElement> & { inert?: string } }> = ({
  modal = false,
  z = 65,
  hide,
}) =>
  createPortal(
    <div role="dialog" aria-modal={modal ? 'true' : 'false'} aria-label="Band invite" style={{ position: 'fixed', zIndex: z }} {...hide}>
      <button type="button">Join</button>
      <button type="button">Not now</button>
    </div>,
    document.body,
  );

const Page: React.FC<{ invite?: React.ReactNode; sheetOpen?: boolean }> = ({ invite, sheetOpen = true }) => (
  <>
    <nav aria-label="Tab bar">
      <button type="button">Home</button>
      <button type="button">Calendar</button>
    </nav>
    <aside aria-label="Rail">
      <button type="button">Back</button>
    </aside>
    <BwSheet open={sheetOpen} onClose={() => {}} title="Create" footer={<button type="button">Create gig</button>}>
      <input aria-label="Gig title" />
    </BwSheet>
    {invite}
  </>
);

const typeInSheet = async () => {
  const sheet = screen.getByRole('dialog', { name: 'Create' });
  await waitFor(() => expect(document.activeElement).toBe(sheet));
  const field = screen.getByRole('textbox', { name: 'Gig title' });
  field.focus();
  return { sheet, field };
};

describe('layers that are not above the trapped sheet', () => {
  it('a band invite arriving over the Create sheet leaves focus on the sheet', async () => {
    const { rerender } = render(<Page />);
    const { sheet, field } = await typeInSheet();
    rerender(<Page invite={<InviteCard />} />);
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
    await frame();
    await frame();
    expect(document.activeElement).toBe(field);
    // Tab still cycles in the sheet.
    screen.getByRole('button', { name: 'Create gig' }).focus();
    tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it('a modal card under the scrim (lower in the stacking order) does not take over either', async () => {
    const { rerender } = render(<Page />);
    const { sheet, field } = await typeInSheet();
    rerender(<Page invite={<InviteCard modal z={65} />} />);
    await frame();
    await frame();
    expect(document.activeElement).toBe(field);
    screen.getByRole('button', { name: 'Create gig' }).focus();
    tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it('a card the scrim covers at its centre (hit test) does not take over', async () => {
    const { rerender } = render(<Page />);
    const { field } = await typeInSheet();
    const scrim = document.querySelector<HTMLElement>('.bw-rail-sheet:not([role="dialog"])')!;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(16, 40, 300, 160));
    (document as Document & { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => scrim;
    try {
      rerender(<Page invite={<InviteCard modal z={500} />} />);
      await frame();
      await frame();
      expect(document.activeElement).toBe(field);
    } finally {
      delete (document as unknown as Record<string, unknown>).elementFromPoint;
    }
  });

  it('a popup waiting hidden (hidden, display:none, aria-hidden, inert) does not register', async () => {
    for (const hide of [{ hidden: true }, { style: { display: 'none' } }, { 'aria-hidden': true }, { inert: '' }] as const) {
      const { rerender, unmount } = render(<Page />);
      const { sheet, field } = await typeInSheet();
      rerender(<Page invite={<InviteCard modal z={500} hide={hide as never} />} />);
      await frame();
      await frame();
      expect(document.activeElement).toBe(field);
      screen.getByRole('button', { name: 'Create gig' }).focus();
      tab();
      expect(sheet.contains(document.activeElement)).toBe(true);
      unmount();
    }
  });

  it('after the sheet closes, Tab reaches the tab bar and the rail again (the trap lets go)', async () => {
    const { rerender } = render(<Page />);
    await typeInSheet();
    // A dialog above the sheet that its owner leaves on the page.
    rerender(<Page invite={<InviteCard modal z={500} />} />);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Band invite' }).contains(document.activeElement)).toBe(true));
    rerender(<Page invite={<InviteCard modal z={500} />} sheetOpen={false} />);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create' })).toBeNull());
    expect(document.querySelector('[data-bw-focus-guard]')).toBeNull();
    for (const name of ['Home', 'Calendar', 'Back']) {
      const b = screen.getByRole('button', { name });
      b.focus();
      expect(tab()).toBe(true); // the browser moves focus: nothing pulls it back
      expect(document.activeElement).toBe(b);
    }
  });

  it('a dialog that opens above moves focus to its first control that is not a text field', async () => {
    const Above: React.FC = () =>
      createPortal(
        <div role="dialog" aria-modal="true" aria-label="Rename">
          <input aria-label="Name" />
          <button type="button">Save name</button>
        </div>,
        document.body,
      );
    const { rerender } = render(<Page />);
    await typeInSheet();
    rerender(<Page invite={<Above />} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save name' })));
  });
});

describe('lists owned by the trapped layer', () => {
  const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <ComposerShell title="New gig" closeLabel="Close" onClose={() => {}} ready={{ done: 0, total: 3 }} accent="#000" kind="gig">
      {children}
      <button type="button">Publish</button>
    </ComposerShell>
  );

  const wrapsFromLast = (composer: HTMLElement) => {
    screen.getByRole('button', { name: 'Publish' }).focus();
    const buttons = Array.from(composer.querySelectorAll<HTMLElement>('button:not([disabled])'));
    buttons[buttons.length - 1].focus();
    expect(tab()).toBe(false); // the trap handles it
    expect(composer.contains(document.activeElement)).toBe(true);
  };

  it('the venue suggestions keep the composer trap on; Tab closes them and stays in the composer', async () => {
    const Venue: React.FC = () => {
      const [v, setV] = useState('');
      return <VenueAutocomplete value={v} onChange={setV} onSelect={() => {}} inputId="venue" />;
    };
    render(
      <Shell>
        <Venue />
      </Shell>,
    );
    const composer = document.querySelector<HTMLElement>('[data-bw-composer]')!;
    const input = screen.getByRole('combobox');
    input.focus();
    fireEvent.change(input, { target: { value: 'Blue' } });
    await screen.findByRole('listbox', {}, { timeout: 2000 });
    await frame();
    await frame();
    wrapsFromLast(composer);
    input.focus();
    tab();
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(composer.contains(document.activeElement)).toBe(true);
    wrapsFromLast(composer);
  });

  it('"Add here" on the stage plot is part of the composer: the trap stays on', async () => {
    const Plot: React.FC = () => {
      const [plot, setPlot] = useState<StagePlot>({ id: 'p', name: 'Main', items: [] });
      return <StagePlotView plot={plot} editable onChange={setPlot} />;
    };
    render(
      <Shell>
        <Plot />
      </Shell>,
    );
    Element.prototype.scrollIntoView ??= () => {};
    const composer = document.querySelector<HTMLElement>('[data-bw-composer]')!;
    const stage = screen.getByRole('group', { name: /Stage plot/ });
    fireEvent.pointerDown(stage, { pointerType: 'touch', pointerId: 1, clientX: 40, clientY: 40, button: 0 });
    await screen.findByRole('menu', { name: 'Add here' }, { timeout: 2000 });
    await frame();
    await frame();
    wrapsFromLast(composer);
  });

  it('a list on <body> that a field in the composer controls (aria-controls) belongs to the composer', async () => {
    const Combo: React.FC = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <input aria-label="Instrument" role="combobox" aria-expanded={open} aria-controls={open ? 'instr-list' : undefined} onChange={() => setOpen(true)} />
          {open &&
            createPortal(
              <div id="instr-list" role="listbox" aria-label="Instruments">
                <div role="option" aria-selected="false">
                  Bass
                </div>
              </div>,
              document.body,
            )}
        </>
      );
    };
    render(
      <Shell>
        <Combo />
      </Shell>,
    );
    const composer = document.querySelector<HTMLElement>('[data-bw-composer]')!;
    const input = screen.getByRole('combobox');
    input.focus();
    fireEvent.change(input, { target: { value: 'B' } });
    await screen.findByRole('listbox');
    await frame();
    await frame();
    wrapsFromLast(composer);
  });
});

describe('layers that go away or close beneath', () => {
  it('a dialog above that is hidden or leaving (still on the page) no longer traps: Tab is back in the sheet', async () => {
    for (const leave of [
      (el: HTMLElement) => el.setAttribute('hidden', ''),
      (el: HTMLElement) => (el.style.pointerEvents = 'none'),
      (el: HTMLElement) => el.setAttribute('aria-hidden', 'true'),
    ]) {
      const { rerender, unmount } = render(<Page />);
      const { sheet } = await typeInSheet();
      rerender(<Page invite={<InviteCard modal z={500} />} />);
      const card = screen.getByRole('dialog', { name: 'Band invite' });
      await waitFor(() => expect(card.contains(document.activeElement)).toBe(true));
      leave(card);
      screen.getByRole('button', { name: 'Create gig' }).focus();
      tab();
      expect(sheet.contains(document.activeElement)).toBe(true);
      unmount();
    }
  });

  it('a sheet that closes beneath another one leaves focus where it is', async () => {
    const Two: React.FC<{ lower: boolean }> = ({ lower }) => {
      const [upper, setUpper] = useState(false);
      return (
        <>
          <button type="button">Page button</button>
          <BwSheet open={lower} onClose={() => {}} title="Lower">
            <button type="button" onClick={() => setUpper(true)}>
              Open upper
            </button>
          </BwSheet>
          <BwSheet open={upper} onClose={() => setUpper(false)} title="Upper">
            <button type="button">First</button>
            <button type="button">Second</button>
          </BwSheet>
        </>
      );
    };
    const { rerender } = render(<Two lower={false} />);
    screen.getByRole('button', { name: 'Page button' }).focus();
    rerender(<Two lower />);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Lower' }).contains(document.activeElement)).toBe(true));
    const open = screen.getByRole('button', { name: 'Open upper' });
    open.focus();
    fireEvent.click(open);
    const upper = await screen.findByRole('dialog', { name: 'Upper' });
    await waitFor(() => expect(upper.contains(document.activeElement)).toBe(true));
    const second = screen.getByRole('button', { name: 'Second' });
    second.focus();
    rerender(<Two lower={false} />);
    await frame();
    await frame();
    expect(document.activeElement).toBe(second);
    // The upper one still traps.
    tab();
    expect(upper.contains(document.activeElement)).toBe(true);
  });
});

describe('the Duo rail\'s actions (Close, Back) belong to the top layer', () => {
  /** Stand-in for DuoRail's actions toolbar, where a layer's Close moves on the Duo. */
  const Rail: React.FC = () => (
    <div role="toolbar" aria-label="Screen actions" data-bw-trap-include="">
      <button type="button">Close (rail)</button>
    </div>
  );
  const Tabs: React.FC = () => (
    <nav aria-label="Main">
      <button type="button">Home</button>
    </nav>
  );

  it('Tab reaches Close in the rail and wraps back into the layer; the tab bar stays out', async () => {
    render(
      <>
        <Tabs />
        <Rail />
        <BwSheet open onClose={() => {}} title="Create" footer={<button type="button">Create gig</button>}>
          <button type="button">New gig</button>
        </BwSheet>
      </>,
    );
    const sheet = screen.getByRole('dialog', { name: 'Create' });
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    const close = screen.getByRole('button', { name: 'Close (rail)' });
    // Shift+Tab from the first control of the sheet goes round to Close, the last stop.
    const first = Array.from(sheet.querySelectorAll<HTMLElement>('button'))[0];
    first.focus();
    tab(true);
    expect(document.activeElement).toBe(close);
    // On Close, Tab is not pulled away, and from it Tab wraps to the sheet.
    tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
    // The tab bar is still behind the trap.
    screen.getByRole('button', { name: 'Home' }).focus();
    tab();
    expect(sheet.contains(document.activeElement) || document.activeElement === close).toBe(true);
  });
});
