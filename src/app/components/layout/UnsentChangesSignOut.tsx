import React, { useEffect, useRef, useState } from 'react';
import { BwSheet } from '@/app/components/bw/Screen';
import { FormError, PillButton } from '@/app/components/bw/Form';
import { LIVE_REFUSED_EVENT, refusedChanges, refusedListFull, waitingChanges, WAITING_EVENTS } from '@/lib/liveOutbox';
import { setSignOutGate, type SignOutChoice } from '@/lib/signOutGate';
import { sendWaitingNow } from '@/app/hooks/useLiveOutbox';
import { readChatOutboxCount } from '@/lib/offline/storage';
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
  // Chat messages waiting (#291): not sent from here, and kept on this phone
  // for the account at sign-out.
  const [messages, setMessages] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = useRef<((c: SignOutChoice) => void) | null>(null);
  // Refused changes when the sheet opened: one more since then means the band
  // turned something down, and the person stays signed in to see it.
  const refusedAtAsk = useRef(0);

  useEffect(
    () =>
      setSignOutGate(
        (userId) =>
          new Promise<SignOutChoice>((resolve) => {
            answer.current?.('cancel');
            answer.current = resolve;
            setCount(waitingChanges(userId));
            setMessages(readChatOutboxCount(userId));
            refusedAtAsk.current = refusedChanges(userId);
            setError(null);
            setAsk({ userId });
          }),
      ),
    [],
  );

  const done = (c: SignOutChoice) => {
    answer.current?.(c);
    answer.current = null;
    setAsk(null);
    setSending(false);
  };
  const doneRef = useRef(done);
  doneRef.current = done;
  const sendingRef = useRef(false);
  sendingRef.current = sending;

  const place = `${t('Settings & account')} › ${t('Offline & live')}`;
  const refusedText = (n: number) =>
    n === 1
      ? t('1 change was refused. You’ll find it in {place}.', { place })
      : t('{n} changes were refused. You’ll find them in {place}.', { n, place });
  const refusedTextRef = useRef(refusedText);
  refusedTextRef.current = refusedText;

  // Sent meanwhile (back online in the background): the count follows. All
  // sent: the sheet closes and the sign-out goes on; refused: it stays and
  // says where the refused change is kept.
  useEffect(() => {
    if (!ask) return;
    const update = () => {
      if (sendingRef.current) return;
      const left = waitingChanges(ask.userId);
      const chat = readChatOutboxCount(ask.userId);
      setCount(left);
      setMessages(chat);
      if (left > 0 || chat > 0) return;
      const refused = refusedChanges(ask.userId) - refusedAtAsk.current;
      if (refused > 0) setError(refusedTextRef.current(refused));
      else doneRef.current('signout');
    };
    const events = [...WAITING_EVENTS, LIVE_REFUSED_EVENT, 'storage'];
    for (const e of events) window.addEventListener(e, update);
    return () => {
      for (const e of events) window.removeEventListener(e, update);
    };
  }, [ask]);

  const sendNow = async () => {
    if (!ask || sending) return;
    setSending(true);
    setError(null);
    const { left, refused } = await sendWaitingNow(ask.userId).catch(() => ({ left: waitingChanges(ask.userId), refused: 0 }));
    setCount(left);
    setSending(false);
    // Turned down by the band: not signed out, so the person sees where they are kept.
    if (refused > 0) {
      refusedAtAsk.current = refusedChanges(ask.userId);
      setError(refusedText(refused));
      return;
    }
    // Chat messages go from the chat itself, not from here.
    const chat = readChatOutboxCount(ask.userId);
    setMessages(chat);
    if (left === 0 && chat > 0) {
      setError(t('Chat messages are sent when the chat opens or the app is back online.'));
      return;
    }
    if (left === 0) {
      done('signout');
      return;
    }
    setError(refusedListFull(ask.userId) ? t('The list of refused changes is full. Copy and remove some in {place}.', { place }) : t('No connection. Try again when you are online.'));
  };

  return (
    <BwSheet
      open={!!ask}
      onClose={() => {
        if (!sending) done('cancel');
      }}
      title={
        count === 1
          ? t('You have 1 unsent change')
          : count > 1
            ? t('You have {n} unsent changes', { n: count })
            : messages === 1
              ? t('You have 1 unsent message')
              : messages > 1
                ? t('You have {n} unsent messages', { n: messages })
                : t('Some changes were refused')
      }
      tone="light"
      // Above every screen, the "Update BandWith" one (z 1000) included: it signs out too.
      zIndex={1010}
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
      {count > 0 && (
        <p className="bw-body-md text-muted-foreground">
          {t('Notes, suggestions or a setlist order made on this phone haven’t reached the band yet. Send them before you sign out: “Sign out anyway” deletes them from this phone.')}
        </p>
      )}
      {messages > 0 && (
        <p className={count > 0 ? 'bw-body-md text-muted-foreground mt-2' : 'bw-body-md text-muted-foreground'}>
          {t('Unsent chat messages stay on this phone for your account, also after “Sign out anyway”, and are sent when you sign in again.')}
        </p>
      )}
    </BwSheet>
  );
};
