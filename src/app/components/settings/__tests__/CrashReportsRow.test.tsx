import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ rpc: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      h.rpc.push(args);
      return { data: true, error: null };
    },
  },
}));

import { CrashReportsRow } from '../CrashReportsRow';
import { readCrashReportsEnabled, __resetCrashReportsForTest } from '@/lib/crashReports';
import { ErrorBoundary } from '@/app/components/ui/ErrorBoundary';

beforeEach(() => {
  localStorage.clear();
  __resetCrashReportsForTest();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Send crash reports (Settings › Privacy & account)', () => {
  it('is on by default and turns off', () => {
    render(<CrashReportsRow />);
    const sw = screen.getByRole('switch', { name: 'Send crash reports' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Never your songs, gigs, messages or contacts/)).toBeInTheDocument();
    fireEvent.click(sw);
    expect(readCrashReportsEnabled()).toBe(false);
    expect(screen.getByRole('switch', { name: 'Send crash reports' })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('a screen that fails to draw', () => {
  it('is reported as a render error', async () => {
    h.rpc = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => {
      throw new Error('bad lyrics');
    };
    render(
      <ErrorBoundary fallback={<p>Fallback</p>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Fallback')).toBeInTheDocument();
    await waitFor(() => expect(h.rpc.map((a) => a.p_kind)).toContain('render'));
    expect(h.rpc.find((a) => a.p_kind === 'render')?.p_message).toBe('Error: bad lyrics');
  });
});
