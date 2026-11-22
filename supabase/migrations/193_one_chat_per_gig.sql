-- ============================================================================
-- 193 · One chat per gig and per band (audit 07 #6, release 383f15b)
-- ----------------------------------------------------------------------------
-- A band admin who is not on a gig's lineup may open its chat, but could not
-- see the chat a lineup member had already started: chats were readable only
-- by their creator and participants. The app's "does one exist?" lookup came
-- back empty and created a second chat, splitting the gig's conversation.
-- The same happened to a member who had never joined the band chat.
--
-- Now:
--   * bw_chat_joinable(type, band, event, user): may this person join this
--     band or gig chat? Band chat: active member of the band. Gig chat: may
--     take part in the gig (bw_is_event_participant: creator, band admin, on
--     the lineup and not declined) and is an active member of its band.
--   * chats_select_joinable: those people can see the chat row (not its
--     messages: the messages policies still need participation, 175/181).
--     This alone fixes older app builds: their lookup finds the chat and
--     they join it as before.
--   * bw_open_group_chat(type, band, event, name): the app's get-or-join, in
--     one transaction under a lock. It finds the chat (or creates it), adds
--     the caller and returns the row plus "created".
--   * Duplicates already there are merged into the oldest chat of the band
--     or gig (messages, participants, chat notifications move over; the
--     merged chats are archived in chat_merges_193, admin only), then a
--     unique index allows one band chat per band and one chat per gig.
--
-- Older app builds keep working: the lookup they run now finds the chat; a
-- duplicate insert (only in a race) is refused instead of splitting the gig.
-- Independent of 175/181 (uses only 073 helpers). Idempotent; one transaction.
-- ============================================================================

BEGIN;

-- ── Who may join a band or gig chat ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bw_chat_joinable(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_user_id IS NOT NULL AND CASE
    WHEN p_type = 'band' THEN
      p_band_id IS NOT NULL AND public.bw_is_band_member(p_band_id, p_user_id)
    WHEN p_type = 'event' THEN
      p_event_id IS NOT NULL
      AND public.bw_is_event_participant(p_event_id, p_user_id)
      AND (p_band_id IS NULL OR public.bw_is_band_member(p_band_id, p_user_id))
      AND coalesce((
        SELECT e.band_id IS NULL OR public.bw_is_band_member(e.band_id, p_user_id)
          FROM events e WHERE e.id = p_event_id
      ), false)
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_chat_joinable(text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_joinable(text, uuid, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS chats_select_joinable ON public.chats;
CREATE POLICY chats_select_joinable ON public.chats
  FOR SELECT TO authenticated
  USING (type::text IN ('band', 'event') AND public.bw_chat_joinable(type::text, band_id, event_id, auth.uid()));

-- ── Merge duplicates into the oldest chat ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_merges_193 (
  dup_chat_id uuid PRIMARY KEY,
  keeper_chat_id uuid NOT NULL,
  chat_row jsonb NOT NULL,
  participant_rows jsonb NOT NULL,
  message_ids uuid[] NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_merges_193 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_merges_193 FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r record;
  v_any boolean;
  v_msg_trg boolean;
  v_cp_trg boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM chats
     WHERE type IN ('band', 'event')
       AND (CASE WHEN type = 'event' THEN event_id ELSE band_id END) IS NOT NULL
     GROUP BY type, (CASE WHEN type = 'event' THEN event_id ELSE band_id END)
    HAVING count(*) > 1
  ) INTO v_any;
  IF NOT v_any THEN
    RETURN;
  END IF;

  -- Messages and participant rows never change chat (050); this merge is
  -- the one exception, inside this transaction.
  v_msg_trg := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.messages'::regclass
                         AND tgname = 'bw_messages_immutable_keys' AND NOT tgisinternal);
  v_cp_trg := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.chat_participants'::regclass
                        AND tgname = 'bw_chat_participants_immutable_keys' AND NOT tgisinternal);
  IF v_msg_trg THEN EXECUTE 'ALTER TABLE public.messages DISABLE TRIGGER bw_messages_immutable_keys'; END IF;
  IF v_cp_trg THEN EXECUTE 'ALTER TABLE public.chat_participants DISABLE TRIGGER bw_chat_participants_immutable_keys'; END IF;

  FOR r IN
    WITH keyed AS (
      SELECT c.id, c.type, c.created_at,
             CASE WHEN c.type = 'event' THEN c.event_id ELSE c.band_id END AS k
        FROM chats c
       WHERE c.type IN ('band', 'event')
    ), ranked AS (
      SELECT id, type, k,
             first_value(id) OVER (PARTITION BY type, k ORDER BY created_at, id) AS keeper
        FROM keyed
       WHERE k IS NOT NULL
    )
    SELECT id AS dup, keeper FROM ranked WHERE id <> keeper
  LOOP
    INSERT INTO chat_merges_193 (dup_chat_id, keeper_chat_id, chat_row, participant_rows, message_ids)
    SELECT r.dup, r.keeper, to_jsonb(c),
           coalesce((SELECT jsonb_agg(to_jsonb(cp)) FROM chat_participants cp WHERE cp.chat_id = r.dup), '[]'::jsonb),
           coalesce((SELECT array_agg(m.id) FROM messages m WHERE m.chat_id = r.dup), '{}'::uuid[])
      FROM chats c WHERE c.id = r.dup
    ON CONFLICT (dup_chat_id) DO NOTHING;

    UPDATE messages SET chat_id = r.keeper WHERE chat_id = r.dup;

    -- People in both: one row, and nothing they deleted comes back.
    UPDATE chat_participants k
       SET cleared_at = GREATEST(k.cleared_at, d.cleared_at),
           last_read_at = GREATEST(k.last_read_at, d.last_read_at),
           last_delivered_at = GREATEST(k.last_delivered_at, d.last_delivered_at)
      FROM chat_participants d
     WHERE k.chat_id = r.keeper AND d.chat_id = r.dup AND d.user_id = k.user_id;
    UPDATE chat_participants d
       SET chat_id = r.keeper
     WHERE d.chat_id = r.dup
       AND NOT EXISTS (SELECT 1 FROM chat_participants k WHERE k.chat_id = r.keeper AND k.user_id = d.user_id);

    UPDATE notifications n
       SET data = n.data || jsonb_build_object('chat_id', r.keeper::text)
                 || CASE WHEN n.data ? 'chatId' THEN jsonb_build_object('chatId', r.keeper::text) ELSE '{}'::jsonb END,
           action_url = '/chat/' || r.keeper::text
     WHERE n.type IN ('chat_message', 'chat_mention')
       AND coalesce(n.data ->> 'chat_id', n.data ->> 'chatId') = r.dup::text;

    UPDATE chats k SET updated_at = GREATEST(k.updated_at, d.updated_at)
      FROM chats d WHERE k.id = r.keeper AND d.id = r.dup;

    DELETE FROM chats WHERE id = r.dup;
  END LOOP;

  IF v_msg_trg THEN EXECUTE 'ALTER TABLE public.messages ENABLE TRIGGER bw_messages_immutable_keys'; END IF;
  IF v_cp_trg THEN EXECUTE 'ALTER TABLE public.chat_participants ENABLE TRIGGER bw_chat_participants_immutable_keys'; END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS chats_one_per_event
  ON public.chats (event_id) WHERE type = 'event' AND event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chats_one_per_band
  ON public.chats (band_id) WHERE type = 'band' AND band_id IS NOT NULL;

-- ── Get or join, atomically ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bw_open_group_chat(p_type text, p_band_id uuid DEFAULT NULL, p_event_id uuid DEFAULT NULL, p_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_band uuid;
  v_chat chats%ROWTYPE;
  v_created boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_type = 'event' THEN
    IF p_event_id IS NULL THEN
      RAISE EXCEPTION 'event_id is required' USING ERRCODE = '22023';
    END IF;
    SELECT e.band_id INTO v_band FROM events e WHERE e.id = p_event_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0002';
    END IF;
  ELSIF p_type = 'band' THEN
    IF p_band_id IS NULL THEN
      RAISE EXCEPTION 'band_id is required' USING ERRCODE = '22023';
    END IF;
    v_band := p_band_id;
  ELSE
    RAISE EXCEPTION 'Only band and event chats' USING ERRCODE = '22023';
  END IF;

  IF NOT public.bw_chat_joinable(p_type, v_band, p_event_id, v_uid) THEN
    RAISE EXCEPTION 'Not allowed to open this chat' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('bw_group_chat:' || p_type || ':' || coalesce(p_event_id, v_band)::text, 0));

  SELECT * INTO v_chat FROM chats c
   WHERE c.type::text = p_type
     AND ((p_type = 'event' AND c.event_id = p_event_id) OR (p_type = 'band' AND c.band_id = v_band))
   ORDER BY c.created_at, c.id
   LIMIT 1;

  IF NOT FOUND THEN
    BEGIN
      -- Literal types: chats.type may be text or the chat_type enum.
      IF p_type = 'event' THEN
        INSERT INTO chats (type, name, band_id, event_id, created_by)
        VALUES ('event', nullif(trim(coalesce(p_name, '')), ''), v_band, p_event_id, v_uid)
        RETURNING * INTO v_chat;
      ELSE
        INSERT INTO chats (type, name, band_id, event_id, created_by)
        VALUES ('band', nullif(trim(coalesce(p_name, '')), ''), v_band, NULL, v_uid)
        RETURNING * INTO v_chat;
      END IF;
      v_created := true;
    EXCEPTION WHEN unique_violation THEN
      -- An older app build inserted it a moment ago.
      SELECT * INTO v_chat FROM chats c
       WHERE c.type::text = p_type
         AND ((p_type = 'event' AND c.event_id = p_event_id) OR (p_type = 'band' AND c.band_id = v_band))
       ORDER BY c.created_at, c.id
       LIMIT 1;
    END;
  END IF;

  -- Join, keeping cleared_at: deleted history stays deleted.
  INSERT INTO chat_participants (chat_id, user_id)
  VALUES (v_chat.id, v_uid)
  ON CONFLICT (chat_id, user_id) DO NOTHING;

  RETURN to_jsonb(v_chat) || jsonb_build_object('created', v_created);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_open_group_chat(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_open_group_chat(text, uuid, uuid, text) TO authenticated;

COMMIT;
