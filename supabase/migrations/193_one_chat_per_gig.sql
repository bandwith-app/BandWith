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
--
-- Round 2 (Codex + Claude review #291):
--   * the merge moves a duplicate's participant into the keeper only if
--     they may still join it (bw_chat_joinable): a former member left in a
--     duplicate no longer gains the keeper's history;
--   * someone in both keeps the keeper's cleared_at: clearing the duplicate
--     hid the messages they kept in the keeper. (Messages of the duplicate
--     they had cleared are visible again for them: one cut-off time can't
--     hide only those. Their own messages were deleted by Delete chat.)
--     The keeper's participant rows are archived too, so a merge can be
--     undone exactly;
--   * joining a gig chat needs an active band membership (the gig's band):
--     an ex-member still on a lineup is refused. Their older build finds no
--     chat and inserts one: instead of a raw unique-index error they get a
--     clear message in their language ("This gig already has a chat...");
--   * an older build that still holds a merged chat (cached list, push tap,
--     outbox) can't read it any more (it shows empty until refreshed), but
--     a message it sends there is moved to the keeper (trigger on messages;
--     the keeper's participation rules still apply).
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
  keeper_participant_rows jsonb,
  merged_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_merges_193 ADD COLUMN IF NOT EXISTS keeper_participant_rows jsonb;
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
    INSERT INTO chat_merges_193 (dup_chat_id, keeper_chat_id, chat_row, participant_rows, message_ids, keeper_participant_rows)
    SELECT r.dup, r.keeper, to_jsonb(c),
           coalesce((SELECT jsonb_agg(to_jsonb(cp)) FROM chat_participants cp WHERE cp.chat_id = r.dup), '[]'::jsonb),
           coalesce((SELECT array_agg(m.id) FROM messages m WHERE m.chat_id = r.dup), '{}'::uuid[]),
           coalesce((SELECT jsonb_agg(to_jsonb(cp)) FROM chat_participants cp WHERE cp.chat_id = r.keeper), '[]'::jsonb)
      FROM chats c WHERE c.id = r.dup
    ON CONFLICT (dup_chat_id) DO NOTHING;

    UPDATE messages SET chat_id = r.keeper WHERE chat_id = r.dup;

    -- People in both: one row with the keeper's cleared_at (clearing the
    -- duplicate must not hide what they kept in the keeper), read and
    -- delivered marks as far as either got.
    UPDATE chat_participants k
       SET last_read_at = GREATEST(k.last_read_at, d.last_read_at),
           last_delivered_at = GREATEST(k.last_delivered_at, d.last_delivered_at)
      FROM chat_participants d
     WHERE k.chat_id = r.keeper AND d.chat_id = r.dup AND d.user_id = k.user_id;
    -- Only in the duplicate: moved over if they may still join the keeper
    -- (a former member's row stays behind, archived above, and goes with
    -- the duplicate).
    UPDATE chat_participants d
       SET chat_id = r.keeper
      FROM chats kc
     WHERE d.chat_id = r.dup
       AND kc.id = r.keeper
       AND public.bw_chat_joinable(kc.type::text, kc.band_id, kc.event_id, d.user_id)
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

-- ── Older builds: a clear refusal, and the outbox of a merged chat ─────────
-- An older build of someone who may not join finds no chat and inserts one:
-- the unique index refused it with a raw error. Same refusal (23505, so
-- bw_open_group_chat's retry still works), in words, in their language.
CREATE OR REPLACE FUNCTION public.bw_trg_chats_one_group_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lang text;
  v_msg text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM chats c
     WHERE c.type::text = NEW.type::text
       AND ((NEW.type::text = 'event' AND c.event_id = NEW.event_id)
         OR (NEW.type::text = 'band' AND c.band_id = NEW.band_id))
  ) THEN
    RETURN NEW;
  END IF;
  SELECT lower(left(coalesce(to_jsonb(p) ->> 'preferred_language', 'en'), 2)) INTO v_lang
    FROM profiles p WHERE p.id = auth.uid();
  v_msg := CASE WHEN NEW.type::text = 'event' THEN
    CASE coalesce(v_lang, 'en')
      WHEN 'it' THEN 'Questo concerto ha già una chat. Possono entrarci solo i membri attivi della band in formazione.'
      WHEN 'es' THEN 'Este concierto ya tiene un chat. Solo pueden unirse los miembros activos de la banda en la formación.'
      WHEN 'fr' THEN 'Ce concert a déjà une discussion. Seuls les membres actifs du groupe dans la formation peuvent la rejoindre.'
      WHEN 'de' THEN 'Dieser Gig hat schon einen Chat. Nur aktive Bandmitglieder in der Besetzung können beitreten.'
      WHEN 'pt' THEN 'Este show já tem um chat. Só membros ativos da banda na formação podem entrar.'
      ELSE 'This gig already has a chat. Only active band members on the lineup can join it.'
    END
  ELSE
    CASE coalesce(v_lang, 'en')
      WHEN 'it' THEN 'Questa band ha già una chat. Possono entrarci solo i membri attivi.'
      WHEN 'es' THEN 'Esta banda ya tiene un chat. Solo pueden unirse los miembros activos.'
      WHEN 'fr' THEN 'Ce groupe a déjà une discussion. Seuls les membres actifs peuvent la rejoindre.'
      WHEN 'de' THEN 'Diese Band hat schon einen Chat. Nur aktive Mitglieder können beitreten.'
      WHEN 'pt' THEN 'Esta banda já tem um chat. Só membros ativos podem entrar.'
      ELSE 'This band already has a chat. Only active members can join it.'
    END
  END;
  RAISE EXCEPTION '%', v_msg USING ERRCODE = '23505';
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_chats_one_group_chat() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_chats_one_group_chat ON public.chats;
CREATE TRIGGER bw_chats_one_group_chat
  BEFORE INSERT ON public.chats
  FOR EACH ROW
  WHEN (NEW.type::text IN ('band', 'event'))
  EXECUTE FUNCTION public.bw_trg_chats_one_group_chat();

-- A message an older build sends to a merged chat goes to the keeper. The
-- messages policies check the new row after this (participation in the
-- keeper), so nobody gets in who isn't there.
CREATE OR REPLACE FUNCTION public.bw_trg_messages_merged_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_keeper uuid;
BEGIN
  SELECT keeper_chat_id INTO v_keeper FROM chat_merges_193 WHERE dup_chat_id = NEW.chat_id;
  IF FOUND THEN
    NEW.chat_id := v_keeper;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_messages_merged_chat() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_messages_merged_chat ON public.messages;
CREATE TRIGGER bw_messages_merged_chat
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.bw_trg_messages_merged_chat();

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
