-- ============================================================================
-- 182: calendar links carry no feed or reply credential
-- ----------------------------------------------------------------------------
-- Codex audit of release 383f15b: 02 #3 / 03 #2, 02 #5 / 03 #6, 02 #11.
--
-- Deputies (084, 086, 087)
--   The deputy calendar (edge function deputy-calendar) was keyed by the
--   request's reply token, and every entry carried the reply link
--   (/deputy.html?t=...) in DESCRIPTION and URL. Whoever saw the entry (a
--   shared or family calendar, a forwarded invite) could see the offered fee
--   and change the answer; bw_deputy_feed also handed out the reply tokens
--   of the deputy's other gigs with the band, by any of their tokens.
--
--   - deputy_requests.calendar_token: a separate read-only key per request
--     (64 hex), for the calendar file and subscription only. It opens no
--     reply page and no answer: bw_deputy_request_view/reply look up `token`.
--   - bw_deputy_request_view also returns calendar_token (the reply page and
--     the in-app deputy gigs, via bw_my_deputy_gigs, build calendar links
--     with it).
--   - bw_deputy_calendar_feed(token): what the calendar shows, by calendar
--     token, or by reply token for the subscriptions made before 182 (they
--     keep working). Same gigs as bw_deputy_feed; no tokens at all, `mine`
--     marks the gig of the link (one=1).
--   - bw_deputy_feed (084, still called by the deployed function until it is
--     redeployed): returns the caller's own token only, never the others'.
--   - bw_deputy_unlink (087) rotates calendar_token too, so a forwarded
--     subscription stops with the reply link.
--   Replies on a withdrawn (cancelled) request were already refused (084:
--   'closed'); unchanged.
--
-- Members (165)
--   "Add to calendar" on one event downloaded member-calendar?t=<account feed
--   token>&e=<event>: forwarding that link handed over the whole calendar.
--   One date of a repeating rehearsal also imported the whole series.
--
--   - calendar_event_links: a token per (user, event, date of a repeating
--     event). It hangs off calendar_feeds, so "Make a new link" (rotate)
--     ends these links too.
--   - bw_my_event_calendar_token(event, date): the signed-in user's token for
--     one event they see in their calendar (same rule as the feed), else
--     NULL.
--   - bw_member_event_calendar(token): that one event (and the date), while
--     the user still sees it; NULL otherwise.
--   The account feed (bw_member_calendar_feed) is unchanged, and so is
--   t=&e= for app builds before 182.
--
-- Older app builds: no signature they call changes. Safe to run more than
-- once.
-- ============================================================================

BEGIN;

-- ------------------------------------------------ deputy calendar token --

ALTER TABLE public.deputy_requests ADD COLUMN IF NOT EXISTS calendar_token text;
UPDATE public.deputy_requests
   SET calendar_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 WHERE calendar_token IS NULL;
ALTER TABLE public.deputy_requests
  ALTER COLUMN calendar_token SET DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  ALTER COLUMN calendar_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS deputy_requests_calendar_token_key ON public.deputy_requests (calendar_token);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deputy_requests_calendar_token_check') THEN
    ALTER TABLE public.deputy_requests
      ADD CONSTRAINT deputy_requests_calendar_token_check CHECK (calendar_token ~ '^[0-9a-f]{64}$');
  END IF;
END
$$;

-- --------------------------------------------- the reply page (084 + key) --

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
  k text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT r.answer_snapshot, r.status, public.bw_deputy_event_snapshot(r.event_id)
    INTO v_snap, v_status, v_now
    FROM public.deputy_requests r WHERE r.token = p_token;
  -- What changed since the answer. The address counts only once they said
  -- yes (before that they never saw it).
  IF v_snap IS NOT NULL AND v_status IN ('available', 'maybe') THEN
    FOREACH k IN ARRAY ARRAY['date', 'load_in', 'soundcheck', 'start', 'end', 'venue', 'city', 'address'] LOOP
      CONTINUE WHEN k = 'address' AND v_status <> 'available';
      IF (v_snap->>k) IS DISTINCT FROM (v_now->>k) THEN
        v_changes := v_changes || to_jsonb(k);
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
           'event_type', e.event_type,
           'event_date', coalesce(e.event_date, e.date),
           'start_time', coalesce(e.start_time, e.time),
           'end_time', e.end_time,
           'load_in_time', e.load_in_time,
           'soundcheck_time', e.soundcheck_time,
           'venue_name', coalesce(e.venue_name, e.venue),
           'venue_city', e.venue_city,
           -- The street address only after they said yes.
           'venue_address', CASE WHEN r.status = 'available' THEN e.venue_address END,
           'event_cancelled', coalesce(e.status, '') = 'cancelled',
           'event_updated_at', e.updated_at,
           'changes', v_changes,
           'before', v_before,
           -- Read-only key of the calendar file / subscription (182).
           'calendar_token', r.calendar_token,
           -- A day of slack for time zones.
           'closed', r.status = 'cancelled' OR coalesce(e.status, '') = 'cancelled'
                     OR coalesce(e.event_date, e.date) < current_date - 1
         )
    INTO v
    FROM public.deputy_requests r
    JOIN public.events e ON e.id = r.event_id
    JOIN public.bands b ON b.id = r.band_id
   WHERE r.token = p_token;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.bw_deputy_request_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_deputy_request_view(text) TO anon, authenticated;

-- ------------------------------------------------- the deputy's calendar --
-- The deputy's gigs with this band, by the calendar token of any of their
-- requests (or, for subscriptions made before 182, a reply token).
-- Confirmed gigs, plus the ones they had answered that were cancelled since
-- (so the calendar marks them cancelled). No tokens in the result.

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
               'cancelled', r.status = 'cancelled' OR coalesce(e.status, '') = 'cancelled',
               'role', r.role,
               'event_title', e.title,
               'event_date', coalesce(e.event_date, e.date),
               'start_time', coalesce(e.start_time, e.time),
               'end_time', e.end_time,
               'load_in_time', e.load_in_time,
               'soundcheck_time', e.soundcheck_time,
               'venue_name', coalesce(e.venue_name, e.venue),
               'venue_city', e.venue_city,
               'venue_address', e.venue_address,
               'updated_at', greatest(e.updated_at, r.updated_at)
             ) ORDER BY coalesce(e.event_date, e.date))
        FROM public.deputy_requests r
        JOIN public.events e ON e.id = r.event_id
       WHERE r.band_id = v_req.band_id
         AND (r.id = v_req.id OR (v_req.deputy_id IS NOT NULL AND r.deputy_id = v_req.deputy_id))
         AND (r.status = 'available' OR (r.status = 'cancelled' AND r.answer_snapshot IS NOT NULL))
         AND coalesce(e.event_date, e.date) >= current_date - 60
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_deputy_calendar_feed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_deputy_calendar_feed(text) TO anon, authenticated;

-- 084's feed, for the function deployed before 182: no other gig's token.
CREATE OR REPLACE FUNCTION public.bw_deputy_feed(p_token text)
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
  SELECT * INTO v_req FROM public.deputy_requests WHERE token = p_token;
  IF v_req.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'band_name', (SELECT b.name FROM public.bands b WHERE b.id = v_req.band_id),
    'deputy_name', v_req.deputy_name,
    'gigs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id,
               -- 182: only the caller's own token (they sent it), never the
               -- reply tokens of the deputy's other gigs.
               'token', CASE WHEN r.id = v_req.id THEN r.token END,
               'cancelled', r.status = 'cancelled' OR coalesce(e.status, '') = 'cancelled',
               'role', r.role,
               'event_title', e.title,
               'event_date', coalesce(e.event_date, e.date),
               'start_time', coalesce(e.start_time, e.time),
               'end_time', e.end_time,
               'load_in_time', e.load_in_time,
               'soundcheck_time', e.soundcheck_time,
               'venue_name', coalesce(e.venue_name, e.venue),
               'venue_city', e.venue_city,
               'venue_address', e.venue_address,
               'updated_at', greatest(e.updated_at, r.updated_at)
             ) ORDER BY coalesce(e.event_date, e.date))
        FROM public.deputy_requests r
        JOIN public.events e ON e.id = r.event_id
       WHERE r.band_id = v_req.band_id
         AND (r.id = v_req.id OR (v_req.deputy_id IS NOT NULL AND r.deputy_id = v_req.deputy_id))
         AND (r.status = 'available' OR (r.status = 'cancelled' AND r.answer_snapshot IS NOT NULL))
         AND coalesce(e.event_date, e.date) >= current_date - 60
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bw_deputy_feed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_deputy_feed(text) TO anon, authenticated;

-- 087 + the calendar token.
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
  IF v_dep.user_id IS NULL THEN
    RETURN 'not_linked';
  END IF;

  UPDATE public.band_deputies SET user_id = NULL, updated_at = now() WHERE id = v_dep.id;

  -- New reply and calendar tokens (182): old links and subscriptions stop.
  UPDATE public.deputy_requests r
     SET token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         calendar_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
   WHERE r.deputy_id = v_dep.id;

  RETURN 'unlinked';
END;
$$;

REVOKE ALL ON FUNCTION public.bw_deputy_unlink(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_deputy_unlink(uuid) TO authenticated;

-- ------------------------------------------------ one event, for members --

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

ALTER TABLE public.calendar_event_links ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: only the functions below touch it.
REVOKE ALL ON public.calendar_event_links FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_my_event_calendar_token(p_event_id uuid, p_date date DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_feed text;
  v_event jsonb;
  v_occ date;
  v_token text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF p_event_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.calendar_feeds (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
  SELECT token INTO v_feed FROM public.calendar_feeds WHERE user_id = v_uid;

  -- Only an event the user's calendar shows (the feed's rule, 165).
  SELECT x INTO v_event
    FROM jsonb_array_elements(coalesce(public.bw_member_calendar_feed(v_feed)->'events', '[]'::jsonb)) x
   WHERE x->>'id' = p_event_id::text;
  IF v_event IS NULL THEN RETURN NULL; END IF;

  -- The date matters only for a repeating event.
  IF jsonb_typeof(v_event->'recurrence') = 'object' THEN
    v_occ := coalesce(p_date, (v_event->>'event_date')::date);
  END IF;

  INSERT INTO public.calendar_event_links (user_id, event_id, occurrence)
  VALUES (v_uid, p_event_id, v_occ)
  ON CONFLICT (user_id, event_id, coalesce(occurrence, 'infinity'::date)) DO NOTHING;
  SELECT token INTO v_token FROM public.calendar_event_links
   WHERE user_id = v_uid AND event_id = p_event_id AND occurrence IS NOT DISTINCT FROM v_occ;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_my_event_calendar_token(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_my_event_calendar_token(uuid, date) TO authenticated;

-- What an event link shows: that one event, while its owner still sees it.
-- Called by the edge function with the publishable key, as the feed.
CREATE OR REPLACE FUNCTION public.bw_member_event_calendar(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.calendar_event_links;
  v_feed jsonb;
  v_event jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_link FROM public.calendar_event_links WHERE token = p_token;
  IF v_link.token IS NULL THEN RETURN NULL; END IF;
  v_feed := public.bw_member_calendar_feed((SELECT f.token FROM public.calendar_feeds f WHERE f.user_id = v_link.user_id));
  SELECT x INTO v_event
    FROM jsonb_array_elements(coalesce(v_feed->'events', '[]'::jsonb)) x
   WHERE x->>'id' = v_link.event_id::text;
  IF v_event IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'language', v_feed->'language',
    'occurrence', v_link.occurrence,
    'event', v_event
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_member_event_calendar(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_member_event_calendar(text) TO anon, authenticated;

COMMIT;
