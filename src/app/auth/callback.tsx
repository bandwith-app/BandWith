import { useEffect, useState } from 'react';
import { supabase, RECOVERY_FLAG } from '@/lib/supabase';
import { Loader2 } from '@/app/components/icons';
import { t, useT } from '@/lib/i18n';
import { AuthScreen, Kicker, PillButton } from '@/app/components/bw/Form';
import { DuoAuthLayout } from '@/app/components/onboarding/DuoAuthLayout';
import {
  authScreenUrl,
  callbackProblem,
  callbackProblemText,
  callbackUrlError,
  type AuthCallbackProblem,
  type AuthScreenTarget,
} from '@/lib/authCallback';

/**
 * Auth callback page — handles OAuth redirects from Google/Apple.
 * 
 * When Supabase redirects back with the OAuth tokens in the URL hash
 * (e.g. #access_token=xxx&refresh_token=yyy), this page:
 * 1. Extracts tokens from URL hash (implicit flow)
 * 2. Sets the session via supabase.auth.setSession()
 * 3. Cleans the URL hash so isAuthCallback() won't match on next render
 * 4. Redirects to the main app root
 *
 * When the link can't sign in (expired or already used, opened in another
 * browser, Google cancelled) it shows why, with a way forward: a new reset
 * link or the sign-in screen. Never a blank page.
 */
export default function AuthCallback() {
  // Re-render on a language change; the text below uses the module t().
  useT();
  const [status, setStatus] = useState<'processing' | 'redirecting'>('processing');
  const [problem, setProblem] = useState<AuthCallbackProblem | null>(null);
  const isRecovery = new URLSearchParams(window.location.search).get(RECOVERY_FLAG) === '1';

  useEffect(() => {
    let cancelled = false;

    const fail = (err: unknown) => {
      if (!cancelled) setProblem(callbackProblem(err));
    };

    const handleCallback = async () => {
      try {
        // Parse hash params (implicit flow: #access_token=xxx&refresh_token=yyy...)
        const hashParams = new URLSearchParams(
          window.location.hash.substring(1)
        );
        const accessToken = hashParams.get('access_token');

        // Also check query params (PKCE flow or error callback)
        const queryParams = new URLSearchParams(window.location.search);
        const code = queryParams.get('code');

        // Expired reset link (otp_expired), cancelled sign-in (access_denied)…:
        // Supabase puts the error in the query and/or the fragment.
        const urlError = callbackUrlError(window.location.search, window.location.hash);
        if (urlError) {
          console.error('[AuthCallback] Auth error in URL:', urlError.code || urlError.error);
          fail(urlError);
          return;
        }

        if (code) {
          // PKCE flow. With detectSessionInUrl the client exchanges the code
          // itself while it starts; initialize() returns that attempt's
          // error (a code already used, a stale code verifier…).
          const auth = supabase.auth as { initialize?: () => Promise<{ error: unknown }> };
          const init = typeof auth.initialize === 'function' ? await auth.initialize() : { error: null };
          if (init.error) {
            console.error('[AuthCallback] PKCE exchange error:', init.error);
            fail(init.error);
            return;
          }
          const { data: { session: existing } } = await supabase.auth.getSession();
          // No session yet: the client didn't try (no code verifier in this
          // browser), so try here; that error says which case it is.
          const { error: exchangeError } = existing
            ? { error: null }
            : await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            console.error('[AuthCallback] PKCE exchange error:', exchangeError);
            fail(exchangeError);
            return;
          }
          console.log('[AuthCallback] PKCE exchange successful');
        } else if (accessToken) {
          // Tokens in the URL fragment (legacy implicit flow) are rejected:
          // they cannot be tied to a sign-in this app started (login CSRF).
          fail({ code: 'flow_state_not_found' });
          return;
        } else {
          // No tokens found — auth listener might have already caught them,
          // or this is a stale callback
          console.log('[AuthCallback] No tokens in URL, checking existing session...');
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            console.warn('[AuthCallback] No session found');
            fail(null);
            return;
          }
        }

        if (cancelled) return;
        setStatus('redirecting');

        // Clean the URL — remove hash and query params
        cleanupAndRedirect(true);
      } catch (err) {
        console.error('[AuthCallback] Unexpected error:', err);
        fail(err);
      }
    };

    // `signedIn`: only a reset link that really signed in asks for a new
    // password; after an error the flag would force that screen on the next
    // normal sign-in.
    const cleanupAndRedirect = (signedIn: boolean) => {
      if (cancelled) return;
      const isRecovery = signedIn && new URLSearchParams(window.location.search).get(RECOVERY_FLAG) === '1';
      // Replace the URL to remove all OAuth params, preventing
      // isAuthCallback() from triggering again after redirect
      window.history.replaceState(
        null,
        document.title,
        window.location.pathname
      );
      // Redirect to app root, keeping only the password-recovery flag so the
      // app can ask for a new password.
      window.location.href = isRecovery
        ? `${window.location.origin}/?${RECOVERY_FLAG}=1`
        : window.location.origin;
    };

    handleCallback();

    return () => {
      cancelled = true;
    };
  }, []);

  if (problem) {
    return <CallbackProblemScreen problem={problem} recovery={isRecovery} />;
  }

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-4">
      <Loader2 className="w-8 h-8 animate-spin text-white" />
      <span className="text-white/60 text-sm font-medium">
        {status === 'processing' ? t('Completing sign in...') : t('Redirecting...')}
      </span>
    </div>
  );
}

/** The link didn't sign in: say why and offer the way forward (no auto-redirect). */
function CallbackProblemScreen({ problem, recovery }: { problem: AuthCallbackProblem; recovery: boolean }) {
  const { title, body } = callbackProblemText(problem, recovery);
  const go = (screen: AuthScreenTarget) => {
    // Replace: Back must not return to this dead link.
    window.location.replace(authScreenUrl(window.location.origin, screen));
  };
  return (
    <DuoAuthLayout>
      <AuthScreen
        bodyClassName="pt-10"
        footer={
          <>
            {recovery && <PillButton onClick={() => go('forgot-password')}>{t('Send a new link')}</PillButton>}
            <PillButton variant={recovery ? 'ghost' : 'primary'} size={recovery ? 'md' : 'lg'} onClick={() => go('sign-in')}>
              {t('Back to sign in')}
            </PillButton>
          </>
        }
      >
        <div role="alert" className="flex flex-col gap-4">
          <Kicker overline={recovery ? t('Account recovery') : t('Sign in')} title={title} />
          <p className="text-[16px] leading-[1.45] text-muted-foreground max-w-[340px]">{body}</p>
        </div>
      </AuthScreen>
    </DuoAuthLayout>
  );
}
