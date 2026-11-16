/**
 * Poll builder on a phone: while the keyboard is up, the Back / Publish bar
 * steps aside so the Location field's venue suggestions are not hidden under
 * it. In the Duo Laptop pose the header holds the Display.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: 'b1', name: 'Band', members: [] }, refreshMembers: vi.fn() }),
}));
vi.mock('@/lib/bandAvailability', async (orig) => ({
  ...(await orig<typeof import('@/lib/bandAvailability')>()),
  useBandFreeDays: () => null,
  useCandidateFreeCounts: () => new Map(),
}));
vi.mock('@/lib/services/rehearsalPolls', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/rehearsalPolls')>()),
  createOrPublishAdminPoll: vi.fn(),
}));

import { RehearsalPollModal } from '../RehearsalPollModal';

// The stylesheet as written (CSS imports are stubbed in the test runner).
const FS = 'node:fs';
const readCss = async (): Promise<string> => {
  const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync: (p: string, enc: 'utf8') => string };
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();
  return readFileSync(`${cwd}/src/styles/index.css`, 'utf8');
};

describe('Poll builder and the keyboard', () => {
  it('the Back / Publish bar steps aside while the keyboard is up, so venue suggestions stay visible', async () => {
    render(<RehearsalPollModal isOpen onClose={() => {}} bandId="b1" adminId="a1" />);
    const bar = screen.getByRole('button', { name: /Publish poll/i }).closest('.bw-poll-cta');
    expect(bar).not.toBeNull();
    expect(await readCss()).toMatch(/html\[data-keyboard="open"\] \.bw-poll-cta \{\s*display: none !important;/);
  });

  it('in the Duo laptop pose the poll header holds the Display', () => {
    render(<RehearsalPollModal isOpen onClose={() => {}} bandId="b1" adminId="a1" />);
    expect(document.querySelector('.bw-fold-form > header:first-child')).not.toBeNull();
  });

  it('venue suggestions open under the whole Location field, as wide as it', () => {
    render(<RehearsalPollModal isOpen onClose={() => {}} bandId="b1" adminId="a1" />);
    const input = screen.getByLabelText('Location / studio');
    // The search box itself is not a positioning box: the field pill is.
    const search = input.closest('div.w-full') as HTMLElement;
    expect(search.className.split(' ')).toContain('static');
    expect(search.className.split(' ')).not.toContain('relative');
    expect((search.parentElement as HTMLElement).className.split(' ')).toContain('relative');
  });
});
