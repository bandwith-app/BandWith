-- ====================================================================
-- 122: ✓✓ (delivered) when the push reaches the recipient's phone
--
-- "Delivered" was set only by the recipient's app (bw_mark_chats_delivered,
-- bw_mark_chat_read). With the app in the background the phone suspends it,
-- so the sender kept a single ✓ until the other person opened BandWith, even
-- though the push had already arrived.
--
-- send-push now calls this after Apple or Google accepted a chat push for at
-- least one of a recipient's devices: those recipients count as delivered
-- for that chat, like the app does on receipt. Server time (now()), so it
-- always covers the message that triggered the push. Only rows with an
-- undelivered message change, so no extra realtime events.
--
-- Only the service role (send-push) can call it. Safe to run more than once.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.bw_mark_chat_delivered_by_push(p_chat_id uuid, p_user_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_chat_id IS NULL OR p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN RETURN 0; END IF;
  UPDATE chat_participants cp
     SET last_delivered_at = now()
   WHERE cp.chat_id = p_chat_id
     AND cp.user_id = ANY (p_user_ids)
     AND EXISTS (
       SELECT 1 FROM messages m
        WHERE m.chat_id = cp.chat_id
          AND m.sender_id <> cp.user_id
          AND m.created_at > coalesce(cp.last_delivered_at, '-infinity'::timestamptz)
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bw_mark_chat_delivered_by_push(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_mark_chat_delivered_by_push(uuid, uuid[]) TO service_role;
