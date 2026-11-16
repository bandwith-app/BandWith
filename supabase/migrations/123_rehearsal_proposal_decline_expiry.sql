-- 123 · Member rehearsal proposals: declined → pushed; unanswered → expired.
--
-- 1. An admin can decline a member's proposal (the app sets status
--    'cancelled' and writes the member a `system` notification of kind
--    'proposal_declined', in the member's language, with the optional
--    reason). Until now `system` rows were inbox only; this one asks the
--    member to plan again, so it is also pushed. bw_trg_dispatch_push is the
--    live definition (108) plus that one kind.
--
-- 2. A proposal no admin acted on (status still 'proposed') lapses after its
--    last proposed day. A proposal names weekdays ("[Preferred Days: Mon,
--    Thu]" in notes): the next of each after the day it was sent, a same
--    weekday meaning next week's; with none, 7 days. Days are read in the
--    proposer's time zone (profiles.timezone), like src/lib/proposalExpiry.ts
--    on their device; without a valid zone, 8 days after it was sent (never
--    before any device has hidden it). The app already hides lapsed
--    proposals; a daily sweep marks them 'expired' (a status 038 allows and
--    that no screen loads).
--
-- No new columns, no grants: nothing new for clients to read.
-- Idempotent; safe to re-run on live data.

BEGIN;

-- ------------------------------------------------------------ pushes --

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
      'song_suggestion', 'song_suggestion_reviewed'
    )
    -- One summary after a setlist / song save (107); the per-row notes stay inbox-only.
    OR (NEW.type IN ('setlist_updated', 'song_updated') AND coalesce(NEW.data->>'kind', '') = 'summary')
    -- An admin declined your rehearsal proposal (123).
    OR (NEW.type = 'system' AND coalesce(NEW.data->>'kind', '') = 'proposal_declined')
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

-- ---------------------------------------------------------- expiry --

-- When a proposal sent at p_created_at (notes as the app writes them) lapses:
-- 00:00 in p_tz on the day after its last proposed day.
CREATE OR REPLACE FUNCTION public.bw_rehearsal_proposal_ends(p_created_at timestamptz, p_notes text, p_tz text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_tz text := nullif(btrim(coalesce(p_tz, '')), '');
  v_sent date;
  v_max int := 0;
  v_dow int;
  d text;
BEGIN
  IF v_tz IS NOT NULL THEN
    BEGIN
      v_sent := (p_created_at AT TIME ZONE v_tz)::date;
    EXCEPTION WHEN invalid_parameter_value OR data_exception THEN
      v_tz := NULL; -- unknown zone name
    END;
  END IF;
  IF v_tz IS NULL THEN
    -- The longest window a device shows (7 days), plus a day for any zone.
    RETURN p_created_at + interval '8 days';
  END IF;

  FOREACH d IN ARRAY coalesce(
    string_to_array((regexp_match(coalesce(p_notes, ''), '\[Preferred Days:\s*([^\]]+)\]', 'i'))[1], ','),
    '{}'::text[]
  ) LOOP
    v_dow := array_position(ARRAY['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], lower(left(btrim(d), 3))) - 1;
    IF v_dow IS NOT NULL THEN
      -- 1..7 days later: the same weekday means next week's.
      v_max := greatest(v_max, ((v_dow - extract(dow FROM v_sent)::int + 6) % 7) + 1);
    END IF;
  END LOOP;
  IF v_max = 0 THEN
    v_max := 7;
  END IF;
  RETURN (v_sent + v_max + 1)::timestamp AT TIME ZONE v_tz;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_rehearsal_proposal_ends(timestamptz, text, text) FROM PUBLIC, anon, authenticated;

-- Marks lapsed proposals 'expired'; returns how many.
CREATE OR REPLACE FUNCTION public.bw_expire_rehearsal_proposals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.rehearsal_polls rp
     SET status = 'expired', updated_at = now()
   WHERE rp.status = 'proposed'
     AND now() >= public.bw_rehearsal_proposal_ends(
           rp.created_at, rp.notes,
           (SELECT p.timezone FROM public.profiles p WHERE p.id = rp.created_by));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_expire_rehearsal_proposals() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('bw-expire-rehearsal-proposals')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-expire-rehearsal-proposals');
  PERFORM cron.schedule('bw-expire-rehearsal-proposals', '20 3 * * *', 'SELECT public.bw_expire_rehearsal_proposals()');
END;
$$;

-- Proposals that lapsed before this migration.
SELECT public.bw_expire_rehearsal_proposals();

COMMIT;
