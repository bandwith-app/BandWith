import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

// Phase 3: the gig wizard closes only after a save, and keeps what the user
// typed (and a draft) when the save fails. Band, pricing, songs and tasks
// come from mocks.
const band = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: 'band-1', name: 'Testcento' }, bands: [], isAdmin: band.isAdmin }),
}));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/supabase', () => {
  const result = Promise.resolve({ data: null, error: null });
  const chain: any = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? result.then.bind(result) : chain),
    apply: () => chain,
  });
  return { supabase: chain };
});
vi.mock('@/lib/services/songs', () => ({
  getSongs: vi.fn(async () => ({ data: [], error: null })),
  getSetlists: vi.fn(async () => ({ data: [], error: null })),
  getSetlist: vi.fn(async () => ({ data: null, error: null })),
  getSetlistSongIds: vi.fn(async () => ({ data: [], error: null })),
}));
// The date field as a plain input showing its value.
vi.mock('@/app/components/ui/DatePicker', async (orig) => ({
  ...(await orig<typeof import('@/app/components/ui/DatePicker')>()),
  DatePicker: ({ id, value }: { id?: string; value?: string }) => <input id={id} data-testid={id} value={value || ''} readOnly />,
}));
vi.mock('@/lib/services/eventTasks', () => ({ listEventTasks: vi.fn(async () => ({ data: [], error: null })) }));
vi.mock('@/lib/services/pricing', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/pricing')>()),
  getBandPricing: vi.fn(() => new Promise(() => {})),
}));

// The shared setup mocks ResizeObserver with an arrow function, which
// vitest 4 cannot call with `new`.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const drafts = vi.hoisted(() => ({ save: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/wizardDrafts', async (orig) => ({
  ...(await orig<typeof import('@/lib/wizardDrafts')>()),
  saveEventDraft: drafts.save,
  deleteEventDraft: drafts.del,
}));

import { RehearsalCreationWizard } from '../RehearsalCreationWizard';
import { CreateEventModal } from '@/app/components/dashboard/CreateEventModal';
import { toLocalDateString } from '@/lib/dates';

/** Audit 05 #12: "Add rehearsal" on a Calendar day starts on that day, not tomorrow. */
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('New rehearsal from a Calendar day (audit 05 #12)', () => {
  it('the rehearsal wizard opened from the event modal starts on the chosen day', async () => {
    const onCreate = vi.fn(async () => true);
    render(<CreateEventModal initialType="rehearsal" initialDate="2099-12-04" onClose={vi.fn()} onCreate={onCreate} currentUserId="me" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(((await screen.findByTestId('rehearsal-date')) as HTMLInputElement).value).toBe('2099-12-04');
  });

  it('without a day it still starts tomorrow', async () => {
    render(<RehearsalCreationWizard onClose={vi.fn()} onCreate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    const tomorrow = toLocalDateString(new Date(Date.now() + 86400000));
    expect(((await screen.findByTestId('rehearsal-date')) as HTMLInputElement).value).toBe(tomorrow);
  });
});
