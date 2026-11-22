// Audit 04 #2: a reset link opened in a browser where someone else is signed
// in must not open the new-password screen on that other account.
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callbackProblemText } from '@/lib/authCallback';
import { clearRecoveryProof, noteOwnExchange, noteRecovery, resetOwnExchange } from '@/lib/recoveryProof';

const BOB = '00000000-0000-0000-0000-00000000b0b0';
const auth = vi.hoisted(() => ({
  initialize: vi.fn(async () => ({ error: null })),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: '00000000-0000-0000-0000-00000000b0b0' } } } })),
  exchangeCodeForSession: vi.fn(async () => ({ error: null })),
}));
vi.mock('@/lib/supabase', () => ({ RECOVERY_FLAG: 'bw_recovery', supabase: { auth } }));

import AuthCallback from '../callback';

const problemTitle = callbackProblemText('other_browser', true).title;

describe('reset link callback', () => {
  beforeEach(() => {
    clearRecoveryProof();
    resetOwnExchange();
    // Bob is signed in here; the link carries Alice's code, and this
    // browser has no verifier for it, so the library leaves Bob's session.
    window.history.replaceState(null, '', '/auth/callback?code=alice-code&bw_recovery=1');
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.clearAllMocks();
  });

  it("does not take someone else's session for a reset", async () => {
    render(<AuthCallback />);
    await waitFor(() => expect(screen.getByText(problemTitle)).toBeTruthy());
  });

  // Codex review #287 round 2 (B1): Bob finished his own reset in another
  // tab; the library broadcasts PASSWORD_RECOVERY for him to this tab too.
  it("a reset finished in another tab doesn't vouch for this link", async () => {
    noteRecovery(BOB); // the broadcast event, in this tab
    render(<AuthCallback />);
    await waitFor(() => expect(screen.getByText(problemTitle)).toBeTruthy());
  });

  it('opens the reset when the link really signed this account in here', async () => {
    // This tab exchanged the link's own code for Bob (recoveryExchangeFetch),
    // then the library's PASSWORD_RECOVERY event for that session.
    noteOwnExchange('alice-code', BOB);
    noteRecovery(BOB);
    render(<AuthCallback />);
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(problemTitle)).toBeNull();
  });
});
