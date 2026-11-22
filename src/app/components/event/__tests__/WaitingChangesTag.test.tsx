import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { WaitingChangesTag } from '../WaitingChangesTag';
import { queueLiveOp } from '@/lib/liveOutbox';

const note = (id: string) => ({ kind: 'note' as const, id, songId: 's1', anchor: { type: 'song' as const }, body: 'capo 2', isNew: true });

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('"N changes waiting for signal"', () => {
  it('shows nothing when nothing waits', () => {
    const { container } = render(<WaitingChangesTag userId="u-1" />);
    expect(container.textContent).toBe('');
  });

  it('says how many changes wait, in plain words, and updates', () => {
    render(<WaitingChangesTag userId="u-1" />);
    act(() => queueLiveOp('u-1', note('n1')));
    expect(screen.getByRole('status')).toHaveTextContent('1 change waiting for signal');
    act(() => queueLiveOp('u-1', note('n2')));
    expect(screen.getByRole('status')).toHaveTextContent('2 changes waiting for signal');
    expect(screen.getByRole('status').textContent).not.toMatch(/sync/i);
  });
});
