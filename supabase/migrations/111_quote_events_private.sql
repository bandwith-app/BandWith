-- 111 · Quote (tentative) events: only who is involved can read them.
--
-- Until now every active member of a band could read the public columns of
-- every band event (072), quote rows included: title, date, venue, notes of a
-- gig the client has not accepted yet. The app hid them from members, the
-- database did not. And when a quote's date moved, or the quote event was
-- deleted, with nobody on its lineup, the 046 trigger sent "Gig updated" /
-- "Gig cancelled" to the whole band (bw_event_recipient_ids fell back to
-- every active member), which revealed the quote.
--
-- After this migration:
--   * A quote event is a band event (not a rehearsal) that is tied to a quote
--     or marked as one (quote_id, event_type 'quote', status tentative /
--     quoted / quote) and is not confirmed or completed: the same rule the app
--     uses to tell quotes from gigs (AuthenticatedApp, isQuote).
--   * Quote events are readable by the band's active admins, the event's
--     creator and the members on its lineup (event_members, any answer).
--     Confirmed gigs, rehearsals and everything else: every active member,
--     as before.
--   * bw_can_view_event (lineup and rehearsal-task policies) follows the same
--     rule, so the lineup of a quote is not readable by the rest of the band.
--   * Notifications about a quote event go to its lineup; with no lineup, to
--     the band's admins only (they already see every quote; bw_notify skips
--     the admin who made the change), never to the whole band. "Gig
--     confirmed" still falls back to the whole band: once confirmed the gig is
--     visible to everyone.
--
-- Nothing changes for the app: it already hides quotes from members. Writes
-- are unchanged (072: admins).
--
-- Idempotent; safe to re-run on live data.

BEGIN;

-- Is this event a quote? Same rule as the app (rehearsals never are).
CREATE OR REPLACE FUNCTION public.bw_event_is_quote(p_status text, p_event_type text, p_quote_id uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT lower(coalesce(p_event_type, '')) <> 'rehearsal'
     AND lower(coalesce(p_status, '')) NOT IN ('confirmed', 'completed')
     AND (
       p_quote_id IS NOT NULL
       OR lower(coalesce(p_event_type, '')) = 'quote'
       OR lower(coalesce(p_status, '')) IN ('tentative', 'quoted', 'quote')
     );
$$;

-- On the event's lineup (any answer). SECURITY DEFINER: the events policy
-- below must not go through event_members' own policy.
CREATE OR REPLACE FUNCTION public.bw_is_on_event_lineup(p_event_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM event_members em
    WHERE em.event_id = p_event_id AND em.user_id = p_user_id
  );
$$;

REVOKE EXECUTE ON FUNCTION public.bw_event_is_quote(text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bw_is_on_event_lineup(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_event_is_quote(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bw_is_on_event_lineup(uuid, uuid) TO authenticated;

-- ── events: read ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS events_select_policy ON public.events;
CREATE POLICY events_select_policy ON public.events
  FOR SELECT TO authenticated
  USING (
    band_id IS NOT NULL
    AND public.bw_is_band_member(band_id)
    AND (
      NOT public.bw_event_is_quote(status, event_type, quote_id)
      OR public.bw_is_band_admin(band_id)
      OR created_by = auth.uid()
      OR public.bw_is_on_event_lineup(id)
    )
  );

-- ── bw_can_view_event (event_members, rehearsal_tasks) ───────────────────
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
            OR e.created_by = p_user_id
            OR public.bw_is_on_event_lineup(e.id, p_user_id)
          ))
        OR (e.band_id IS NULL AND e.created_by = p_user_id)
      )
  );
$$;

-- ── Notification recipients (046) ────────────────────────────────────────
-- p_private: the event is (or was) a quote. With no lineup, only the band's
-- admins are told instead of the whole band.
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
    AND coalesce(status, 'invited') NOT IN ('declined', 'dropped_out', 'removed');

  IF coalesce(array_length(v_ids, 1), 0) = 0 AND p_band_id IS NOT NULL THEN
    v_ids := public.bw_active_band_member_ids(p_band_id, coalesce(p_private, false));
  END IF;
  RETURN v_ids;
END;
$$;

-- The 2-argument form keeps working for any other caller: it looks the
-- event up and treats a quote as private.
CREATE OR REPLACE FUNCTION public.bw_event_recipient_ids(p_event_id uuid, p_band_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.bw_event_recipient_ids(
    p_event_id,
    p_band_id,
    coalesce((SELECT public.bw_event_is_quote(e.status, e.event_type, e.quote_id) FROM events e WHERE e.id = p_event_id), false)
  );
$$;

REVOKE ALL ON FUNCTION public.bw_event_recipient_ids(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_event_recipient_ids(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The live 046/089 trigger, with the quote rule passed to the recipients:
-- delete and cancel look at the event as it was, "confirmed" at the event
-- as it is now, other changes at both.
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
  v_was_quote := public.bw_event_is_quote(OLD.status, OLD.event_type, OLD.quote_id);

  IF TG_OP = 'DELETE' THEN
    -- Skip drafts nobody was told about.
    IF coalesce(OLD.status, '') IN ('draft') THEN RETURN OLD; END IF;
    v_recipients := public.bw_event_recipient_ids(OLD.id, OLD.band_id, v_was_quote);
    PERFORM public.bw_notify(v_recipients, OLD.band_id, 'event_cancelled',
      v_label || ' cancelled', OLD.title || ' · ' || v_when || ' was removed from the calendar.',
      v_data || jsonb_build_object('deleted', true), OLD.id, 'event');
    RETURN OLD;
  END IF;

  v_is_quote := public.bw_event_is_quote(NEW.status, NEW.event_type, NEW.quote_id);

  -- UPDATE
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'cancelled' THEN
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
    RETURN NEW;
  END IF;

  IF NEW.status = 'draft' THEN RETURN NEW; END IF;

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
    v_recipients := public.bw_event_recipient_ids(NEW.id, NEW.band_id, v_was_quote OR v_is_quote);
    PERFORM public.bw_notify(v_recipients, NEW.band_id, 'event_update',
      v_label || ' updated', NEW.title || ' · ' || v_when || ' — new ' || array_to_string(v_changes, ', ') || '.',
      v_data || jsonb_build_object('changes', to_jsonb(v_changes)), NEW.id, 'event', interval '2 minutes');
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- Never block the calendar because of a notification.
  RAISE WARNING 'bw_trg_event_changed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$function$;

COMMIT;
