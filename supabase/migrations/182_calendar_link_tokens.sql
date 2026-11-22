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
--     "maybe" leaves no trace). The street address only while they are on it.
--   - bw_deputy_feed (084, called by the function deployed before 182): same
--     rules, also takes the calendar token, and returns no token at all, so
--     the old function writes no credential either.
--   - bw_deputy_unlink (087) rotates all three keys, also for a deputy with
--     no account (it used to stop at 'not_linked' before rotating).
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
--     one event their calendar shows (same rule as the feed), else NULL.
--   - bw_member_event_calendar(token): that one event as a single date, never
--     the series rule or start; NULL once the user no longer sees it or the
--     date is no longer in the series.
--   - The one-event links shared before 182 carry the account token:
--     calendar_feeds.review_link marks the accounts to ask once (the app
--     offers "Make a new link" or "Keep my link"): every link made before
--     182, and any served again in the old one-event form (t=&e=, older app
--     builds; bw_member_calendar_flag_shared, called by member-calendar).
--   The account feed (bw_member_calendar_feed) is unchanged.
--
-- Older app builds: no signature they call changes. Safe to run more than
-- once.
-- ============================================================================

BEGIN;

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
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_deputy_request_was_available() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_deputy_request_was_available ON public.deputy_requests;
CREATE TRIGGER bw_deputy_request_was_available BEFORE INSERT OR UPDATE OF status ON public.deputy_requests
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_deputy_request_was_available();

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
           -- Read-only keys of the calendar (182): the subscription, and the
           -- file of this one gig.
           'calendar_token', r.calendar_token,
           'gig_calendar_token', r.gig_calendar_token,
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
               -- The street address only while they are on it (as the page).
               'venue_address', CASE WHEN r.status = 'available' THEN e.venue_address END,
               'updated_at', greatest(e.updated_at, r.updated_at)
             ) ORDER BY coalesce(e.event_date, e.date))
        FROM public.deputy_requests r
        JOIN public.events e ON e.id = r.event_id
       WHERE r.band_id = v_req.band_id
         AND (r.id = v_req.id OR (v_req.deputy_id IS NOT NULL AND r.deputy_id = v_req.deputy_id))
         AND (r.status = 'available' OR (r.status = 'cancelled' AND r.was_available))
         AND coalesce(e.event_date, e.date) >= current_date - 60
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
               -- The street address only while they are on it (as the page).
               'venue_address', CASE WHEN r.status = 'available' THEN e.venue_address END,
               'updated_at', greatest(e.updated_at, r.updated_at)
             ))
        FROM public.deputy_requests r
        JOIN public.events e ON e.id = r.event_id
       WHERE r.id = v_req.id
         AND (r.status = 'available' OR (r.status = 'cancelled' AND r.was_available))
         AND coalesce(e.event_date, e.date) >= current_date - 60
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
  RETURN jsonb_build_object(
    'band_name', v->'band_name',
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

  IF v_dep.user_id IS NULL THEN
    RETURN 'not_linked';
  END IF;
  UPDATE public.band_deputies SET user_id = NULL, updated_at = now() WHERE id = v_dep.id;
  RETURN 'unlinked';
END;
$$;
REVOKE ALL ON FUNCTION public.bw_deputy_unlink(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_deputy_unlink(uuid) TO authenticated;

-- ------------------------------------------------ one event, for members --

-- A date of a repeating rehearsal, stepped as the app's calendar steps it
-- (EventsView; = isOccurrence in supabase/functions/_shared/deputy-calendar.ts).
CREATE OR REPLACE FUNCTION public.bw_calendar_is_occurrence(p_rule jsonb, p_start date, p_date date)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_freq text;
  v_every int := 1;
  v_count int := 1000;
  v_until text;
  v_cur date := p_start;
  v_day int;
  v_d text;
  v_target text := to_char(p_date, 'YYYY-MM-DD');
BEGIN
  IF p_rule IS NULL OR jsonb_typeof(p_rule) <> 'object' OR p_start IS NULL OR p_date IS NULL THEN RETURN false; END IF;
  v_freq := lower(coalesce(p_rule->>'freq', p_rule->>'frequency', ''));
  IF v_freq NOT IN ('weekly', 'biweekly', 'monthly') THEN RETURN false; END IF;
  IF p_date = p_start THEN RETURN true; END IF;
  IF (p_rule->>'interval') ~ '^\d{1,2}$' AND (p_rule->>'interval')::int BETWEEN 1 AND 52 THEN v_every := (p_rule->>'interval')::int; END IF;
  IF (p_rule->>'count') ~ '^\d{1,4}$' AND (p_rule->>'count')::int BETWEEN 1 AND 1000 THEN v_count := (p_rule->>'count')::int; END IF;
  v_until := substring(coalesce(p_rule->>'until', '') FROM '^(\d{4}-\d{2}-\d{2})');
  FOR i IN 1..v_count LOOP
    IF v_freq = 'weekly' THEN v_cur := v_cur + 7 * v_every;
    ELSIF v_freq = 'biweekly' THEN v_cur := v_cur + 14;
    ELSE
      -- Same day number in the month `every` months on; past the month's end
      -- it runs into the next month, as Date.setMonth does.
      v_day := extract(day FROM v_cur)::int;
      v_cur := (date_trunc('month', v_cur) + make_interval(months => v_every))::date + (v_day - 1);
    END IF;
    v_d := to_char(v_cur, 'YYYY-MM-DD');
    IF v_until IS NOT NULL AND v_d > v_until THEN RETURN false; END IF;
    IF v_d = v_target THEN RETURN true; END IF;
    IF v_d > v_target THEN RETURN false; END IF;
  END LOOP;
  RETURN false;
END;
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

  -- The date matters only for a repeating event: one of its real dates,
  -- from 60 days back to two years ahead.
  IF jsonb_typeof(v_event->'recurrence') = 'object' THEN
    v_occ := coalesce(p_date, (v_event->>'event_date')::date);
    IF v_occ < current_date - 60 OR v_occ > current_date + 730
       OR NOT public.bw_calendar_is_occurrence(v_event->'recurrence', (v_event->>'event_date')::date, v_occ) THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.calendar_event_links (user_id, event_id, occurrence)
  VALUES (v_uid, p_event_id, v_occ)
  ON CONFLICT (user_id, event_id, coalesce(occurrence, 'infinity'::date)) DO NOTHING;
  SELECT token INTO v_token FROM public.calendar_event_links
   WHERE user_id = v_uid AND event_id = p_event_id AND occurrence IS NOT DISTINCT FROM v_occ;

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
--   repeating now, link for a one-off the event's own (first) date;
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
  v_feed jsonb;
  v_event jsonb;
  v_start date;
  v_date date;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_link FROM public.calendar_event_links WHERE token = p_token;
  IF v_link.token IS NULL THEN RETURN NULL; END IF;
  v_feed := public.bw_member_calendar_feed((SELECT f.token FROM public.calendar_feeds f WHERE f.user_id = v_link.user_id));
  SELECT x INTO v_event
    FROM jsonb_array_elements(coalesce(v_feed->'events', '[]'::jsonb)) x
   WHERE x->>'id' = v_link.event_id::text;
  IF v_event IS NULL THEN RETURN NULL; END IF;

  v_start := (v_event->>'event_date')::date;
  IF jsonb_typeof(v_event->'recurrence') = 'object' THEN
    IF v_link.occurrence IS NULL THEN
      v_date := v_start;
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
    'language', v_feed->'language',
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
  UPDATE public.calendar_feeds SET review_link = false WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.bw_my_calendar_link_keep() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_my_calendar_link_keep() TO authenticated;

-- member-calendar served a one-event link in the old form (t=&e=, app
-- builds before 182): ask the owner again. The token is the key; marking
-- only shows them the question.
CREATE OR REPLACE FUNCTION public.bw_member_calendar_flag_shared(p_token text)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.calendar_feeds SET review_link = true
   WHERE token = p_token AND p_token ~ '^[0-9a-f]{64}$' AND NOT review_link;
$$;
REVOKE ALL ON FUNCTION public.bw_member_calendar_flag_shared(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_member_calendar_flag_shared(text) TO anon, authenticated;

COMMIT;
