/**
 * Duo Laptop pose: the Create layers keep their header on the Display and
 * start their fields on the Deck (`.bw-fold-form`, rules in index.css), so no
 * field or button rests across the fold.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('@/lib/services/rehearsalPolls', () => ({
  checkMemberProposalEligibility: vi.fn(async () => ({ canPropose: true, nextAvailableDate: null })),
  createMemberRehearsalProposal: vi.fn(async () => ({})),
}));
vi.mock('@/lib/services/events', () => ({
  createPersonalGig: vi.fn(async () => ({})),
  updatePersonalGig: vi.fn(async () => ({})),
}));

import { ProposeRehearsalModal } from '../ProposeRehearsalModal';
import { PersonalGigModal } from '../../modals/PersonalGigModal';

// The stylesheet as written (CSS imports are stubbed in the test runner).
const FS = 'node:fs';
const readCss = async (): Promise<string> => {
  const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync: (p: string, enc: 'utf8') => string };
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();
  return readFileSync(`${cwd}/src/styles/index.css`, 'utf8');
};

describe('Duo laptop pose: Create layers stay off the fold', () => {
  it('the propose-rehearsal form keeps its header on the Display', async () => {
    render(<ProposeRehearsalModal isOpen onClose={() => {}} bandId="b1" bandName="Band" userId="u1" />);
    await waitFor(() => expect(document.querySelector('.bw-fold-form > header:first-child')).not.toBeNull());
  });

  it('the personal gig form keeps its header on the Display', () => {
    render(<PersonalGigModal isOpen onClose={() => {}} userId="u1" />);
    expect(document.querySelector('.bw-fold-form > header:first-child')).not.toBeNull();
  });

  it('the laptop-pose header rule outranks the status-bar header rule', async () => {
    // `:root[data-bw-rail-host][data-bw-status-block] header` (0,3,1) used to
    // shrink the Display-high header back to the status bar's height.
    expect(await readCss()).toContain(':root[data-bw-posture="tabletop"] .bw-fold-form > :first-child {');
    expect(await readCss()).toMatch(/\.bw-fold-form > :first-child \{\s*min-height: max\(var\(--bw-display-h\), var\(--bw-status-bottom/);
  });

  it('a form that scrolls as one keeps its header on the Display while the fields scroll', async () => {
    expect(await readCss()).toMatch(
      /:root\[data-bw-posture="tabletop"\]:not\(\[data-keyboard="open"\]\) \.bw-fold-form\.overflow-y-auto > :first-child \{\s*position: sticky;/,
    );
  });
});
