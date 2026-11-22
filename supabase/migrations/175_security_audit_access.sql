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
--      * band chats and the chats of a band's events need active membership
--        of that band (bw_my_chat_ids, which the messages and
--        chat_participants policies use, and the chats read policy);
--      * leaving the band (row deleted or is_active false) removes the
--        person from that band's band chat and event chats;
--      * stale rows already there are removed (kept in an admin-only
--        archive table, chat_participants_removed_175, for a rollback);
--      * bw_chat_recipient_ids(chat, sender) gives send-push the people who
--        may still read the chat.
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
-- working (name, updated_at), invitations already use the RPCs.
-- Idempotent; safe to re-run.
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

  IF NOT EXISTS (
    SELECT 1 FROM chat_participants WHERE chat_id = p_chat_id AND user_id = v_uid
  ) THEN
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
-- May p_user_id use a chat of this kind? Band chats and band event chats:
-- only while an active member of the band. Direct and other chats: yes
-- (being a participant is checked by the caller).
CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_type = 'band' THEN
      p_band_id IS NULL OR public.bw_is_band_member(p_band_id, p_user_id)
    WHEN p_type = 'event' THEN
      (p_band_id IS NULL OR public.bw_is_band_member(p_band_id, p_user_id))
      AND coalesce((
        SELECT e.band_id IS NULL OR public.bw_is_band_member(e.band_id, p_user_id)
          FROM events e WHERE e.id = p_event_id
      ), true)
    ELSE true
  END;
$$;
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
     AND public.bw_chat_scope_ok(c.type, c.band_id, c.event_id, cp.user_id);
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
       AND public.bw_chat_scope_ok(c.type, c.band_id, c.event_id, cp.user_id)
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ok WHERE user_id = p_sender)
    THEN coalesce((SELECT array_agg(DISTINCT user_id) FROM ok WHERE user_id <> p_sender), '{}')
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
  SELECT coalesce((SELECT public.bw_chat_scope_ok(c.type, c.band_id, c.event_id, p_user_id)
                     FROM chats c WHERE c.id = p_chat_id), false);
$$;
REVOKE ALL ON FUNCTION public.bw_chat_scope_ok_for(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_scope_ok_for(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS chat_participants_insert ON public.chat_participants;
CREATE POLICY chat_participants_insert ON public.chat_participants
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.bw_can_add_chat_participant(chat_id, user_id)
              AND public.bw_chat_scope_ok_for(chat_id, user_id));

-- 042's body; only the chat filter changes (bw_my_chat_ids, scope-checked).
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
      )
    )
    ORDER BY c.updated_at DESC NULLS LAST
  ) INTO result
  FROM chats c
  WHERE c.id = ANY (public.bw_my_chat_ids());

  RETURN COALESCE(result, '[]'::JSONB);
END;
$$;
REVOKE ALL ON FUNCTION public.get_user_chats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_chats(uuid) TO authenticated;

-- chats: read through the same rule.
DROP POLICY IF EXISTS chats_select_participant ON public.chats;
CREATE POLICY chats_select_participant ON public.chats
  FOR SELECT TO authenticated
  USING (id = ANY (public.bw_my_chat_ids()));

DROP POLICY IF EXISTS chats_select_creator ON public.chats;
CREATE POLICY chats_select_creator ON public.chats
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() AND public.bw_chat_scope_ok(type, band_id, event_id, auth.uid()));

-- Leaving the band: out of its band chat and its events' chats.
CREATE OR REPLACE FUNCTION public.bw_trg_band_member_left_chats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (coalesce(OLD.is_active, true) AND NOT coalesce(NEW.is_active, true)) THEN
    RETURN NEW;
  END IF;
  DELETE FROM chat_participants cp
   USING chats c
   WHERE cp.chat_id = c.id
     AND cp.user_id = OLD.user_id
     AND (
       (c.type = 'band' AND c.band_id = OLD.band_id)
       OR (c.type = 'event' AND (
             c.band_id = OLD.band_id
             OR c.event_id IN (SELECT e.id FROM events e WHERE e.band_id = OLD.band_id)))
     );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_band_member_left_chats() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_band_member_left_chats ON public.band_members;
CREATE TRIGGER bw_band_member_left_chats
  AFTER UPDATE OF is_active OR DELETE ON public.band_members
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_band_member_left_chats();

-- Stale rows left by earlier removals: archived, then removed.
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

WITH stale AS (
  SELECT cp.chat_id, cp.user_id, to_jsonb(cp) AS row_data
    FROM chat_participants cp
    JOIN chats c ON c.id = cp.chat_id
   WHERE c.type IN ('band', 'event')
     AND NOT public.bw_chat_scope_ok(c.type, c.band_id, c.event_id, cp.user_id)
), saved AS (
  INSERT INTO public.chat_participants_removed_175 (chat_id, user_id, row_data)
  SELECT chat_id, user_id, row_data FROM stale
  RETURNING chat_id, user_id
)
DELETE FROM chat_participants cp
 USING saved s
 WHERE cp.chat_id = s.chat_id AND cp.user_id = s.user_id;

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
    AND coalesce(status, 'invited') NOT IN ('declined', 'dropped_out', 'removed')
    AND (p_band_id IS NULL OR public.bw_is_band_member(p_band_id, user_id));

  IF coalesce(array_length(v_ids, 1), 0) = 0 AND p_band_id IS NOT NULL THEN
    v_ids := public.bw_active_band_member_ids(p_band_id, coalesce(p_private, false));
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
    WHERE event_id = NEW.event_id AND coalesce(status, 'invited') NOT IN ('declined', 'dropped_out', 'removed')
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
    SELECT coalesce(array_agg(DISTINCT em.user_id), '{}') INTO v_recipients
      FROM public.event_members em
     WHERE em.event_id = p_event_id
       AND em.user_id IS NOT NULL
       AND em.user_id <> v_uid
       AND coalesce(em.status, '') <> 'declined'
       -- 175: only people still in the band (a lineup row outlives removal).
       AND public.bw_is_band_member(v_band, em.user_id);
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
