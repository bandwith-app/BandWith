import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OfflineBanner } from '../OfflineBanner';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(cleanup);

describe('Back online, in plain words', () => {
  it('says everything is up to date, not "synced"', () => {
    const { rerender } = render(<OfflineBanner isOnline={false} wasOffline={false} />);
    rerender(<OfflineBanner isOnline wasOffline />);
    expect(screen.getByText('Back online · up to date')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sync/i);
  });
});

describe('changes waiting, in plain words', () => {
  it('offline: says the changes wait for signal', () => {
    render(<OfflineBanner isOnline={false} wasOffline={false} pendingCount={3} onSyncNow={() => {}} />);
    expect(screen.getByText('You’re offline · 3 changes waiting for signal')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sync/i);
  });

  it('back online: says they are being sent, and the button sends them now', () => {
    const { rerender } = render(<OfflineBanner isOnline={false} wasOffline={false} pendingCount={1} onSyncNow={() => {}} />);
    rerender(<OfflineBanner isOnline wasOffline pendingCount={1} onSyncNow={() => {}} />);
    expect(screen.getByText('Back online · sending 1 change')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send now' })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/sync/i);
  });
});
