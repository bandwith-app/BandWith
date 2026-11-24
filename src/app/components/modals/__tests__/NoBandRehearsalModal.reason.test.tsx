import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { NoBandRehearsalModal } from '../NoBandRehearsalModal';

afterEach(cleanup);

/**
 * "Band required": the one answer to anything that needs a band, for an
 * account that has none. It names what was asked for and offers one way on.
 */
describe('Band required', () => {
  it('says what needs a band: the chat', () => {
    render(<NoBandRehearsalModal isOpen reason="chat" onClose={() => {}} onOpenUpgrade={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: /band required/i });
    expect(dialog.textContent).toMatch(/chat is only available when you’re in a band/i);
    expect(dialog.textContent).not.toMatch(/proposing a rehearsal/i);
  });

  it('says what needs a band: another band screen', () => {
    render(<NoBandRehearsalModal isOpen reason="other" onClose={() => {}} onOpenUpgrade={() => {}} />);
    expect(screen.getByRole('dialog', { name: /band required/i }).textContent).toMatch(/this is only available when you’re in a band/i);
  });

  it('proposing a rehearsal keeps its own sentence (the default)', () => {
    render(<NoBandRehearsalModal isOpen onClose={() => {}} onOpenUpgrade={() => {}} />);
    expect(screen.getByRole('dialog', { name: /band required/i }).textContent).toMatch(/proposing a rehearsal is only available when you’re in a band/i);
  });

  it('"Create a band" closes it and opens band creation; "Maybe later" only closes it', () => {
    const onClose = vi.fn();
    const onOpenUpgrade = vi.fn();
    render(<NoBandRehearsalModal isOpen reason="chat" onClose={onClose} onOpenUpgrade={onOpenUpgrade} />);
    fireEvent.click(screen.getByRole('button', { name: /maybe later/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenUpgrade).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /create a band/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onOpenUpgrade).toHaveBeenCalledTimes(1);
  });
});
