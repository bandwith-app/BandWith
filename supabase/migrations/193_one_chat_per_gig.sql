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
--     The app may ask about itself, or a band admin about someone in the
--     band (round 4); the rule itself is bw_chat_joinable_rule, server only.
--   * chats_select_joinable: those people can see the chat row (not its
--     messages: the messages policies still need participation, 175/181).
--     This alone fixes older app builds: their lookup finds the chat and
--     they join it as before.
--   * bw_chat_participant_joinable: a chat_participants row for someone who
--     may not join a band or gig chat is skipped, whoever inserts it (the
--     app's lineup restore re-added ex-members still on a lineup).
--   * bw_open_group_chat(type, band, event, name): the app's get-or-join, in
--     one transaction under a lock. It finds the chat (or creates it), adds
--     the caller and returns the row plus "created". With 175 applied it also
--     passes 175's rule (bw_chat_scope_ok_for, round 4: 175 keeps a removed
--     person's row, and its rule is the stricter one).
--   * Reading chat_participants (round 4, 175 keeps ex-members' rows): the
--     trigger reads only chats; bw_open_group_chat writes the caller's own
--     row after both rules said yes; nothing here counts participants.
--   * a unique index allows one band chat per band and one chat per gig.
--     Prod has no duplicates (checked 11-22: 2 band chats, 5 event chats, a
--     dry run found nothing to merge), so there is no merge: if duplicates
--     exist, this migration stops and lists them.
--
-- Older app builds keep working: the lookup they run now finds the chat; a
-- duplicate insert (only in a race) is refused instead of splitting the gig.
--
-- Joining a gig chat needs an active membership of the gig's band: an
-- ex-member still on a lineup is refused. Their older build finds no chat
-- and inserts one: instead of a raw unique-index error they get a clear
-- message in their language ("This gig already has a chat...", still 23505).
--
-- Needs 175 first (175_security_audit_access.sql, #281; Codex #291 r4 B1/B2,
-- main's decision): removing someone from the band takes them out of these
-- chats only through 175's rule (bw_chat_scope_ok_for, archived rows), and
-- only 175's bw_chats_immutable_keys stops a chat's creator moving it to
-- another band. Without them this file stops at once, naming 175. Hard
-- order 175 → 193 (the release safety net checks it too, #278).
-- Idempotent; one transaction.
-- ============================================================================

BEGIN;

-- ── 175 first ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.bw_chat_scope_ok_for(uuid, uuid)') IS NULL
     OR to_regprocedure('public.bw_chats_immutable_keys()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t
                     WHERE t.tgrelid = 'public.chats'::regclass
                       AND t.tgname = 'bw_chats_immutable_keys'
                       AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION '193 needs 175 (175_security_audit_access.sql, #281) applied first: missing public.bw_chat_scope_ok_for(uuid, uuid), public.bw_chats_immutable_keys() or trigger bw_chats_immutable_keys on public.chats';
  END IF;
END
$$;

-- ── Who may join a band or gig chat ─────────────────────────────────────────
-- The rule itself, about anyone: for 193's own trigger and get-or-join
-- (security definer), never callable by the app.
CREATE OR REPLACE FUNCTION public.bw_chat_joinable_rule(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid)
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
REVOKE ALL ON FUNCTION public.bw_chat_joinable_rule(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_chat_joinable_rule(text, uuid, uuid, uuid) TO service_role;

-- For the app and the read policy: about yourself, or (band admins) about
-- someone in your band. Anyone else asking about someone else gets false
-- (Claude review #291 r4: it told a member who may join which gig chat).
CREATE OR REPLACE FUNCTION public.bw_chat_joinable(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (auth.uid() IS NULL
          OR p_user_id = auth.uid()
          OR (p_band_id IS NOT NULL AND public.bw_is_band_admin(p_band_id, auth.uid()))
          OR coalesce((SELECT e.band_id IS NOT NULL AND public.bw_is_band_admin(e.band_id, auth.uid())
                         FROM events e WHERE e.id = p_event_id), false))
     AND public.bw_chat_joinable_rule(p_type, p_band_id, p_event_id, p_user_id);
$$;
REVOKE ALL ON FUNCTION public.bw_chat_joinable(text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_joinable(text, uuid, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS chats_select_joinable ON public.chats;
CREATE POLICY chats_select_joinable ON public.chats
  FOR SELECT TO authenticated
  USING (type::text IN ('band', 'event') AND public.bw_chat_joinable(type::text, band_id, event_id, auth.uid()));

-- ── No duplicates (main's decision, round 3: no merge) ──────────────────────
DO $$
DECLARE
  v_list text;
BEGIN
  SELECT string_agg(format('%s %s: %s', type, k, ids), '; ')
    INTO v_list
    FROM (
      SELECT type::text AS type,
             CASE WHEN type = 'event' THEN event_id ELSE band_id END AS k,
             string_agg(id::text, ', ' ORDER BY created_at, id) AS ids
        FROM chats
       WHERE type IN ('band', 'event')
         AND (CASE WHEN type = 'event' THEN event_id ELSE band_id END) IS NOT NULL
       GROUP BY 1, 2
      HAVING count(*) > 1
    ) d;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '193: duplicate group chats, merge them by hand first (type key: chat ids, oldest first): %', v_list;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS chats_one_per_event
  ON public.chats (event_id) WHERE type = 'event' AND event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chats_one_per_band
  ON public.chats (band_id) WHERE type = 'band' AND band_id IS NOT NULL;

-- ── Older builds: a clear refusal ──────────────────────────────────────────
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

-- ── Only people who may join end up in a band or gig chat ──────────────────
-- Sending to a gig chat re-adds the whole lineup (the app's restore, older
-- builds too, in one upsert); an ex-member still on the lineup came back
-- that way and read the chat. Every insert path now has the same rule as
-- bw_open_group_chat: a row for someone who may not join is skipped (not an
-- error, so the rest of an older build's upsert still goes in). Chats
-- without a band or gig key are left to the policies.
CREATE OR REPLACE FUNCTION public.bw_trg_chat_participant_joinable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_type text;
  v_band uuid;
  v_event uuid;
BEGIN
  SELECT c.type::text, c.band_id, c.event_id INTO v_type, v_band, v_event
    FROM chats c WHERE c.id = NEW.chat_id;
  IF (v_type = 'band' AND v_band IS NOT NULL) OR (v_type = 'event' AND v_event IS NOT NULL) THEN
    IF NOT public.bw_chat_joinable_rule(v_type, v_band, v_event, NEW.user_id) THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_chat_participant_joinable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_chat_participant_joinable ON public.chat_participants;
CREATE TRIGGER bw_chat_participant_joinable
  BEFORE INSERT ON public.chat_participants
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_chat_participant_joinable();

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
  v_scope_ok boolean;
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

  IF NOT public.bw_chat_joinable_rule(p_type, v_band, p_event_id, v_uid) THEN
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

  -- 175 r4 (#281): a removed person's row is kept and its rule refuses it
  -- everywhere. That rule is the stricter one (lineup statuses in any case:
  -- 'Dropped_Out' is off the gig), so opening must pass it too, or someone
  -- would "open" a chat they can't read. 175 is required (checked at the
  -- top); EXECUTE keeps this body valid on its own. A chat created just now
  -- goes back with the refusal.
  IF to_regprocedure('public.bw_chat_scope_ok_for(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(public.bw_chat_scope_ok_for($1, $2), false)' INTO v_scope_ok USING v_chat.id, v_uid;
    IF NOT v_scope_ok THEN
      RAISE EXCEPTION 'Not allowed to open this chat' USING ERRCODE = '42501';
    END IF;
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
