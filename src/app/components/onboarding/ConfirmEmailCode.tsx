import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight } from '@/app/components/icons';
import { supabase, getAuthCallbackUrl } from '@/lib/supabase';
import { authErrorMessage } from '@/lib/authErrors';
import { callbackProblemText } from '@/lib/authCallback';
import {
  SIGNUP_CODE_LENGTH,
  SIGNUP_CODE_OTP_TYPE,
  SIGNUP_CODE_RESEND_COOLDOWN_MS,
  codeDigits,
  signupCodeErrorKind,
  signupCodeErrorMessage,
} from '@/lib/signupCode';
import { FormError, Kicker, PillButton, PillField } from '@/app/components/bw/Form';
import { WizardTop } from './OnboardingChrome';
import { useT } from '@/lib/i18n';
import { useSystemBack } from '@/lib/backStack';
import { isKeyboardOpen } from '@/lib/keyboardInsets';

interface ConfirmEmailCodeProps {
  /** The address the code was sent to. */
  email: string;
  step: number;
  total: number;
  /** Back to the Create account form. */
  onBack: () => void;
  /** The code was right: the person is signed in. */
  onVerified: () => void;
  /** Confirmed through the link in the email instead: the sign-in screen. */
  onSignIn?: () => void;
  /**
   * The phone app came back from the email's link with an error (the link had
   * expired, was already used…): said here, where a new code can be sent.
   */
  linkError?: string | null;
  /** The link error is on screen: the parent can drop its copy. */
  onLinkErrorShown?: () => void;
}

/**
 * "Check your email": the confirmation email carries a code (and, below it,
 * the link older app versions use). Typing the code here confirms the address
 * and signs the person in, so the phone app never hands over to the browser.
 *
 * Laid out like the Create account form (`.bw-fold-form`): on the Duo in
 * Laptop pose the title holds the Display and the code and buttons lie on the
 * Deck, nothing across the fold.
 */
export const ConfirmEmailCode: React.FC<ConfirmEmailCodeProps> = ({
  email,
  step,
  total,
  onBack,
  onVerified,
  onSignIn,
  linkError,
  onLinkErrorShown,
}) => {
  const t = useT();
  const hintId = useId();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const verifyingRef = useRef(false);
  /** The code itself was refused (wrong, expired): shown on the field. */
  const [codeError, setCodeError] = useState<string | null>(null);
  /** Anything else (no connection, too many attempts, a resend that failed). */
  const [error, setError] = useState<string | null>(null);
  /** When the last code went out: the sign-up itself, then each "Send a new code". */
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent'>('idle');
  // Checking a code and sending a new one never overlap: a new code makes the
  // one being checked worthless, and would empty the field under its answer.
  const resendingRef = useRef(false);

  // Android's system Back (and Escape) does what the Back button here does:
  // the Create account form, its fields kept. Without it the onboarding's own
  // back handling only knew "step 1" and left for the Welcome screen.
  useSystemBack(true, () => {
    onBack();
  });

  // Keyboard up: Verify is pinned above it (see the bar below), so a refusal
  // shown under the field could end behind that bar. It is brought above it.
  const formRef = useRef<HTMLFormElement>(null);
  const verifyBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!codeError || !isKeyboardOpen()) return;
    const frame = requestAnimationFrame(() => {
      const message = formRef.current?.querySelector<HTMLElement>('[role="alert"]');
      const bar = verifyBarRef.current;
      if (!message || !bar || getComputedStyle(bar).position !== 'sticky') return;
      // From where the bar really is: keyboardInsets may have padded the
      // scroller under the field, and a pinned bar rests above that padding.
      message.style.scrollMarginBottom = `${Math.max(0, window.innerHeight - bar.getBoundingClientRect().top) + 8}px`;
      message.scrollIntoView?.({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [codeError]);

  // A dead link from the email (any callback problem that isn't its own
  // sentence): on this screen the way out is a new code.
  useEffect(() => {
    if (!linkError) return;
    setCodeError(null);
    setError(
      linkError === callbackProblemText('link_expired', false).body
        ? t('This link has expired or was already used. Ask for a new one.')
        : linkError,
    );
    onLinkErrorShown?.();
    // Only when a new error arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkError]);

  // "New code sent" rests for a minute (Supabase sends one a minute), then offers another.
  useEffect(() => {
    if (resend !== 'sent') return;
    const timer = setTimeout(() => setResend('idle'), SIGNUP_CODE_RESEND_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [resend]);

  const refuse = (err: unknown) => {
    verifyingRef.current = false;
    setVerifying(false);
    if (signupCodeErrorKind(err, sentAt) === 'other') setError(authErrorMessage(err));
    else setCodeError(signupCodeErrorMessage(err, sentAt));
  };

  const verify = async (token: string) => {
    if (verifyingRef.current || resendingRef.current || token.length !== SIGNUP_CODE_LENGTH) return;
    verifyingRef.current = true;
    setVerifying(true);
    setError(null);
    setCodeError(null);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: SIGNUP_CODE_OTP_TYPE });
      if (!mountedRef.current) return;
      if (verifyError || !data?.session) {
        refuse(verifyError);
        return;
      }
      // Signed in: the spinner stays until the onboarding takes over.
      onVerified();
    } catch (err) {
      if (mountedRef.current) refuse(err);
    }
  };

  /** What is in the field now; the last digit verifies on its own. */
  const accept = (next: string) => {
    setCode(next);
    setCodeError(null);
    setError(null);
    if (next.length === SIGNUP_CODE_LENGTH && next !== code) void verify(next);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    // A whole code replaces what was typed, wherever the cursor is. Anything
    // shorter goes in as typed text (and is cleaned by onChange).
    const pasted = codeDigits(e.clipboardData.getData('text'));
    if (pasted.length !== SIGNUP_CODE_LENGTH) return;
    e.preventDefault();
    setCode(pasted);
    setCodeError(null);
    setError(null);
    void verify(pasted);
  };

  const handleResend = async () => {
    if (resend !== 'idle' || verifyingRef.current || resendingRef.current) return;
    resendingRef.current = true;
    setResend('sending');
    setError(null);
    let resendError: unknown = null;
    try {
      ({ error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: getAuthCallbackUrl() },
      }));
    } catch (err) {
      resendError = err;
    }
    resendingRef.current = false;
    if (!mountedRef.current) return;
    if (resendError) {
      setError(authErrorMessage(resendError));
      setResend('idle');
      return;
    }
    // The code sent before no longer works.
    setCode('');
    setCodeError(null);
    setSentAt(Date.now());
    setResend('sent');
  };

  const [sentBefore, sentAfter = ''] = t(
    'We sent a {digits}-digit code to {email}. Enter it here to confirm your address and finish creating your account.',
    { digits: SIGNUP_CODE_LENGTH, email: '\u0000' },
  ).split('\u0000');

  return (
    // `bw-code-*`: the narrower measure and quiet links of a computer window (onboarding-desktop.css).
    <div className="bw-auth-screen bw-code-screen bw-fold-form min-h-[100dvh] bg-background text-foreground flex flex-col">
      <div className="shrink-0" style={{ paddingTop: 'var(--safe-top)' }}>
        <div className="h-14 shrink-0 flex items-center px-4 bw-status-clear">
          <WizardTop onBack={onBack} step={step} total={total} />
        </div>
        {/* Closed iPhone Duo, upright: the clock / camera block reaches down
            beside the title and the first lines, wider than the top bar's
            clearance covers, so they stop before it like the top bar does. */}
        <div className="flex flex-col px-4 pt-2 gap-5 [[data-bw-posture=closed][data-bw-status-edge=right]_&]:pe-[max(1rem,var(--bw-status-clear-x))]">
          <Kicker overline={t('Account')} title={t('Check your email')} />
          <p role="status" className="bw-auth-lede text-[16px] leading-[1.45] tracking-[-0.003em] text-muted-foreground -mt-1 break-words">
            {sentBefore}
            <span className="text-foreground font-medium">{email}</span>
            {sentAfter}
          </p>
        </div>
      </div>
      <form
        id="confirm-email-code-form"
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void verify(code);
        }}
        className="bw-code-form flex-1 flex flex-col px-4 pt-5 pb-6 gap-5"
      >
        {error && <FormError>{error}</FormError>}
        <div className="flex flex-col gap-2">
        <PillField
          label={t('Confirmation code')}
          type="text"
          name="one-time-code"
          value={code}
          onChange={(e) => accept(codeDigits(e.target.value))}
          onPaste={handlePaste}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder={'0'.repeat(SIGNUP_CODE_LENGTH)}
          readOnly={verifying || resend === 'sending'}
          // A refusal is about the digits in the field: never on an empty one.
          error={code ? codeError : null}
          // The last digit sends the code and the screen changes: said before it happens.
          aria-describedby={hintId}
          className="bw-code-field"
          inputClassName="text-center text-[24px] tracking-[0.3em] tabular-nums placeholder:tracking-[0.3em]"
          autoFocus
        />
        <p id={hintId} className="text-[14px] leading-[1.4] text-muted-foreground">
          {t('The code is checked as soon as you enter the last digit.')} {t('No email? Check your spam folder.')}
        </p>
        </div>
      </form>
      {/* Keyboard up (keyboardInsets.ts marks <html>): Verify stays pinned just
          above it, where keyboardInsets already keeps the field clear of a
          pinned footer; the secondary buttons are reached by scrolling. Not in
          the Duo's Laptop pose, where the field itself rests on that strip. */}
      <div
        ref={verifyBarRef}
        className="bw-code-verify shrink-0 px-4 pt-3 pb-3 bg-background [html[data-keyboard=open]:not([data-bw-posture=tabletop])_&]:sticky [html[data-keyboard=open]:not([data-bw-posture=tabletop])_&]:bottom-0 [html[data-keyboard=open]:not([data-bw-posture=tabletop])_&]:z-10 [html[data-keyboard=open]:not([data-bw-posture=tabletop])_&]:py-2"
      >
        <PillButton
          type="submit"
          form="confirm-email-code-form"
          loading={verifying}
          disabled={code.length !== SIGNUP_CODE_LENGTH || resend === 'sending'}
          trailingIcon={<ArrowUpRight className="w-5 h-5" />}
        >
          {t('Verify')}
        </PillButton>
      </div>
      <div className="bw-code-actions shrink-0 px-4 flex flex-col gap-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
        <PillButton variant="ghost" size="md" onClick={handleResend} loading={resend === 'sending'} disabled={resend === 'sent' || verifying}>
          {resend === 'sent' ? t('New code sent') : t('Send a new code')}
        </PillButton>
        {onSignIn && (
          <PillButton variant="ghost" size="md" onClick={onSignIn}>
            {t('I’ve confirmed it: sign in')}
          </PillButton>
        )}
      </div>
      {/* Keyboard up and the page scrolled: the top bar leaves behind the
          status bar's own strip instead of sliding under the clock. */}
      <div
        aria-hidden="true"
        className="hidden [html[data-keyboard=open]_&]:block fixed top-0 inset-x-0 z-10 bg-background"
        style={{ height: 'var(--safe-top-inset, 0px)' }}
      />
    </div>
  );
};

export default ConfirmEmailCode;
