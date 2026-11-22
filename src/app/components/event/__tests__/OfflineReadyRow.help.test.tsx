import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { OfflineReadyRow } from '../OfflineReadyRow';
import { queueLiveOp } from '@/lib/liveOutbox';

// The "?" on the gig's offline row opens the Academy: the guide to live mode
// without signal, or, while changes wait for signal, the guide to those.

const note = { kind: 'note' as const, id: 'n1', songId: 's1', anchor: { type: 'song' as const }, body: 'capo 2', isNew: true };

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the "?" on the offline row', () => {
  it('opens the live mode guide, and the changes guide while changes wait', () => {
    render(<OfflineReadyRow pack={null} userId="u-1" event={{ id: 'e1' }} online={false} />);
    const help = screen.getByRole('button', { name: 'Help for this screen' });
    expect(help).toHaveAttribute('data-academy', 'live-mode-offline');
    act(() => queueLiveOp('u-1', note));
    expect(screen.getByRole('button', { name: 'Help for this screen' })).toHaveAttribute('data-academy', 'changes-without-signal');
  });
});
