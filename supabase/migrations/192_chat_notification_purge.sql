-- ============================================================================
-- 192 · Deleted messages take their notification previews with them
--       (audit 07 #4, release 383f15b)
-- ----------------------------------------------------------------------------
-- "Delete chat" (bw_delete_chat_history, 067/175) removed the messages, but
-- every recipient's chat notification kept a copy of the text: the whole
-- message in body and data.content when it was short, its first 120
-- characters otherwise. The deleted DM stayed on the server.
--
-- Now:
--   * whenever messages are deleted (Delete chat, a deleted chat, any other
--     path), the chat_message / chat_mention notifications that announced
--     them are deleted in the same statement (trigger on messages, security
--     definer: the sender cannot otherwise touch the recipient's rows);
--   * the link is data.message_id, which send-push writes from #284 on (it
--     also fills it for older app builds, by matching their preview). Rows
--     written before that have no message_id: they are matched on chat,
--     preview text and time (written within an hour after the message);
--   * notification previews of messages already deleted today are removed.
--
-- Older app builds: nothing they call changes. Idempotent; one transaction.
-- Independent of 175/181 (uses no function they redefine).
-- ============================================================================

BEGIN;

-- Lookups by message and by chat for chat notifications only.
CREATE INDEX IF NOT EXISTS idx_notifications_chat_message_id
  ON public.notifications ((data ->> 'message_id'))
  WHERE type IN ('chat_message', 'chat_mention');
CREATE INDEX IF NOT EXISTS idx_notifications_chat_chat_id
  ON public.notifications ((coalesce(data ->> 'chat_id', data ->> 'chatId')), created_at)
  WHERE type IN ('chat_message', 'chat_mention');

-- The preview the app and send-push store for a message (chat-push.ts chatPreview).
CREATE OR REPLACE FUNCTION public.bw_chat_preview(p_content text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(nullif(left(coalesce(p_content, ''), 120), ''), 'New message');
$$;
REVOKE ALL ON FUNCTION public.bw_chat_preview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_preview(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bw_trg_messages_purge_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Notifications that name the message.
  DELETE FROM notifications n
   USING gone g
   WHERE n.type IN ('chat_message', 'chat_mention')
     AND n.data ->> 'message_id' = g.id::text;

  -- Older rows without message_id: same chat, same preview, written after it.
  DELETE FROM notifications n
   USING gone g
   WHERE n.type IN ('chat_message', 'chat_mention')
     AND n.data ->> 'message_id' IS NULL
     AND coalesce(n.data ->> 'chat_id', n.data ->> 'chatId') = g.chat_id::text
     AND n.created_at >= g.created_at - interval '1 minute'
     AND n.created_at < g.created_at + interval '1 hour'
     AND (n.body = public.bw_chat_preview(g.content)
          OR n.data ->> 'content' = left(coalesce(g.content, ''), 120));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_messages_purge_notifications() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_messages_purge_notifications ON public.messages;
CREATE TRIGGER bw_messages_purge_notifications
  AFTER DELETE ON public.messages
  REFERENCING OLD TABLE AS gone
  FOR EACH STATEMENT EXECUTE FUNCTION public.bw_trg_messages_purge_notifications();

-- Previews of messages deleted before this migration.
DELETE FROM public.notifications n
 WHERE n.type IN ('chat_message', 'chat_mention')
   AND n.data ->> 'message_id' IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.id::text = n.data ->> 'message_id');

DELETE FROM public.notifications n
 WHERE n.type IN ('chat_message', 'chat_mention')
   AND n.data ->> 'message_id' IS NULL
   AND coalesce(n.data ->> 'chat_id', n.data ->> 'chatId') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.messages m
      WHERE m.chat_id::text = coalesce(n.data ->> 'chat_id', n.data ->> 'chatId')
        AND m.created_at <= n.created_at + interval '1 minute'
        AND m.created_at > n.created_at - interval '1 hour'
        AND (n.body = public.bw_chat_preview(m.content)
             OR n.data ->> 'content' = left(coalesce(m.content, ''), 120))
   );

COMMIT;
