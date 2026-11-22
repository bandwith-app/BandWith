import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

const m = vi.hoisted(() => ({ queued: false }));
const chart = { title: 'Empire State of Mind', sections: [] };
vi.mock('@/lib/BandContext', () => ({ useBand: () => ({ selectedBand: { id: 'b1' }, isAdmin: false }) }));
vi.mock('@/lib/chartInbox', () => ({
  onReceivedChart: () => () => {},
  peekReceivedChart: () => chart,
  receivedFileProblem: () => null,
  setReceivedFileProblem: vi.fn(),
  takeReceivedChart: vi.fn(),
}));
vi.mock('@/lib/services/songs', () => ({
  getSongs: async () => ({ data: [{ id: 's1', band_id: 'b1', title: 'Empire State of Mind', artist: 'Alicia Keys', status: 'active' }], error: null }),
  updateSong: vi.fn(),
}));
vi.mock('@/lib/services/songSuggestions', () => ({
  suggestSongChange: async () => (m.queued ? { data: null, error: null, queued: true } : { data: {}, error: null }),
}));
vi.mock('@/app/components/ui/ChordChart', () => ({ chartSource: () => '', chartSummary: () => '' }));
vi.mock('@/lib/ireal', () => ({ chartBarCount: () => 8 }));

import { ReceivedChartSheet } from '../ReceivedChartSheet';

afterEach(cleanup);

async function suggest() {
  render(<ReceivedChartSheet />);
  const row = await screen.findByRole('button', { name: /Empire State of Mind/ });
  await act(async () => {
    fireEvent.click(row);
  });
}

describe('a chart from another app, suggested by a member', () => {
  it('says it went to the admin when it did', async () => {
    m.queued = false;
    await suggest();
    expect(await screen.findByText(/Sent to the admin/)).toBeInTheDocument();
  });

  it('with no signal, says it is kept on this phone instead', async () => {
    m.queued = true;
    await suggest();
    expect(await screen.findByText('Saved on this phone. It goes to the admin when you’re back online.')).toBeInTheDocument();
    expect(screen.queryByText(/Sent to the admin/)).toBeNull();
  });
});
