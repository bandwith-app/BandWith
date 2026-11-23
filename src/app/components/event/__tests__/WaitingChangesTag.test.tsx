import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react';
import { WaitingChangesTag } from '../WaitingChangesTag';
import { flushLiveOutbox, keepRefused, queueLiveOp, readRefusedLiveOps, type LiveOutboxApi } from '@/lib/liveOutbox';

const note = (id: string, body = 'capo 2') => ({ kind: 'note' as const, id, songId: 's1', anchor: { type: 'song' as const }, body, isNew: true });

/** navigator.onLine, as the browser reports it. */
const setOnline = (on: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => on });
  window.dispatchEvent(new Event(on ? 'online' : 'offline'));
};

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
});
afterEach(() => {
  cleanup();
  setOnline(true);
});

describe('"N changes waiting for signal"', () => {
  it('shows nothing when nothing waits', () => {
    const { container } = render(<WaitingChangesTag userId="u-1" />);
    expect(container.textContent).toBe('');
  });

  it('no signal: says how many changes wait for it, in plain words, and updates', () => {
    setOnline(false);
    render(<WaitingChangesTag userId="u-1" />);
    act(() => queueLiveOp('u-1', note('n1')));
    expect(screen.getByRole('status')).toHaveTextContent('1 change waiting for signal');
    act(() => queueLiveOp('u-1', note('n2')));
    expect(screen.getByRole('status')).toHaveTextContent('2 changes waiting for signal');
    expect(screen.getByRole('status').textContent).not.toMatch(/sync/i);
  });

  it('full signal (the server busy for a moment): "waiting to send", not "waiting for signal"', () => {
    render(<WaitingChangesTag userId="u-1" />);
    act(() => queueLiveOp('u-1', note('n1')));
    expect(screen.getByRole('status')).toHaveTextContent('1 change waiting to send');
    act(() => setOnline(false));
    expect(screen.getByRole('status')).toHaveTextContent('1 change waiting for signal');
  });
});

describe('a change that was not saved', () => {
  const refuse: LiveOutboxApi = {
    // Not allowed (42501): a refusal for good in #292's classes (liveOutbox.ts, isDefiniteRefusal).
    note: async () => ({ error: { message: 'Forbidden', code: '42501' } }),
    noteDelete: async () => ({ error: null }),
    suggestion: async () => ({ error: null }),
    order: async () => ({ error: null }),
  };

  it('is shown, its words can be copied, and it goes when removed', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<WaitingChangesTag userId="u-1" />);
    queueLiveOp('u-1', note('n1', 'Capo 2 on the bridge'));
    await act(async () => {
      await flushLiveOutbox('u-1', refuse);
    });
    const open = screen.getByRole('button', { name: /1 change wasn’t saved/ });
    fireEvent.click(open);
    const sheet = screen.getByRole('dialog');
    expect(sheet).toHaveTextContent('Capo 2 on the bridge');
    expect(sheet).toHaveTextContent('Your note');
    expect(sheet).toHaveTextContent('The server didn’t accept it.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Capo 2 on the bridge');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove' }));
    // Removed through the list's own call: Settings › Offline & live no longer has it either.
    expect(readRefusedLiveOps('u-1')).toEqual([]);
    expect(screen.queryByRole('button', { name: /wasn’t saved/ })).toBeNull();
  });

  it('one the server never answered for (the stuck cap) says so', () => {
    keepRefused('u-1', note('n1', 'Slower outro'), 'stuck');
    keepRefused('u-1', { kind: 'noteDelete', id: 'n2', songId: 's1' });
    render(<WaitingChangesTag userId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: /2 changes weren’t saved/ }));
    const sheet = screen.getByRole('dialog');
    expect(sheet).toHaveTextContent('The server didn’t answer for too long.');
    // Kept without a reason (lock-screen sign-out): no reason line.
    expect(within(sheet).queryAllByText(/^The server didn’t/)).toHaveLength(1);
  });

  it('Copy, Remove and Close take a 44 px tap (36 px buttons, a hit area 6 px past each edge: it starts inside the border)', () => {
    keepRefused('u-1', note('n1', 'Slower outro'));
    render(<WaitingChangesTag userId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: /1 change wasn’t saved/ }));
    const sheet = screen.getByRole('dialog');
    for (const name of ['Copy', 'Remove', 'Close']) {
      const cls = within(sheet).getByRole('button', { name }).className;
      expect(cls, name).toContain('relative');
      expect(cls, name).toMatch(/after:-inset(-y)?-1\.5(\s|$)/);
    }
  });
});
