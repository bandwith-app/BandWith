/**
 * Claude #297 round 3: a new date for one later date of a repeating
 * rehearsal asks "Only this date" or "The whole series" before it saves.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/app/components/ui/DatePicker', async (orig) => ({
  ...(await orig<typeof import('@/app/components/ui/DatePicker')>()),
  DatePicker: ({ id, value, onChange }: { id?: string; value?: string; onChange: (d: string) => void }) => (
    <input id={id} data-testid={id} value={value || ''} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('@/lib/BandContext', () => ({ useBand: () => ({ bands: [], selectedBand: { id: 'b1', members: [] }, isAdmin: true }) }));

import { OverviewEditSheets } from '../OverviewEditSheets';

const event = {
  id: 'ev-occ-2099-12-08', eventId: 'ev', band_id: 'b1', title: 'Weekly', status: 'REHEARSAL', eventType: 'rehearsal',
  date: '2099-12-08', seriesDate: '2099-12-01', time: '19:00', timeSet: true, location: 'Studio', price: '0', members: [], color: '',
  is_recurring: true, recurrence_rule: { frequency: 'weekly', interval: 1 },
} as any;

const setup = () => {
  const api = { saveFields: vi.fn(async () => null), saveLineup: vi.fn(), saveTasks: vi.fn(), moveDateOnly: vi.fn(async () => null) };
  render(<OverviewEditSheets card="event" onClose={() => {}} event={event} kind="rehearsal" api={api as any} lineup={[]} tasks={[]} />);
  fireEvent.change(screen.getByTestId('ovw-date'), { target: { value: '2099-12-10' } });
  return api;
};
const save = () => screen.getAllByRole('button', { name: 'Save' }).slice(-1)[0]!;

describe('a new date for one date of a series', () => {
  it('asks which dates move; Save waits for the answer', () => {
    setup();
    const ask = screen.getByRole('radiogroup', { name: 'Move which dates?' });
    expect(within(ask).getByRole('radio', { name: 'Only this date' })).toBeTruthy();
    expect(within(ask).getByRole('radio', { name: 'The whole series' })).toBeTruthy();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
  });

  it('Only this date: moves that date alone', () => {
    const api = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Only this date' }));
    fireEvent.click(save());
    expect(api.moveDateOnly).toHaveBeenCalledWith(expect.objectContaining({ date: '2099-12-10' }));
    expect(api.saveFields).not.toHaveBeenCalled();
  });

  it('The whole series: its start moves by the same days', () => {
    const api = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'The whole series' }));
    fireEvent.click(save());
    expect(api.saveFields).toHaveBeenCalledWith(expect.objectContaining({ event_date: '2099-12-03' }));
  });
});
