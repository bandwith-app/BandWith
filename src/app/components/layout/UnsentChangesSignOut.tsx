import React, { useEffect, useRef, useState } from 'react';
import { BwSheet } from '@/app/components/bw/Screen';
import { FormError, PillButton } from '@/app/components/bw/Form';
import {
  LIVE_REFUSED_EVENT,
  queuedNotKeptOnSignOut,
  refusedChanges,
  readRefusedLiveOps,
  refusedListFull,
  refusedRehearsalNotes,
  waitingChanges,
  WAITING_EVENTS,
} from '@/lib/liveOutbox';
import { setSignOutGate, signOutCopy, QUEUED_KEPT, type SignOutChoice } from '@/lib/signOutGate';
import { sendWaitingNow } from '@/app/hooks/useLiveOutbox';
import { deleteChatOutboxEntry, readChatOutboxAll, readChatOutboxCount, type ChatOutboxEntry } from '@/lib/offline/storage';
import { isAppLockedNow } from '@/lib/appLock';
import { useT } from '@/lib/i18n';

/**
 * The ids of the chats the person is in now, or null when the list can't be
 * had (no signal, an error, no answer within 5 s).
 */
async function chatIdsNow(): Promise<Set<string> | null> {
  try {
    const { getChats } = await import('@/lib/services/chats');
    const res = await Promise.race([getChats(), new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
    return res?.data && !res.error ? new Set(res.data.map((c) => c.id)) : null;
  } catch {
    return null;
  }
}

/**
 * "You have 2 unsent changes · Send now / Sign out anyway": asked before any
 * sign-out while changes made on this phone haven't reached the band yet.
 * Only refused changes left: "they stay on this phone for your account ·
 * Sign out / Erase them and sign out". Closing the sheet (X, scrim, swipe)
 * keeps the person signed in. Mounted once, under AuthProvider.
 */
export const UnsentChangesSignOut: React.FC = () => {
  const t = useT();
  const [ask, setAsk] = useState<{ userId: string } | null>(null);
  const [count, setCount] = useState(0);
  // Chat messages waiting (#291): not sent from here, and kept on this phone
  // for the account at sign-out.
  const [messages, setMessages] = useState(0);
  // Asked from the lock screen: nothing is sent from there, unlock first.
  const [locked, setLocked] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = useRef<((c: SignOutChoice) => void) | null>(null);
  // Refused changes when the sheet opened: one more since then means the band
  // turned something down, and the person stays signed in to see it.
  const refusedAtAsk = useRef(0);
  const notesAtAsk = useRef(0);
  // Opened with nothing waiting, only refused changes: nothing to send or wait for.
  const [refusedOnly, setRefusedOnly] = useState(false);
  // Chat messages the server refused (#291 `refused`, maybe '') whose chat is
  // gone (`gone`), or all refused ones when the chat list can't be had: the
  // chat can't show them any more, so they're listed here with Delete. #291
  // drops them itself once the chat list loads without that chat.
  const [orphans, setOrphans] = useState<{ entry: ChatOutboxEntry; gone: boolean }[]>([]);

  useEffect(
    () =>
      setSignOutGate(
        (userId, chatMessages) =>
          new Promise<SignOutChoice>((resolve) => {
            answer.current?.('cancel');
            answer.current = resolve;
            setCount(waitingChanges(userId));
            setMessages(chatMessages);
            setLocked(isAppLockedNow());
            setRefusedOnly(waitingChanges(userId) + chatMessages === 0);
            refusedAtAsk.current = refusedChanges(userId);
            notesAtAsk.current = refusedRehearsalNotes(userId);
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
  // Rehearsal notes among them: not listed in Settings before #296, so no place.
  const refusedText = (n: number, notes: number) =>
    notes > 0
      ? n === 1
        ? t('1 change was refused. It stays on this phone for your account.')
        : t('{n} changes were refused. They stay on this phone for your account.', { n })
      : n === 1
        ? t('1 change was refused. You’ll find it in {place}.', { place })
        : t('{n} changes were refused. You’ll find them in {place}.', { n, place });
  const copy = ask ? signOutCopy(ask.userId) : null;
  const refusedNow = ask ? refusedChanges(ask.userId) : 0;
  const refusedLive = ask ? readRefusedLiveOps(ask.userId).length : 0;
  const notesNotSaved = ask ? refusedRehearsalNotes(ask.userId) : 0;

  useEffect(() => {
    setOrphans([]);
    if (!ask) return;
    let live = true;
    void (async () => {
      const refused = (await readChatOutboxAll(ask.userId)).filter((e) => e.refused !== undefined);
      if (!refused.length) return;
      const ids = await chatIdsNow();
      if (!live) return;
      setOrphans(ids ? refused.filter((e) => !ids.has(e.chatId)).map((entry) => ({ entry, gone: true })) : refused.map((entry) => ({ entry, gone: false })));
    })();
    return () => {
      live = false;
    };
  }, [ask]);

  const deleteMessage = async (clientId: string) => {
    if (!ask || locked || isAppLockedNow()) return;
    await deleteChatOutboxEntry(ask.userId, clientId);
    setOrphans((list) => list.filter((o) => o.entry.clientId !== clientId));
    const chat = await readChatOutboxCount(ask.userId);
    setMessages(chat);
    const left = waitingChanges(ask.userId);
    // Back to the sheet, never signed out unseen: "Sign out" is the person's tap.
    setCount(left);
    if (left + chat === 0) setRefusedOnly(true);
  };
  const refusedTextRef = useRef(refusedText);
  refusedTextRef.current = refusedText;
  const refusedOnlyRef = useRef(refusedOnly);
  refusedOnlyRef.current = refusedOnly;

  // Sent meanwhile (back online in the background): the count follows. All
  // sent: the sheet closes and the sign-out goes on; refused: it stays and
  // says where the refused change is kept.
  useEffect(() => {
    if (!ask) return;
    let live = true;
    const update = async () => {
      if (sendingRef.current) return;
      const chat = await readChatOutboxCount(ask.userId);
      if (!live || sendingRef.current) return;
      const left = waitingChanges(ask.userId);
      setCount(left);
      setMessages(chat);
      // Only refused ones when it opened: a change queued meanwhile (another
      // tab) shows, with "Send now"; nothing signs out on its own from here.
      if (refusedOnlyRef.current) {
        if (left > 0 || chat > 0) setRefusedOnly(false);
        return;
      }
      if (left > 0 || chat > 0) return;
      const refused = refusedChanges(ask.userId) - refusedAtAsk.current;
      const notes = refusedRehearsalNotes(ask.userId) - notesAtAsk.current;
      if (refused > 0) setError(refusedTextRef.current(refused, Math.max(0, notes)));
      else doneRef.current('signout');
    };
    const events = [...WAITING_EVENTS, LIVE_REFUSED_EVENT, 'storage'];
    const onEvent = () => void update();
    for (const e of events) window.addEventListener(e, onEvent);
    return () => {
      live = false;
      for (const e of events) window.removeEventListener(e, onEvent);
    };
  }, [ask]);

  const sendNow = async () => {
    if (!ask || sending || locked || isAppLockedNow()) return;
    setSending(true);
    setError(null);
    const { left, refused, refusedNotes, busy } = await sendWaitingNow(ask.userId).catch(() => ({
      left: waitingChanges(ask.userId),
      refused: 0,
      refusedNotes: 0,
      busy: false,
    }));
    setCount(left);
    setSending(false);
    // Turned down by the band: not signed out, so the person sees where they are kept.
    if (refused > 0) {
      refusedAtAsk.current = refusedChanges(ask.userId);
      notesAtAsk.current = refusedRehearsalNotes(ask.userId);
      setError(refusedText(refused, refusedNotes));
      return;
    }
    // Chat messages go from the chat itself, not from here.
    const chat = await readChatOutboxCount(ask.userId);
    setMessages(chat);
    if (left === 0 && chat > 0) {
      setError(t('Chat messages are sent when the chat opens or the app is back online.'));
      return;
    }
    if (left === 0) {
      done('signout');
      return;
    }
    setError(
      refusedListFull(ask.userId)
        ? t('The list of refused changes is full. Copy and remove some in {place}.', { place })
        : busy
          ? t('Another tab is sending your changes. Try again in a moment.')
          : t('No connection. Try again when you are online.'),
    );
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
                : refusedNow > 0
                  ? t('Some changes were refused')
                  : t('Nothing is waiting any more')
      }
      tone="light"
      // Above every screen, the "Update BandWith" one (z 1000) included: it signs out too.
      zIndex={1010}
      portal
      footer={
        refusedOnly ? (
          <div className="flex flex-col gap-2">
            <PillButton onClick={() => done('signout')}>{t('Sign out')}</PillButton>
            {/* Not from the lock screen: whoever holds the phone can't erase them. */}
            {!locked && refusedNow > 0 && (
              <PillButton
                variant="outline"
                onClick={() => {
                  // Erased by AuthContext once the session check passed.
                  done('erase');
                }}
              >
                {t('Erase them and sign out')}
              </PillButton>
            )}
          </div>
        ) : locked ? (
          <div className="flex flex-col gap-2">
            <PillButton onClick={() => done('cancel')}>{t('Unlock to send')}</PillButton>
            {/* The wipe would delete what waits: kept as refused instead (AuthContext).
                What can't be kept that way (a note deleted or ticked, a full list) waits for the unlock. */}
            <PillButton
              variant="outline"
              onClick={() => {
                if (copy?.queued === QUEUED_KEPT) return done('signout');
                if (ask && queuedNotKeptOnSignOut(ask.userId) > 0) {
                  setError(t('Some of these changes can’t be kept on this phone. Unlock to send them before you sign out.'));
                  return;
                }
                done('keep-queued');
              }}
            >
              {t('Sign out')}
            </PillButton>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <PillButton onClick={sendNow} loading={sending}>
              {t('Send now')}
            </PillButton>
            <PillButton variant="outline" onClick={() => done('signout')} disabled={sending}>
              {t('Sign out anyway')}
            </PillButton>
          </div>
        )
      }
    >
      {error && <FormError className="mb-3">{error}</FormError>}
      {/* Said as sign-out really does it (signOutCopy asks clearOfflineCache). */}
      {count > 0 && (
        <p className="bw-body-md text-muted-foreground">
          {copy?.queued === QUEUED_KEPT
            ? t('Notes, suggestions or a setlist order made on this phone haven’t reached the band yet. “Sign out anyway” keeps them on this phone, and they’re sent when you sign in again.')
            : locked
              ? t('Notes, suggestions or a setlist order made on this phone haven’t reached the band yet. “Sign out” keeps them on this phone for your account, with the refused changes.')
              : t('Notes, suggestions or a setlist order made on this phone haven’t reached the band yet. Send them before you sign out: “Sign out anyway” deletes them from this phone.')}
        </p>
      )}
      {messages > 0 && (
        <p className="bw-body-md text-muted-foreground mt-2">
          {copy?.chatKept
            ? t('Unsent chat messages stay on this phone for your account, also after “Sign out anyway”, and are sent when you sign in again.')
            : t('“Sign out anyway” also deletes the unsent chat messages from this phone.')}
        </p>
      )}
      {orphans.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {orphans.map(({ entry, gone }) => (
            <li key={entry.clientId} className="flex items-start gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0 flex-1">
                {/* Locked: whoever holds the phone sees no message text, only what it is. */}
                {!locked && <p className="bw-body-md line-clamp-2 break-words">{entry.body}</p>}
                <p className={locked ? 'bw-body-md' : 'bw-body-sm text-muted-foreground'}>
                  {gone ? t('Not sent: this chat is no longer available.') : t('Message not sent')}
                </p>
              </div>
              {!locked && (
                <PillButton
                  variant="outline"
                  size="sm"
                  aria-label={t('Delete message not sent: {text}', { text: entry.body })}
                  onClick={() => void deleteMessage(entry.clientId)}
                >
                  {t('Delete')}
                </PillButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {refusedNow > 0 && copy?.refusedKept && (
        <div className={refusedOnly ? '' : 'mt-2'}>
          {refusedLive > 0 && (
            <p className="bw-body-md text-muted-foreground">
              {refusedLive === 1
                ? t('1 change not sent stays on this phone for your account.')
                : t('{n} changes not sent stay on this phone for your account.', { n: refusedLive })}
            </p>
          )}
          {notesNotSaved > 0 && (
            <p className="bw-body-md text-muted-foreground">
              {notesNotSaved === 1
                ? t('1 note not saved stays on this phone for your account.')
                : t('{n} notes not saved stay on this phone for your account.', { n: notesNotSaved })}
            </p>
          )}
        </div>
      )}
    </BwSheet>
  );
};
