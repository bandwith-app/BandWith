-- ============================================================================
-- 175 · Security audit fixes (Codex audit of release 383f15b), database part
-- ----------------------------------------------------------------------------
-- 1. Invitations: the person invited could rewrite their own invitation row
--    ("Users can accept own invitations": UPDATE, email match, no WITH CHECK)
--    and set role = 'admin' or another band_id; bw_accept_invitation then
--    copied both. That policy is dropped. Accept and decline go only through
--    the SECURITY DEFINER RPCs (bw_accept_invitation, bw_decline_invitation,
--    bw_decline_invitation_by_token), which is all the app has ever used
--    (checked: release 383f15b and main never UPDATE band_invitations).
--
-- 2. Chats: the creator could change chats.type (and band_id / event_id).
--    A group turned into 'direct' made bw_delete_chat_history delete every
--    participant's messages. Now type, band_id, event_id, created_by and
--    created_at never change (trigger + column grant: the app only ever
--    updates name and updated_at), and "delete for both" needs a chat that
--    really involves two people at most (creator, participants, authors).
--
-- 3. Removed members kept their band chat: reads, sends and pushes went
--    through chat_participants only. Now
--      * band chats need active membership of the band; gig (event) chats
--        need it too, and being on the gig: its creator, a band admin, or on
--        the lineup and not declined, dropped out or removed (round 3: the
--        lineup rule lives here, one definition, bw_chat_scope_ok). A gig
--        with no lineup: only its admins and creator use its chat (as 071);
--        the whole band gets only its logistics notices. This drives
--        bw_my_chat_ids (the messages, chats and chat_participants read
--        policies, so also Realtime), get_user_chats (chats and roster),
--        the read / delivered receipts (bw_mark_chat_read,
--        bw_mark_chats_delivered) and bw_chat_recipient_ids (send-push).
--        An access check never falls back to "yes" (no user, no gig, a gig
--        with no creator: false);
--      * leaving the band (row deleted or is_active false) or no longer
--        being an admin takes the person out of the chats the rule now
--        refuses. Round 4: their participant row is KEPT (a record goes to
--        chat_participants_removed_175) and the rule refuses it everywhere:
--        reads, roster and own row (chat_participants read policies, plus
--        one RESTRICTIVE guard on the rule that every read policy, current
--        or future, is ANDed with: old builds and Realtime included),
--        receipts, push (send-push via bw_chat_recipient_ids),
--        "shares a chat" (bw_shares_chat), "delete chat". Coming back, the
--        same row works again: same chat, cleared_at and read times as they
--        were, so no app can miss the chat and start a second one;
--      * stale rows already there are kept the same way (archived once);
--      * bw_chat_recipient_ids(chat, sender) gives send-push the people who
--        may still read the chat;
--      * bw_chat_scope_ok answers about someone else only for a caller the
--        same rule lets in (round 4);
--      * a gig whose whole lineup said no (or left) is still a gig with a
--        lineup: its notices go to its admins and creator (round 4).
--    Direct chats are not touched (people who left keep their DMs).
--
-- 4. Lineup notifications (04-auth #7): a lineup row outlives removal from
--    the band, so former members still got "Gig updated", payment and
--    setlist notices for gigs they had been booked on. Every lineup-based
--    recipient list is now limited to active members of the band.
--
-- 5. Quotes: quotes_select_admin also let the quote's creator read it after
--    being demoted or removed. Now: current active admins only (a quote with
--    no band, if any exists, stays readable by its creator).
--
-- Older app builds: nothing they call changes shape. Chat rename keeps
-- working (name, updated_at), invitations already use the RPCs. Their
-- batch inserts of a gig's lineup into its chat keep working: a former
-- member in the batch is skipped, not refused (round 2).
--
-- chats.type is the chat_type enum on databases built from 002 (text on
-- others): every call passes type::text. Legacy 'group' chats tied to a
-- band follow the band rule (prod has none).
--
-- Duplicate band / gig chats: round 4, nothing here deletes a participant
-- row, so a former member who comes back still has theirs. Someone who never
-- had one (new member) can still miss the chat in an old build's lookup:
-- 193 (#291: bw_open_group_chat, chats_select_joinable, one chat per band /
-- gig) closes that, and the new app's fallback asks bw_group_chat_exists
-- (below) and stops instead of creating a second chat. 175 must NOT ship
-- without 193. Apply order:
-- 175 -> 178 -> 193 -> 181 (tested in that order; 178 first because 193's
-- bw_chat_joinable builds on 178's bw_is_event_participant).
--
-- Idempotent; safe to re-run, also after 178 or 181 (178 keeps this
-- bw_chat_scope_ok: it calls bw_is_event_participant, which 178 extends).
-- ============================================================================

BEGIN;

-- ── 1. Invitations ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can accept own invitations" ON public.band_invitations;

-- ── 2. Chats: keys never change ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bw_chats_immutable_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type
     OR NEW.band_id IS DISTINCT FROM OLD.band_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     -- created_by may only go to NULL, and only because that profile is gone
     -- (the FK's ON DELETE SET NULL when an account is deleted).
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by
         AND NOT (NEW.created_by IS NULL
                  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.created_by)))
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'chats: type, band_id, event_id, created_by and created_at cannot change'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bw_chats_immutable_keys ON public.chats;
CREATE TRIGGER bw_chats_immutable_keys
  BEFORE UPDATE ON public.chats
  FOR EACH ROW EXECUTE FUNCTION public.bw_chats_immutable_keys();

REVOKE UPDATE ON public.chats FROM authenticated, anon;
GRANT UPDATE (name, updated_at) ON public.chats TO authenticated;

-- "Delete for both" only in a chat between two people at most.
CREATE OR REPLACE FUNCTION public.bw_delete_chat_history(p_chat_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_type text;
  v_people integer;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Round 4: a kept row the rule refuses (left the band) is no participant.
  IF NOT EXISTS (
    SELECT 1 FROM chat_participants WHERE chat_id = p_chat_id AND user_id = v_uid
  ) OR NOT coalesce(public.bw_chat_scope_ok_for(p_chat_id, v_uid), false) THEN
    RAISE EXCEPTION 'Not a participant of this chat' USING ERRCODE = '42501';
  END IF;

  SELECT type INTO v_type FROM chats WHERE id = p_chat_id;

  SELECT count(*) INTO v_people FROM (
    SELECT c.created_by AS u FROM chats c WHERE c.id = p_chat_id
    UNION SELECT cp.user_id FROM chat_participants cp WHERE cp.chat_id = p_chat_id
    UNION SELECT m.sender_id FROM messages m WHERE m.chat_id = p_chat_id
  ) people
  WHERE u IS NOT NULL;

  IF v_type = 'direct' AND v_people <= 2 THEN
    DELETE FROM messages WHERE chat_id = p_chat_id;
  ELSE
    DELETE FROM messages WHERE chat_id = p_chat_id AND sender_id = v_uid;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE chat_participants
     SET cleared_at = now()
   WHERE chat_id = p_chat_id AND user_id = v_uid;

  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.bw_delete_chat_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_delete_chat_history(uuid) TO authenticated;

-- ── 3. Band and event chats need active membership ─────────────────────────
-- May p_user_id use a chat of this kind? Band chats: only while an active
-- member of the band. Gig (event) chats: an active member of the band who is
-- also on the gig (bw_is_event_participant, 073: its creator, a band admin,
-- or on the lineup and not declined; 178 adds the quote rule to it) and not
-- dropped out or removed from the lineup (the statuses the server's notices
-- already treat as off the gig, 046) unless they run it (creator or admin).
-- Direct and other chats: yes (being a participant is checked by the
-- caller).
-- Round 3: this is the one definition (181 no longer redefines it), and an
-- access check never falls back to "yes": no user, no event, an event with
-- no creator, or a band chat with no band all give false.
-- The quote rule (178: a member is not on a quote's chat) is carried by
-- bw_is_event_participant once 178 is live; when 175 runs after 178 the rule
-- is also written in here, so it never depends on which one ran last.
-- Round 4:
--   * asked about someone else, it answers only for a caller the same rule
--     lets into that chat (its band's admins, people already in it, who see
--     its roster anyway); anyone else gets false. Not "self only": the
--     chat_participants insert policy and the roster ask about others on
--     behalf of the person adding them or reading the chat. No auth.uid()
--     (service role, migrations): the plain answer (anon has no EXECUTE).
--     current_user can't tell those apart here: inside a SECURITY DEFINER
--     function it is always the owner;
--   * lineup answers compared with lower(btrim()) ('Declined', 'Dropped_Out ');
--   * the body carries the marker bw:175-r4: later migrations that keep a
--     live definition (178, 181) look for it.
DO $do$
DECLARE
  v_quote text := '';
BEGIN
  IF to_regprocedure('public.bw_event_quote_hidden(uuid, uuid)') IS NOT NULL THEN
    v_quote := 'AND NOT public.bw_event_quote_hidden(e.id, w.u)';
  END IF;
  EXECUTE format($sql$
CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $f$
  -- bw:175-r4
  -- Everyone asked about must pass: p_user_id, and the caller as well when
  -- the caller asks about someone else.
  SELECT p_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM (VALUES (p_user_id),
                   (CASE WHEN auth.uid() IS DISTINCT FROM p_user_id THEN auth.uid() END)) AS w(u)
     WHERE w.u IS NOT NULL
       AND NOT coalesce(CASE
    WHEN p_type = 'band' THEN
      p_band_id IS NOT NULL AND public.bw_is_band_member(p_band_id, w.u)
    -- 'group' with a band: legacy, same rule as the band chat.
    WHEN p_type = 'group' THEN
      p_band_id IS NULL OR public.bw_is_band_member(p_band_id, w.u)
    WHEN p_type = 'event' THEN
      (p_band_id IS NULL OR public.bw_is_band_member(p_band_id, w.u))
      AND EXISTS (
        SELECT 1 FROM events e
         WHERE e.id = p_event_id
           AND (e.band_id IS NULL OR public.bw_is_band_member(e.band_id, w.u))
           AND public.bw_is_event_participant(e.id, w.u)
           AND (coalesce(e.created_by = w.u, false)
                OR (e.band_id IS NOT NULL AND public.bw_is_band_admin(e.band_id, w.u))
                OR NOT EXISTS (
                  SELECT 1 FROM event_members em
                   WHERE em.event_id = e.id AND em.user_id = w.u
                     AND lower(btrim(coalesce(em.status::text, ''))) IN ('declined', 'dropped_out', 'removed')))
           %s)
    ELSE true
  END, false));
$f$;
$sql$, v_quote);
END
$do$;
REVOKE ALL ON FUNCTION public.bw_chat_scope_ok(text, uuid, uuid, uuid) FROM PUBLIC, anon;
-- The chats read policy calls it (same exposure as bw_is_band_member).
GRANT EXECUTE ON FUNCTION public.bw_chat_scope_ok(text, uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bw_my_chat_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(array_agg(cp.chat_id), '{}')
    FROM chat_participants cp
    JOIN chats c ON c.id = cp.chat_id
   WHERE cp.user_id = auth.uid()
     AND public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, cp.user_id);
$$;
REVOKE ALL ON FUNCTION public.bw_my_chat_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_my_chat_ids() TO authenticated;

-- Who send-push may tell about a new message in p_chat_id from p_sender:
-- the other participants who can still read it, and nobody when the sender
-- cannot. Server only (service role).
CREATE OR REPLACE FUNCTION public.bw_chat_recipient_ids(p_chat_id uuid, p_sender uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH c AS (SELECT * FROM chats WHERE id = p_chat_id),
  ok AS (
    SELECT cp.user_id
      FROM chat_participants cp, c
     WHERE cp.chat_id = p_chat_id
       AND public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, cp.user_id)
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ok WHERE user_id = p_sender)
    THEN coalesce((SELECT array_agg(DISTINCT user_id) FROM ok WHERE user_id IS DISTINCT FROM p_sender), '{}')
    ELSE '{}'::uuid[] END;
$$;
REVOKE ALL ON FUNCTION public.bw_chat_recipient_ids(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_chat_recipient_ids(uuid, uuid) TO service_role;

-- Joining a band or gig chat takes the same rule (an INSERT that would put a
-- former member back, e.g. still on a gig's lineup, is refused), and the
-- chat list RPC lists only chats the caller can still read: get_user_chats
-- returned rosters and read times straight from chat_participants.
CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok_for(p_chat_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce((SELECT public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, p_user_id)
                     FROM chats c WHERE c.id = p_chat_id), false);
$$;
REVOKE ALL ON FUNCTION public.bw_chat_scope_ok_for(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_scope_ok_for(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS chat_participants_insert ON public.chat_participants;
CREATE POLICY chat_participants_insert ON public.chat_participants
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.bw_can_add_chat_participant(chat_id, user_id)
              AND public.bw_chat_scope_ok_for(chat_id, user_id));

-- Round 2: a row the rule refuses is skipped, not an error. Apps add a gig's
-- whole lineup in one insert (createChat, sendMessage, older builds too):
-- one former member still on the lineup made the policy refuse the whole
-- batch, so nobody (not even the creator) joined the new chat. The policy
-- above stays as the backstop.
CREATE OR REPLACE FUNCTION public.bw_trg_chat_participant_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_patch jsonb := '{}'::jsonb;
  k text;
BEGIN
  IF EXISTS (SELECT 1 FROM chats c WHERE c.id = NEW.chat_id)
     AND NOT coalesce(public.bw_chat_scope_ok_for(NEW.chat_id, NEW.user_id), false) THEN
    RETURN NULL;
  END IF;
  -- Round 3: back in a chat they were taken out of (left the band, off the
  -- lineup): their own cut-offs come back with them, so history they had
  -- cleared stays cleared and old messages don't count as new again.
  SELECT r.row_data INTO v_old
    FROM public.chat_participants_removed_175 r
   WHERE r.chat_id = NEW.chat_id AND r.user_id = NEW.user_id
   ORDER BY r.removed_at DESC
   LIMIT 1;
  IF v_old IS NOT NULL THEN
    v_new := to_jsonb(NEW);
    FOREACH k IN ARRAY ARRAY['cleared_at', 'last_read_at', 'last_delivered_at'] LOOP
      IF v_new ? k AND v_old ? k AND v_old->>k IS NOT NULL
         AND (v_new->>k IS NULL OR (v_new->>k)::timestamptz < (v_old->>k)::timestamptz) THEN
        v_patch := v_patch || jsonb_build_object(k, v_old->k);
      END IF;
    END LOOP;
    IF v_new ? 'muted' AND coalesce((v_old->>'muted')::boolean, false) THEN
      v_patch := v_patch || jsonb_build_object('muted', true);
    END IF;
    IF v_patch <> '{}'::jsonb THEN
      NEW := jsonb_populate_record(NEW, v_patch);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_chat_participant_scope() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_chat_participant_scope ON public.chat_participants;
CREATE TRIGGER bw_chat_participant_scope
  BEFORE INSERT ON public.chat_participants
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_chat_participant_scope();

-- 042's body; only the chat filter (bw_my_chat_ids, scope-checked) and the
-- roster filter (same rule) change.
CREATE OR REPLACE FUNCTION public.get_user_chats(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'id', c.id,
      'band_id', c.band_id,
      'event_id', c.event_id,
      'type', c.type,
      'name', c.name,
      'created_by', c.created_by,
      'created_at', c.created_at,
      'updated_at', c.updated_at,
      'participants', (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'id', cp.id,
            'chat_id', cp.chat_id,
            'user_id', cp.user_id,
            'last_read_at', cp.last_read_at,
            'muted', cp.muted,
            'joined_at', cp.joined_at
          )
        )
        FROM chat_participants cp
        WHERE cp.chat_id = c.id
          -- round 3: the roster leaves out rows the rule refuses too
          AND public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, cp.user_id)
      )
    )
    ORDER BY c.updated_at DESC NULLS LAST
  ) INTO result
  FROM chats c
  WHERE c.id = ANY ((SELECT public.bw_my_chat_ids())::uuid[]);

  RETURN COALESCE(result, '[]'::JSONB);
END;
$$;
REVOKE ALL ON FUNCTION public.get_user_chats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_chats(uuid) TO authenticated;

-- Round 3: read and delivery receipts (049) only for chats the caller can
-- still read. A row the rule refuses (e.g. a demoted admin off the lineup,
-- left before the cleanup) answered "true" to bw_mark_chat_read whenever
-- someone had written since: that says new messages exist, and it moved
-- receipts the others see. Same bodies, plus the rule, and (round 3) a
-- message whose sender deleted their account (sender_id NULL, #282 / 180)
-- counts as someone else's: IS DISTINCT FROM, not <>.
CREATE OR REPLACE FUNCTION public.bw_mark_chats_delivered()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  UPDATE chat_participants cp
     SET last_delivered_at = now()
   WHERE cp.user_id = auth.uid()
     AND public.bw_chat_scope_ok_for(cp.chat_id, cp.user_id)
     AND EXISTS (
       SELECT 1 FROM messages m
        WHERE m.chat_id = cp.chat_id
          AND m.sender_id IS DISTINCT FROM auth.uid()
          AND m.created_at > coalesce(cp.last_delivered_at, '-infinity'::timestamptz)
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_mark_chats_delivered() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_mark_chats_delivered() TO authenticated;

CREATE OR REPLACE FUNCTION public.bw_mark_chat_read(p_chat_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  UPDATE chat_participants cp
     SET last_read_at = now(),
         last_delivered_at = now()
   WHERE cp.chat_id = p_chat_id
     AND cp.user_id = auth.uid()
     AND public.bw_chat_scope_ok_for(cp.chat_id, cp.user_id)
     AND (
       cp.last_read_at IS NULL
       OR EXISTS (
         SELECT 1 FROM messages m
          WHERE m.chat_id = cp.chat_id
            AND m.sender_id IS DISTINCT FROM auth.uid()
            AND m.created_at > cp.last_read_at
       )
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_mark_chat_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_mark_chat_read(uuid) TO authenticated;

-- chats: read through the same rule.
-- Round 4 (cost): bw_my_chat_ids() now checks the rule for each of the
-- caller's chats, so policies call it once per query, as a sub-select
-- (an InitPlan), never once per row: (SELECT ...)::uuid[]. Same answer.
DROP POLICY IF EXISTS chats_select_participant ON public.chats;
CREATE POLICY chats_select_participant ON public.chats
  FOR SELECT TO authenticated
  USING (id = ANY ((SELECT public.bw_my_chat_ids())::uuid[]));

-- messages (073 policies, same rule, same InitPlan form).
DROP POLICY IF EXISTS messages_select_participant ON public.messages;
CREATE POLICY messages_select_participant ON public.messages
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (chat_id = ANY ((SELECT public.bw_my_chat_ids())::uuid[]));
DROP POLICY IF EXISTS messages_insert_participant ON public.messages;
CREATE POLICY messages_insert_participant ON public.messages
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND chat_id = ANY ((SELECT public.bw_my_chat_ids())::uuid[]));

DROP POLICY IF EXISTS chats_select_creator ON public.chats;
CREATE POLICY chats_select_creator ON public.chats
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() AND public.bw_chat_scope_ok(type::text, band_id, event_id, auth.uid()));

-- Leaving the band: out of its band chat and its events' chats (the rule
-- above refuses them). Round 4: the row is archived and KEPT, never deleted:
-- coming back, the same row (and so the same chat) is theirs again, and no
-- app build can miss it and start a second band or gig chat.
CREATE OR REPLACE FUNCTION public.bw_trg_band_member_left_chats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Left (row deleted), deactivated, or (round 3) no longer an admin: a
  -- demoted admin who is not on a gig's lineup is out of that gig's chat.
  IF TG_OP = 'UPDATE' AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
                      AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;
  -- A record of who was taken out of what, when (an account being deleted
  -- takes its rows with it: the archive's FK to profiles would refuse them).
  WITH gone AS (
    SELECT cp.chat_id, cp.user_id, to_jsonb(cp) AS row_data,
           EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = cp.user_id) AS keep
      FROM chat_participants cp
      JOIN chats c ON c.id = cp.chat_id
     WHERE cp.user_id = OLD.user_id
       AND (
         (c.type::text IN ('band', 'group') AND c.band_id = OLD.band_id)
         OR (c.type::text = 'event' AND (
               c.band_id = OLD.band_id
               OR c.event_id IN (SELECT e.id FROM events e WHERE e.band_id = OLD.band_id)))
       )
       AND NOT coalesce(public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, cp.user_id), false)
  )
  INSERT INTO public.chat_participants_removed_175 (chat_id, user_id, row_data)
  SELECT chat_id, user_id, row_data FROM gone WHERE keep;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_band_member_left_chats() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_band_member_left_chats ON public.band_members;
CREATE TRIGGER bw_band_member_left_chats
  AFTER UPDATE OF is_active, role OR DELETE ON public.band_members
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_band_member_left_chats();

-- Stale rows left by earlier removals: the rule refuses them everywhere;
-- round 4: archived once, kept (never deleted, as above).
CREATE TABLE IF NOT EXISTS public.chat_participants_removed_175 (
  chat_id uuid NOT NULL,
  user_id uuid NOT NULL,
  row_data jsonb NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now()
);
-- Gone with the account (and with the chat).
DELETE FROM public.chat_participants_removed_175 r
 WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id)
    OR NOT EXISTS (SELECT 1 FROM public.chats c WHERE c.id = r.chat_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_participants_removed_175_user_fkey') THEN
    ALTER TABLE public.chat_participants_removed_175
      ADD CONSTRAINT chat_participants_removed_175_user_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_participants_removed_175_chat_fkey') THEN
    ALTER TABLE public.chat_participants_removed_175
      ADD CONSTRAINT chat_participants_removed_175_chat_fkey
      FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE public.chat_participants_removed_175 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_participants_removed_175 FROM PUBLIC, anon, authenticated;

INSERT INTO public.chat_participants_removed_175 (chat_id, user_id, row_data)
SELECT cp.chat_id, cp.user_id, to_jsonb(cp)
  FROM chat_participants cp
  JOIN chats c ON c.id = cp.chat_id
 WHERE c.type::text IN ('band', 'group', 'event')
   AND NOT public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, cp.user_id)
   -- (a row whose profile is gone can't be archived: its FK would refuse it)
   AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = cp.user_id)
   AND NOT EXISTS (SELECT 1 FROM public.chat_participants_removed_175 r
                    WHERE r.chat_id = cp.chat_id AND r.user_id = cp.user_id);

-- Round 4: rows are kept, so everything that reads other people's rows
-- applies the rule too. The roster (chat_participants read policy): rows of
-- my chats; only people who can still use the chat, by the guard below
-- (both are for authenticated, so the rule is checked once per row, there).
DROP POLICY IF EXISTS chat_participants_select_same_chat ON public.chat_participants;
CREATE POLICY chat_participants_select_same_chat ON public.chat_participants
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (chat_id = ANY ((SELECT public.bw_my_chat_ids())::uuid[]));
-- And their own kept row: not shown to them either (no chat list, unread
-- count or badge in any app build counts a chat the rule refuses). This one
-- is for every role (as on prod), so it carries the rule itself as well.
DROP POLICY IF EXISTS chat_participants_select_own ON public.chat_participants;
CREATE POLICY chat_participants_select_own ON public.chat_participants
  AS PERMISSIVE FOR SELECT TO public
  USING (user_id = auth.uid() AND public.bw_chat_scope_ok_for(chat_id, user_id));
-- The central guard: permissive read policies are ORed, so any other one
-- (made by hand on prod, or by a later migration) would show kept rows
-- again. A RESTRICTIVE policy is ANDed with all of them. Both functions are
-- SECURITY DEFINER (they read chat_participants as the owner: no RLS, no
-- recursion). An UPDATE or DELETE that filters rows (every app build does,
-- by chat_id / user_id) goes through the read policies too, so a kept row
-- can't be changed or removed by its former owner either.
DROP POLICY IF EXISTS chat_participants_scope_guard ON public.chat_participants;
CREATE POLICY chat_participants_scope_guard ON public.chat_participants
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.bw_chat_scope_ok_for(chat_id, user_id));
-- Exact duplicates on prod (073): "Users can update own chat participation"
-- and "Users can delete own chat participation" have the same rule
-- (user_id = auth.uid()) and stay.
DROP POLICY IF EXISTS cp_update ON public.chat_participants;
DROP POLICY IF EXISTS cp_delete ON public.chat_participants;

-- "Shares a chat" (042: profiles read policy, chat notices): a band or gig
-- chat counts only while both may still use it (a former member's kept row
-- no longer shares the band chat with the band).
CREATE OR REPLACE FUNCTION public.bw_shares_chat(p_other uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM chat_participants a
    JOIN chat_participants b ON b.chat_id = a.chat_id
    WHERE a.user_id = p_user_id AND b.user_id = p_other
      AND public.bw_chat_scope_ok_for(a.chat_id, a.user_id)
      AND public.bw_chat_scope_ok_for(b.chat_id, b.user_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.bw_shares_chat(uuid, uuid) FROM anon;

-- Is there a band chat for this band / a gig chat for this gig? For the app's
-- fallback when 193 (bw_open_group_chat) is not there: a chat it cannot see
-- (no row of its own yet) must never be created twice. Active members of
-- the band only; anyone else gets false.
CREATE OR REPLACE FUNCTION public.bw_group_chat_exists(p_type text, p_band_id uuid DEFAULT NULL, p_event_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_type = 'band' THEN
      p_band_id IS NOT NULL AND public.bw_is_band_member(p_band_id, auth.uid())
      AND EXISTS (SELECT 1 FROM chats c WHERE c.type::text = 'band' AND c.band_id = p_band_id)
    WHEN p_type = 'event' THEN
      EXISTS (SELECT 1 FROM events e
               WHERE e.id = p_event_id AND e.band_id IS NOT NULL
                 AND public.bw_is_band_member(e.band_id, auth.uid()))
      AND EXISTS (SELECT 1 FROM chats c WHERE c.type::text = 'event' AND c.event_id = p_event_id)
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_group_chat_exists(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_group_chat_exists(text, uuid, uuid) TO authenticated;

-- ── 4. Lineup notifications: only people still in the band ─────────────────
CREATE OR REPLACE FUNCTION public.bw_event_recipient_ids(p_event_id uuid, p_band_id uuid, p_private boolean)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT user_id), '{}'::uuid[]) INTO v_ids
  FROM public.event_members
  WHERE event_id = p_event_id
    AND lower(btrim(coalesce(status::text, 'invited'))) NOT IN ('declined', 'dropped_out', 'removed')
    AND (p_band_id IS NULL OR public.bw_is_band_member(p_band_id, user_id));

  IF p_band_id IS NOT NULL AND coalesce(array_length(v_ids, 1), 0) = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM public.event_members WHERE event_id = p_event_id) THEN
      -- No lineup at all: the whole band (its admins for a quote).
      v_ids := public.bw_active_band_member_ids(p_band_id, coalesce(p_private, false));
    ELSE
      -- A lineup with nobody left on it (round 4: all declined, dropped out
      -- or removed; round 2: all gone from the band) is still a lineup: the
      -- people who run the gig, its band's admins and its creator, never
      -- the members who were never booked (nor those who said no).
      SELECT coalesce(array_agg(DISTINCT u), '{}'::uuid[]) INTO v_ids
        FROM unnest(public.bw_active_band_member_ids(p_band_id, true)
                    || ARRAY(SELECT e.created_by FROM public.events e
                              WHERE e.id = p_event_id AND e.created_by IS NOT NULL
                                AND public.bw_is_band_member(p_band_id, e.created_by))) AS u
       WHERE u IS NOT NULL;
    END IF;
  END IF;
  RETURN v_ids;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_event_recipient_ids(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Payment notice to the lineup (046), same filter.
CREATE OR REPLACE FUNCTION public.bw_trg_transaction_income()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency text;
  v_event_title text;
  v_admins uuid[];
  v_lineup uuid[];
BEGIN
  IF NEW.type <> 'income' THEN RETURN NEW; END IF;

  -- to_jsonb() so a missing optional column never breaks the trigger
  SELECT coalesce(to_jsonb(b)->'pricing_settings'->>'currency', to_jsonb(b)->>'pricing_currency', 'EUR') INTO v_currency
  FROM public.bands b WHERE b.id = NEW.band_id;
  v_admins := public.bw_active_band_member_ids(NEW.band_id, true);

  IF NEW.event_id IS NOT NULL THEN
    SELECT title INTO v_event_title FROM public.events WHERE id = NEW.event_id;
  END IF;

  PERFORM public.bw_notify(v_admins, NEW.band_id, 'payment_received',
    'Payment received',
    to_char(NEW.amount, 'FM999G999G990D00') || ' ' || coalesce(v_currency, 'EUR') || ' · ' ||
      coalesce(v_event_title, NEW.title),
    jsonb_build_object('transaction_id', NEW.id, 'event_id', NEW.event_id, 'amount', NEW.amount, 'currency', v_currency),
    NEW.id, 'transaction');

  IF NEW.event_id IS NOT NULL THEN
    SELECT coalesce(array_agg(DISTINCT user_id), '{}'::uuid[]) INTO v_lineup
    FROM public.event_members
    WHERE event_id = NEW.event_id AND lower(btrim(coalesce(status::text, 'invited'))) NOT IN ('declined', 'dropped_out', 'removed')
      AND user_id <> ALL (v_admins)
      -- 175: only people still in the band.
      AND public.bw_is_band_member(NEW.band_id, user_id);
    PERFORM public.bw_notify(v_lineup, NEW.band_id, 'payment_received',
      'Payment received', 'The band recorded a payment for ' || coalesce(v_event_title, 'a gig') || '.',
      jsonb_build_object('event_id', NEW.event_id), NEW.id, 'transaction');
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_transaction_income: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Setlist summary to a gig's lineup (107), same filter.
CREATE OR REPLACE FUNCTION public.bw_notify_setlist_saved(
  p_setlist_id uuid,
  p_event_id uuid DEFAULT NULL,
  p_moved int DEFAULT 0,
  p_added int DEFAULT 0,
  p_removed int DEFAULT 0,
  p_renamed boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_band uuid;
  v_name text;
  v_event_title text;
  v_who text;
  v_recipients uuid[];
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_moved, 0) <= 0 AND coalesce(p_added, 0) <= 0 AND coalesce(p_removed, 0) <= 0 AND NOT coalesce(p_renamed, false) THEN
    RETURN 0;
  END IF;

  SELECT s.band_id, s.name INTO v_band, v_name FROM public.setlists s WHERE s.id = p_setlist_id;
  IF v_band IS NULL OR NOT public.bw_is_band_admin(v_band) THEN
    RAISE EXCEPTION 'Only band admins can change setlists' USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NOT NULL THEN
    SELECT e.title INTO v_event_title
      FROM public.events e
     WHERE e.id = p_event_id AND e.setlist_id = p_setlist_id AND e.band_id = v_band;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This event does not use that setlist' USING ERRCODE = '22023';
    END IF;
    -- 175: the gig's recipients as every other gig notice has them
    -- (bw_event_recipient_ids, above): the lineup still in the band, not
    -- declined, dropped out or removed (round 3: this one still told
    -- dropped-out and removed musicians); the band when there is no lineup.
    -- Round 4: the two-argument form, which works the quote rule out itself
    -- (111): a quote with no lineup tells the band's admins only, never the
    -- whole band (round 3 passed false, so a private title reached members).
    SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_recipients
      FROM unnest(public.bw_event_recipient_ids(p_event_id, v_band)) AS u
     WHERE u IS NOT NULL AND u <> v_uid;
    -- With 178 live, nobody the quote rule hides it from (178's sharper
    -- rule: a quote is for its band's admins, a cancelled hold stays one).
    IF to_regprocedure('public.bw_event_quote_hidden(uuid, uuid)') IS NOT NULL THEN
      EXECUTE 'SELECT coalesce(array_agg(u), ''{}'') FROM unnest($1) AS u WHERE NOT public.bw_event_quote_hidden($2, u)'
         INTO v_recipients USING v_recipients, p_event_id;
    END IF;
  ELSE
    SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_recipients
      FROM unnest(public.bw_active_band_member_ids(v_band)) AS u
     WHERE u IS NOT NULL AND u <> v_uid;
  END IF;

  -- The inbox notes the same save just wrote, one per row (046): replaced
  -- by the summary, also for band members who aren't in this gig.
  DELETE FROM public.notifications n
   WHERE n.type = 'setlist_updated'
     AND n.reference_id = p_setlist_id
     AND n.read = false
     AND coalesce(n.data ->> 'kind', '') <> 'summary'
     AND n.created_at > now() - interval '5 minutes';

  v_who := public.bw_display_name(v_uid);

  INSERT INTO public.notifications (user_id, band_id, type, title, body, data, read, reference_id, reference_type)
  SELECT r.u, v_band, 'setlist_updated',
         left(public.bw_setlist_text(CASE WHEN p_event_id IS NOT NULL THEN 'gig.title' ELSE 'band.title' END, r.lang,
                jsonb_build_object('event', coalesce(nullif(v_event_title, ''), v_name), 'name', v_name)), 255),
         CASE WHEN coalesce(p_moved, 0) <= 0 AND coalesce(p_added, 0) <= 0 AND coalesce(p_removed, 0) <= 0
              THEN public.bw_setlist_text('renamed.body', r.lang, jsonb_build_object(
                     'who', coalesce(v_who, public.bw_setlist_text('someone', r.lang)), 'name', v_name))
              ELSE public.bw_setlist_text('summary.body', r.lang, jsonb_build_object(
                     'who', coalesce(v_who, public.bw_setlist_text('someone', r.lang)),
                     'changes', public.bw_setlist_summary(r.lang, p_moved, p_added, p_removed)))
         END,
         jsonb_strip_nulls(jsonb_build_object(
           'kind', 'summary',
           'setlist_id', p_setlist_id,
           'setlist_name', v_name,
           'event_id', p_event_id,
           'event_title', v_event_title,
           'moved', greatest(coalesce(p_moved, 0), 0),
           'added', greatest(coalesce(p_added, 0), 0),
           'removed', greatest(coalesce(p_removed, 0), 0),
           'tag', 'setlist-' || p_setlist_id,
           'channel_id', 'bandwith_events')),
         false, p_setlist_id, 'setlist'
    FROM (
      SELECT u,
             coalesce(nullif(lower(left(btrim(p.preferred_language), 2)), ''), 'en') AS lang
        FROM unnest(v_recipients) AS u
        LEFT JOIN public.profiles p ON p.id = u
    ) r;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_notify_setlist_saved(uuid, uuid, int, int, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_notify_setlist_saved(uuid, uuid, int, int, int, boolean) TO authenticated;

-- ── 5. Quotes: current active admins only ──────────────────────────────────
DROP POLICY IF EXISTS quotes_select_admin ON public.quotes;
CREATE POLICY quotes_select_admin ON public.quotes
  FOR SELECT TO authenticated
  USING (
    public.bw_is_band_admin(band_id)
    OR (band_id IS NULL AND created_by = auth.uid())
  );

COMMIT;
