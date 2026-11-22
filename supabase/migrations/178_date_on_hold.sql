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
--     a member could reach them:
--       * events (events_select_policy), bw_can_view_event (lineup, event
--         tasks), the member's own lineup row of a quote (event_members read
--         and own-answer update), bw_event_member_money (the musician fee);
--       * rider (bw_event_rider), stage plot (event_stage), gig kits
--         (event_gear_kits), the live stage key and channel (bw_stage_key,
--         bw_stage_topic_allowed), the offline live pack (window, can-hold);
--       * bw_is_event_participant: a member is not a participant of a quote,
--         so they can't be added to (or create) its event chat;
--       * the event chat of a quote: chats, messages, chat_participants are
--         hidden from members by RESTRICTIVE policies (they keep working
--         with or without 175), and bw_chat_scope_ok (175, used by
--         bw_my_chat_ids and the send-push recipients) gets the same rule;
--       * notifications: a BEFORE INSERT guard drops any notification about
--         a quote event addressed to a non-admin member of its band (old app
--         builds still write "Availability check: <title> · your fee"), and
--         the ones already in members' inboxes are archived and removed.
--     Admins: unchanged. Confirmed gigs: unchanged (own fee + logistics).
--
--  2. Every active member who is not an admin sees a hold instead, only
--     through these RPCs (no table grants):
--       bw_my_date_holds()                 day, start/end time, venue name,
--                                          city, band, my answer
--       bw_answer_date_hold(event, answer) 'free' or 'busy'
--       bw_date_hold_answers(event)        admins: every member's answer
--     A hold is live while the event is a quote, not cancelled, not past,
--     and its quote is not declined / expired / archived (quote or link).
--
--  3. Neutral notifications, in the reader's language (no title, client,
--     fee or notes): 'date_hold' when the hold starts, 'date_hold_changed'
--     when its day, time or place changes, 'date_hold_released' ("The date
--     is free again") once when it ends without becoming their gig: quote
--     declined or expired, event cancelled or deleted, or confirmed with a
--     lineup they are not on. Confirmed with them on it: the usual "Gig
--     confirmed" (046). Expiry has no write of its own: a cron sweep
--     ('bw-date-hold-sweep', hourly) releases those.
--     bw_trg_event_changed (111) sends its titled notices about a quote
--     (cancelled, deleted, updated) to the band's admins only.
--
-- Older app builds: they already hid quotes from members; now members simply
-- don't get those rows (events, their own lineup row, notifications), which
-- the app treats like a gig they are not on. No RPC they call changes shape.
-- Apply after 175 (it defines bw_chat_scope_ok, redefined here); if 175 is
-- ever applied after this, run this file again. 181's bw_chat_scope_ok
-- (lineup rule) already carries the quote rule and is kept on a re-run.
-- Idempotent; safe to re-run on live data.
-- ============================================================================

BEGIN;

-- ── 1. Helpers ──────────────────────────────────────────────────────────────

-- Is this event a quote that p_user_id may not read? (A band quote event and
-- p_user_id is not an active admin of its band.)
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
       AND public.bw_event_is_quote(e.status, e.event_type, e.quote_id)
       AND NOT public.bw_is_band_admin(e.band_id, p_user_id)
  );
$$;
REVOKE ALL ON FUNCTION public.bw_event_quote_hidden(uuid, uuid) FROM PUBLIC, anon;
-- Policies call it (same exposure as bw_can_view_event).
GRANT EXECUTE ON FUNCTION public.bw_event_quote_hidden(uuid, uuid) TO authenticated;

-- The event chats the caller may not read: chats of quotes in bands where
-- they are not an admin. One array per statement (no per-row lookups).
CREATE OR REPLACE FUNCTION public.bw_hidden_quote_chat_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(array_agg(c.id), '{}'::uuid[])
    FROM chats c
    JOIN events e ON e.id = c.event_id
   WHERE c.type = 'event'
     AND e.band_id IS NOT NULL
     AND public.bw_event_is_quote(e.status, e.event_type, e.quote_id)
     AND NOT public.bw_is_band_admin(e.band_id, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.bw_hidden_quote_chat_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_hidden_quote_chat_ids() TO authenticated;

-- ── 2. Quote events: admins only ────────────────────────────────────────────
DROP POLICY IF EXISTS events_select_policy ON public.events;
CREATE POLICY events_select_policy ON public.events
  FOR SELECT TO authenticated
  USING (
    band_id IS NOT NULL
    AND public.bw_is_band_member(band_id)
    AND (
      NOT public.bw_event_is_quote(status, event_type, quote_id)
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
            NOT public.bw_event_is_quote(e.status, e.event_type, e.quote_id)
            OR public.bw_is_band_admin(e.band_id, p_user_id)
          ))
        OR (e.band_id IS NULL AND e.created_by = p_user_id)
      )
  );
$$;

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
        AND public.bw_event_is_quote(e.status, e.event_type, e.quote_id)
        AND NOT public.bw_is_band_admin(e.band_id, p_user_id)
      )
      AND (
        e.created_by = p_user_id
        OR (e.band_id IS NOT NULL AND public.bw_is_band_admin(e.band_id, p_user_id))
        OR EXISTS (
          SELECT 1 FROM event_members em
          WHERE em.event_id = e.id AND em.user_id = p_user_id
            AND COALESCE(em.status, '') <> 'declined'
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
     AND c.type = 'rider'
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

-- ── 3. The event chat of a quote ────────────────────────────────────────────
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

DROP POLICY IF EXISTS chat_participants_quote_admins_only ON public.chat_participants;
CREATE POLICY chat_participants_quote_admins_only ON public.chat_participants
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (chat_id NOT IN (SELECT unnest(public.bw_hidden_quote_chat_ids())));

-- 175's scope rule (band chats and band event chats need active membership),
-- plus: the event chat of a quote is for the band's admins only. Used by
-- bw_my_chat_ids, the chats read policies and bw_chat_recipient_ids
-- (send-push), once 175 is applied.
-- 181 (event chat = lineup) redefines it to also need bw_is_event_participant,
-- which carries the quote rule since this migration. When that definition is
-- live, keep it: re-running 178 after 181 must not undo the lineup rule.
DO $do$
BEGIN
  IF to_regprocedure('public.bw_chat_scope_ok(text, uuid, uuid, uuid)') IS NOT NULL THEN
    IF pg_get_functiondef(to_regprocedure('public.bw_chat_scope_ok(text, uuid, uuid, uuid)'))
       LIKE '%bw_is_event_participant%' THEN
      RETURN;
    END IF;
  END IF;
  EXECUTE $sql$
CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $f$
  SELECT CASE
    WHEN p_type = 'band' THEN
      p_band_id IS NULL OR public.bw_is_band_member(p_band_id, p_user_id)
    WHEN p_type = 'event' THEN
      (p_band_id IS NULL OR public.bw_is_band_member(p_band_id, p_user_id))
      AND coalesce((
        SELECT e.band_id IS NULL OR public.bw_is_band_member(e.band_id, p_user_id)
          FROM events e WHERE e.id = p_event_id
      ), true)
      AND NOT public.bw_event_quote_hidden(p_event_id, p_user_id)
    ELSE true
  END;
$f$;
  $sql$;
END
$do$;
REVOKE ALL ON FUNCTION public.bw_chat_scope_ok(text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_chat_scope_ok(text, uuid, uuid, uuid) TO authenticated;

-- ── 4. Hold tables (server only: RLS on, no policies, no grants) ────────────
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
-- No FK: the row must outlive the event's delete trigger.
CREATE TABLE IF NOT EXISTS public.event_date_holds (
  event_id uuid PRIMARY KEY,
  band_id uuid NOT NULL,
  announced_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  release_reason text
);
ALTER TABLE public.event_date_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_date_holds FROM PUBLIC, anon, authenticated;

-- ── 5. Is the hold live? ────────────────────────────────────────────────────
-- A quote event, not cancelled, dated today or later, whose quote (if any)
-- is not settled against it: declined, expired (valid_until more than a day
-- past while out with the client, as src/lib/quoteExpiry.ts), archived, or
-- declined on the client link.
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
       AND coalesce(e.event_date, e.date) >= current_date
       AND NOT EXISTS (
         SELECT 1 FROM quotes q
          WHERE q.band_id = e.band_id
            AND (q.id = e.quote_id OR q.converted_to_event_id = e.id)
            AND (
              lower(q.status::text) IN ('declined', 'rejected', 'expired', 'archived', 'cancelled')
              OR (lower(q.status::text) IN ('sent', 'viewed', 'negotiating')
                  AND q.valid_until IS NOT NULL AND q.valid_until::date + 1 < current_date)
              OR EXISTS (SELECT 1 FROM quote_links l WHERE l.quote_id = q.id AND l.status = 'declined')
            )
       )
  );
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_live(uuid) FROM PUBLIC, anon, authenticated;

-- ── 6. Texts (reader's language; no title, client, fee or notes) ────────────
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
--   live, never told (or told it ended)  → 'date_hold' to the members
--   live, told, p_changed                → 'date_hold_changed'
--   not live, told, not released yet     → released; "free again" if the
--     date is still ahead and the event did not become their gig
CREATE OR REPLACE FUNCTION public.bw_date_hold_sync(p_event_id uuid, p_changed boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_live boolean := public.bw_date_hold_live(p_event_id);
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
  SELECT e.band_id, e.status::text, e.event_type::text, e.quote_id, coalesce(e.event_date, e.date),
         e.start_time, e.end_time, coalesce(nullif(btrim(e.venue_name), ''), e.venue), e.venue_city
    INTO v_band, v_status, v_type, v_quote, v_date, v_start, v_end, v_venue, v_city
    FROM events e WHERE e.id = p_event_id;
  IF v_band IS NULL THEN RETURN; END IF;
  SELECT * INTO v_state FROM event_date_holds WHERE event_id = p_event_id;
  v_people := public.bw_date_hold_people(v_band);

  IF v_live THEN
    IF v_state.event_id IS NULL OR v_state.released_at IS NOT NULL THEN
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
       AND coalesce(em.status, 'invited') NOT IN ('declined', 'dropped_out', 'removed');
    IF coalesce(array_length(v_lineup, 1), 0) = 0 THEN
      v_people := '{}'::uuid[];
    ELSE
      SELECT coalesce(array_agg(u), '{}'::uuid[]) INTO v_people FROM unnest(v_people) u WHERE u <> ALL (v_lineup);
    END IF;
  ELSIF lower(coalesce(v_status, '')) IN ('cancelled', 'canceled') THEN
    v_reason := 'cancelled';
  ELSIF v_date IS NULL OR v_date < current_date THEN
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
  SELECT * INTO v_state FROM event_date_holds WHERE event_id = p_event_id;
  IF v_state.event_id IS NOT NULL AND v_state.released_at IS NULL AND p_band_id IS NOT NULL
     AND p_date IS NOT NULL AND p_date >= current_date THEN
    PERFORM public.bw_date_hold_notify('released', p_event_id, p_band_id, public.bw_date_hold_people(p_band_id),
      p_date, p_start, p_end, p_venue, p_city);
  END IF;
  DELETE FROM event_date_holds WHERE event_id = p_event_id;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_gone(uuid, uuid, date, time, time, text, text) FROM PUBLIC, anon, authenticated;

-- ── 7. The RPCs ─────────────────────────────────────────────────────────────

-- The caller's holds: bands where they are an active member, not an admin.
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

-- "I'm free" / "I can't". Returns the answer saved.
CREATE OR REPLACE FUNCTION public.bw_answer_date_hold(p_event_id uuid, p_answer text)
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
  IF NOT public.bw_date_hold_live(p_event_id) THEN
    RAISE EXCEPTION 'This date is no longer on hold' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO event_hold_answers (event_id, user_id, answer, answered_at)
  VALUES (p_event_id, v_uid, v_answer, now())
  ON CONFLICT (event_id, user_id) DO UPDATE SET answer = EXCLUDED.answer, answered_at = EXCLUDED.answered_at;
  RETURN v_answer;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_answer_date_hold(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_answer_date_hold(uuid, text) TO authenticated;

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
                      AND coalesce(em.status, 'invited') NOT IN ('declined', 'dropped_out', 'removed'))
      FROM people p
      LEFT JOIN event_hold_answers a ON a.event_id = p_event_id AND a.user_id = p.u
     ORDER BY CASE a.answer WHEN 'free' THEN 0 WHEN 'busy' THEN 1 ELSE 2 END, 2;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_answers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_date_hold_answers(uuid) TO authenticated;

-- ── 8. Triggers ─────────────────────────────────────────────────────────────

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
  v_was_quote := OLD.band_id IS NOT NULL AND public.bw_event_is_quote(OLD.status, OLD.event_type, OLD.quote_id);

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

  v_is_quote := NEW.band_id IS NOT NULL AND public.bw_event_is_quote(NEW.status, NEW.event_type, NEW.quote_id);

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
    IF v_was_quote THEN PERFORM public.bw_date_hold_sync(NEW.id, false); END IF;
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
    -- What a hold shows: day, start and end time, venue name, city.
    v_hold_changed := coalesce(NEW.event_date, NEW.date) IS DISTINCT FROM coalesce(OLD.event_date, OLD.date)
      OR NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time
      OR NEW.venue_name IS DISTINCT FROM OLD.venue_name OR NEW.venue IS DISTINCT FROM OLD.venue
      OR NEW.venue_city IS DISTINCT FROM OLD.venue_city;
    PERFORM public.bw_date_hold_sync(NEW.id, v_hold_changed);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- Never block the calendar because of a notification.
  RAISE WARNING 'bw_trg_event_changed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$function$;

-- A new quote event: tell the band the date is on hold.
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

-- The quote (or its client link) settled: declined, expired, archived, or
-- open again.
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
DROP TRIGGER IF EXISTS bw_date_hold_quote_link_changed ON public.quote_links;
CREATE TRIGGER bw_date_hold_quote_link_changed
  AFTER UPDATE OF status ON public.quote_links
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_date_hold_quote_changed();

-- Expiry has no write of its own: the sweep releases holds that ended.
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
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_date_hold_sweep() FROM PUBLIC, anon, authenticated;

-- ── 9. Notifications about a quote never reach its members ─────────────────
CREATE OR REPLACE FUNCTION public.bw_trg_notification_quote_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event uuid;
  v_band uuid;
BEGIN
  IF NEW.type IN ('date_hold', 'date_hold_changed', 'date_hold_released') THEN RETURN NEW; END IF;
  BEGIN
    v_event := nullif(NEW.data ->> 'event_id', '')::uuid;
  EXCEPTION WHEN others THEN v_event := NULL;
  END;
  IF v_event IS NULL AND NEW.reference_type = 'event' THEN v_event := NEW.reference_id; END IF;
  IF v_event IS NULL THEN RETURN NEW; END IF;
  SELECT e.band_id INTO v_band FROM events e
   WHERE e.id = v_event AND e.band_id IS NOT NULL
     AND public.bw_event_is_quote(e.status, e.event_type, e.quote_id);
  -- Members of the band who are not admins: dropped (deputies and others
  -- outside the band are not concerned).
  IF v_band IS NOT NULL AND public.bw_is_band_member(v_band, NEW.user_id)
     AND NOT public.bw_is_band_admin(v_band, NEW.user_id) THEN
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
-- "Gig updated", fee...): archived (admins only, for a rollback), removed.
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
    JOIN events e ON e.id = CASE
         WHEN coalesce(n.data ->> 'event_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN (n.data ->> 'event_id')::uuid
         WHEN n.reference_type = 'event' THEN n.reference_id END
   WHERE n.type NOT IN ('date_hold', 'date_hold_changed', 'date_hold_released')
     AND e.band_id IS NOT NULL
     AND public.bw_event_is_quote(e.status, e.event_type, e.quote_id)
     AND public.bw_is_band_member(e.band_id, n.user_id)
     AND NOT public.bw_is_band_admin(e.band_id, n.user_id)
), saved AS (
  INSERT INTO public.notifications_quote_178 (id, user_id, row_data)
  SELECT id, user_id, row_data FROM stale
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
DELETE FROM notifications n USING stale s WHERE n.id = s.id;

-- ── 10. Push for the new notifications (170's dispatcher + 3 types) ─────────
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

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bw-dispatch-secret', v_secret),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'title', NEW.title,
      -- send-push requires a body; fall back to the title.
      'body', coalesce(nullif(NEW.body, ''), NEW.title),
      'create_in_app', false,
      'data', coalesce(NEW.data, '{}'::jsonb) || jsonb_build_object(
        'type', NEW.type,
        'notification_id', NEW.id,
        'band_id', NEW.band_id
      )
    ),
    timeout_milliseconds := 8000
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_dispatch_push: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ── 11. Holds live today: known, not announced again ────────────────────────
INSERT INTO public.event_date_holds (event_id, band_id, announced_at)
SELECT e.id, e.band_id, now()
  FROM events e
 WHERE e.band_id IS NOT NULL
   AND public.bw_event_is_quote(e.status, e.event_type, e.quote_id)
   AND public.bw_date_hold_live(e.id)
ON CONFLICT (event_id) DO NOTHING;

-- ── 12. Schedule ────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('bw-date-hold-sweep')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-date-hold-sweep');
  PERFORM cron.schedule('bw-date-hold-sweep', '7 * * * *', 'SELECT public.bw_date_hold_sweep()');
END;
$$;

COMMIT;
