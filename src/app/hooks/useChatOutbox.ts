import { useEffect } from 'react';
import { flushChatOutbox, readChatOutbox } from '@/lib/chatOutbox';
import { onAppResume } from '@/lib/appResume';

/**
 * Chat messages written offline go out with the chat closed too: at start,
 * when the signal comes back and when the app comes to the front (main,
 * #291 r4). Mounted once for the signed-in person; flushChatOutbox also
 * checks the session before each send, so A's messages never go out as B.
 */
export function useChatOutboxFlush(userId?: string | null) {
  useEffect(() => {
    if (!userId) return;
    const go = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (readChatOutbox(userId).some((x) => x.refused === undefined)) void flushChatOutbox(userId);
    };
    go();
    window.addEventListener('online', go);
    const offResume = onAppResume(go);
    return () => {
      window.removeEventListener('online', go);
      offResume();
    };
  }, [userId]);
}
