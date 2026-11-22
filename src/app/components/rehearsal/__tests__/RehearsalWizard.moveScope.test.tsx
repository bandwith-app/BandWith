import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

// Claude #297 round 4: editing one date of a repeating rehearsal in the
// wizard and giving it a new date asks "Only this date or the whole series?",
// on the first date too, and sends the answer (and one request id) to the save.
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: 'band-1', name: 'Testcento' }, bands: [], isAdmin: true }),
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
// The date field as a plain input the test can change.
vi.mock('@/app/components/ui/DatePicker', async (orig) => ({
  ...(await orig<typeof import('@/app/components/ui/DatePicker')>()),
  DatePicker: ({ id, value, onChange }: { id?: string; value?: string; onChange?: (d: string) => void }) => (
    <input id={id} data-testid={id} value={value || ''} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));
vi.mock('@/lib/services/eventTasks', () => ({ listEventTasks: vi.fn(async () => ({ data: [], error: null })) }));
vi.mock('@/lib/services/pricing', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/pricing')>()),
  getBandPricing: vi.fn(() => new Promise(() => {})),
}));
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { RehearsalCreationWizard } from '../RehearsalCreationWizard';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const later = { id: 1, eventId: 'ev-1', title: 'Studio night', status: 'confirmed', date: '2099-12-10', seriesDate: '2099-12-03', time: '19:00', endTime: '22:00', location: 'Studio 4', price: '0', eventType: 'rehearsal', is_recurring: true, recurrence_rule: { frequency: 'weekly', interval: 1 } };
const first = { ...later, date: '2099-12-03', seriesDate: undefined };

async function changeDateAndSave(editing: Record<string, unknown>, to: string) {
  const onCreate = vi.fn(async () => true);
  render(<RehearsalCreationWizard onClose={vi.fn()} onCreate={onCreate} editingEvent={editing as any} />);
  fireEvent.change(await screen.findByTestId('rehearsal-date'), { target: { value: to } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Save rehearsal' })[0]);
  return onCreate;
}

describe('Wizard: which dates move (Claude #297 round 4)', () => {
  it('asks before saving, and "Only this date" sends the scope and a request id', async () => {
    const onCreate = await changeDateAndSave(later, '2099-12-11');
    expect(await screen.findByRole('button', { name: 'Only this date' })).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Only this date' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const sent = (onCreate.mock.calls[0] as any[])[0];
    expect(sent._moveScope).toBe('date');
    expect(typeof sent._moveClientId === 'string' && sent._moveClientId.length > 0).toBe(true);
    expect(sent.date).toBe('2099-12-11');
  });

  it('"The whole series" sends the series scope', async () => {
    const onCreate = await changeDateAndSave(later, '2099-12-12');
    fireEvent.click(await screen.findByRole('button', { name: 'The whole series' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(((onCreate.mock.calls[0] as any[])[0])._moveScope).toBe('series');
  });

  it('asks on the first date too', async () => {
    const onCreate = await changeDateAndSave(first, '2099-12-04');
    expect(await screen.findByRole('button', { name: 'Only this date' })).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('does not ask when the date stays', async () => {
    const onCreate = await changeDateAndSave(later, '2099-12-10');
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Only this date' })).toBeNull();
    expect(((onCreate.mock.calls[0] as any[])[0])._moveScope).toBeUndefined();
  });
});
