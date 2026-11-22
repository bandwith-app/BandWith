/**
 * Duo Laptop pose: the song form (with its live-mode fields) keeps its header
 * on the Display and its fields on the Deck (`.bw-fold-form`, index.css), so
 * no field (the time signature chips) rests across the fold.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ isAdmin: true, selectedBand: { id: 'b1', name: 'Hudson Street Band' } }),
  useOptionalBand: () => ({ isAdmin: true, selectedBand: { id: 'b1', name: 'Hudson Street Band' } }),
}));
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
  useOptionalAuth: () => ({ user: { id: 'u1' } }),
}));

import { AddSongModal } from '../AddSongModal';

describe('Duo laptop pose: the song form stays off the fold', () => {
  it('is a fold form: header first, then the fields', () => {
    render(<AddSongModal isOpen onClose={() => {}} bandId="b1" />);
    const form = document.querySelector('[role="dialog"][aria-labelledby="add-song-title"]');
    expect(form?.classList.contains('bw-fold-form')).toBe(true);
    expect(form?.firstElementChild?.tagName).toBe('HEADER');
  });
});
