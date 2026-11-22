import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

const m = vi.hoisted(() => ({ result: { data: null, error: null, queued: false } as { data: unknown; error: unknown; queued?: boolean } }));
vi.mock('@/lib/services/songSuggestions', async (orig) => {
  const real = await orig<typeof import('@/lib/services/songSuggestions')>();
  return { ...real, suggestSongChange: vi.fn(async () => m.result) };
});

import { SuggestSongChangeSheet } from '../SuggestSongChangeSheet';
import { openSuggestChange, closeSuggestChange } from '@/lib/services/songSuggestions';

const song = { id: 's1', band_id: 'b1', title: 'Empire State of Mind', lyrics: '[C]Concrete jungle', start: 'note' as const };

beforeEach(() => {
  m.result = { data: null, error: null, queued: false };
});
afterEach(() => {
  act(() => closeSuggestChange());
  cleanup();
});

async function sendNote() {
  render(<SuggestSongChangeSheet />);
  act(() => openSuggestChange(song));
  const box = await screen.findByRole('textbox');
  fireEvent.change(box, { target: { value: 'Count in 4 on the second verse' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Send suggestion/i }));
  });
}

describe('"Note for the band" with no signal', () => {
  it('says it was sent when it reached the admin', async () => {
    await sendNote();
    expect(screen.getByRole('status')).toHaveTextContent('Sent to the admin');
  });

  it('says it is kept on this phone, not sent, when there is no signal', async () => {
    m.result = { data: null, error: null, queued: true };
    await sendNote();
    const s = screen.getByRole('status');
    expect(s).toHaveTextContent('Saved on this phone. It goes to the admin when you’re back online.');
    expect(s.textContent).not.toMatch(/Sent to the admin|sync/i);
  });
});
