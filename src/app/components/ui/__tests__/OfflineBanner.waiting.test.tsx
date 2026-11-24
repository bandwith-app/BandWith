import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

// The offline bar counts every change that waits on this phone. It counted
// only the offline queue (gigs and rehearsals edited offline): with two notes
// written in Stage mode and no signal it still said "showing cached info",
// while Stage's own tag said "2 changes waiting for signal".

const sendWaitingNow = vi.fn(async (_userId: string) => ({ left: 0, refused: 0, refusedNotes: 0, busy: false }));
vi.mock('@/app/hooks/useLiveOutbox', async (orig) => ({
  ...(await orig<typeof import('@/app/hooks/useLiveOutbox')>()),
  sendWaitingNow: (userId: string) => sendWaitingNow(userId),
}));

import { AppOfflineBanner } from '../OfflineBanner';
import { queueLiveOp, writeLiveOutbox } from '@/lib/liveOutbox';
import { queueNoteOp } from '@/lib/rehearsalNotesOutbox';
import { setLocalePref } from '@/lib/i18n';
import { TRANSLATED, loadAllDictionaries } from '@/test/dictionaries';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const ME = 'u-1';
const note = (id: string) => ({ kind: 'note' as const, id, songId: 's1', anchor: { type: 'song' as const }, body: 'capo 2', isNew: true });

beforeEach(() => {
  localStorage.clear();
  sendWaitingNow.mockClear();
});
afterEach(async () => {
  cleanup();
  await act(() => setLocalePref('en'));
});

describe('the offline bar counts every change waiting on this phone', () => {
  it('two notes written in Stage mode with no signal: "2 changes waiting for signal"', () => {
    queueLiveOp(ME, note('n1'));
    queueLiveOp(ME, note('n2'));
    render(<AppOfflineBanner userId={ME} isOnline={false} wasOffline={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline · 2 changes waiting for signal');
    expect(screen.queryByText(/showing cached info/)).toBeNull();
  });

  it('one waits: singular', () => {
    queueLiveOp(ME, note('n1'));
    render(<AppOfflineBanner userId={ME} isOnline={false} wasOffline={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline · 1 change waiting for signal');
  });

  it('every kind adds up: the offline queue, Stage (note, suggestion, the leader’s order) and rehearsal notes', () => {
    queueLiveOp(ME, note('n1'));
    queueLiveOp(ME, { kind: 'suggestion', id: 'g1', row: { kind: 'note' } });
    queueLiveOp(ME, { kind: 'order', setlistId: 'l1', rows: [], before: [] });
    queueNoteOp(ME, { kind: 'ok', id: 'r1', value: true });
    // Two gig edits in the offline queue (useNetworkStatus's pendingSyncCount).
    render(<AppOfflineBanner userId={ME} isOnline={false} wasOffline={false} pendingCount={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline · 6 changes waiting for signal');
  });

  it('another account’s changes on this phone are not mine', () => {
    queueLiveOp('u-2', note('n1'));
    render(<AppOfflineBanner userId={ME} isOnline={false} wasOffline={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline · showing cached info');
  });

  it('nothing waits: "showing cached info"; a note written while the bar shows is counted at once, and leaves when sent', () => {
    render(<AppOfflineBanner userId={ME} isOnline={false} wasOffline={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline · showing cached info');
    act(() => queueLiveOp(ME, note('n1')));
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline · 1 change waiting for signal');
    act(() => writeLiveOutbox(ME, []));
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline · showing cached info');
  });

  it('back online: "sending 2 changes", and Send now sends the offline queue and the Stage changes', () => {
    queueLiveOp(ME, note('n1'));
    const syncQueue = vi.fn();
    const { rerender } = render(<AppOfflineBanner userId={ME} isOnline={false} wasOffline={false} pendingCount={1} onSyncNow={syncQueue} />);
    rerender(<AppOfflineBanner userId={ME} isOnline wasOffline pendingCount={1} onSyncNow={syncQueue} />);
    expect(screen.getByRole('status')).toHaveTextContent('Back online · sending 2 changes');
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    expect(syncQueue).toHaveBeenCalledTimes(1);
    expect(sendWaitingNow).toHaveBeenCalledWith(ME);
  });

  it('back online with nothing left: "up to date", no button', () => {
    const { rerender } = render(<AppOfflineBanner userId={ME} isOnline={false} wasOffline={false} onSyncNow={() => {}} />);
    rerender(<AppOfflineBanner userId={ME} isOnline wasOffline onSyncNow={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Back online · up to date');
    expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull();
  });

  it('one and two, in every language', async () => {
    const dicts = await loadAllDictionaries();
    for (const lang of TRANSLATED) {
      const d = dicts[lang];
      await act(() => setLocalePref(lang));
      for (const n of [1, 2]) {
        localStorage.removeItem(`bw:live_outbox:${ME}`);
        for (let i = 0; i < n; i++) queueLiveOp(ME, note(`n${i}`));
        const { unmount } = render(<AppOfflineBanner userId={ME} isOnline={false} wasOffline={false} />);
        const changes = d[n === 1 ? '{count} change' : '{count} changes'].replace('{count}', String(n));
        const want = d['You’re offline · {changes} waiting for signal'].replace('{changes}', changes);
        expect(want, `${lang}: translated`).not.toMatch(/You’re offline|\{/);
        expect(screen.getByRole('status'), `${lang}, ${n}`).toHaveTextContent(want);
        unmount();
      }
    }
  });
});
