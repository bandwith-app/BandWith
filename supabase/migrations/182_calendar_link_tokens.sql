-- ============================================================================
-- 182: calendar links carry no feed or reply credential
-- ----------------------------------------------------------------------------
-- Codex audit of release 383f15b: 02 #3 / 03 #2, 02 #5 / 03 #6, 02 #11, and
-- the reviews of PR #285.
--
-- Deputies (084, 086, 087)
--   The deputy calendar (edge function deputy-calendar) was keyed by the
--   request's reply token, and every entry carried the reply link
--   (/deputy.html?t=...) in DESCRIPTION and URL. Whoever saw the entry (a
--   shared or family calendar, a forwarded invite) could see the offered fee
--   and change the answer; bw_deputy_feed also handed out the reply tokens
--   of the deputy's other gigs with the band, by any of their tokens.
--
--   - Two read-only keys per request, neither of which answers or opens the
--     reply page (bw_deputy_request_view/reply look up `token` only):
--       calendar_token      the subscription: the deputy's gigs with the band;
--       gig_calendar_token  "Add to calendar": the file of this one gig, so a
--                           forwarded file link shows that gig and nothing else.
--   - bw_deputy_request_view returns both (the reply page, and the in-app
--     deputy gigs through bw_my_deputy_gigs).
--   - bw_deputy_calendar_feed(token): the subscription, by calendar token, or
--     by reply token for subscriptions made before 182 (kept working; see
--     the PR for the sunset). No tokens in the result; `mine` = the gig of
--     the link (one=1 of old links).
--   - bw_deputy_gig_calendar(token): that one gig, by gig_calendar_token.
--   - A gig is in the calendar while the deputy said yes, and as cancelled
--     only if they had said yes before it was withdrawn (was_available; a
--     "maybe" leaves no trace). The street address only while they are on it
--     and the gig is on: once the band cancels the event (the request can
--     stay 'available'), no link or page gives the address any more.
--   - bw_deputy_feed (084, called by the function deployed before 182): same
--     rules, also takes the calendar token, and returns no token at all, so
--     the old function writes no credential either.
--   - bw_deputy_unlink (087) rotates all three keys, also for a deputy with
--     no account, then answers 'revoked' (087 answered 'not_linked' without
--     rotating; older builds only call it for linked deputies, which still
--     get 'unlinked').
--   - bw_deputy_revoke_links: "Revoke sent links" for a deputy with no
--     account. It never unlinks: if they joined meanwhile it changes
--     nothing and answers 'linked'.
--   - bw_deputy_claim (086) locks the deputy before it trusts the token, so a
--     claim waiting on an unlink or a revoke can't link with the old token.
--   - Deleting a deputy rotates their requests' keys first (trigger; older
--     builds delete the row directly). Requests of deputies deleted before
--     182 (deputy_id NULL) get new keys when 182 runs, and the reply page of
--     a request with no deputy is closed, without fee, address or keys, and
--     says 'removed': true (the only branch that sends it).
--   - A cancelled event in either spelling ('cancelled', 'canceled', any
--     case): bw_event_status_cancelled, used by every check here.
--   - A date deleted from its series since (skip_dates, #297;
--     bw_event_date_deleted): both deputy calendars and the reply page
--     show it cancelled, without the address (a request is on the series'
--     first date, so deleting that date is the case). The member feed
--     writes an EXDATE per deleted date (edge function, from the rule's
--     skip_dates).
--   - A gig reverted to a private quote (#294's 178, bw_event_deputy_hidden):
--     out of both calendars and the old feed, and the reply page closed,
--     without detail, offer (fee, currency), note or calendar keys, as a
--     closed request ('status' 'cancelled', as #294's 178); the deputy's
--     in-app list (bw_my_deputy_gigs, 086) shows that page.
--   - A request withdrawn after a yes stays as the deputy last saw it: the
--     gig of their answer (answer_snapshot, which now keeps the title too),
--     never later changes, no street address (bw_deputy_frozen_gig). Those
--     withdrawn before 182 get, once, the title their gig has when 182 runs.
--   Replies on a withdrawn (cancelled) request were already refused (084:
--   'closed'); unchanged.
--
-- Members (165)
--   "Add to calendar" on one event downloaded member-calendar?t=<account feed
--   token>&e=<event>: forwarding that link handed over the whole calendar.
--   One date of a repeating rehearsal also imported the whole series.
--
--   - calendar_event_links: a token per (user, event, date of a repeating
--     event), off calendar_feeds, so "Make a new link" ends them too. The
--     date must be a real date of the series, from 60 days back to two
--     years ahead; at most 500 links per account (the oldest go).
--   - bw_my_event_calendar_token(event, date): the signed-in user's token for
--     one event their calendar shows (same rule as the feed,
--     bw_member_calendar_event: that one event, not the whole feed), made on
--     the first tap, else NULL. bw_my_event_calendar_link(event, date): the
--     same link if it exists, read only (opening an event writes nothing).
--     The date the user opened stays, also a past first date; a series asked
--     without a date gets its next date from today
--     (bw_calendar_next_occurrence), and no link once none is left (never
--     its first date). "Today" is the earliest date still
--     current on Earth (bw_calendar_today, UTC-12), never the server's UTC
--     date: events and bands keep no time zone. Accepted cost (Claude review
--     r5): far east of UTC (New Zealand, UTC+13) a date counts as today for
--     up to a day after it ended locally, so yesterday's link still opens
--     and a series asked without a date may give yesterday's date until the
--     day ends at UTC-12. Nothing more is shown than on that date itself.
--   - bw_member_event_calendar(token): that one event as a single date, never
--     the series rule or start; NULL once the user no longer sees it or the
--     date is no longer in the series.
--   - The one-event links shared before 182 carry the account token:
--     calendar_feeds.review_link marks the accounts to ask once (the app
--     offers "Make a new link" or "Keep my link"): every link made before
--     182, and any served again in the old one-event form (t=&e=, older app
--     builds; bw_member_calendar_flag_shared, called by member-calendar),
--     unless the owner chose "Keep my link" for it (review_kept). 165 keeps
--     no record of which feeds a calendar fetched, so every account with a
--     link made before 182 is asked once (accepted: nothing narrower to go
--     by).
--   - A date of a series: a deleted date (recurrence_rule.skip_dates) is
--     none; monthly on the 29th-31st takes the last day of shorter months
--     (bw_calendar_monthly_date), counted from the first date.
--   The account feed (bw_member_calendar_feed) is unchanged.
--
-- Deploy order: deploy the edge functions deputy-calendar and
-- member-calendar BEFORE applying 182. Both work on the database before 182
-- (deputy-calendar falls back to bw_deputy_feed and picks the gig of a
-- one=1 link by its token there). Applied first, 182 leaves the function
-- deployed before it writing empty one=1 files until it is redeployed, by
-- design: the only value that old function can match is the reply token,
-- which is the credential 182 takes out of calendar files.
--
-- Order: 178 (#294) BEFORE 182, hard: 182 stops at its first statement
-- when 178's bw_event_deputy_hidden is missing.
--
-- Older app builds: no signature they call changes. Safe to run more than
-- once.
-- ============================================================================

BEGIN;

-- 178 first (hard order, Codex review of #285 round 5): the deputy views
-- below hide a gig reverted to a private quote through its
-- bw_event_deputy_hidden, the member's one-event link through its
-- bw_event_quote_hidden. Without them, stop here rather than show it.
DO $$
BEGIN
  IF to_regprocedure('public.bw_event_deputy_hidden(uuid)') IS NULL THEN
    RAISE EXCEPTION '182 needs 178 first: public.bw_event_deputy_hidden(uuid) is missing (apply 178_date_on_hold.sql, then 182)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.bw_event_quote_hidden(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION '182 needs 178 first: public.bw_event_quote_hidden(uuid, uuid) is missing (apply 178_date_on_hold.sql, then 182)'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- -------------------------------------------------- deputy calendar keys --

DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['calendar_token', 'gig_calendar_token'] LOOP
    EXECUTE format('ALTER TABLE public.deputy_requests ADD COLUMN IF NOT EXISTS %I text', c);
    EXECUTE format($q$UPDATE public.deputy_requests
                       SET %I = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
                     WHERE %I IS NULL$q$, c, c);
    EXECUTE format($q$ALTER TABLE public.deputy_requests
                       ALTER COLUMN %I SET DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
                       ALTER COLUMN %I SET NOT NULL$q$, c, c);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.deputy_requests (%I)', 'deputy_requests_' || c || '_key', c);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deputy_requests_' || c || '_check') THEN
      EXECUTE format($q$ALTER TABLE public.deputy_requests ADD CONSTRAINT %I CHECK (%I ~ '^[0-9a-f]{64}$')$q$,
                     'deputy_requests_' || c || '_check', c);
    END IF;
  END LOOP;
END
$$;

-- Whether the deputy said yes before the request was withdrawn: only then a
-- withdrawn request stays in their calendar (as cancelled). Before 182 the
-- answer before a withdrawal was not kept: those stay out.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'deputy_requests' AND column_name = 'was_available') THEN
    ALTER TABLE public.deputy_requests ADD COLUMN was_available boolean NOT NULL DEFAULT false;
    UPDATE public.deputy_requests SET was_available = true WHERE status = 'available';
  END IF;
END
$$;

-- 084's snapshot of the gig at the answer, now with its title too: a
-- withdrawn gig stays in the deputy's calendar as it was (Claude review of
-- #285, round 5). The keys 084 compares are unchanged.
CREATE OR REPLACE FUNCTION public.bw_deputy_event_snapshot(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'date', coalesce(e.event_date, e.date),
           'load_in', left(e.load_in_time::text, 5),
           'soundcheck', left(e.soundcheck_time::text, 5),
           'start', left(coalesce(e.start_time, e.time)::text, 5),
           'end', left(e.end_time::text, 5),
           'venue', coalesce(e.venue_name, e.venue),
           'city', e.venue_city,
           'address', e.venue_address,
           'title', e.title
         )
    FROM public.events e
   WHERE e.id = p_event_id;
$$;
REVOKE ALL ON FUNCTION public.bw_deputy_event_snapshot(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_trg_deputy_request_was_available()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.was_available := CASE
    WHEN NEW.status = 'available' THEN true
    WHEN NEW.status = 'cancelled' AND TG_OP = 'UPDATE' THEN coalesce(OLD.was_available, false) OR OLD.status = 'available'
    ELSE false END;
  -- Withdrawn after an answer saved before 182 (no title in it): keep the
  -- title it has now, so nothing of the entry follows the gig any more.
  IF NEW.status = 'cancelled' AND NEW.answer_snapshot IS NOT NULL AND NOT (NEW.answer_snapshot ? 'title') THEN
    NEW.answer_snapshot := NEW.answer_snapshot
      || jsonb_build_object('title', (SELECT e.title FROM public.events e WHERE e.id = NEW.event_id));
  END IF;
  RETURN NEW;
END;
$$;

-- A withdrawn request, as the deputy last saw it (Claude review of #285,
-- round 5): the gig as it was at their answer, never later changes, and no
-- street address. Merged over the live fields of the reply page and both
-- calendars.
CREATE OR REPLACE FUNCTION public.bw_deputy_frozen_gig(p_snap jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_snap IS NULL OR jsonb_typeof(p_snap) <> 'object' THEN '{}'::jsonb ELSE
    jsonb_build_object(
      'event_date', p_snap->'date', 'load_in_time', p_snap->'load_in', 'soundcheck_time', p_snap->'soundcheck',
      'start_time', p_snap->'start', 'end_time', p_snap->'end', 'venue_name', p_snap->'venue',
      'venue_city', p_snap->'city', 'venue_address', NULL)
    || CASE WHEN p_snap ? 'title' THEN jsonb_build_object('event_title', p_snap->'title') ELSE '{}'::jsonb END
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_deputy_frozen_gig(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_trg_deputy_request_was_available() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_deputy_request_was_available ON public.deputy_requests;
CREATE TRIGGER bw_deputy_request_was_available BEFORE INSERT OR UPDATE OF status ON public.deputy_requests
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_deputy_request_was_available();

-- Withdrawn before 182 (Claude review #285 round 5, M3): those snapshots have
-- no title, and the trigger above only sees later withdrawals. Once, now:
-- the title the gig has today. Rows that have one are left alone, so a
-- second run changes nothing.
UPDATE public.deputy_requests r
   SET answer_snapshot = r.answer_snapshot || jsonb_build_object('title', e.title)
  FROM public.events e
 WHERE e.id = r.event_id
   AND r.status = 'cancelled'
   AND r.answer_snapshot IS NOT NULL
   AND jsonb_typeof(r.answer_snapshot) = 'object'
   AND NOT (r.answer_snapshot ? 'title');

-- A cancelled event, in either spelling and any case (Codex review #285
-- round 4): every check below goes through this one.
CREATE OR REPLACE FUNCTION public.bw_event_status_cancelled(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(lower(btrim(p_status)) IN ('cancelled', 'canceled'), false);
$$;
GRANT EXECUTE ON FUNCTION public.bw_event_status_cancelled(text) TO anon, authenticated;

-- A gig reverted to a private quote shows a deputy nothing: #294's 178,
-- bw_event_deputy_hidden, called directly (checked at the top: 178 comes
-- first). An earlier draft of 182 had a run-time lookup wrapper; never live.
DROP FUNCTION IF EXISTS public.bw_deputy_gig_hidden(uuid);

-- A date deleted from its series (recurrence_rule.skip_dates, #297, as
-- YYYY-MM-DD). The deputy calendars carry one date per request (no RRULE,
-- so no EXDATE): a request on a date deleted since shows as cancelled,
-- without the address (#297's Codex B4, routed to #285).
CREATE OR REPLACE FUNCTION public.bw_event_date_deleted(p_rule jsonb, p_date date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(p_date IS NOT NULL AND jsonb_typeof(p_rule) = 'object' AND jsonb_typeof(p_rule->'skip_dates') = 'array'
                  AND (p_rule->'skip_dates') ? to_char(p_date, 'YYYY-MM-DD'), false);
$$;
REVOKE ALL ON FUNCTION public.bw_event_date_deleted(jsonb, date) FROM PUBLIC, anon, authenticated;

-- -------------------------------------------- the reply page (084 + keys) --

CREATE OR REPLACE FUNCTION public.bw_deputy_request_view(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
  v_snap jsonb;
  v_now jsonb;
  v_status text;
  v_changes jsonb := '[]'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_cancelled boolean;
  v_hidden boolean;
  v_orphan boolean;
  k text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  -- Cancelled: the gig cancelled, or its date deleted from the series
  -- (skip_dates, #297). A request is on the series row, so its date is the
  -- series' first date (Codex review #285 @ 6ab65eb9, B2): the same as the
  -- calendars (bw_event_date_deleted).
  SELECT r.answer_snapshot, r.status, public.bw_deputy_event_snapshot(r.event_id),
         public.bw_event_status_cancelled(e.status::text)
           OR public.bw_event_date_deleted(e.recurrence_rule, coalesce(e.event_date, e.date)),
         public.bw_event_deputy_hidden(r.event_id),
         r.deputy_id IS NULL
    INTO v_snap, v_status, v_now, v_cancelled, v_hidden, v_orphan
    FROM public.deputy_requests r
    JOIN public.events e ON e.id = r.event_id
   WHERE r.token = p_token;
  -- What changed since the answer. The address counts only once they said
  -- yes (before that they never saw it), and never once the gig is
  -- cancelled (review of #285, round 3: neither the old nor the new one).
  -- An address the band cleared shows as changed, without the old one.
  IF v_snap IS NOT NULL AND v_status IN ('available', 'maybe') AND NOT coalesce(v_hidden, false) THEN
    FOREACH k IN ARRAY ARRAY['date', 'load_in', 'soundcheck', 'start', 'end', 'venue', 'city', 'address'] LOOP
      CONTINUE WHEN k = 'address' AND (v_status <> 'available' OR v_cancelled OR v_orphan);
      IF (v_snap->>k) IS DISTINCT FROM (v_now->>k) THEN
        v_changes := v_changes || to_jsonb(k);
        CONTINUE WHEN k = 'address' AND nullif(btrim(coalesce(v_now->>k, '')), '') IS NULL;
        v_before := v_before || jsonb_build_object(k, v_snap->k);
      END IF;
    END LOOP;
  END IF;

  SELECT jsonb_build_object(
           'status', r.status,
           'deputy_name', r.deputy_name,
           'role', r.role,
           'fee', r.fee_offered,
           'currency', coalesce(r.currency, e.currency),
           'reply_note', r.reply_note,
           'responded_at', r.responded_at,
           'band_name', b.name,
           'event_title', e.title,
           'event_type', e.event_type::text,
           'event_date', coalesce(e.event_date, e.date),
           'start_time', coalesce(e.start_time, e.time),
           'end_time', e.end_time,
           'load_in_time', e.load_in_time,
           'soundcheck_time', e.soundcheck_time,
           'venue_name', coalesce(e.venue_name, e.venue),
           'venue_city', e.venue_city,
           -- The street address only after they said yes, and while the
           -- gig is on (review of #285, round 2).
           'venue_address', CASE WHEN r.status = 'available' AND NOT v_cancelled THEN e.venue_address END,
           'event_cancelled', v_cancelled,
           'event_updated_at', e.updated_at,
           'changes', v_changes,
           'before', v_before,
           -- Read-only keys of the calendar (182): the subscription, and the
           -- file of this one gig.
           'calendar_token', r.calendar_token,
           'gig_calendar_token', r.gig_calendar_token,
           -- A day of slack for time zones.
           'closed', r.status = 'cancelled' OR v_cancelled
                     OR coalesce(e.event_date, e.date) < current_date - 1
         )
    INTO v
    FROM public.deputy_requests r
    JOIN public.events e ON e.id = r.event_id
    JOIN public.bands b ON b.id = r.band_id
   WHERE r.token = p_token;
  -- Withdrawn after an answer: the gig as it was then, no later change.
  IF v IS NOT NULL AND v_status = 'cancelled' AND v_snap IS NOT NULL THEN
    v := v || public.bw_deputy_frozen_gig(v_snap) || jsonb_build_object('event_updated_at', NULL);
  END IF;
  -- Reverted to a private quote (178): closed, and no detail of the gig,
  -- nor the offer or the calendar keys (Claude review of #285, round 5;
  -- bw_my_deputy_gigs, 086, returns this view). Shown as a closed request
  -- ('status' 'cancelled', as #294's 178 does): every build, 383f15b too,
  -- says "This request is closed" / "Request withdrawn", never "over" or
  -- "took you off this gig" (Claude review #285 r9).
  IF v IS NOT NULL AND coalesce(v_hidden, false) THEN
    v := v || jsonb_build_object(
      'event_title', NULL, 'event_type', NULL, 'event_date', NULL, 'start_time', NULL, 'end_time', NULL,
      'load_in_time', NULL, 'soundcheck_time', NULL, 'venue_name', NULL, 'venue_city', NULL,
      'venue_address', NULL, 'event_updated_at', NULL, 'changes', '[]'::jsonb, 'before', '{}'::jsonb,
      'fee', NULL, 'currency', NULL, 'reply_note', NULL, 'calendar_token', NULL, 'gig_calendar_token', NULL,
      'status', 'cancelled', 'event_cancelled', false, 'closed', true);
  END IF;
  -- The deputy was deleted from the band (deputy_id NULL; Codex review #285
  -- round 7): closed, without the offer, the address or the calendar keys.
  -- 'removed' (only here) is what the page keys "took you off this gig" on.
  -- A hidden gig stays 178's page exactly (no 'removed'): it says nothing
  -- of the gig, and the closed wording fits both.
  IF v IS NOT NULL AND coalesce(v_orphan, false) AND NOT coalesce(v_hidden, false) THEN
    v := v || jsonb_build_object(
      'fee', NULL, 'currency', NULL, 'reply_note', NULL, 'venue_address', NULL,
      'calendar_token', NULL, 'gig_calendar_token', NULL, 'closed', true, 'removed', true);
  END IF;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.bw_deputy_request_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_deputy_request_view(text) TO anon, authenticated;

-- ------------------------------------------------- the deputy's calendar --
-- The deputy's gigs with this band, by the calendar token of any of their
-- requests (or, for subscriptions made before 182, a reply token). No
-- tokens in the result.

CREATE OR REPLACE FUNCTION public.bw_deputy_calendar_feed(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.deputy_requests;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_req FROM public.deputy_requests WHERE calendar_token = p_token;
  IF v_req.id IS NULL THEN
    SELECT * INTO v_req FROM public.deputy_requests WHERE token = p_token;
  END IF;
  IF v_req.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'band_name', (SELECT b.name FROM public.bands b WHERE b.id = v_req.band_id),
    'gigs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id,
               'mine', r.id = v_req.id,
               'cancelled', r.status = 'cancelled' OR public.bw_event_status_cancelled(e.status::text)
                            OR public.bw_event_date_deleted(e.recurrence_rule, coalesce(e.event_date, e.date)),
               'role', r.role,
               'event_title', e.title,
               'event_date', coalesce(e.event_date, e.date),
               'start_time', coalesce(e.start_time, e.time),
               'end_time', e.end_time,
               'load_in_time', e.load_in_time,
               'soundcheck_time', e.soundcheck_time,
               'venue_name', coalesce(e.venue_name, e.venue),
               'venue_city', e.venue_city,
               -- The street address only while they are on it and the gig is
               -- on (as the page): a band's cancellation leaves the request
               -- 'available' (review of #285, round 2).
               'venue_address', CASE WHEN r.status = 'available' AND NOT public.bw_event_status_cancelled(e.status::text)
                                      AND NOT public.bw_event_date_deleted(e.recurrence_rule, coalesce(e.event_date, e.date)) THEN e.venue_address END,
               'updated_at', CASE WHEN r.status = 'cancelled' THEN r.updated_at ELSE greatest(e.updated_at, r.updated_at) END
             )
             -- Withdrawn: the gig as it was at their answer (round 5).
             || CASE WHEN r.status = 'cancelled' THEN public.bw_deputy_frozen_gig(r.answer_snapshot) ELSE '{}'::jsonb END
             ORDER BY coalesce(CASE WHEN r.status = 'cancelled' THEN (r.answer_snapshot->>'date')::date END, e.event_date, e.date))
        FROM public.deputy_requests r
        JOIN public.events e ON e.id = r.event_id
       WHERE r.band_id = v_req.band_id
         AND (r.id = v_req.id OR (v_req.deputy_id IS NOT NULL AND r.deputy_id = v_req.deputy_id))
         AND (r.status = 'available' OR (r.status = 'cancelled' AND r.was_available))
         AND coalesce(CASE WHEN r.status = 'cancelled' THEN (r.answer_snapshot->>'date')::date END, e.event_date, e.date) >= current_date - 60
         AND NOT public.bw_event_deputy_hidden(e.id)
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_deputy_calendar_feed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_deputy_calendar_feed(text) TO anon, authenticated;

-- "Add to calendar": the one gig of its gig_calendar_token, same shape.
CREATE OR REPLACE FUNCTION public.bw_deputy_gig_calendar(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.deputy_requests;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_req FROM public.deputy_requests WHERE gig_calendar_token = p_token;
  IF v_req.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'band_name', (SELECT b.name FROM public.bands b WHERE b.id = v_req.band_id),
    'gigs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id,
               'mine', r.id = v_req.id,
               'cancelled', r.status = 'cancelled' OR public.bw_event_status_cancelled(e.status::text)
                            OR public.bw_event_date_deleted(e.recurrence_rule, coalesce(e.event_date, e.date)),
               'role', r.role,
               'event_title', e.title,
               'event_date', coalesce(e.event_date, e.date),
               'start_time', coalesce(e.start_time, e.time),
               'end_time', e.end_time,
               'load_in_time', e.load_in_time,
               'soundcheck_time', e.soundcheck_time,
               'venue_name', coalesce(e.venue_name, e.venue),
               'venue_city', e.venue_city,
               -- The street address only while they are on it and the gig is
               -- on (as the page): a band's cancellation leaves the request
               -- 'available' (review of #285, round 2).
               'venue_address', CASE WHEN r.status = 'available' AND NOT public.bw_event_status_cancelled(e.status::text)
                                      AND NOT public.bw_event_date_deleted(e.recurrence_rule, coalesce(e.event_date, e.date)) THEN e.venue_address END,
               'updated_at', CASE WHEN r.status = 'cancelled' THEN r.updated_at ELSE greatest(e.updated_at, r.updated_at) END
             )
             -- Withdrawn: the gig as it was at their answer (round 5).
             || CASE WHEN r.status = 'cancelled' THEN public.bw_deputy_frozen_gig(r.answer_snapshot) ELSE '{}'::jsonb END)
        FROM public.deputy_requests r
        JOIN public.events e ON e.id = r.event_id
       WHERE r.id = v_req.id
         AND (r.status = 'available' OR (r.status = 'cancelled' AND r.was_available))
         AND coalesce(CASE WHEN r.status = 'cancelled' THEN (r.answer_snapshot->>'date')::date END, e.event_date, e.date) >= current_date - 60
         AND NOT public.bw_event_deputy_hidden(e.id)
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_deputy_gig_calendar(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_deputy_gig_calendar(text) TO anon, authenticated;

-- 084's feed, for the function deployed before 182: the same gigs, by
-- reply or calendar token, and `token` always NULL, so that function
-- writes a dead "?t=null" instead of a credential (and its one=1 file is
-- empty) until it is redeployed.
CREATE OR REPLACE FUNCTION public.bw_deputy_feed(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb := public.bw_deputy_calendar_feed(p_token);
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  -- The keys of 084 / 178's body: band_name, deputy_name, gigs (the
  -- request the key opens, as bw_deputy_calendar_feed finds it).
  RETURN jsonb_build_object(
    'band_name', v->'band_name',
    'deputy_name', coalesce(
      (SELECT r.deputy_name FROM public.deputy_requests r WHERE r.calendar_token = p_token),
      (SELECT r.deputy_name FROM public.deputy_requests r WHERE r.token = p_token)),
    'gigs', coalesce((
      SELECT jsonb_agg((g - 'mine') || jsonb_build_object('token', NULL))
        FROM jsonb_array_elements(v->'gigs') g
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_deputy_feed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_deputy_feed(text) TO anon, authenticated;

-- 087, rotating all three keys first, also when no account is linked: an
-- admin can always end a forwarded link.
CREATE OR REPLACE FUNCTION public.bw_deputy_unlink(p_deputy_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dep public.band_deputies;
BEGIN
  SELECT * INTO v_dep FROM public.band_deputies d WHERE d.id = p_deputy_id FOR UPDATE;
  IF v_dep.id IS NULL OR NOT public.bw_is_band_admin(v_dep.band_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.deputy_requests r
     SET token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         calendar_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         gig_calendar_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
   WHERE r.deputy_id = v_dep.id;

  -- No account: the links are new now. 'revoked', not 087's 'not_linked'
  -- (which rotated nothing), so the app can tell (review of #285, round 4).
  IF v_dep.user_id IS NULL THEN
    RETURN 'revoked';
  END IF;
  UPDATE public.band_deputies SET user_id = NULL, updated_at = now() WHERE id = v_dep.id;
  RETURN 'unlinked';
END;
$$;
REVOKE ALL ON FUNCTION public.bw_deputy_unlink(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_deputy_unlink(uuid) TO authenticated;

-- "Revoke sent links" (a deputy with no account), its own call so it can
-- never unlink anyone (Codex review of #285, round 5): the deputy row is
-- locked, as in the claim, so a join either lands first (then this changes
-- nothing and answers 'linked': the app shows the account and asks again)
-- or after (then its old link no longer matches and it can't link).
CREATE OR REPLACE FUNCTION public.bw_deputy_revoke_links(p_deputy_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dep public.band_deputies;
BEGIN
  SELECT * INTO v_dep FROM public.band_deputies d WHERE d.id = p_deputy_id FOR UPDATE;
  IF v_dep.id IS NULL OR NOT public.bw_is_band_admin(v_dep.band_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_dep.user_id IS NOT NULL THEN
    RETURN 'linked';
  END IF;
  UPDATE public.deputy_requests r
     SET token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         calendar_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         gig_calendar_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
   WHERE r.deputy_id = v_dep.id;
  RETURN 'revoked';
END;
$$;
REVOKE ALL ON FUNCTION public.bw_deputy_revoke_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_deputy_revoke_links(uuid) TO authenticated;

-- 086's claim, with the lock taken before the token is trusted.
CREATE OR REPLACE FUNCTION public.bw_deputy_claim(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.deputy_requests;
  v_dep public.band_deputies;
  v_band text;
  v_title text;
  v_who text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO v_req FROM public.deputy_requests WHERE token = p_token;
  IF v_req.id IS NULL OR v_req.deputy_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  -- The deputy first, then the token again (review of #285, round 4): a
  -- "Revoke sent links" or an unlink holding this lock rotates the tokens,
  -- and a claim that waited for it must not link with the old one.
  SELECT * INTO v_dep FROM public.band_deputies WHERE id = v_req.deputy_id FOR UPDATE;
  IF v_dep.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO v_req FROM public.deputy_requests WHERE token = p_token AND deputy_id = v_dep.id;
  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT b.name INTO v_band FROM public.bands b WHERE b.id = v_dep.band_id;

  IF v_dep.user_id = v_uid THEN
    RETURN jsonb_build_object('status', 'already', 'band_name', v_band, 'deputy_name', v_dep.name);
  END IF;
  IF v_dep.user_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'taken', 'band_name', v_band);
  END IF;
  -- A band member opening the link (an admin trying it) is not the deputy.
  IF EXISTS (SELECT 1 FROM public.band_members bm
              WHERE bm.band_id = v_dep.band_id AND bm.user_id = v_uid AND coalesce(bm.is_active, true)) THEN
    RETURN jsonb_build_object('status', 'member', 'band_name', v_band);
  END IF;

  UPDATE public.band_deputies SET user_id = v_uid, updated_at = now() WHERE id = v_dep.id;

  SELECT nullif(btrim(p.full_name), '') INTO v_who FROM public.profiles p WHERE p.id = v_uid;
  SELECT e.title INTO v_title FROM public.events e WHERE e.id = v_req.event_id;
  PERFORM public.bw_notify(
    ARRAY(SELECT bm.user_id FROM public.band_members bm
           WHERE bm.band_id = v_dep.band_id AND bm.role = 'admin' AND coalesce(bm.is_active, true)),
    v_dep.band_id, 'deputy_joined',
    v_dep.name || ' is on BandWith',
    'From now on you can ask them in the app.' || coalesce(' Account: ' || v_who || '.', ''),
    jsonb_build_object('deputy_id', v_dep.id, 'deputy_name', v_dep.name, 'account_name', v_who,
                       'event_id', v_req.event_id, 'eventTitle', v_title),
    v_dep.id, 'band_deputy'
  );

  RETURN jsonb_build_object('status', 'linked', 'band_name', v_band, 'deputy_name', v_dep.name);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_deputy_claim(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_deputy_claim(text) TO authenticated;

-- Deleting a deputy ends their links first (Claude review of #285, round 4):
-- the requests stay (deputy_id becomes NULL), and their reply, calendar and
-- gig-file keys would keep showing the gig and its address. Also for older
-- builds, which delete the row directly.
CREATE OR REPLACE FUNCTION public.bw_trg_band_deputy_delete_rotate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.deputy_requests r
     SET token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         calendar_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         gig_calendar_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
   WHERE r.deputy_id = OLD.id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_band_deputy_delete_rotate() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_band_deputy_delete_rotate ON public.band_deputies;
CREATE TRIGGER bw_band_deputy_delete_rotate BEFORE DELETE ON public.band_deputies
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_band_deputy_delete_rotate();

-- Deputies deleted before 182 (Codex review #285 round 7): no trigger then,
-- so their requests (deputy_id NULL) kept working keys. New keys for all of
-- them, now. Nobody may hold such a key, so another run changes nothing
-- anyone uses.
UPDATE public.deputy_requests r
   SET token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
       calendar_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
       gig_calendar_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 WHERE r.deputy_id IS NULL;

-- ------------------------------------------------ one event, for members --

-- A date of a repeating rehearsal, stepped as the app's calendar steps it
-- (src/lib/recurrence.ts; = isOccurrence in
-- supabase/functions/_shared/deputy-calendar.ts). Review of #285, round 3:
--   - a date the band deleted (recurrence_rule.skip_dates, #297) is none;
--   - monthly repeats count from the first date and fall on the last day of
--     a shorter month (Jan 31 -> Feb 28 -> Mar 31, #298), never run over.
-- The first date of a series on or after p_from (the app's rule, as
-- src/lib/recurrence.ts: weekly / biweekly / monthly by interval, counted
-- from the first date; a monthly date the month doesn't have is its last
-- day; deleted dates (skip_dates) skipped; until and count kept). NULL when
-- the series has none left.
-- A monthly series' date, p_months after its first (Codex review of #285,
-- round 5: one rule, here and in isOccurrence's monthlyDate): the first
-- date's day, else that month's last day, always counted from the first
-- date, so a short month carries nothing over (Jan 31 -> Feb 28 -> Mar 31).
CREATE OR REPLACE FUNCTION public.bw_calendar_monthly_date(p_start date, p_months int)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT m + (least(extract(day FROM p_start)::int, extract(day FROM (m + interval '1 month - 1 day'))::int) - 1)
    FROM (SELECT (date_trunc('month', p_start) + make_interval(months => p_months))::date AS m) x;
$$;
REVOKE ALL ON FUNCTION public.bw_calendar_monthly_date(date, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_calendar_next_occurrence(p_rule jsonb, p_start date, p_from date)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_freq text;
  v_every int := 1;
  v_count int := 1000;
  v_until text;
  v_skip jsonb;
  v_cur date;
BEGIN
  IF p_rule IS NULL OR jsonb_typeof(p_rule) <> 'object' OR p_start IS NULL OR p_from IS NULL THEN RETURN NULL; END IF;
  v_freq := lower(coalesce(p_rule->>'freq', p_rule->>'frequency', ''));
  IF v_freq NOT IN ('weekly', 'biweekly', 'monthly') THEN RETURN NULL; END IF;
  v_skip := CASE WHEN jsonb_typeof(p_rule->'skip_dates') = 'array' THEN p_rule->'skip_dates' ELSE '[]'::jsonb END;
  IF (p_rule->>'interval') ~ '^\d{1,2}$' AND (p_rule->>'interval')::int BETWEEN 1 AND 52 THEN v_every := (p_rule->>'interval')::int; END IF;
  IF (p_rule->>'count') ~ '^\d{1,4}$' AND (p_rule->>'count')::int BETWEEN 1 AND 1000 THEN v_count := (p_rule->>'count')::int; END IF;
  v_until := substring(coalesce(p_rule->>'until', '') FROM '^(\d{4}-\d{2}-\d{2})');
  FOR i IN 0..v_count LOOP
    IF i = 0 THEN v_cur := p_start;
    ELSIF v_freq = 'weekly' THEN v_cur := p_start + 7 * v_every * i;
    ELSIF v_freq = 'biweekly' THEN v_cur := p_start + 14 * i;
    ELSE v_cur := public.bw_calendar_monthly_date(p_start, v_every * i);
    END IF;
    IF i > 0 AND v_until IS NOT NULL AND to_char(v_cur, 'YYYY-MM-DD') > v_until THEN RETURN NULL; END IF;
    IF v_cur >= p_from AND NOT (v_skip ? to_char(v_cur, 'YYYY-MM-DD')) THEN RETURN v_cur; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_calendar_next_occurrence(jsonb, date, date) FROM PUBLIC, anon, authenticated;

-- One of the series' real dates: the first one on or after it is itself.
CREATE OR REPLACE FUNCTION public.bw_calendar_is_occurrence(p_rule jsonb, p_start date, p_date date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_date IS NOT NULL AND public.bw_calendar_next_occurrence(p_rule, p_start, p_date) IS NOT DISTINCT FROM p_date;
$$;
REVOKE ALL ON FUNCTION public.bw_calendar_is_occurrence(jsonb, date, date) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.calendar_event_links (
  -- 64 hex characters from two random UUIDs (244 random bits).
  token text PRIMARY KEY
    DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    CHECK (token ~ '^[0-9a-f]{64}$'),
  -- Off the account link: rotating it (bw_my_calendar_token(true)) ends these.
  user_id uuid NOT NULL REFERENCES public.calendar_feeds(user_id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  -- The date of a repeating event; NULL for a one-off.
  occurrence date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_links_one
  ON public.calendar_event_links (user_id, event_id, coalesce(occurrence, 'infinity'::date));
CREATE INDEX IF NOT EXISTS calendar_event_links_event_idx ON public.calendar_event_links (event_id);
CREATE INDEX IF NOT EXISTS calendar_event_links_user_idx ON public.calendar_event_links (user_id, created_at);

ALTER TABLE public.calendar_event_links ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: only the functions below touch it.
REVOKE ALL ON public.calendar_event_links FROM PUBLIC, anon, authenticated;

-- "Today" for a member's date (Codex review of #285, round 5): never the
-- server's UTC date. Events and bands keep no time zone (only
-- profiles.timezone, which the app doesn't keep current), so it is the
-- earliest date still current somewhere on Earth (UTC-12): a date counts as
-- past only once it is past everywhere, and a member whose day is behind UTC
-- (Los Angeles after midnight UTC) keeps the date they see.
CREATE OR REPLACE FUNCTION public.bw_calendar_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE 'Etc/GMT+12')::date;
$$;
REVOKE ALL ON FUNCTION public.bw_calendar_today() FROM PUBLIC, anon, authenticated;

-- One event as the account feed shows it to p_uid (165's
-- bw_member_calendar_feed: the same rule and the same fields), or NULL. One
-- row, by its id: opening an event no longer builds the whole feed (Claude
-- review of #285, round 5). The PGlite check holds it equal to the feed.
CREATE OR REPLACE FUNCTION public.bw_member_calendar_event(p_uid uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'id', e.id,
           'type', CASE WHEN lower(coalesce(e.event_type, '')) = 'rehearsal' THEN 'rehearsal'
                        WHEN e.band_id IS NULL THEN 'personal'
                        ELSE 'gig' END,
           'title', e.title,
           'band_name', b.name,
           'event_date', coalesce(e.event_date, e.date),
           'start_time', coalesce(e.start_time, e.time),
           'end_time', e.end_time,
           'load_in_time', e.load_in_time,
           'soundcheck_time', e.soundcheck_time,
           'venue_name', coalesce(e.venue_name, e.venue),
           'venue_city', e.venue_city,
           'venue_address', coalesce(e.venue_address, e.address),
           'role', em.role,
           'recurrence', CASE WHEN e.is_recurring THEN e.recurrence_rule END,
           'updated_at', e.updated_at
         )
    FROM public.events e
    LEFT JOIN public.bands b ON b.id = e.band_id
    LEFT JOIN public.band_members bm
      ON bm.band_id = e.band_id AND bm.user_id = p_uid
     AND coalesce(bm.is_active, true) AND bm.left_at IS NULL
    LEFT JOIN public.event_members em ON em.event_id = e.id AND em.user_id = p_uid
   WHERE e.id = p_event_id AND p_uid IS NOT NULL
     AND coalesce(e.event_date, e.date) IS NOT NULL
     AND (coalesce(e.event_date, e.date) >= current_date - 60 OR e.is_recurring)
     AND lower(coalesce(e.status, '')) NOT IN ('cancelled', 'canceled', 'draft', 'pending')
     AND NOT (
       (e.quote_id IS NOT NULL OR lower(coalesce(e.event_type, '')) = 'quote'
         OR lower(coalesce(e.status, '')) IN ('tentative', 'quoted', 'quote'))
       AND lower(coalesce(e.status, '')) NOT IN ('confirmed', 'completed')
     )
     AND (
       (e.band_id IS NULL AND e.created_by = p_uid)
       OR (bm.role::text = 'admin' AND coalesce(em.status, '') <> 'declined')
       OR (bm.id IS NOT NULL AND em.id IS NOT NULL AND coalesce(em.status, '') <> 'declined')
     )
     -- A gig reverted to a private quote (#294's 178): nothing for whoever
     -- may not read it, as everywhere a link or token reads an event.
     AND NOT public.bw_event_quote_hidden(e.id, p_uid)
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.bw_member_calendar_event(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The date a link of that event is for: NULL for a one-off; for a series,
-- one of its real dates from 60 days back to two years ahead. The date the
-- user opened stays, also a past first date (Claude review of #285, round
-- 5); only with no date (a notification, a link) it is the next date from
-- today. ok = false: no link for that date.
CREATE OR REPLACE FUNCTION public.bw_calendar_link_date(p_event jsonb, p_date date, OUT ok boolean, OUT occ date)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_today date := public.bw_calendar_today();
  v_start date;
BEGIN
  ok := p_event IS NOT NULL;
  occ := NULL;
  IF NOT ok OR jsonb_typeof(p_event->'recurrence') <> 'object' THEN RETURN; END IF;
  v_start := (p_event->>'event_date')::date;
  -- No date and none left (the series ended): no link, never its first
  -- date (Codex review #285 round 7); the file link answers 404.
  occ := coalesce(p_date, public.bw_calendar_next_occurrence(p_event->'recurrence', v_start, v_today));
  ok := occ IS NOT NULL AND occ >= v_today - 60 AND occ <= v_today + 731
        AND public.bw_calendar_is_occurrence(p_event->'recurrence', v_start, occ);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_calendar_link_date(jsonb, date) FROM PUBLIC, anon, authenticated;

-- Opening an event: the link it already has, or NULL. Reads only (STABLE:
-- it can't write), so an open costs no write (Claude review of #285, round
-- 5); the link is made on the first tap (bw_my_event_calendar_token).
CREATE OR REPLACE FUNCTION public.bw_my_event_calendar_link(p_event_id uuid, p_date date DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_when record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF p_event_id IS NULL THEN RETURN NULL; END IF;
  v_when := public.bw_calendar_link_date(public.bw_member_calendar_event(v_uid, p_event_id), p_date);
  IF NOT coalesce(v_when.ok, false) THEN RETURN NULL; END IF;
  RETURN (SELECT l.token FROM public.calendar_event_links l
           WHERE l.user_id = v_uid AND l.event_id = p_event_id
             AND coalesce(l.occurrence, 'infinity'::date) = coalesce(v_when.occ, 'infinity'::date));
END;
$$;
REVOKE ALL ON FUNCTION public.bw_my_event_calendar_link(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_my_event_calendar_link(uuid, date) TO authenticated;

-- The tap: the link of that event (and date), made if it has none.
CREATE OR REPLACE FUNCTION public.bw_my_event_calendar_token(p_event_id uuid, p_date date DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_when record;
  v_token text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF p_event_id IS NULL THEN RETURN NULL; END IF;
  -- Only an event the user's calendar shows (the feed's rule, 165), and
  -- for a series one of its real dates.
  v_when := public.bw_calendar_link_date(public.bw_member_calendar_event(v_uid, p_event_id), p_date);
  IF NOT coalesce(v_when.ok, false) THEN RETURN NULL; END IF;

  -- Already made: nothing to write.
  SELECT l.token INTO v_token FROM public.calendar_event_links l
   WHERE l.user_id = v_uid AND l.event_id = p_event_id
     AND coalesce(l.occurrence, 'infinity'::date) = coalesce(v_when.occ, 'infinity'::date);
  IF v_token IS NOT NULL THEN RETURN v_token; END IF;

  INSERT INTO public.calendar_feeds (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
  -- Locked: two devices making links at once take turns, so the 500 cap
  -- below holds (review of #285, round 3).
  PERFORM 1 FROM public.calendar_feeds WHERE user_id = v_uid FOR UPDATE;

  INSERT INTO public.calendar_event_links (user_id, event_id, occurrence)
  VALUES (v_uid, p_event_id, v_when.occ)
  ON CONFLICT (user_id, event_id, coalesce(occurrence, 'infinity'::date)) DO NOTHING;
  SELECT l.token INTO v_token FROM public.calendar_event_links l
   WHERE l.user_id = v_uid AND l.event_id = p_event_id
     AND coalesce(l.occurrence, 'infinity'::date) = coalesce(v_when.occ, 'infinity'::date);

  -- At most 500 links per account: the oldest go (never this one).
  DELETE FROM public.calendar_event_links l
   WHERE l.user_id = v_uid AND l.token <> v_token
     AND l.token NOT IN (SELECT k.token FROM public.calendar_event_links k
                          WHERE k.user_id = v_uid AND k.token <> v_token
                          ORDER BY k.created_at DESC, k.token LIMIT 499);
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_my_event_calendar_token(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_my_event_calendar_token(uuid, date) TO authenticated;

-- What an event link shows: that one event as a single date, while its
-- owner still sees it. Never the series rule or its first date. Called by
-- the edge function with the publishable key, as the feed.
--   repeating now, link for a date   that date, if still in the series;
--   repeating now, link for a one-off its first date still on, else none;
--   one-off now, link for a date      only if it is the event's date.
CREATE OR REPLACE FUNCTION public.bw_member_event_calendar(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.calendar_event_links;
  v_event jsonb;
  v_start date;
  v_date date;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_link FROM public.calendar_event_links WHERE token = p_token;
  IF v_link.token IS NULL THEN RETURN NULL; END IF;
  v_event := public.bw_member_calendar_event(v_link.user_id, v_link.event_id);
  IF v_event IS NULL THEN RETURN NULL; END IF;

  v_start := (v_event->>'event_date')::date;
  IF jsonb_typeof(v_event->'recurrence') = 'object' THEN
    IF v_link.occurrence IS NULL THEN
      -- A link made while it was a one-off: its first date still on, from
      -- the first (a deleted first date gives the next one); none left, no
      -- file (Codex review #285 @ 0b5765f0, M4).
      v_date := public.bw_calendar_next_occurrence(v_event->'recurrence', v_start, v_start);
      IF v_date IS NULL THEN RETURN NULL; END IF;
    ELSIF public.bw_calendar_is_occurrence(v_event->'recurrence', v_start, v_link.occurrence) THEN
      v_date := v_link.occurrence;
    ELSE
      RETURN NULL;
    END IF;
  ELSE
    IF v_link.occurrence IS NOT NULL AND v_link.occurrence IS DISTINCT FROM v_start THEN RETURN NULL; END IF;
    v_date := v_start;
  END IF;

  RETURN jsonb_build_object(
    'language', (SELECT p.preferred_language FROM public.profiles p WHERE p.id = v_link.user_id),
    'occurrence', v_link.occurrence,
    'event', v_event || jsonb_build_object('event_date', v_date, 'recurrence', NULL)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_member_event_calendar(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_member_event_calendar(text) TO anon, authenticated;

-- ------------------------------------ links shared before 182: ask once --

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'calendar_feeds' AND column_name = 'review_link') THEN
    ALTER TABLE public.calendar_feeds ADD COLUMN review_link boolean NOT NULL DEFAULT false;
    -- Every account link made before 182 may sit in a shared one-event link.
    UPDATE public.calendar_feeds SET review_link = true;
  END IF;
END
$$;
-- The owner chose "Keep my link" for this account link: not asked again
-- (review of #285, round 3). A new link (new row) starts without it.
ALTER TABLE public.calendar_feeds ADD COLUMN IF NOT EXISTS review_kept boolean NOT NULL DEFAULT false;

-- Whether the app should ask the signed-in user to replace their link.
CREATE OR REPLACE FUNCTION public.bw_my_calendar_link_review()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT f.review_link FROM public.calendar_feeds f WHERE f.user_id = auth.uid()), false);
$$;
REVOKE ALL ON FUNCTION public.bw_my_calendar_link_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_my_calendar_link_review() TO authenticated;

-- "Keep my link". (A new link, bw_my_calendar_token(true), starts unmarked.)
CREATE OR REPLACE FUNCTION public.bw_my_calendar_link_keep()
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.calendar_feeds SET review_link = false, review_kept = true WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.bw_my_calendar_link_keep() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_my_calendar_link_keep() TO authenticated;

-- member-calendar served a one-event link in the old form (t=&e=, app
-- builds before 182): ask the owner again, unless they already answered
-- "Keep my link" for this link (their own taps on older builds use the same
-- form). The token is the key; marking only shows them the question.
CREATE OR REPLACE FUNCTION public.bw_member_calendar_flag_shared(p_token text)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.calendar_feeds SET review_link = true
   WHERE token = p_token AND p_token ~ '^[0-9a-f]{64}$' AND NOT review_link AND NOT review_kept;
$$;
REVOKE ALL ON FUNCTION public.bw_member_calendar_flag_shared(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_member_calendar_flag_shared(text) TO anon, authenticated;

COMMIT;
