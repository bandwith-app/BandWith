-- ============================================================================
-- 178 · Date on hold: members see only a hold card for a tentative quote gig
-- ----------------------------------------------------------------------------
-- Owner's decision, 2026-11-22. Until now a quote event (a band event tied to
-- a quote, not confirmed yet: bw_event_is_quote, 111) was readable by the
-- members on its lineup and by its creator (title, venue, notes...), and a
-- change of date sent them "Gig updated" with the quote's title.
--
-- After this migration:
--
--  1. Quote events are readable only by the band's active admins, everywhere
--     a member could reach them. "Quote event" here is bw_event_quote_private:
--     still a quote (111), or cancelled while it was one and never confirmed
--     (a wizard quote is linked only by quotes.converted_to_event_id, so a
--     cancelled one looks like any cancelled gig on its own row).
--       * events (events_select_policy), bw_can_view_event (lineup, event
--         tasks), the member's own lineup row of a quote (event_members read
--         and own-answer update), bw_event_member_money (the musician fee),
--         quote_musicians (a member's own row only once the quote's event is
--         confirmed);
--       * rider (bw_event_rider), stage plot (event_stage), gig kits
--         (event_gear_kits), the live stage key and channel (bw_stage_key,
--         bw_stage_topic_allowed), the offline live pack (window, can-hold);
--       * setlists linked to a quote (events.setlist_id) and their songs,
--         unless a gig or rehearsal members can see uses the same setlist, or
--         it is a template; song proposals of a quote event;
--       * bw_is_event_participant: a member is not a participant of a quote,
--         so they can't be added to (or create) its event chat;
--       * the event chat of a quote, on its own (with or without 175/181):
--         members' chat_participants rows are archived and removed, new ones
--         are dropped by a BEFORE INSERT trigger (an older admin build that
--         adds the whole lineup still saves its own row), chats / messages /
--         chat_participants are hidden by RESTRICTIVE policies,
--         get_user_chats skips them, send-push asks bw_chat_push_readers per
--         recipient, and bw_chat_scope_ok (175) gets the same rule;
--       * once the gig is confirmed the lineup is put back in its chat, with
--         the quote-stage history cut off (cleared_at, and a RESTRICTIVE
--         messages policy for older messages);
--       * notifications: a BEFORE INSERT guard drops any notification about
--         a quote event (by event, by its chat, or by its setlist) addressed
--         to a non-admin member of its band (old app builds still write
--         "Availability check: <title> · your fee"), and the ones already in
--         members' inboxes are archived and removed;
--       * no new deputy request for a quote event (deputies asked before keep
--         their own snapshot);
--       * bw_member_stats and bw_band_free_slots skip quote lineup rows; a
--         live hold blocks its slot for the band in free_slots (it exists to
--         avoid double booking).
--     Admins: unchanged. Confirmed gigs: unchanged (own fee + logistics).
--
--  2. Every active member who is not an admin sees a hold instead, only
--     through these RPCs (no table grants):
--       bw_my_date_holds()                 day, start/end time, venue name,
--                                          city, band, my answer
--       bw_answer_date_hold(event, answer) 'free' or 'busy'
--       bw_date_hold_answers(event)        admins: every member's answer
--     A hold is live while the event is a quote, not cancelled, its day has
--     not ended for the band, and its quote is not declined / expired /
--     archived (quote or link). It is announced once its quote is saved (a
--     tentative event with no quote: after 2 minutes, by the sweep), so a
--     wizard save that fails never tells anyone. Moving the day or the time
--     clears the answers.
--     "The day has ended": there is no time zone on events or bands, and
--     profiles.timezone is never set by the app (it is 'Europe/Rome' for
--     everyone). So the day ends when it has ended everywhere a band can be:
--     at midnight in UTC-12 (as 117 does for poll deadlines). A New York gig
--     on Saturday is held until Sunday 7:00 there.
--
--  3. Neutral notifications, in the reader's language (no title, client,
--     fee or notes): 'date_hold' when the hold starts, 'date_hold_changed'
--     when its day, time or place changes, 'date_hold_released' ("The date
--     is free again") once when it ends without becoming their gig: quote
--     declined or expired, event cancelled or deleted, or confirmed with a
--     lineup they are not on. Confirmed with them on it: the usual "Gig
--     confirmed" (046). The sweep ('bw-date-hold-sweep', every 5 minutes)
--     announces tentative events with no quote and releases expired ones.
--     Their pushes go out as type 'event_date_hold' without an event id, so
--     older builds open the calendar; newer ones open the hold.
--     bw_trg_event_changed (111) sends its titled notices about a quote
--     (cancelled, deleted, updated) to the band's admins only.
--
-- Older app builds: they already hid quotes from members; now members simply
-- don't get those rows (events, their own lineup row, notifications), which
-- the app treats like a gig they are not on. No RPC they call changes shape.
-- Works with or without 175 / 181, in either order (checked with the real
-- 175 + 181 loaded: 175 -> 178 -> 181, 175 -> 181 -> 178 and main's
-- 175 -> 178 -> 193 -> 181). bw_chat_scope_ok and get_user_chats start from
-- 175's bodies (lineup and status rule, caller check, roster filter) and add
-- the quote rule; 175's final bw_chat_scope_ok (marker bw:175-r4) is kept
-- (it carries the quote rule via bw_is_event_participant), any other one is
-- replaced.
-- bw_is_event_participant keeps 181's off-the-gig statuses (declined,
-- dropped_out, removed). 175's BEFORE INSERT trigger already skips quote-chat
-- rows through bw_chat_scope_ok; 178's own trigger makes the same call
-- without 175 and also sets the history cutoff (cleared_at) after the
-- confirmation, which 175's does not.
-- Idempotent; safe to re-run on live data.
-- ============================================================================

BEGIN;

-- ── 1. Tables (server only: RLS on, no policies, no grants) ─────────────────
CREATE TABLE IF NOT EXISTS public.event_hold_answers (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answer text NOT NULL CHECK (answer IN ('free', 'busy')),
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
ALTER TABLE public.event_hold_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_hold_answers FROM PUBLIC, anon, authenticated;

-- Which holds the band was told about, and whether "free again" went out.
-- release_reason 'confirmed' + released_at: when the quote became a gig (the
-- cut-off of its chat history for members). No FK: the row must outlive the
-- event's delete trigger.
CREATE TABLE IF NOT EXISTS public.event_date_holds (
  event_id uuid PRIMARY KEY,
  band_id uuid NOT NULL,
  announced_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  release_reason text
);
ALTER TABLE public.event_date_holds ADD COLUMN IF NOT EXISTS answers_carried_at timestamptz;
-- First time the quote became a gig: kept when it goes back to a quote (the
-- 'confirmed' row is reset then), so a later cancel knows it was a gig.
ALTER TABLE public.event_date_holds ADD COLUMN IF NOT EXISTS confirmed_once_at timestamptz;
ALTER TABLE public.event_date_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_date_holds FROM PUBLIC, anon, authenticated;

-- Members' rows taken out of quote chats (for a rollback).
CREATE TABLE IF NOT EXISTS public.chat_participants_quote_178 (
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  row_data jsonb NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);
ALTER TABLE public.chat_participants_quote_178 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_participants_quote_178 FROM PUBLIC, anon, authenticated;

-- ── 2. Helpers ──────────────────────────────────────────────────────────────

-- Today for a hold: the date in the furthest-west zone (UTC-12), so a day is
-- over only once it is over for every band (see the header).
CREATE OR REPLACE FUNCTION public.bw_date_hold_today(p_at timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT (p_at AT TIME ZONE 'Etc/GMT+12')::date;
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_today(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_date_hold_today(timestamptz) TO authenticated;

-- A quote that never became a gig: still a quote (111), or cancelled while
-- it was one. A cancelled row is decided first (111 would call any cancelled
-- row with a quote_id a quote): it is private only if it was never a gig (no
-- confirmation recorded, and no quote_id: only "Create gig from quote" sets
-- one, on a confirmed gig) and it was held or tied to a quote that was never
-- accepted.
CREATE OR REPLACE FUNCTION public.bw_event_quote_private(p_event_id uuid, p_status text, p_event_type text, p_quote_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_event_type, '')) = 'rehearsal' THEN false
    WHEN lower(coalesce(p_status, '')) NOT IN ('cancelled', 'canceled') THEN
      public.bw_event_is_quote(p_status, p_event_type, p_quote_id)
    ELSE
      p_quote_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM event_date_holds h WHERE h.event_id = p_event_id
                        AND (h.release_reason = 'confirmed' OR h.confirmed_once_at IS NOT NULL))
      AND (
        EXISTS (SELECT 1 FROM event_date_holds h WHERE h.event_id = p_event_id)
        OR EXISTS (
          SELECT 1 FROM quotes q
           WHERE q.converted_to_event_id = p_event_id
             AND lower(coalesce(q.status::text, '')) <> 'accepted')
      )
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_event_quote_private(uuid, text, text, uuid) FROM PUBLIC, anon;
-- Policies call it (one boolean about an event id the caller already has).
GRANT EXECUTE ON FUNCTION public.bw_event_quote_private(uuid, text, text, uuid) TO authenticated;

-- Is this event a quote that p_user_id may not read? (A band quote event and
-- p_user_id is not an active admin of its band.) Asked about someone else by
-- a caller who doesn't run the band, the answer treats them as a member: it
-- never tells who the band's admins are, and stays "hidden" for a quote.
CREATE OR REPLACE FUNCTION public.bw_event_quote_hidden(p_event_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM events e
     WHERE e.id = p_event_id
       AND e.band_id IS NOT NULL
       AND public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id)
       AND NOT (public.bw_is_band_admin(e.band_id, p_user_id)
                AND (auth.uid() IS NULL OR auth.uid() = p_user_id OR public.bw_is_band_admin(e.band_id, auth.uid())))
  );
$$;
REVOKE ALL ON FUNCTION public.bw_event_quote_hidden(uuid, uuid) FROM PUBLIC, anon;
-- Policies call it (same exposure as bw_can_view_event).
GRANT EXECUTE ON FUNCTION public.bw_event_quote_hidden(uuid, uuid) TO authenticated;

-- The quote chats the caller may not read, among the chats they could reach:
-- ones they are in or made, and the event chats of their own bands. Never
-- the chats of other bands. One array per statement (no per-row lookups).
CREATE OR REPLACE FUNCTION public.bw_hidden_quote_chat_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(array_agg(c.id), '{}'::uuid[])
    FROM chats c
    JOIN events e ON e.id = c.event_id
   WHERE auth.uid() IS NOT NULL
     AND c.type::text = 'event'
     AND e.band_id IS NOT NULL
     AND (
       c.created_by = auth.uid()
       OR EXISTS (SELECT 1 FROM chat_participants cp WHERE cp.chat_id = c.id AND cp.user_id = auth.uid())
       OR public.bw_is_band_member(e.band_id, auth.uid())
     )
     AND public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id)
     AND NOT public.bw_is_band_admin(e.band_id, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.bw_hidden_quote_chat_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_hidden_quote_chat_ids() TO authenticated;

-- A setlist only a quote uses, for p_user_id who is not its band's admin.
-- Kept readable when a gig or rehearsal they can see uses it, or a template.
CREATE OR REPLACE FUNCTION public.bw_setlist_quote_hidden(p_setlist_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM setlists s
     WHERE s.id = p_setlist_id
       AND NOT coalesce(s.is_template, false)
       AND NOT public.bw_is_band_admin(s.band_id, p_user_id)
       AND EXISTS (
         SELECT 1 FROM events e
          WHERE e.setlist_id = s.id AND e.band_id IS NOT NULL
            AND public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id))
       AND NOT EXISTS (
         SELECT 1 FROM events e
          WHERE e.setlist_id = s.id
            AND NOT public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id))
  );
$$;
REVOKE ALL ON FUNCTION public.bw_setlist_quote_hidden(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_setlist_quote_hidden(uuid, uuid) TO authenticated;

-- Chats where the caller (not an admin) came back after the quote became a
-- gig: { chat id: confirmation time }. Older messages stay with the admins.
CREATE OR REPLACE FUNCTION public.bw_quote_chat_cutoffs()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_object_agg(c.id::text, h.released_at), '{}'::jsonb)
    FROM chats c
    JOIN events e ON e.id = c.event_id
    JOIN event_date_holds h ON h.event_id = e.id AND h.release_reason = 'confirmed' AND h.released_at IS NOT NULL
   WHERE auth.uid() IS NOT NULL
     AND c.type::text = 'event'
     AND e.band_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM chat_participants cp WHERE cp.chat_id = c.id AND cp.user_id = auth.uid())
     AND NOT public.bw_is_band_admin(e.band_id, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.bw_quote_chat_cutoffs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_chat_cutoffs() TO authenticated;

-- The event a notification is about: data.event_id, an event reference, or
-- the event of the chat it announces (chat notices carry only chat_id).
CREATE OR REPLACE FUNCTION public.bw_notification_event_id(p_data jsonb, p_reference_type text, p_reference_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event uuid;
  v_chat uuid;
BEGIN
  BEGIN
    v_event := nullif(coalesce(p_data ->> 'event_id', p_data ->> 'eventId'), '')::uuid;
  EXCEPTION WHEN others THEN v_event := NULL;
  END;
  IF v_event IS NULL AND p_reference_type = 'event' THEN v_event := p_reference_id; END IF;
  IF v_event IS NOT NULL THEN RETURN v_event; END IF;
  BEGIN
    v_chat := nullif(coalesce(p_data ->> 'chat_id', p_data ->> 'chatId'), '')::uuid;
  EXCEPTION WHEN others THEN v_chat := NULL;
  END;
  IF v_chat IS NULL AND p_reference_type = 'chat' THEN v_chat := p_reference_id; END IF;
  IF v_chat IS NULL THEN RETURN NULL; END IF;
  SELECT c.event_id INTO v_event FROM chats c WHERE c.id = v_chat AND c.type::text = 'event';
  RETURN v_event;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_notification_event_id(jsonb, text, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Quote events: admins only ────────────────────────────────────────────
DROP POLICY IF EXISTS events_select_policy ON public.events;
CREATE POLICY events_select_policy ON public.events
  FOR SELECT TO authenticated
  USING (
    band_id IS NOT NULL
    AND public.bw_is_band_member(band_id)
    AND (
      NOT public.bw_event_quote_private(id, status, event_type, quote_id)
      OR public.bw_is_band_admin(band_id)
    )
  );

CREATE OR REPLACE FUNCTION public.bw_can_view_event(p_event_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = p_event_id
      AND (
        (e.band_id IS NOT NULL
          AND public.bw_is_band_member(e.band_id, p_user_id)
          AND (
            NOT public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id)
            OR public.bw_is_band_admin(e.band_id, p_user_id)
          ))
        OR (e.band_id IS NULL AND e.created_by = p_user_id)
      )
  );
$$;

-- bw_is_on_event_lineup (111): any account could ask about anyone, so a
-- member learned who is on a private quote. Now a caller asks about
-- themselves unless they run the event's band (or it's the server); on a
-- private quote the answer is true only for the band's admins. Same
-- signature (111's events policy used it; 178's no longer does).
CREATE OR REPLACE FUNCTION public.bw_is_on_event_lineup(p_event_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM event_members em
      JOIN events e ON e.id = em.event_id
     WHERE em.event_id = p_event_id AND em.user_id = p_user_id
       AND (auth.uid() IS NULL OR auth.uid() = p_user_id
            OR (e.band_id IS NOT NULL AND public.bw_is_band_admin(e.band_id, auth.uid()))
            OR (e.band_id IS NULL AND e.created_by = auth.uid()))
       AND (e.band_id IS NULL
            OR NOT public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id)
            OR public.bw_is_band_admin(e.band_id, p_user_id))
  );
$$;
REVOKE ALL ON FUNCTION public.bw_is_on_event_lineup(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_is_on_event_lineup(uuid, uuid) TO authenticated;

-- A member is not a participant of a quote (chats, live pack).
CREATE OR REPLACE FUNCTION public.bw_is_event_participant(p_event_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = p_event_id
      AND NOT (
        e.band_id IS NOT NULL
        AND public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id)
        AND NOT public.bw_is_band_admin(e.band_id, p_user_id)
      )
      AND (
        e.created_by = p_user_id
        OR (e.band_id IS NOT NULL AND public.bw_is_band_admin(e.band_id, p_user_id))
        OR EXISTS (
          SELECT 1 FROM event_members em
          WHERE em.event_id = e.id AND em.user_id = p_user_id
            -- Off the gig like declined (046, 181): dropped out, removed.
            AND lower(btrim(COALESCE(em.status::text, ''))) NOT IN ('declined', 'dropped_out', 'removed')
        )
      )
  );
$$;

-- The member's own lineup row of a quote: not readable, not answerable.
DROP POLICY IF EXISTS event_members_select ON public.event_members;
CREATE POLICY event_members_select ON public.event_members
  FOR SELECT TO authenticated
  USING (
    (user_id = auth.uid() AND NOT public.bw_event_quote_hidden(event_id))
    OR public.bw_can_view_event(event_id)
  );

DROP POLICY IF EXISTS event_members_update_own ON public.event_members;
CREATE POLICY event_members_update_own ON public.event_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND NOT public.bw_event_quote_hidden(event_id))
  WITH CHECK (user_id = auth.uid() AND NOT public.bw_event_quote_hidden(event_id));

-- The musician fee of a quote is quote data.
CREATE OR REPLACE FUNCTION public.bw_event_member_money(p_event_ids uuid[] DEFAULT NULL)
RETURNS TABLE (event_id uuid, user_id uuid, fee numeric, paid_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT em.event_id, em.user_id, em.fee::numeric, em.paid_at
  FROM event_members em
  WHERE auth.uid() IS NOT NULL
    AND NOT public.bw_event_quote_hidden(em.event_id)
    AND (
      (p_event_ids IS NULL AND em.user_id = auth.uid())
      OR (
        p_event_ids IS NOT NULL
        AND em.event_id = ANY (p_event_ids)
        AND (em.user_id = auth.uid() OR public.bw_can_manage_event(em.event_id))
      )
    );
$$;

-- quote_musicians (073): a member read their own row of any quote, fee
-- included. Now only once the quote's event is a confirmed gig; before that
-- the quote's admins only (quote_musicians_admin, unchanged).
CREATE OR REPLACE FUNCTION public.bw_quote_musician_row_visible(p_quote_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM quotes q
    JOIN events e ON e.id = q.converted_to_event_id
     WHERE q.id = p_quote_id
       AND lower(coalesce(e.status, '')) IN ('confirmed', 'completed')
       AND NOT public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id)
  );
$$;
REVOKE ALL ON FUNCTION public.bw_quote_musician_row_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_musician_row_visible(uuid) TO authenticated;

DROP POLICY IF EXISTS "Band members can view quote musicians" ON public.quote_musicians;
CREATE POLICY "Band members can view quote musicians" ON public.quote_musicians
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.bw_quote_musician_row_visible(quote_id));

-- Rider status (093), stage plot (092), gig kits (094).
CREATE OR REPLACE FUNCTION public.bw_event_rider(p_event_id uuid)
RETURNS TABLE (id uuid, title text, version integer, status text, sent_at timestamptz, viewed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.title::text, c.version, c.status::text, c.sent_at, c.viewed_at
    FROM public.contracts c
   WHERE c.event_id = p_event_id
     AND c.type::text = 'rider'
     AND auth.uid() IS NOT NULL
     AND public.bw_is_band_member(c.band_id)
     AND NOT public.bw_event_quote_hidden(p_event_id)
   ORDER BY c.version DESC, c.created_at DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.bw_event_rider(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_event_rider(uuid) TO authenticated;

DROP POLICY IF EXISTS event_stage_select ON public.event_stage;
CREATE POLICY event_stage_select ON public.event_stage
  FOR SELECT TO authenticated
  USING (public.bw_is_band_member(band_id) AND NOT public.bw_event_quote_hidden(event_id));

DROP POLICY IF EXISTS "Band members can view gig kits" ON public.event_gear_kits;
CREATE POLICY "Band members can view gig kits" ON public.event_gear_kits
  FOR SELECT TO authenticated
  USING (public.bw_is_band_member(band_id) AND NOT public.bw_event_quote_hidden(event_id));

-- Setlists of a quote (owner, 2026-11-22): its name can carry the client's.
-- RESTRICTIVE: ANDed with 074's read policies.
DROP POLICY IF EXISTS setlists_quote_admins_only ON public.setlists;
CREATE POLICY setlists_quote_admins_only ON public.setlists
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.bw_setlist_quote_hidden(id));

DROP POLICY IF EXISTS setlist_songs_quote_admins_only ON public.setlist_songs;
CREATE POLICY setlist_songs_quote_admins_only ON public.setlist_songs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.bw_setlist_quote_hidden(setlist_id));

-- Song proposals of a quote event: admins only while it is one.
DROP POLICY IF EXISTS song_proposals_quote_admins_only ON public.song_proposals;
CREATE POLICY song_proposals_quote_admins_only ON public.song_proposals
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (event_id IS NULL OR NOT public.bw_event_quote_hidden(event_id))
  WITH CHECK (event_id IS NULL OR NOT public.bw_event_quote_hidden(event_id));

-- Live stage (085, 087): no key and no channel for a quote's members.
CREATE OR REPLACE FUNCTION public.bw_stage_key(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  band uuid;
  k text;
BEGIN
  IF auth.uid() IS NULL OR p_event_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT e.band_id INTO band FROM public.events e WHERE e.id = p_event_id;
  IF band IS NULL OR NOT public.bw_is_band_member(band) OR public.bw_event_quote_hidden(p_event_id) THEN
    RETURN NULL;
  END IF;
  SELECT s.key INTO k FROM public.stage_keys s WHERE s.event_id = p_event_id;
  IF k IS NULL THEN
    -- Two v4 UUIDs: 244 random bits, no extension needed.
    INSERT INTO public.stage_keys (event_id, key)
    VALUES (
      p_event_id,
      encode(
        decode(replace(gen_random_uuid()::text, '-', ''), 'hex') || decode(replace(gen_random_uuid()::text, '-', ''), 'hex'),
        'base64'
      )
    )
    ON CONFLICT (event_id) DO NOTHING;
    SELECT s.key INTO k FROM public.stage_keys s WHERE s.event_id = p_event_id;
  END IF;
  RETURN k;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bw_stage_key(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_stage_key(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bw_stage_topic_allowed(p_topic text, p_lead boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ev text;
  band uuid;
BEGIN
  IF auth.uid() IS NULL OR p_topic IS NULL THEN
    RETURN false;
  END IF;
  ev := substring(p_topic FROM '^stage:event:([0-9a-fA-F-]{36})$');
  IF ev IS NULL THEN
    RETURN false;
  END IF;
  SELECT e.band_id INTO band FROM public.events e WHERE e.id = ev::uuid;
  IF band IS NULL THEN
    RETURN false;
  END IF;
  IF p_lead THEN
    RETURN public.bw_is_band_admin(band);
  END IF;
  RETURN public.bw_is_band_member(band) AND NOT public.bw_event_quote_hidden(ev::uuid);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bw_stage_topic_allowed(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_stage_topic_allowed(text, boolean) TO authenticated;

-- Offline live pack (170): never for a quote (not even the admin's: it is
-- not a gig yet).
CREATE OR REPLACE FUNCTION public.bw_live_pack_window_events(p_event_id uuid DEFAULT NULL)
RETURNS TABLE (event_id uuid, band_id uuid, event_date date, is_rehearsal boolean, place text, songs int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.band_id, coalesce(e.event_date, e.date),
         coalesce(e.event_type, '') = 'rehearsal',
         coalesce(nullif(btrim(e.venue_name), ''), nullif(btrim(e.venue), ''), nullif(btrim(e.title), ''), ''),
         (SELECT count(*)::int FROM public.setlist_songs ss WHERE ss.setlist_id = e.setlist_id)
    FROM public.events e
   WHERE e.band_id IS NOT NULL
     AND e.setlist_id IS NOT NULL
     AND coalesce(e.status, '') NOT IN ('cancelled', 'canceled')
     AND NOT public.bw_event_is_quote(e.status, e.event_type, e.quote_id)
     AND coalesce(e.event_date, e.date) BETWEEN current_date AND current_date + 7
     AND (p_event_id IS NULL OR e.id = p_event_id)
     AND EXISTS (SELECT 1 FROM public.setlist_songs ss WHERE ss.setlist_id = e.setlist_id);
$$;
REVOKE ALL ON FUNCTION public.bw_live_pack_window_events(uuid) FROM PUBLIC, anon, authenticated;

-- No new deputy for a quote (084/086: bw_deputy_request_open is the only
-- way in). Deputies asked before keep their own request.
CREATE OR REPLACE FUNCTION public.bw_trg_deputy_request_quote_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM events e WHERE e.id = NEW.event_id
              AND public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id)) THEN
    RAISE EXCEPTION 'This gig is still a quote: ask a deputy once it is confirmed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_deputy_request_quote_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_deputy_request_quote_guard ON public.deputy_requests;
CREATE TRIGGER bw_deputy_request_quote_guard
  BEFORE INSERT ON public.deputy_requests
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_deputy_request_quote_guard();

-- A gig back to a quote: deputies asked before get nothing more about it
-- while it is one. 086's "open" (an existing request is updated and its
-- link handed out again) and "Ask in the app" refuse; deputy pushes are
-- dropped (section 10). The reply page and the deputy calendar read the
-- event themselves (084, and 182 in #285): bw_event_deputy_hidden is the
-- check for them.
CREATE OR REPLACE FUNCTION public.bw_event_deputy_hidden(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.band_id IS NOT NULL
                   AND public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id));
$$;
REVOKE ALL ON FUNCTION public.bw_event_deputy_hidden(uuid) FROM PUBLIC, anon, authenticated;

-- 086's body; refused while the gig is a quote.
CREATE OR REPLACE FUNCTION public.bw_deputy_request_open(
  p_event_id uuid,
  p_deputy_id uuid,
  p_replaces_user_id uuid DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_fee numeric DEFAULT NULL
)
RETURNS TABLE (id uuid, token text, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid;
  v_currency text;
  v_name text;
  v_row public.deputy_requests;
BEGIN
  SELECT e.band_id, e.currency INTO v_band, v_currency FROM public.events e WHERE e.id = p_event_id;
  IF v_band IS NULL OR NOT public.bw_is_band_admin(v_band) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.bw_event_deputy_hidden(p_event_id) THEN
    RAISE EXCEPTION 'This gig is still a quote: ask a deputy once it is confirmed' USING ERRCODE = '42501';
  END IF;
  SELECT d.name INTO v_name FROM public.band_deputies d WHERE d.id = p_deputy_id AND d.band_id = v_band;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Deputy not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT r.* INTO v_row FROM public.deputy_requests r
   WHERE r.event_id = p_event_id AND r.deputy_id = p_deputy_id AND r.status <> 'cancelled'
   ORDER BY r.created_at DESC LIMIT 1;

  IF v_row.id IS NULL THEN
    INSERT INTO public.deputy_requests (band_id, event_id, deputy_id, deputy_name, replaces_user_id, role, fee_offered, currency, created_by)
    VALUES (v_band, p_event_id, p_deputy_id, v_name, p_replaces_user_id, nullif(left(btrim(coalesce(p_role, '')), 120), ''),
            CASE WHEN p_fee >= 0 THEN p_fee END, left(v_currency, 8), auth.uid())
    RETURNING * INTO v_row;
    PERFORM public.bw_deputy_notify(v_row.id, 'request');
  ELSE
    UPDATE public.deputy_requests r
       SET deputy_name = v_name,
           replaces_user_id = coalesce(p_replaces_user_id, r.replaces_user_id),
           role = coalesce(nullif(left(btrim(coalesce(p_role, '')), 120), ''), r.role),
           fee_offered = CASE WHEN p_fee >= 0 THEN p_fee ELSE r.fee_offered END,
           updated_at = now()
     WHERE r.id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  RETURN QUERY SELECT v_row.id, v_row.token, v_row.status;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_deputy_request_open(uuid, uuid, uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_deputy_request_open(uuid, uuid, uuid, text, numeric) TO authenticated;

-- 086's body; 'closed' while the gig is a quote (same answers as before).
CREATE OR REPLACE FUNCTION public.bw_deputy_request_ping(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.deputy_requests;
  v_view jsonb;
  v_linked boolean;
  v_changes text[];
  v_kind text;
BEGIN
  SELECT * INTO v_req FROM public.deputy_requests WHERE id = p_request_id;
  IF v_req.id IS NULL OR NOT public.bw_is_band_admin(v_req.band_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.bw_event_deputy_hidden(v_req.event_id) THEN RETURN 'closed'; END IF;
  SELECT d.user_id IS NOT NULL INTO v_linked FROM public.band_deputies d WHERE d.id = v_req.deputy_id;
  IF NOT coalesce(v_linked, false) THEN RETURN 'not_linked'; END IF;
  v_view := public.bw_deputy_request_view(v_req.token);
  IF v_view IS NULL OR (v_view->>'closed')::boolean THEN RETURN 'closed'; END IF;
  SELECT coalesce(array_agg(x), '{}') INTO v_changes FROM jsonb_array_elements_text(coalesce(v_view->'changes', '[]'::jsonb)) x;
  v_kind := CASE
    WHEN v_req.status IN ('available', 'maybe') AND cardinality(v_changes) > 0 THEN 'changed'
    WHEN v_req.status = 'available' THEN 'recap'
    ELSE 'request' END;
  IF public.bw_deputy_notify(v_req.id, v_kind, CASE WHEN v_kind = 'changed' THEN v_changes END) > 0 THEN
    RETURN 'sent';
  END IF;
  RETURN 'throttled';
END;
$$;
REVOKE ALL ON FUNCTION public.bw_deputy_request_ping(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_deputy_request_ping(uuid) TO authenticated;

-- ── 4. The event chat of a quote ────────────────────────────────────────────
-- RESTRICTIVE: ANDed with whatever read policies these tables have (073 or
-- 175), so the rule holds in either order. The list is worked out once per
-- statement (uncorrelated subquery), not once per row.
DROP POLICY IF EXISTS chats_quote_admins_only ON public.chats;
CREATE POLICY chats_quote_admins_only ON public.chats
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (id NOT IN (SELECT unnest(public.bw_hidden_quote_chat_ids())));

DROP POLICY IF EXISTS messages_quote_admins_only ON public.messages;
CREATE POLICY messages_quote_admins_only ON public.messages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (chat_id NOT IN (SELECT unnest(public.bw_hidden_quote_chat_ids())));

DROP POLICY IF EXISTS messages_quote_admins_only_insert ON public.messages;
CREATE POLICY messages_quote_admins_only_insert ON public.messages
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (chat_id NOT IN (SELECT unnest(public.bw_hidden_quote_chat_ids())));

-- Back in the chat once it's a gig: messages from before the confirmation
-- stay with the admins.
DROP POLICY IF EXISTS messages_quote_history_admins_only ON public.messages;
CREATE POLICY messages_quote_history_admins_only ON public.messages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (coalesce(
    created_at >= (((SELECT public.bw_quote_chat_cutoffs()) ->> chat_id::text)::timestamptz),
    true));

DROP POLICY IF EXISTS chat_participants_quote_admins_only ON public.chat_participants;
CREATE POLICY chat_participants_quote_admins_only ON public.chat_participants
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (chat_id NOT IN (SELECT unnest(public.bw_hidden_quote_chat_ids())));

-- Joining a quote chat: a member's row is dropped silently (older admin
-- builds add the whole lineup in one insert; the admin's own row must still
-- save). With 175 its bw_chat_participant_scope trigger (same rule, through
-- bw_chat_scope_ok) fires first and this one agrees; without 175 this is
-- the only guard. Joining a former quote chat: the history before the confirmation is
-- cleared for members (cleared_at), whoever adds them.
CREATE OR REPLACE FUNCTION public.bw_trg_chat_participant_quote_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event uuid;
  v_band uuid;
  v_cut timestamptz;
BEGIN
  SELECT c.event_id INTO v_event FROM chats c WHERE c.id = NEW.chat_id AND c.type::text = 'event';
  IF v_event IS NULL THEN RETURN NEW; END IF;
  IF public.bw_event_quote_hidden(v_event, NEW.user_id) THEN
    RETURN NULL;
  END IF;
  SELECT e.band_id, h.released_at INTO v_band, v_cut
    FROM events e JOIN event_date_holds h ON h.event_id = e.id AND h.release_reason = 'confirmed'
   WHERE e.id = v_event;
  IF v_cut IS NOT NULL AND v_band IS NOT NULL AND NOT public.bw_is_band_admin(v_band, NEW.user_id) THEN
    NEW.cleared_at := greatest(coalesce(NEW.cleared_at, v_cut), v_cut);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_chat_participant_quote_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_chat_participants_00_quote_guard ON public.chat_participants;
CREATE TRIGGER bw_chat_participants_00_quote_guard
  BEFORE INSERT ON public.chat_participants
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_chat_participant_quote_guard();

-- Members out of a quote's chat (rows archived). p_event_id NULL: every
-- quote chat (the one-off cleanup below).
CREATE OR REPLACE FUNCTION public.bw_quote_chat_prune(p_event_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH gone AS (
    SELECT cp.chat_id, cp.user_id, to_jsonb(cp) AS row_data
      FROM chat_participants cp
      JOIN chats c ON c.id = cp.chat_id
     WHERE c.type::text = 'event'
       AND c.event_id IS NOT NULL
       AND (p_event_id IS NULL OR c.event_id = p_event_id)
       AND public.bw_event_quote_hidden(c.event_id, cp.user_id)
  ), saved AS (
    INSERT INTO chat_participants_quote_178 (chat_id, user_id, row_data)
    SELECT g.chat_id, g.user_id, g.row_data FROM gone g
     WHERE EXISTS (SELECT 1 FROM profiles p WHERE p.id = g.user_id)
    ON CONFLICT (chat_id, user_id) DO UPDATE SET row_data = EXCLUDED.row_data, removed_at = now()
  )
  DELETE FROM chat_participants cp
   USING gone g
   WHERE cp.chat_id = g.chat_id AND cp.user_id = g.user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_chat_prune(uuid) FROM PUBLIC, anon, authenticated;

SELECT public.bw_quote_chat_prune(NULL);

-- The quote became a gig: the cut-off time is kept (event_date_holds) and its
-- lineup goes back in its chat, history cleared up to now (181 may have taken
-- them out too; either order ends here).
CREATE OR REPLACE FUNCTION public.bw_quote_event_confirmed(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_band uuid;
BEGIN
  SELECT e.band_id INTO v_band FROM events e WHERE e.id = p_event_id;
  IF v_band IS NULL THEN RETURN; END IF;
  INSERT INTO event_date_holds (event_id, band_id, announced_at, released_at, release_reason, confirmed_once_at)
  VALUES (p_event_id, v_band, now(), now(), 'confirmed', now())
  ON CONFLICT (event_id) DO UPDATE
    SET released_at = CASE WHEN event_date_holds.release_reason = 'confirmed' AND event_date_holds.released_at IS NOT NULL
                           THEN event_date_holds.released_at ELSE now() END,
        release_reason = 'confirmed',
        confirmed_once_at = coalesce(event_date_holds.confirmed_once_at, now());
  INSERT INTO chat_participants (chat_id, user_id, joined_at, cleared_at)
  SELECT DISTINCT c.id, em.user_id, now(), now()
    FROM chats c
    JOIN event_members em ON em.event_id = c.event_id
   WHERE c.type::text = 'event' AND c.event_id = p_event_id
     AND em.user_id IS NOT NULL
     AND lower(btrim(coalesce(em.status::text, 'invited'))) NOT IN ('declined', 'dropped_out', 'removed')
     AND public.bw_is_band_member(v_band, em.user_id)
     AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = em.user_id)
     AND NOT EXISTS (SELECT 1 FROM chat_participants cp WHERE cp.chat_id = c.id AND cp.user_id = em.user_id);
  DELETE FROM chat_participants_quote_178 a
   USING chats c
   WHERE a.chat_id = c.id AND c.type::text = 'event' AND c.event_id = p_event_id;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_event_confirmed(uuid) FROM PUBLIC, anon, authenticated;

-- bw_chat_scope_ok: 175's body (round 4: 'group' = band, the lineup rule
-- through bw_is_event_participant, declined / dropped out / removed off the
-- gig unless they run it, never "yes" by default, and asked about someone
-- else it also checks the caller), plus the quote rule: the event chat of a
-- quote is for the band's admins only. Used by bw_my_chat_ids, the chats
-- read policies, get_user_chats (chats and roster) and bw_chat_recipient_ids
-- (send-push).
-- When 175's final definition is live (its body carries the marker
-- bw:175-r4), keep it: it calls bw_is_event_participant, which carries the
-- quote rule since this migration, and 175 writes the quote rule in itself
-- when it runs after 178. Any other definition is replaced by this one,
-- which does not carry the marker (only 175's does).
DO $do$
BEGIN
  IF to_regprocedure('public.bw_chat_scope_ok(text, uuid, uuid, uuid)') IS NOT NULL
     AND pg_get_functiondef(to_regprocedure('public.bw_chat_scope_ok(text, uuid, uuid, uuid)')) LIKE '%bw:175-r4%' THEN
    RETURN;
  END IF;
  EXECUTE $sql$
CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $f$
  -- Everyone asked about must pass: p_user_id, and the caller as well when
  -- the caller asks about someone else (175 round 4).
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
                     AND lower(coalesce(em.status::text, '')) IN ('declined', 'dropped_out', 'removed')))
           AND NOT public.bw_event_quote_hidden(e.id, w.u))
    ELSE true
  END, false));
$f$;
  $sql$;
END
$do$;
REVOKE ALL ON FUNCTION public.bw_chat_scope_ok(text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_scope_ok(text, uuid, uuid, uuid) TO authenticated;

-- The chat list: 175's body (chats from bw_my_chat_ids, the roster
-- filtered by bw_chat_scope_ok, so rows the rule refuses are left out), plus
-- quote chats only for admins. Without 175, bw_my_chat_ids is 073's
-- (participants) and bw_chat_scope_ok is the one defined above.
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
          -- 175 round 3: the roster leaves out rows the rule refuses too
          AND public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, cp.user_id)
      )
    )
    ORDER BY c.updated_at DESC NULLS LAST
  ) INTO result
  FROM chats c
  WHERE c.id = ANY (public.bw_my_chat_ids())
    AND NOT (c.id = ANY (public.bw_hidden_quote_chat_ids()));

  RETURN COALESCE(result, '[]'::JSONB);
END;
$$;
REVOKE ALL ON FUNCTION public.get_user_chats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_chats(uuid) TO authenticated;

-- send-push (_shared/auth.ts chatRecipients): of these people, who may get a
-- message of this chat (the quote rule, per recipient). Server only.
CREATE OR REPLACE FUNCTION public.bw_chat_push_readers(p_chat_id uuid, p_user_ids uuid[])
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(array_agg(DISTINCT u), '{}'::uuid[])
    FROM unnest(coalesce(p_user_ids, '{}'::uuid[])) u
   WHERE u IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM chats c
        WHERE c.id = p_chat_id AND c.type::text = 'event' AND c.event_id IS NOT NULL
          AND public.bw_event_quote_hidden(c.event_id, u));
$$;
REVOKE ALL ON FUNCTION public.bw_chat_push_readers(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_chat_push_readers(uuid, uuid[]) TO service_role;

-- ── 5. Is the hold live? ────────────────────────────────────────────────────
-- A quote event, not cancelled, its day not over for the band
-- (bw_date_hold_today), whose quote (if any) is not settled against it:
-- declined, expired (valid_until more than a day past while out with the
-- client, as src/lib/quoteExpiry.ts), archived, or declined on the link.
CREATE OR REPLACE FUNCTION public.bw_date_hold_live(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM events e
     WHERE e.id = p_event_id
       AND e.band_id IS NOT NULL
       AND public.bw_event_is_quote(e.status, e.event_type, e.quote_id)
       AND lower(coalesce(e.status, '')) NOT IN ('cancelled', 'canceled', 'draft')
       AND coalesce(e.event_date, e.date) >= public.bw_date_hold_today()
       AND NOT EXISTS (
         SELECT 1 FROM quotes q
          WHERE q.band_id = e.band_id
            AND (q.id = e.quote_id OR q.converted_to_event_id = e.id)
            AND (
              lower(q.status::text) IN ('declined', 'rejected', 'expired', 'archived', 'cancelled')
              OR (lower(q.status::text) IN ('sent', 'viewed', 'negotiating')
                  AND q.valid_until IS NOT NULL AND q.valid_until::date + 1 < public.bw_date_hold_today())
              OR EXISTS (SELECT 1 FROM quote_links l WHERE l.quote_id = q.id AND l.status = 'declined')
            )
       )
  );
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_live(uuid) FROM PUBLIC, anon, authenticated;

-- May the hold be announced yet? Its quote is saved with its musicians (the
-- app writes the quote, then its musicians, and deletes both if the second
-- write fails), or the quote has been there a minute (no musicians), or (a
-- tentative event with no quote, e.g. from Create event) the event has been
-- there 2 minutes. The wizard saves the event first and deletes it if the
-- quote fails. The sweep announces what the triggers leave.
CREATE OR REPLACE FUNCTION public.bw_date_hold_ready(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM events e
     WHERE e.id = p_event_id
       AND (
         EXISTS (SELECT 1 FROM quotes q
                  WHERE q.band_id = e.band_id AND (q.id = e.quote_id OR q.converted_to_event_id = e.id)
                    AND (EXISTS (SELECT 1 FROM quote_musicians qm WHERE qm.quote_id = q.id)
                         OR coalesce((to_jsonb(q) ->> 'created_at')::timestamptz, now()) < now() - interval '1 minute'))
         OR coalesce(e.created_at, now()) < now() - interval '2 minutes'
       )
  );
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_ready(uuid) FROM PUBLIC, anon, authenticated;

-- ── 6. Stats and free slots: confirmed gigs only ────────────────────────────
-- 083, with quote lineup rows left out (a pending answer to a quote is not a
-- pending gig, and "declined" a quote is not a declined gig).
CREATE OR REPLACE FUNCTION public.bw_member_stats(
  p_band_id uuid,
  p_from date,
  p_to date,
  p_today date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  user_id uuid,
  is_active boolean,
  gigs_played integer,
  gigs_upcoming integer,
  rehearsals integer,
  declined integer,
  pending integer,
  earned numeric,
  paid numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ev AS (
    SELECT e.id,
           e.event_date,
           (lower(coalesce(e.event_type, '')) = 'rehearsal') AS is_rehearsal,
           lower(coalesce(e.status, '')) AS ev_status
    FROM events e
    WHERE e.band_id = p_band_id
      AND e.event_date BETWEEN p_from AND p_to
      AND NOT public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id)
  ),
  mine AS (
    SELECT em.user_id,
           lower(btrim(coalesce(em.status::text, ''))) AS answer,
           em.fee,
           em.paid_at,
           ev.event_date,
           ev.is_rehearsal,
           ev.ev_status
    FROM event_members em
    JOIN ev ON ev.id = em.event_id
  ),
  marked AS (
    SELECT m.*,
           (NOT m.is_rehearsal AND m.ev_status IN ('confirmed', 'completed') AND m.answer = 'confirmed') AS booked_gig,
           (m.ev_status IN ('cancelled', 'canceled')) AS cancelled
    FROM mine m
  )
  SELECT bm.user_id,
         coalesce(bool_or(coalesce(bm.is_active, true)), true) AS is_active,
         count(*) FILTER (WHERE r.booked_gig AND r.event_date < p_today)::int AS gigs_played,
         count(*) FILTER (WHERE r.booked_gig AND r.event_date >= p_today)::int AS gigs_upcoming,
         count(*) FILTER (WHERE r.is_rehearsal AND NOT r.cancelled AND r.answer = 'confirmed' AND r.event_date < p_today)::int AS rehearsals,
         count(*) FILTER (WHERE r.answer = 'declined')::int AS declined,
         count(*) FILTER (WHERE r.answer = 'pending' AND NOT r.cancelled AND r.event_date >= p_today)::int AS pending,
         coalesce(sum(r.fee) FILTER (WHERE r.booked_gig AND r.event_date < p_today), 0)::numeric AS earned,
         coalesce(sum(r.fee) FILTER (WHERE r.booked_gig AND r.event_date < p_today AND r.paid_at IS NOT NULL), 0)::numeric AS paid
  FROM band_members bm
  LEFT JOIN marked r ON r.user_id = bm.user_id
  WHERE auth.uid() IS NOT NULL
    AND bm.band_id = p_band_id
    AND bm.user_id IS NOT NULL
    AND (
      public.bw_is_band_admin(p_band_id, auth.uid())
      OR (bm.user_id = auth.uid() AND public.bw_is_band_member(p_band_id, auth.uid()))
    )
  GROUP BY bm.user_id;
$$;
REVOKE ALL ON FUNCTION public.bw_member_stats(uuid, date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_member_stats(uuid, date, date, date) TO authenticated;

-- 095, the free-slot heatmap of the date pickers (gig, rehearsal and quote
-- composers: pick a day the band is free, i.e. don't double-book). A quote's
-- own lineup rows no longer make anyone busy; a live hold (below) makes the
-- whole band busy in its window instead: every member is asked to keep that
-- date free. Counts only, as before.
CREATE OR REPLACE FUNCTION public.bw_band_free_slots(
  p_band_id uuid,
  p_from date,
  p_to date,
  p_start time DEFAULT NULL,
  p_end time DEFAULT NULL,
  p_slot_minutes integer DEFAULT NULL,
  p_exclude_event uuid DEFAULT NULL
)
RETURNS TABLE (
  day date,
  slot_start time,
  free_count integer,
  total_count integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH allowed AS (
    SELECT auth.uid() IS NOT NULL
       AND public.bw_is_band_member(p_band_id, auth.uid())
       AND p_from IS NOT NULL AND p_to IS NOT NULL
       AND p_to >= p_from
       AND p_to - p_from <= 62 AS ok
  ),
  members AS (
    SELECT DISTINCT bm.user_id
    FROM band_members bm, allowed a
    WHERE a.ok
      AND bm.band_id = p_band_id
      AND bm.user_id IS NOT NULL
      AND coalesce(bm.is_active, true)
      AND bm.left_at IS NULL
  ),
  days AS (
    SELECT d::date AS day
    FROM allowed a, generate_series(p_from, p_to, interval '1 day') d
    WHERE a.ok
  ),
  win AS (
    SELECT
      (extract(epoch FROM p_start) / 60)::int AS ws,
      CASE
        WHEN p_end IS NULL THEN NULL
        WHEN p_end <= p_start THEN (extract(epoch FROM p_end) / 60)::int + 1440
        ELSE (extract(epoch FROM p_end) / 60)::int
      END AS we
  ),
  slots AS (
    -- One row per day (whole window) or per slot inside the window.
    SELECT d.day,
           CASE WHEN w.ws IS NOT NULL AND w.we IS NOT NULL AND coalesce(p_slot_minutes, 0) >= 15
                THEN s.m ELSE w.ws END AS s_from,
           CASE WHEN w.ws IS NOT NULL AND w.we IS NOT NULL AND coalesce(p_slot_minutes, 0) >= 15
                THEN least(s.m + p_slot_minutes, w.we) ELSE w.we END AS s_to
    FROM days d
    CROSS JOIN win w
    CROSS JOIN LATERAL (
      SELECT generate_series(w.ws, w.we - 1, greatest(coalesce(p_slot_minutes, 0), 15)) AS m
      WHERE w.ws IS NOT NULL AND w.we IS NOT NULL AND coalesce(p_slot_minutes, 0) >= 15
      UNION ALL
      SELECT NULL::int
      WHERE NOT (w.ws IS NOT NULL AND w.we IS NOT NULL AND coalesce(p_slot_minutes, 0) >= 15)
    ) s
  ),
  busy_pairs AS (
    -- On the lineup of a gig or rehearsal (not a quote), or their own
    -- personal event.
    SELECT m.user_id, e.id AS event_id
      FROM members m
      JOIN events e
        ON e.event_date BETWEEN p_from AND p_to
       AND (p_exclude_event IS NULL OR e.id <> p_exclude_event)
       AND lower(coalesce(e.status, '')) NOT IN ('cancelled', 'canceled', 'quote', 'quoted')
       AND NOT (coalesce(e.recurrence_rule -> 'skip_dates', '[]'::jsonb) ? to_char(e.event_date, 'YYYY-MM-DD'))
       AND (e.band_id IS NULL OR NOT public.bw_event_is_quote(e.status, e.event_type, e.quote_id))
       AND (
         EXISTS (
           SELECT 1 FROM event_members em
           WHERE em.event_id = e.id
             AND em.user_id = m.user_id
             AND lower(btrim(coalesce(em.status::text, ''))) NOT IN ('declined', 'dropped_out', 'removed')
         )
         OR (e.band_id IS NULL AND e.created_by = m.user_id)
       )
    UNION
    -- A date on hold in one of their bands (178): kept free for a possible gig.
    SELECT m.user_id, e.id
      FROM members m
      JOIN band_members hb
        ON hb.user_id = m.user_id AND coalesce(hb.is_active, true) AND hb.left_at IS NULL
      JOIN events e
        ON e.band_id = hb.band_id
       AND coalesce(e.event_date, e.date) BETWEEN p_from AND p_to
       AND (p_exclude_event IS NULL OR e.id <> p_exclude_event)
       AND public.bw_event_is_quote(e.status, e.event_type, e.quote_id)
       AND NOT (coalesce(e.recurrence_rule -> 'skip_dates', '[]'::jsonb) ? to_char(e.event_date, 'YYYY-MM-DD'))
       AND public.bw_date_hold_live(e.id)
  ),
  busy_events AS (
    -- Every commitment of every member in the range, with its time span in minutes.
    SELECT x.user_id, x.event_date, x.e_from,
           CASE
             WHEN x.e_from IS NULL THEN NULL
             WHEN x.e_to IS NULL THEN x.e_from + 180
             WHEN x.e_to <= x.e_from THEN x.e_to + 1440
             ELSE x.e_to
           END AS e_to
    FROM (
      SELECT p.user_id,
             coalesce(e.event_date, e.date) AS event_date,
             (extract(epoch FROM coalesce(e.start_time, e."time")) / 60)::int AS e_from,
             coalesce(
               (extract(epoch FROM e.end_time) / 60)::int,
               CASE WHEN e.duration_hours IS NOT NULL AND coalesce(e.start_time, e."time") IS NOT NULL
                    THEN (extract(epoch FROM coalesce(e.start_time, e."time")) / 60)::int + (e.duration_hours * 60)::int
               END
             ) AS e_to
      FROM busy_pairs p
      JOIN events e ON e.id = p.event_id
    ) x
  ),
  busy AS (
    SELECT DISTINCT s.day, s.s_from, b.user_id
    FROM slots s
    JOIN busy_events b ON b.event_date = s.day
    WHERE s.s_from IS NULL
       OR b.e_from IS NULL
       OR (b.e_from < s.s_to AND s.s_from < b.e_to)
  )
  SELECT s.day,
         CASE WHEN s.s_from IS NULL THEN NULL
              ELSE make_time(((s.s_from / 60) % 24)::int, (s.s_from % 60)::int, 0) END AS slot_start,
         ((SELECT count(*) FROM members)
           - (SELECT count(*) FROM busy b WHERE b.day = s.day AND b.s_from IS NOT DISTINCT FROM s.s_from))::int AS free_count,
         (SELECT count(*) FROM members)::int AS total_count
  FROM slots s
  ORDER BY s.day, s.s_from NULLS FIRST;
$$;

-- ── 7. Texts (reader's language; no title, client, fee or notes) ────────────
CREATE OR REPLACE FUNCTION public.bw_date_hold_text(p_key text, p_lang text, p_vars jsonb DEFAULT '{}'::jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text;
  k text;
BEGIN
  v := (CASE p_key
    WHEN 'hold.title' THEN '{"en":"Possible gig – keep the date free","it":"Possibile gig – tieni libera la data","es":"Posible concierto – reserva la fecha","fr":"Concert possible – garde la date libre","de":"Möglicher Gig – halte dir den Termin frei","pt":"Possível show – deixe a data livre"}'
    WHEN 'hold.body' THEN '{"en":"{details}. Are you free?","it":"{details}. Sei disponibile?","es":"{details}. ¿Estás disponible?","fr":"{details}. Tu es disponible ?","de":"{details}. Hast du Zeit?","pt":"{details}. Você está livre?"}'
    WHEN 'changed.title' THEN '{"en":"Possible gig – new details","it":"Possibile gig – nuovi dettagli","es":"Posible concierto – nuevos detalles","fr":"Concert possible – nouveaux détails","de":"Möglicher Gig – neue Details","pt":"Possível show – novos detalhes"}'
    WHEN 'changed.body' THEN '{"en":"Now {details}. Still free?","it":"Ora: {details}. Sei ancora disponibile?","es":"Ahora: {details}. ¿Sigues disponible?","fr":"Maintenant : {details}. Toujours disponible ?","de":"Jetzt: {details}. Hast du noch Zeit?","pt":"Agora: {details}. Ainda está livre?"}'
    WHEN 'released.title' THEN '{"en":"The date is free again","it":"La data è di nuovo libera","es":"La fecha vuelve a estar libre","fr":"La date est de nouveau libre","de":"Der Termin ist wieder frei","pt":"A data está livre de novo"}'
    WHEN 'released.body' THEN '{"en":"{day}: no need to keep it free any more.","it":"{day}: non serve più tenerla libera.","es":"{day}: ya no hace falta reservarla.","fr":"{day} : plus besoin de la garder libre.","de":"{day}: Du musst ihn nicht mehr freihalten.","pt":"{day}: não precisa mais deixar livre."}'
  END)::jsonb ->> coalesce(p_lang, 'en');
  IF v IS NULL THEN
    v := (CASE p_key
      WHEN 'hold.title' THEN 'Possible gig – keep the date free'
      WHEN 'hold.body' THEN '{details}. Are you free?'
      WHEN 'changed.title' THEN 'Possible gig – new details'
      WHEN 'changed.body' THEN 'Now {details}. Still free?'
      WHEN 'released.title' THEN 'The date is free again'
      WHEN 'released.body' THEN '{day}: no need to keep it free any more.'
    END);
  END IF;
  IF v IS NULL THEN RETURN NULL; END IF;
  FOR k IN SELECT jsonb_object_keys(coalesce(p_vars, '{}'::jsonb)) LOOP
    v := replace(v, '{' || k || '}', coalesce(p_vars ->> k, ''));
  END LOOP;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_text(text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- "Sat 5 Dec · 20:00–23:00 · Blue Note, New York" (only the hold's fields).
CREATE OR REPLACE FUNCTION public.bw_date_hold_details(
  p_date date, p_start time, p_end time, p_venue text, p_city text, p_lang text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT concat_ws(' · ',
    public.bw_i18n_short_date(p_date, p_lang),
    CASE WHEN p_start IS NOT NULL THEN to_char(p_start, 'HH24:MI')
         || CASE WHEN p_end IS NOT NULL THEN '–' || to_char(p_end, 'HH24:MI') ELSE '' END END,
    nullif(concat_ws(', ',
      nullif(nullif(btrim(coalesce(p_venue, '')), ''), 'TBD'),
      nullif(btrim(coalesce(p_city, '')), '')), ''));
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_details(date, time, time, text, text, text) FROM PUBLIC, anon, authenticated;

-- Active members who are not admins: who a hold is for.
CREATE OR REPLACE FUNCTION public.bw_date_hold_people(p_band_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(array_agg(DISTINCT bm.user_id), '{}'::uuid[])
    FROM band_members bm
   WHERE bm.band_id = p_band_id
     AND bm.user_id IS NOT NULL
     AND coalesce(bm.is_active, true)
     AND bm.role::text <> 'admin';
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_people(uuid) FROM PUBLIC, anon, authenticated;

-- One notification per person (not the one who made the change), in their
-- language. p_kind: 'hold', 'changed' or 'released'.
CREATE OR REPLACE FUNCTION public.bw_date_hold_notify(
  p_kind text, p_event_id uuid, p_band_id uuid, p_user_ids uuid[],
  p_date date, p_start time, p_end time, p_venue text, p_city text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_type text := CASE p_kind WHEN 'hold' THEN 'date_hold' WHEN 'changed' THEN 'date_hold_changed' ELSE 'date_hold_released' END;
  v_count integer;
BEGIN
  INSERT INTO public.notifications (user_id, band_id, type, title, body, data, read, reference_id, reference_type)
  SELECT u, p_band_id, v_type,
         left(public.bw_date_hold_text(p_kind || '.title', l.lang), 255),
         public.bw_date_hold_text(p_kind || '.body', l.lang, jsonb_build_object(
           'details', public.bw_date_hold_details(p_date, p_start, p_end, p_venue, p_city, l.lang),
           'day', public.bw_i18n_short_date(p_date, l.lang))),
         jsonb_build_object(
           'server', true, 'kind', p_kind, 'event_id', p_event_id, 'band_id', p_band_id,
           'event_date', p_date, 'tag', 'hold-' || p_event_id),
         false, p_event_id, 'date_hold'
    FROM (SELECT DISTINCT x AS u FROM unnest(coalesce(p_user_ids, '{}'::uuid[])) x) r
    CROSS JOIN LATERAL (
      SELECT coalesce((SELECT CASE WHEN lower(left(btrim(p.preferred_language), 2)) IN ('it', 'es', 'fr', 'de', 'pt')
                                   THEN lower(left(btrim(p.preferred_language), 2)) END
                         FROM public.profiles p WHERE p.id = r.u), 'en') AS lang
    ) l
   WHERE r.u IS NOT NULL
     AND (v_actor IS NULL OR r.u <> v_actor)
     -- A burst of edits: one "new details" per 2 minutes.
     AND (p_kind <> 'changed' OR NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = r.u AND n.type = 'date_hold_changed' AND n.reference_id = p_event_id
          AND n.created_at > now() - interval '2 minutes'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_notify(text, uuid, uuid, uuid[], date, time, time, text, text) FROM PUBLIC, anon, authenticated;

-- Bring the hold state in line with the event as it is now:
--   live, ready, never told (or told it ended) → 'date_hold' to the members
--   live, told, p_changed                      → 'date_hold_changed'
--   not live, told, not released yet           → released; "free again" if
--     the date is still ahead and the event did not become their gig
-- One sync at a time per event (lock), so a release goes out once.
CREATE OR REPLACE FUNCTION public.bw_date_hold_sync(p_event_id uuid, p_changed boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_live boolean;
  v_state public.event_date_holds;
  v_band uuid;
  v_status text;
  v_type text;
  v_quote uuid;
  v_date date;
  v_start time;
  v_end time;
  v_venue text;
  v_city text;
  v_people uuid[];
  v_lineup uuid[];
  v_reason text;
BEGIN
  PERFORM pg_advisory_xact_lock(178, hashtext(p_event_id::text));
  SELECT e.band_id, e.status::text, e.event_type::text, e.quote_id, coalesce(e.event_date, e.date),
         e.start_time, e.end_time, coalesce(nullif(btrim(e.venue_name), ''), e.venue), e.venue_city
    INTO v_band, v_status, v_type, v_quote, v_date, v_start, v_end, v_venue, v_city
    FROM events e WHERE e.id = p_event_id;
  IF v_band IS NULL THEN RETURN; END IF;
  SELECT * INTO v_state FROM event_date_holds WHERE event_id = p_event_id FOR UPDATE;
  v_live := public.bw_date_hold_live(p_event_id);
  v_people := public.bw_date_hold_people(v_band);

  IF v_live THEN
    IF v_state.event_id IS NULL OR v_state.released_at IS NOT NULL THEN
      IF NOT public.bw_date_hold_ready(p_event_id) THEN RETURN; END IF;
      INSERT INTO event_date_holds (event_id, band_id, announced_at, released_at, release_reason)
      VALUES (p_event_id, v_band, now(), NULL, NULL)
      ON CONFLICT (event_id) DO UPDATE SET announced_at = now(), released_at = NULL, release_reason = NULL, band_id = EXCLUDED.band_id;
      PERFORM public.bw_date_hold_notify('hold', p_event_id, v_band, v_people, v_date, v_start, v_end, v_venue, v_city);
    ELSIF p_changed THEN
      PERFORM public.bw_date_hold_notify('changed', p_event_id, v_band, v_people, v_date, v_start, v_end, v_venue, v_city);
    END IF;
    RETURN;
  END IF;

  IF v_state.event_id IS NULL OR v_state.released_at IS NOT NULL THEN RETURN; END IF;

  IF NOT public.bw_event_is_quote(v_status, v_type, v_quote)
     AND lower(coalesce(v_status, '')) IN ('confirmed', 'completed') THEN
    v_reason := 'confirmed';
    -- "Gig confirmed" (046) goes to the lineup, or to the whole band when the
    -- lineup is empty: "free again" only to members left out of a lineup.
    SELECT coalesce(array_agg(DISTINCT em.user_id), '{}'::uuid[]) INTO v_lineup
      FROM event_members em
     WHERE em.event_id = p_event_id
       AND lower(btrim(coalesce(em.status::text, 'invited'))) NOT IN ('declined', 'dropped_out', 'removed');
    IF coalesce(array_length(v_lineup, 1), 0) = 0 THEN
      v_people := '{}'::uuid[];
    ELSE
      SELECT coalesce(array_agg(u), '{}'::uuid[]) INTO v_people FROM unnest(v_people) u WHERE u <> ALL (v_lineup);
    END IF;
  ELSIF lower(coalesce(v_status, '')) IN ('cancelled', 'canceled') THEN
    v_reason := 'cancelled';
  ELSIF v_date IS NULL OR v_date < public.bw_date_hold_today() THEN
    v_reason := 'past';
    v_people := '{}'::uuid[];
  ELSE
    v_reason := 'quote_closed';
  END IF;

  UPDATE event_date_holds SET released_at = now(), release_reason = v_reason WHERE event_id = p_event_id;
  PERFORM public.bw_date_hold_notify('released', p_event_id, v_band, v_people, v_date, v_start, v_end, v_venue, v_city);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_sync(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- The event is gone (deleted): release from what it was.
CREATE OR REPLACE FUNCTION public.bw_date_hold_gone(
  p_event_id uuid, p_band_id uuid, p_date date, p_start time, p_end time, p_venue text, p_city text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_state public.event_date_holds;
BEGIN
  PERFORM pg_advisory_xact_lock(178, hashtext(p_event_id::text));
  SELECT * INTO v_state FROM event_date_holds WHERE event_id = p_event_id FOR UPDATE;
  IF v_state.event_id IS NOT NULL AND v_state.released_at IS NULL AND p_band_id IS NOT NULL
     AND p_date IS NOT NULL AND p_date >= public.bw_date_hold_today() THEN
    PERFORM public.bw_date_hold_notify('released', p_event_id, p_band_id, public.bw_date_hold_people(p_band_id),
      p_date, p_start, p_end, p_venue, p_city);
  END IF;
  DELETE FROM event_date_holds WHERE event_id = p_event_id;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_gone(uuid, uuid, date, time, time, text, text) FROM PUBLIC, anon, authenticated;

-- ── 8. The RPCs ─────────────────────────────────────────────────────────────

-- The caller's holds: bands where they are an active member, not an admin;
-- holds the band was told about (announced, not released).
CREATE OR REPLACE FUNCTION public.bw_my_date_holds()
RETURNS TABLE (
  event_id uuid, band_id uuid, band_name text, event_date date, start_time time, end_time time,
  venue_name text, venue_city text, my_answer text, answered_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id, e.band_id, b.name::text, coalesce(e.event_date, e.date), e.start_time, e.end_time,
         nullif(nullif(btrim(coalesce(e.venue_name, e.venue, '')), ''), 'TBD'),
         nullif(btrim(coalesce(e.venue_city, '')), ''),
         a.answer, a.answered_at
    FROM band_members bm
    JOIN events e ON e.band_id = bm.band_id
    JOIN bands b ON b.id = e.band_id
    JOIN event_date_holds h ON h.event_id = e.id AND h.released_at IS NULL
    LEFT JOIN event_hold_answers a ON a.event_id = e.id AND a.user_id = bm.user_id
   WHERE auth.uid() IS NOT NULL
     AND bm.user_id = auth.uid()
     AND coalesce(bm.is_active, true)
     AND bm.role::text <> 'admin'
     AND public.bw_event_is_quote(e.status, e.event_type, e.quote_id)
     AND public.bw_date_hold_live(e.id)
   ORDER BY 4, 5 NULLS LAST, 1;
$$;
REVOKE ALL ON FUNCTION public.bw_my_date_holds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_my_date_holds() TO authenticated;

-- "I'm free" / "I can't". Returns the answer saved. p_date / p_start_time:
-- the day and time the card showed; when given and the hold has moved since,
-- the answer is refused (BWD01, "the date changed") so it never lands on the
-- new date. Without them (older calls), as before.
DROP FUNCTION IF EXISTS public.bw_answer_date_hold(uuid, text);
CREATE OR REPLACE FUNCTION public.bw_answer_date_hold(p_event_id uuid, p_answer text, p_date date DEFAULT NULL, p_start_time text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_answer text := lower(btrim(coalesce(p_answer, '')));
  v_band uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000';
  END IF;
  IF v_answer NOT IN ('free', 'busy') THEN
    RAISE EXCEPTION 'The answer is free or busy' USING ERRCODE = '22023';
  END IF;
  SELECT e.band_id INTO v_band FROM events e WHERE e.id = p_event_id;
  IF v_band IS NULL OR NOT public.bw_is_band_member(v_band, v_uid) THEN
    RAISE EXCEPTION 'Not your band' USING ERRCODE = '42501';
  END IF;
  -- One answer at a time per hold: a date change (which clears answers)
  -- can't slip in between the check and the write.
  PERFORM pg_advisory_xact_lock(178, hashtext(p_event_id::text));
  IF NOT public.bw_date_hold_live(p_event_id) THEN
    RAISE EXCEPTION 'This date is no longer on hold' USING ERRCODE = 'P0002';
  END IF;
  IF p_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM events e
     WHERE e.id = p_event_id
       AND (e.event_date IS DISTINCT FROM p_date
            OR coalesce(to_char(e.start_time, 'HH24:MI'), '') <> coalesce(left(btrim(p_start_time), 5), ''))
  ) THEN
    RAISE EXCEPTION 'The date changed' USING ERRCODE = 'BWD01';
  END IF;
  INSERT INTO event_hold_answers (event_id, user_id, answer, answered_at)
  VALUES (p_event_id, v_uid, v_answer, now())
  ON CONFLICT (event_id, user_id) DO UPDATE SET answer = EXCLUDED.answer, answered_at = EXCLUDED.answered_at;
  RETURN v_answer;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_answer_date_hold(uuid, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_answer_date_hold(uuid, text, date, text) TO authenticated;

-- Admins: who is free, who can't, who hasn't answered (every active member
-- who is not an admin, and anyone else who answered).
CREATE OR REPLACE FUNCTION public.bw_date_hold_answers(p_event_id uuid)
RETURNS TABLE (user_id uuid, name text, answer text, answered_at timestamptz, on_lineup boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_band uuid;
BEGIN
  SELECT e.band_id INTO v_band FROM events e WHERE e.id = p_event_id;
  IF auth.uid() IS NULL OR v_band IS NULL OR NOT public.bw_is_band_admin(v_band) THEN
    RAISE EXCEPTION 'Only band admins see the answers' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    WITH people AS (
      SELECT u FROM unnest(public.bw_date_hold_people(v_band)) u
      UNION
      SELECT a.user_id FROM event_hold_answers a WHERE a.event_id = p_event_id
    )
    SELECT p.u, public.bw_display_name(p.u)::text, a.answer, a.answered_at,
           EXISTS (SELECT 1 FROM event_members em
                    WHERE em.event_id = p_event_id AND em.user_id = p.u
                      AND lower(btrim(coalesce(em.status::text, 'invited'))) NOT IN ('declined', 'dropped_out', 'removed'))
      FROM people p
      LEFT JOIN event_hold_answers a ON a.event_id = p_event_id AND a.user_id = p.u
     ORDER BY CASE a.answer WHEN 'free' THEN 0 WHEN 'busy' THEN 1 ELSE 2 END, 2;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_answers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_date_hold_answers(uuid) TO authenticated;

-- ── 9. Triggers ─────────────────────────────────────────────────────────────

-- The live 111 trigger, with quotes kept to admins and the hold kept in line.
CREATE OR REPLACE FUNCTION public.bw_trg_event_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text;
  v_label text;
  v_when text;
  v_changes text[] := '{}';
  v_recipients uuid[];
  v_data jsonb;
  v_was_quote boolean;
  v_is_quote boolean;
  v_hold_changed boolean;
  ev record;
BEGIN
  IF TG_OP = 'DELETE' THEN ev := OLD; ELSE ev := NEW; END IF;
  v_kind := CASE WHEN lower(coalesce(ev.event_type, 'gig')) = 'rehearsal' THEN 'rehearsal' ELSE 'gig' END;
  v_label := CASE WHEN v_kind = 'rehearsal' THEN 'Rehearsal' ELSE 'Gig' END;
  v_when := coalesce(to_char(ev.event_date, 'Dy DD Mon'), 'date TBD') ||
            CASE WHEN ev.start_time IS NOT NULL THEN ' · ' || to_char(ev.start_time, 'HH24:MI') ELSE '' END;
  ev.title := coalesce(ev.title, v_label);
  v_data := jsonb_build_object(
    'event_id', ev.id,
    'event_title', ev.title,
    'event_type', ev.event_type,
    'event_date', ev.event_date,
    'subtitle', ev.title,
    'tag', 'event-' || ev.id
  );
  -- 178: a quote, or a quote cancelled before it became a gig.
  v_was_quote := OLD.band_id IS NOT NULL AND public.bw_event_quote_private(OLD.id, OLD.status, OLD.event_type, OLD.quote_id);

  IF TG_OP = 'DELETE' THEN
    IF v_was_quote THEN
      -- 178: the quote's name only to its admins; members: "free again".
      PERFORM public.bw_notify(public.bw_active_band_member_ids(OLD.band_id, true), OLD.band_id, 'event_cancelled',
        v_label || ' cancelled', OLD.title || ' · ' || v_when || ' was removed from the calendar.',
        v_data || jsonb_build_object('deleted', true), OLD.id, 'event');
      PERFORM public.bw_date_hold_gone(OLD.id, OLD.band_id, coalesce(OLD.event_date, OLD.date), OLD.start_time,
        OLD.end_time, coalesce(nullif(btrim(OLD.venue_name), ''), OLD.venue), OLD.venue_city);
      RETURN OLD;
    END IF;
    -- Skip drafts nobody was told about.
    IF coalesce(OLD.status, '') IN ('draft') THEN RETURN OLD; END IF;
    v_recipients := public.bw_event_recipient_ids(OLD.id, OLD.band_id, v_was_quote);
    PERFORM public.bw_notify(v_recipients, OLD.band_id, 'event_cancelled',
      v_label || ' cancelled', OLD.title || ' · ' || v_when || ' was removed from the calendar.',
      v_data || jsonb_build_object('deleted', true), OLD.id, 'event');
    RETURN OLD;
  END IF;

  v_is_quote := NEW.band_id IS NOT NULL AND public.bw_event_quote_private(NEW.id, NEW.status, NEW.event_type, NEW.quote_id);

  -- Back to a quote ("Revert to quote"): members leave its chat, and the
  -- confirmation is undone (a live hold starts again below; one that isn't
  -- live keeps no 'confirmed' row, so a new confirmation sets a new cut-off).
  IF v_is_quote AND NOT v_was_quote THEN
    UPDATE event_date_holds SET release_reason = 'reverted'
     WHERE event_id = NEW.id AND release_reason = 'confirmed';
    PERFORM public.bw_quote_chat_prune(NEW.id);
  END IF;

  -- UPDATE
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'cancelled' THEN
    IF v_was_quote THEN
      PERFORM public.bw_notify(public.bw_active_band_member_ids(NEW.band_id, true), NEW.band_id, 'event_cancelled',
        v_label || ' cancelled', NEW.title || ' · ' || v_when || ' has been cancelled.',
        v_data, NEW.id, 'event');
      PERFORM public.bw_date_hold_sync(NEW.id, false);
      RETURN NEW;
    END IF;
    v_recipients := public.bw_event_recipient_ids(NEW.id, NEW.band_id, v_was_quote);
    PERFORM public.bw_notify(v_recipients, NEW.band_id, 'event_cancelled',
      v_label || ' cancelled', NEW.title || ' · ' || v_when || ' has been cancelled.',
      v_data, NEW.id, 'event');
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'confirmed'
     AND coalesce(OLD.status, 'draft') IN ('draft', 'pending', 'tentative') THEN
    v_recipients := public.bw_event_recipient_ids(NEW.id, NEW.band_id, v_is_quote);
    PERFORM public.bw_notify(v_recipients, NEW.band_id, 'event_confirmed',
      v_label || ' confirmed', NEW.title || ' · ' || v_when || ' is on. Check your lineup and times.',
      v_data || jsonb_build_object('gig_confirmed', true), NEW.id, 'event');
    IF v_was_quote THEN
      PERFORM public.bw_date_hold_sync(NEW.id, false);
      PERFORM public.bw_quote_event_confirmed(NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'draft' THEN
    IF v_was_quote THEN PERFORM public.bw_date_hold_sync(NEW.id, false); END IF;
    RETURN NEW;
  END IF;

  IF NEW.event_date IS DISTINCT FROM OLD.event_date THEN v_changes := array_append(v_changes, 'date'::text); END IF;
  IF NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time THEN
    v_changes := array_append(v_changes, 'time'::text);
  END IF;
  IF NEW.load_in_time IS DISTINCT FROM OLD.load_in_time OR NEW.soundcheck_time IS DISTINCT FROM OLD.soundcheck_time THEN
    v_changes := array_append(v_changes, 'load-in / soundcheck'::text);
  END IF;
  IF NEW.venue_name IS DISTINCT FROM OLD.venue_name OR NEW.venue_address IS DISTINCT FROM OLD.venue_address
     OR NEW.venue_city IS DISTINCT FROM OLD.venue_city THEN
    v_changes := array_append(v_changes, 'venue'::text);
  END IF;

  IF array_length(v_changes, 1) > 0 THEN
    IF v_was_quote OR v_is_quote THEN
      -- 178: a quote's changes, with its name, to its admins only.
      v_recipients := public.bw_active_band_member_ids(NEW.band_id, true);
    ELSE
      v_recipients := public.bw_event_recipient_ids(NEW.id, NEW.band_id, false);
    END IF;
    PERFORM public.bw_notify(v_recipients, NEW.band_id, 'event_update',
      v_label || ' updated', NEW.title || ' · ' || v_when || ' — new ' || array_to_string(v_changes, ', ') || '.',
      v_data || jsonb_build_object('changes', to_jsonb(v_changes)), NEW.id, 'event', interval '2 minutes');
  END IF;

  IF v_was_quote OR v_is_quote THEN
    -- A new day or time: "I'm free" was for the old one.
    IF coalesce(NEW.event_date, NEW.date) IS DISTINCT FROM coalesce(OLD.event_date, OLD.date)
       OR NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time THEN
      DELETE FROM event_hold_answers WHERE event_id = NEW.id;
    END IF;
    -- What a hold shows: day, start and end time, venue name, city.
    v_hold_changed := coalesce(NEW.event_date, NEW.date) IS DISTINCT FROM coalesce(OLD.event_date, OLD.date)
      OR NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time
      OR NEW.venue_name IS DISTINCT FROM OLD.venue_name OR NEW.venue IS DISTINCT FROM OLD.venue
      OR NEW.venue_city IS DISTINCT FROM OLD.venue_city;
    PERFORM public.bw_date_hold_sync(NEW.id, v_hold_changed);
    -- Confirmed some other way (e.g. from 'quoted'): its lineup back in its chat.
    IF v_was_quote AND NOT v_is_quote AND lower(coalesce(NEW.status, '')) IN ('confirmed', 'completed') THEN
      PERFORM public.bw_quote_event_confirmed(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- Never block the calendar because of a notification.
  RAISE WARNING 'bw_trg_event_changed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$function$;

-- A new quote event: the hold, once its quote is saved (bw_date_hold_ready).
CREATE OR REPLACE FUNCTION public.bw_trg_date_hold_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.band_id IS NOT NULL AND public.bw_event_is_quote(NEW.status, NEW.event_type, NEW.quote_id) THEN
    PERFORM public.bw_date_hold_sync(NEW.id, false);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_date_hold_event_insert: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_date_hold_event_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_date_hold_event_insert ON public.events;
CREATE TRIGGER bw_date_hold_event_insert
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_date_hold_event_insert();

-- The quote is saved (the hold starts), or it (or its client link) settled:
-- declined, expired, archived, or open again.
CREATE OR REPLACE FUNCTION public.bw_trg_date_hold_quote_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_quote uuid := NEW.id;
  r record;
BEGIN
  IF TG_TABLE_NAME = 'quote_links' THEN v_quote := NEW.quote_id; END IF;
  FOR r IN
    SELECT DISTINCT e.id FROM events e JOIN quotes q ON q.id = v_quote
     WHERE e.band_id = q.band_id AND (e.id = q.converted_to_event_id OR e.quote_id = q.id)
  LOOP
    PERFORM public.bw_date_hold_sync(r.id, false);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_date_hold_quote_changed: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_date_hold_quote_changed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_date_hold_quote_changed ON public.quotes;
CREATE TRIGGER bw_date_hold_quote_changed
  AFTER UPDATE OF status, valid_until, converted_to_event_id ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_date_hold_quote_changed();
DROP TRIGGER IF EXISTS bw_date_hold_quote_saved ON public.quotes;
CREATE TRIGGER bw_date_hold_quote_saved
  AFTER INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_date_hold_quote_changed();
-- The quote's musicians are saved: the hold may start now.
CREATE OR REPLACE FUNCTION public.bw_trg_date_hold_quote_musicians()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT e.id FROM quotes q JOIN events e
      ON e.band_id = q.band_id AND (e.id = q.converted_to_event_id OR e.quote_id = q.id)
     WHERE q.id = NEW.quote_id
  LOOP
    PERFORM public.bw_date_hold_sync(r.id, false);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_date_hold_quote_musicians: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_date_hold_quote_musicians() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_date_hold_quote_musicians ON public.quote_musicians;
CREATE TRIGGER bw_date_hold_quote_musicians
  AFTER INSERT ON public.quote_musicians
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_date_hold_quote_musicians();

-- The quote's day or time changed (Quotes screen): its event still on hold
-- moves with it. The event's own trigger then clears the answers and tells
-- the members, as when the gig is edited.
CREATE OR REPLACE FUNCTION public.bw_trg_date_hold_quote_moved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE events e
     SET event_date = coalesce(NEW.event_date, e.event_date),
         start_time = CASE WHEN NEW.event_time_start IS DISTINCT FROM OLD.event_time_start THEN NEW.event_time_start ELSE e.start_time END,
         end_time = CASE WHEN NEW.event_time_end IS DISTINCT FROM OLD.event_time_end THEN NEW.event_time_end ELSE e.end_time END
   WHERE e.band_id = NEW.band_id
     AND (e.id = NEW.converted_to_event_id OR e.quote_id = NEW.id)
     AND public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id)
     AND lower(coalesce(e.status, '')) <> 'cancelled'
     AND (e.event_date IS DISTINCT FROM coalesce(NEW.event_date, e.event_date)
          OR (NEW.event_time_start IS DISTINCT FROM OLD.event_time_start AND e.start_time IS DISTINCT FROM NEW.event_time_start)
          OR (NEW.event_time_end IS DISTINCT FROM OLD.event_time_end AND e.end_time IS DISTINCT FROM NEW.event_time_end));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_date_hold_quote_moved() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_date_hold_quote_moved ON public.quotes;
CREATE TRIGGER bw_date_hold_quote_moved
  AFTER UPDATE OF event_date, event_time_start, event_time_end ON public.quotes
  FOR EACH ROW
  WHEN (NEW.event_date IS DISTINCT FROM OLD.event_date
        OR NEW.event_time_start IS DISTINCT FROM OLD.event_time_start
        OR NEW.event_time_end IS DISTINCT FROM OLD.event_time_end)
  EXECUTE FUNCTION public.bw_trg_date_hold_quote_moved();

DROP TRIGGER IF EXISTS bw_date_hold_quote_link_changed ON public.quote_links;
CREATE TRIGGER bw_date_hold_quote_link_changed
  AFTER UPDATE OF status ON public.quote_links
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_date_hold_quote_changed();

-- Expiry has no write of its own, and a tentative event with no quote waits
-- 2 minutes: the sweep announces and releases.
CREATE OR REPLACE FUNCTION public.bw_date_hold_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT h.event_id FROM event_date_holds h WHERE h.released_at IS NULL LOOP
    IF NOT public.bw_date_hold_live(r.event_id) THEN
      IF EXISTS (SELECT 1 FROM events e WHERE e.id = r.event_id) THEN
        PERFORM public.bw_date_hold_sync(r.event_id, false);
      ELSE
        DELETE FROM event_date_holds WHERE event_id = r.event_id;
      END IF;
      n := n + 1;
    END IF;
  END LOOP;
  FOR r IN
    SELECT e.id FROM events e
     WHERE e.band_id IS NOT NULL
       AND public.bw_event_is_quote(e.status, e.event_type, e.quote_id)
       AND coalesce(e.event_date, e.date) >= public.bw_date_hold_today()
       AND NOT EXISTS (SELECT 1 FROM event_date_holds h WHERE h.event_id = e.id)
  LOOP
    IF public.bw_date_hold_live(r.id) AND public.bw_date_hold_ready(r.id) THEN
      PERFORM public.bw_date_hold_sync(r.id, false);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_sweep() FROM PUBLIC, anon, authenticated;

-- ── 10. Notifications about a quote never reach its members ────────────────
-- The setlist a notice is about: data.setlist_id / setlistId, or its reference.
CREATE OR REPLACE FUNCTION public.bw_notification_setlist_id(p_data jsonb, p_ref_type text, p_ref_id uuid)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v text := nullif(coalesce(p_data ->> 'setlist_id', p_data ->> 'setlistId'), '');
BEGIN
  IF v IS NOT NULL THEN
    BEGIN
      RETURN v::uuid;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
  END IF;
  IF p_ref_type = 'setlist' THEN RETURN p_ref_id; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_notification_setlist_id(jsonb, text, uuid) FROM PUBLIC, anon, authenticated;

-- A notice about this setlist is not for p_user_id: the setlist belongs to a
-- private quote of a band where they are a member, not an admin (even if a
-- gig uses it too: the notice can't tell which), or only quotes use it.
CREATE OR REPLACE FUNCTION public.bw_setlist_notice_hidden(p_setlist_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_setlist_id IS NOT NULL AND p_user_id IS NOT NULL AND (
    public.bw_setlist_quote_hidden(p_setlist_id, p_user_id)
    OR EXISTS (
      SELECT 1 FROM events e
       WHERE e.setlist_id = p_setlist_id
         AND e.band_id IS NOT NULL
         AND public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id)
         AND public.bw_is_band_member(e.band_id, p_user_id)
         AND NOT public.bw_is_band_admin(e.band_id, p_user_id)
    ));
$$;
REVOKE ALL ON FUNCTION public.bw_setlist_notice_hidden(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_trg_notification_quote_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event uuid;
  v_band uuid;
  v_setlist uuid;
BEGIN
  IF NEW.type IN ('date_hold', 'date_hold_changed', 'date_hold_released') THEN RETURN NEW; END IF;
  -- By event, or by the event chat it announces (chat notices carry only chat_id).
  v_event := public.bw_notification_event_id(NEW.data, NEW.reference_type, NEW.reference_id);
  IF v_event IS NOT NULL THEN
    SELECT e.band_id INTO v_band FROM events e
     WHERE e.id = v_event AND e.band_id IS NOT NULL
       AND public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id);
    -- Members of the band who are not admins: dropped (deputies and others
    -- outside the band are not concerned).
    IF v_band IS NOT NULL AND public.bw_is_band_member(v_band, NEW.user_id)
       AND NOT public.bw_is_band_admin(v_band, NEW.user_id) THEN
      RETURN NULL;
    END IF;
  END IF;
  -- A deputy's push about a gig that is (back to) a quote: title and day.
  IF NEW.type IN ('deputy_request', 'deputy_gig_changed') AND NEW.reference_type = 'deputy_request'
     AND EXISTS (SELECT 1 FROM deputy_requests r WHERE r.id = NEW.reference_id
                  AND public.bw_event_deputy_hidden(r.event_id)) THEN
    RETURN NULL;
  END IF;
  -- A setlist notice (setlist_id only) about a quote's setlist.
  v_setlist := public.bw_notification_setlist_id(NEW.data, NEW.reference_type, NEW.reference_id);
  IF v_setlist IS NOT NULL AND NEW.user_id IS NOT NULL AND public.bw_setlist_notice_hidden(v_setlist, NEW.user_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_notification_quote_guard() FROM PUBLIC, anon, authenticated;
-- "00": BEFORE INSERT triggers run in name order, so this comes first.
DROP TRIGGER IF EXISTS bw_notifications_00_quote_guard ON public.notifications;
CREATE TRIGGER bw_notifications_00_quote_guard
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_notification_quote_guard();

-- The ones already in members' inboxes ("Availability check: <title>",
-- "Gig updated", fee, quote chat previews...): archived (admins only, for a
-- rollback), removed.
CREATE TABLE IF NOT EXISTS public.notifications_quote_178 (
  id uuid PRIMARY KEY,
  user_id uuid,
  row_data jsonb NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications_quote_178 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications_quote_178 FROM PUBLIC, anon, authenticated;

WITH stale AS (
  SELECT n.id, n.user_id, to_jsonb(n) AS row_data
    FROM notifications n
    JOIN events e ON e.id = public.bw_notification_event_id(n.data, n.reference_type, n.reference_id)
   WHERE n.type NOT IN ('date_hold', 'date_hold_changed', 'date_hold_released')
     AND e.band_id IS NOT NULL
     AND public.bw_event_quote_private(e.id, e.status, e.event_type, e.quote_id)
     AND public.bw_is_band_member(e.band_id, n.user_id)
     AND NOT public.bw_is_band_admin(e.band_id, n.user_id)
  UNION
  -- Setlist notices that carry only the setlist (046, 107): its name is
  -- often the client's.
  SELECT n.id, n.user_id, to_jsonb(n)
    FROM notifications n
   WHERE n.type NOT IN ('date_hold', 'date_hold_changed', 'date_hold_released')
     AND n.user_id IS NOT NULL
     AND public.bw_setlist_notice_hidden(public.bw_notification_setlist_id(n.data, n.reference_type, n.reference_id), n.user_id)
), saved AS (
  INSERT INTO public.notifications_quote_178 (id, user_id, row_data)
  SELECT id, user_id, row_data FROM stale
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
DELETE FROM notifications n USING stale s WHERE n.id = s.id;

-- ── 11. Push for the new notifications (170's dispatcher + 3 types) ─────────
-- A hold's push goes out as 'event_date_hold' with no event id: older builds
-- open the calendar on it (they route every 'event_*'), newer builds open the
-- hold (hold_event_id, hold_type). The inbox row keeps its own type.
CREATE OR REPLACE FUNCTION public.bw_trg_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_push_pref text;
  v_data jsonb;
BEGIN
  -- Rows created by send-push itself were already pushed.
  IF coalesce(NEW.data->>'skip_push', 'false') = 'true' THEN RETURN NEW; END IF;

  IF NOT (
    NEW.type IN (
      'invite_received', 'event_invite', 'event_update', 'event_cancelled',
      'event_reminder', 'rehearsal_reminder', 'member_dropped_out',
      'rehearsal_poll', 'rehearsal_proposal',
      'quote_accepted', 'payment_due', 'payment_overdue', 'fee_changed',
      'chat_message', 'chat_mention', 'deputy_reply',
      'deputy_joined', 'deputy_request', 'deputy_gig_changed',
      'quote_viewed', 'quote_declined', 'quote_message',
      'song_suggestion', 'song_suggestion_reviewed',
      -- The setlist ready for offline (170).
      'live_pack_ready',
      -- A date on hold for a possible gig (178).
      'date_hold', 'date_hold_changed', 'date_hold_released'
    )
    -- One summary after a setlist / song save (107); the per-row notes stay inbox-only.
    OR (NEW.type IN ('setlist_updated', 'song_updated') AND coalesce(NEW.data->>'kind', '') = 'summary')
    -- An admin declined your rehearsal proposal (123).
    OR (NEW.type = 'system' AND coalesce(NEW.data->>'kind', '') = 'proposal_declined')
    -- A rehearsal session ended: what to practise (133).
    OR (NEW.type = 'rehearsal_notes_added' AND coalesce(NEW.data->>'kind', '') = 'summary')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT notification_preferences->>'push' INTO v_push_pref FROM public.profiles WHERE id = NEW.user_id;
  IF coalesce(v_push_pref, 'true') = 'false' THEN RETURN NEW; END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'bw_project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'bw_push_dispatch_secret' LIMIT 1;
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;

  IF NEW.type IN ('date_hold', 'date_hold_changed', 'date_hold_released') THEN
    v_data := (coalesce(NEW.data, '{}'::jsonb) - 'event_id' - 'eventId') || jsonb_build_object(
      'type', 'event_date_hold',
      'hold_type', NEW.type,
      'hold_event_id', NEW.data->>'event_id',
      'notification_id', NEW.id,
      'band_id', NEW.band_id
    );
  ELSE
    v_data := coalesce(NEW.data, '{}'::jsonb) || jsonb_build_object(
      'type', NEW.type,
      'notification_id', NEW.id,
      'band_id', NEW.band_id
    );
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bw-dispatch-secret', v_secret),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'title', NEW.title,
      -- send-push requires a body; fall back to the title.
      'body', coalesce(nullif(NEW.body, ''), NEW.title),
      'create_in_app', false,
      'data', v_data
    ),
    timeout_milliseconds := 8000
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_dispatch_push: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ── 12. Holds live today: known, not announced again; answers carried ───────
INSERT INTO public.event_date_holds (event_id, band_id, announced_at)
SELECT e.id, e.band_id, now()
  FROM events e
 WHERE e.band_id IS NOT NULL
   AND public.bw_event_is_quote(e.status, e.event_type, e.quote_id)
   AND public.bw_date_hold_live(e.id)
ON CONFLICT (event_id) DO NOTHING;

-- Members who already answered an older build's "Availability check" (their
-- lineup row of the quote): that answer is their hold answer. Once per hold,
-- so a re-run never brings back answers cleared by a change of date.
INSERT INTO public.event_hold_answers (event_id, user_id, answer, answered_at)
SELECT DISTINCT ON (em.event_id, em.user_id) em.event_id, em.user_id,
       CASE WHEN lower(btrim(em.status::text)) IN ('confirmed', 'accepted') THEN 'free' ELSE 'busy' END, now()
  FROM event_date_holds h
  JOIN events e ON e.id = h.event_id
  JOIN event_members em ON em.event_id = h.event_id
 WHERE h.released_at IS NULL
   AND h.answers_carried_at IS NULL
   AND lower(btrim(coalesce(em.status::text, ''))) IN ('confirmed', 'accepted', 'declined')
   AND em.user_id = ANY (public.bw_date_hold_people(e.band_id))
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = em.user_id)
ON CONFLICT (event_id, user_id) DO NOTHING;
UPDATE public.event_date_holds SET answers_carried_at = now()
 WHERE released_at IS NULL AND answers_carried_at IS NULL;

-- ── 13. Schedule ────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('bw-date-hold-sweep')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-date-hold-sweep');
  PERFORM cron.schedule('bw-date-hold-sweep', '*/5 * * * *', 'SELECT public.bw_date_hold_sweep()');
END;
$$;

COMMIT;
