-- 165: calendar sync for every account (Settings → Calendar sync, and
-- "Add to calendar" on an event).
--
--   calendar_feeds                one secret link per account (64 hex), the
--                                 only key of the edge function member-calendar
--   bw_my_calendar_token(rotate)  the signed-in user's link token; creates it
--                                 on first use, or replaces it (rotate = true)
--                                 so an old shared link stops working
--   bw_member_calendar_feed(tok)  what that link shows: the same events the
--                                 app's calendar shows the user
--                                 (src/lib/eventVisibility.ts):
--                                   - own personal gigs;
--                                   - as a member: band events they are on
--                                     and haven't declined;
--                                   - as an admin: band events they haven't
--                                     declined;
--                                   - never quotes, drafts or cancelled events.
--                                 Logistics only: no fees, no client, no notes
--                                 (members see only their own fee in the app;
--                                 a calendar is shared too easily for any).
--
-- Like bw_deputy_feed (084): called by the edge function with the publishable
-- key, so anon may execute the feed; the token is the only key.

BEGIN;

CREATE TABLE IF NOT EXISTS public.calendar_feeds (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 64 hex characters from two random UUIDs (244 random bits).
  token text NOT NULL UNIQUE
    DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    CHECK (token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.calendar_feeds ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: only the functions below touch it.
REVOKE ALL ON public.calendar_feeds FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------- the user's link --

CREATE OR REPLACE FUNCTION public.bw_my_calendar_token(p_rotate boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF coalesce(p_rotate, false) THEN
    DELETE FROM public.calendar_feeds WHERE user_id = v_uid;
  END IF;
  INSERT INTO public.calendar_feeds (user_id) VALUES (v_uid)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT token INTO v_token FROM public.calendar_feeds WHERE user_id = v_uid;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_my_calendar_token(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_my_calendar_token(boolean) TO authenticated;

-- ---------------------------------------------------------- the feed --

CREATE OR REPLACE FUNCTION public.bw_member_calendar_feed(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT user_id INTO v_uid FROM public.calendar_feeds WHERE token = p_token;
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'language', (SELECT p.preferred_language FROM public.profiles p WHERE p.id = v_uid),
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
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
             ) ORDER BY coalesce(e.event_date, e.date))
        FROM public.events e
        LEFT JOIN public.bands b ON b.id = e.band_id
        LEFT JOIN public.band_members bm
          ON bm.band_id = e.band_id AND bm.user_id = v_uid
         AND coalesce(bm.is_active, true) AND bm.left_at IS NULL
        LEFT JOIN public.event_members em ON em.event_id = e.id AND em.user_id = v_uid
       WHERE coalesce(e.event_date, e.date) IS NOT NULL
         -- Recurring rehearsals stay while they repeat; one-offs from 60 days back.
         AND (coalesce(e.event_date, e.date) >= current_date - 60 OR e.is_recurring)
         -- Never quotes, drafts or cancelled events (AuthenticatedApp isQuote rule).
         AND lower(coalesce(e.status, '')) NOT IN ('cancelled', 'canceled', 'draft', 'pending')
         AND NOT (
           (e.quote_id IS NOT NULL OR lower(coalesce(e.event_type, '')) = 'quote'
             OR lower(coalesce(e.status, '')) IN ('tentative', 'quoted', 'quote'))
           AND lower(coalesce(e.status, '')) NOT IN ('confirmed', 'completed')
         )
         AND (
           (e.band_id IS NULL AND e.created_by = v_uid)
           OR (bm.role::text = 'admin' AND coalesce(em.status, '') <> 'declined')
           OR (bm.id IS NOT NULL AND em.id IS NOT NULL AND coalesce(em.status, '') <> 'declined')
         )
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_member_calendar_feed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_member_calendar_feed(text) TO anon, authenticated;

COMMIT;
