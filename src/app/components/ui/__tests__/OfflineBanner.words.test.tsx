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
