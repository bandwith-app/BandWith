import React, { useEffect, useRef, useState } from 'react';
import { BwSheet } from '@/app/components/bw/Screen';
import { FormError, PillButton } from '@/app/components/bw/Form';
import { waitingChanges, WAITING_EVENTS } from '@/lib/liveOutbox';
import { setSignOutGate, type SignOutChoice } from '@/lib/signOutGate';
import { sendWaitingNow } from '@/app/hooks/useLiveOutbox';
import { useT } from '@/lib/i18n';

/**
 * "You have 2 unsent changes · Send now / Sign out anyway": asked before any
 * sign-out while changes made on this phone haven't reached the band yet.
 * Closing the sheet (X, scrim, swipe) keeps the person signed in. Mounted
 * once, under AuthProvider.
 */
export const UnsentChangesSignOut: React.FC = () => {
  const t = useT();
  const [ask, setAsk] = useState<{ userId: string } | null>(null);
  const [count, setCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = useRef<((c: SignOutChoice) => void) | null>(null);

  useEffect(
    () =>
      setSignOutGate(
        (userId) =>
          new Promise<SignOutChoice>((resolve) => {
            answer.current?.('cancel');
            answer.current = resolve;
            setCount(waitingChanges(userId));
            setError(null);
            setAsk({ userId });
          }),
      ),
    [],
  );

  // Sent meanwhile (back online in the background): the count follows.
  useEffect(() => {
    if (!ask) return;
    const update = () => setCount(waitingChanges(ask.userId));
    for (const e of WAITING_EVENTS) window.addEventListener(e, update);
    return () => {
      for (const e of WAITING_EVENTS) window.removeEventListener(e, update);
    };
  }, [ask]);

  const done = (c: SignOutChoice) => {
    answer.current?.(c);
    answer.current = null;
    setAsk(null);
    setSending(false);
  };

  const sendNow = async () => {
    if (!ask || sending) return;
    setSending(true);
    setError(null);
    const left = await sendWaitingNow(ask.userId).catch(() => waitingChanges(ask.userId));
    if (left === 0) {
      done('signout');
      return;
    }
    setCount(left);
    setSending(false);
    setError(t('No connection. Try again when you are online.'));
  };

  return (
    <BwSheet
      open={!!ask}
      onClose={() => {
        if (!sending) done('cancel');
      }}
      title={count === 1 ? t('You have 1 unsent change') : t('You have {n} unsent changes', { n: count })}
      tone="light"
      zIndex={180}
      portal
      footer={
        <div className="flex flex-col gap-2">
          <PillButton onClick={sendNow} loading={sending}>
            {t('Send now')}
          </PillButton>
          <PillButton variant="outline" onClick={() => done('signout')} disabled={sending}>
            {t('Sign out anyway')}
          </PillButton>
        </div>
      }
    >
      {error && <FormError className="mb-3">{error}</FormError>}
      <p className="bw-body-md text-muted-foreground">
        {t('Notes, suggestions or a setlist order made on this phone haven’t reached the band yet. Send them before you sign out.')}
      </p>
    </BwSheet>
  );
};
