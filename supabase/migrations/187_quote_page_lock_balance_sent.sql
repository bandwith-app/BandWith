-- ====================================================================
-- 187: the client's page, after 183 and 185 (audit of release 383f15b,
--      public pages #8, money & documents #8)
--
-- 1. The balance the client sees is the one sent (money #8). The page
--    (bw_quote_link_view) read quote_links.balance, which the app's
--    Preview also wrote: a trial amount or note the admin never sent was
--    on the client's page at the next refresh. It now reads balance_sent
--    (185: set when a send or reminder is recorded), and "requested on"
--    is when that balance was first sent (the send after its last change),
--    not when it was last published or previewed. Older builds keep
--    working: they publish, then record the send, as before (their
--    Preview no longer reaches the client; a sent balance shows).
-- 2. Acceptance and messages after the link is turned off (public #8).
--    bw_quote_link_respond and bw_quote_link_message checked the link
--    (through the view), then waited for the row lock. An admin turning
--    the link off (or making a new one) in between committed first, and
--    the client's acceptance or message was then written on the revoked
--    link, while the client was told the link no longer works. Both now
--    lock the link row (after the quote: one lock order, quote -> link ->
--    event) and check it after the lock: the revoke wins, nothing is
--    written, the page says the link no longer works.
-- 3. No acceptance once the date is gone (round 10, #294 review 1b). The
--    band cancels a quote's event, or deletes it, while the client's link
--    is still live: an acceptance then flipped the quote to accepted on a
--    date the band had given up, bw_event_quote_private (178) went false
--    with no private period, and the members read the negotiation.
--    bw_quote_link_respond now refuses an accept (SQLSTATE BWQ01, nothing
--    written) when the quote's event (bw_quote_gig_id) is cancelled, or
--    when its event was deleted after the version on the link was
--    published (quote_links.event_removed_at, set by a trigger before an
--    event is deleted: the FK clears converted_to_event_id, so nothing else
--    remembers it). A version published after the deletion, or a new event
--    linked to the quote, can be accepted again. Decline and messages still
--    work: a no closes nothing the band still has, and the client can ask
--    for a new quote. The view says so ('unavailable'): the page shows
--    "This date is no longer available" instead of the accept form. An
--    older cached page ignores the flag, and its accept gets the generic
--    "Something went wrong" (it shows any error code that way); nothing is
--    recorded.
--
-- Superset of 183: the three bodies below are 183's as of fix/quote-page
-- 8f5922d7 (PR #286 round 4: link_id conversations, the deposit receipt in
-- the currency recorded with it, the quote locked first) plus the changes
-- above. 183 round 5 (86dd51f6) leaves these three bodies as they were.
-- Round 5 (Claude review of #293): the message limit (20 an hour) counts
-- the messages on this link, not on the quote: a new client is not held
-- back by what the previous one wrote.
-- 183 must not be run again after this one (183 refuses: its guard sees
-- balance_sent in the view). Same signatures and grants (anon keeps
-- EXECUTE on the page RPCs it had). Apply after 183 and 185 (this
-- migration refuses to run without them). Safe to run more than once.
-- ====================================================================

BEGIN;

-- 183 and 185 first: without them the bodies below would fail at the
-- first call, not here.
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'quote_links' AND column_name = 'recipient_changed_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'quote_links' AND column_name = 'deposit_received_amount')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'quote_activity' AND column_name = 'link_id')
     OR to_regprocedure('public.bw_quote_lock_for_token(text)') IS NULL THEN
    RAISE EXCEPTION '187 needs 183 (quote page fixes) applied first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'quote_links' AND column_name = 'balance_sent') THEN
    RAISE EXCEPTION '187 needs 185 (quote money fixes) applied first';
  END IF;
END
$guard$;

-- --------------------------------------------------------------------
-- 3. A cancelled or deleted date (round 10; first: the view and respond use it)
-- --------------------------------------------------------------------

-- When the quote's event was deleted (not accepted links only: an accepted
-- one has its gig, and its page no longer offers an answer). Written only
-- by the trigger below (definer); the band's admins read it with the link.
ALTER TABLE public.quote_links ADD COLUMN IF NOT EXISTS event_removed_at timestamptz;

-- Before the delete: the FK (ON DELETE SET NULL) still points at the event.
-- Round 11: a band deleted with its events (the cascade) leaves its links
-- alone: they go with the band, and a link written in the same transaction
-- would have its band FK checked again and abort the delete (23503). The
-- write changes event_removed_at only: 176's pdf_keys trigger keeps the
-- keys (the document is the same), and 180's account-deletion guard checks
-- only the account columns a write changes (none here); the deleting
-- account itself is refused there, as on its own events delete.
CREATE OR REPLACE FUNCTION public.bw_trg_quote_link_event_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.quote_links l
     SET event_removed_at = now()
    FROM public.quotes q
   WHERE l.quote_id = q.id
     AND q.band_id IS NOT DISTINCT FROM OLD.band_id
     AND (q.converted_to_event_id = OLD.id OR q.id = OLD.quote_id)
     AND l.status <> 'accepted'
     AND EXISTS (SELECT 1 FROM public.bands b WHERE b.id = l.band_id);
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_quote_link_event_removed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_quote_link_event_removed ON public.events;
CREATE TRIGGER bw_quote_link_event_removed
  BEFORE DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_quote_link_event_removed();

-- The date is gone: the quote's event is cancelled, or it has none and the
-- last one was deleted after this version was published. Not callable by
-- apps (it answers for any quote).
CREATE OR REPLACE FUNCTION public.bw_quote_date_unavailable(p_quote_id uuid, p_event_removed_at timestamptz, p_version_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gig uuid := public.bw_quote_gig_id(p_quote_id);
  v_status text;
BEGIN
  IF v_gig IS NULL THEN
    RETURN p_event_removed_at IS NOT NULL
       AND p_event_removed_at > coalesce(p_version_at, '-infinity'::timestamptz);
  END IF;
  SELECT lower(coalesce(e.status::text, '')) INTO v_status FROM public.events e WHERE e.id = v_gig;
  RETURN coalesce(v_status IN ('cancelled', 'canceled'), false);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_date_unavailable(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- 1. The page shows the balance sent, and when (183's view + balance_sent)
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bw_quote_link_view(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.quote_links;
  v_band text;
  v_client text;
  v_snap jsonb;
  v_valid date;
  v_gig_status text;
  v_gig_paid text;
  v_gig_deposit boolean;
  v_gig_deposit_amount numeric;
  v_show_balance boolean;
  v_show_deposit boolean;
  v_signer boolean;
  v_currency text;
  v_balance_sent_at timestamptz;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_link FROM public.quote_links l WHERE l.token = p_token;
  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL OR v_link.snapshot IS NULL THEN RETURN NULL; END IF;
  SELECT b.name, q.client_name, upper(nullif(btrim(q.currency), '')) INTO v_band, v_client, v_currency
    FROM public.quotes q JOIN public.bands b ON b.id = q.band_id WHERE q.id = v_link.quote_id;
  -- Accepted: what the client accepted, whatever was edited afterwards.
  v_snap := CASE WHEN v_link.status = 'accepted' THEN coalesce(v_link.accepted_snapshot, v_link.snapshot) ELSE v_link.snapshot END;
  BEGIN
    v_valid := nullif(v_snap ->> 'validUntil', '')::date;
  EXCEPTION WHEN others THEN v_valid := NULL;
  END;
  -- 168: the balance and the deposit, on an accepted quote whose gig is not cancelled.
  IF v_link.status = 'accepted' THEN
    SELECT lower(coalesce(e.status, '')), lower(coalesce(e.payment_status, '')), coalesce(e.deposit_paid, false), e.deposit_amount
      INTO v_gig_status, v_gig_paid, v_gig_deposit, v_gig_deposit_amount
      FROM public.events e WHERE e.id = public.bw_quote_gig_id(v_link.quote_id);
  END IF;
  -- 183: the link is the signer's (not given to another client since the acceptance).
  v_signer := v_link.status = 'accepted'
              AND (v_link.recipient_changed_at IS NULL OR v_link.recipient_changed_at <= v_link.responded_at);
  -- 187: only a balance that was sent (185 balance_sent); a published or previewed one is not.
  v_show_balance := v_link.status = 'accepted' AND v_link.balance_sent IS NOT NULL AND coalesce(v_gig_status, '') <> 'cancelled';
  -- 187: and when it was sent: the first send of the balance shown (after the
  -- last change sent, 185 balance_updated), not the last publish or preview.
  IF v_show_balance THEN
    SELECT min(a.created_at) INTO v_balance_sent_at
      FROM public.quote_activity a
     WHERE a.quote_id = v_link.quote_id AND a.link_id = v_link.id
       AND a.kind IN ('balance_requested', 'balance_reminded')
       AND a.created_at >= coalesce((SELECT max(u.created_at) FROM public.quote_activity u
                                      WHERE u.quote_id = v_link.quote_id AND u.link_id = v_link.id
                                        AND u.kind = 'balance_updated'), '-infinity'::timestamptz);
    v_balance_sent_at := coalesce(v_balance_sent_at, v_link.balance_sent_at);
  END IF;
  v_show_deposit := v_link.status = 'accepted' AND coalesce(v_gig_deposit, false)
                    AND v_link.deposit_received_amount > 0 AND v_gig_deposit_amount = v_link.deposit_received_amount;

  RETURN jsonb_build_object(
    'status', v_link.status,
    'lang', v_link.lang,
    'band_name', v_band,
    -- 183: an accepted link keeps the name it was accepted under; given to
    -- another client since, it shows theirs.
    'client_name', CASE WHEN v_signer THEN coalesce(v_link.accepted_client_name, v_client) ELSE v_client END,
    -- 168: how to pay the deposit, only once accepted.
    'quote', CASE WHEN v_link.status = 'accepted' AND coalesce(v_gig_status, '') <> 'cancelled' THEN v_snap ELSE v_snap - 'pay' END,
    'version', CASE WHEN v_link.status = 'accepted' THEN coalesce(v_link.accepted_version, v_link.version) ELSE v_link.version END,
    -- 183: for a new recipient, only a version published after it was sent to them is "updated".
    'updated_at', CASE WHEN v_link.version > 1
                        AND (v_link.recipient_changed_at IS NULL
                             OR (v_link.sent_at > v_link.recipient_changed_at AND v_link.version_at > v_link.sent_at))
                       THEN v_link.version_at END,
    'pdf_url', CASE WHEN v_link.status = 'accepted' THEN v_link.accepted_pdf_url
                    WHEN v_link.pdf_version = v_link.version THEN v_link.pdf_url END,
    -- 183: the signature only on the signer's link.
    'accepted_name', CASE WHEN v_link.status <> 'accepted' OR v_signer THEN v_link.accepted_name END,
    'accepted_at', CASE WHEN v_link.status = 'accepted' THEN v_link.responded_at END,
    'declined_at', CASE WHEN v_link.status = 'declined' THEN v_link.responded_at END,
    'decline_reason', CASE WHEN v_link.status = 'declined' THEN v_link.decline_reason END,
    -- A day of slack for time zones.
    'expired', v_link.status <> 'accepted' AND v_valid IS NOT NULL AND v_valid < current_date - 1,
    -- 187 round 10: the date is gone (event cancelled or deleted): no accept.
    'unavailable', v_link.status <> 'accepted'
                   AND public.bw_quote_date_unavailable(v_link.quote_id, v_link.event_removed_at, v_link.version_at),
    -- 183: this link's conversation only (the band keeps all of it): a new
    -- recipient's link never shows the old client's lines.
    'messages', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'from', CASE a.kind WHEN 'client_message' THEN 'client' ELSE 'band' END,
               'body', a.body,
               'at', a.created_at
             ) ORDER BY a.created_at)
        FROM public.quote_activity a
       WHERE a.quote_id = v_link.quote_id AND a.kind IN ('client_message', 'band_reply')
         AND a.link_id = v_link.id
    ), '[]'::jsonb),
    -- 163: the "Made with BandWith" mark, decided here (paid plans §4.3).
    'made_with', public.bw_band_shows_mark(v_link.band_id),
    -- 168: the balance request and whether it was received.
    -- 187: the balance sent, and when it was sent.
    'balance', CASE WHEN v_show_balance THEN v_link.balance_sent END,
    'balance_at', CASE WHEN v_show_balance THEN v_balance_sent_at END,
    'balance_paid', v_show_balance AND (v_link.balance_paid_at IS NOT NULL OR v_gig_paid = 'paid'),
    'balance_paid_at', CASE WHEN v_show_balance THEN v_link.balance_paid_at END,
    -- 168: the band recorded the deposit as received.
    'deposit_paid', v_link.status = 'accepted' AND coalesce(v_gig_deposit, false),
    -- 183: and how much it recorded, in the currency it was recorded in (the
    -- quote's then; round 4: never the currency the quote has now). The
    -- receipt says this, not the amount asked. Only while the gig still has the
    -- deposit paid at that amount (changed in the gig itself: no amount).
    'deposit_paid_amount', CASE WHEN v_show_deposit THEN v_link.deposit_received_amount END,
    'deposit_paid_currency', CASE WHEN v_show_deposit THEN coalesce(v_link.deposit_received_currency, v_currency) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_view(text) TO anon, authenticated;

-- --------------------------------------------------------------------
-- 2. Accept / decline: lock, then check (183's respond)
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bw_quote_link_respond(
  p_token text,
  p_action text,
  p_name text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_version int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.quote_links;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_name text := nullif(left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 120), '');
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 1000), '');
  v_view jsonb;
  v_title text;
  v_client text;
BEGIN
  IF v_action NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION 'Action must be accept or decline' USING ERRCODE = '22023';
  END IF;
  -- 183: an acceptance is given on one version, the one the client saw.
  IF v_action = 'accept' AND p_version IS NULL THEN
    RAISE EXCEPTION 'The version shown is needed to accept' USING ERRCODE = '22023';
  END IF;
  -- 187: the link row locked, then the checks: a revoke or a new link
  -- that commits while this waits is seen here, and nothing is written.
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  -- 183: the quote first, then the link (the order of a save of the quote: no deadlock).
  PERFORM public.bw_quote_lock_for_token(p_token);
  SELECT * INTO v_link FROM public.quote_links l WHERE l.token = p_token FOR UPDATE;
  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL OR v_link.snapshot IS NULL THEN RETURN NULL; END IF;
  v_view := public.bw_quote_link_view(p_token);
  IF v_view IS NULL THEN RETURN NULL; END IF;
  IF v_link.status = 'accepted' THEN RETURN v_view; END IF;
  -- The same decline again (a second tap, a reload) records and tells nothing.
  IF v_action = 'decline' AND v_link.status = 'declined'
     AND coalesce(v_link.decline_reason, '') = coalesce(v_reason, '') THEN
    RETURN v_view;
  END IF;
  IF p_version IS NOT NULL AND p_version <> v_link.version THEN
    RETURN v_view || jsonb_build_object('stale', true);
  END IF;
  v_title := v_link.snapshot ->> 'title';
  SELECT q.client_name INTO v_client FROM public.quotes q WHERE q.id = v_link.quote_id;

  IF v_action = 'accept' THEN
    -- 187 round 10: no acceptance on a date the band gave up (cancelled or
    -- deleted event). An error, so a page from before this says it did not
    -- go through; nothing is written. Decline and messages still work.
    IF (v_view ->> 'unavailable')::boolean THEN
      RAISE EXCEPTION 'This date is no longer available' USING ERRCODE = 'BWQ01';
    END IF;
    IF v_name IS NULL OR length(v_name) < 2 THEN
      RAISE EXCEPTION 'Type your name to accept' USING ERRCODE = '22023';
    END IF;
    IF (v_view ->> 'expired')::boolean THEN RETURN v_view; END IF;
    UPDATE public.quote_links l
       SET status = 'accepted', responded_at = now(), accepted_name = v_name,
           accepted_version = l.version, accepted_snapshot = l.snapshot,
           accepted_pdf_url = CASE WHEN l.pdf_version = l.version THEN l.pdf_url END,
           decline_reason = NULL, updated_at = now()
     WHERE l.id = v_link.id;
    INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version)
    VALUES (v_link.quote_id, v_link.band_id, 'accepted', v_name, v_link.version);
    UPDATE public.quotes q
       SET status = 'accepted', accepted_at = now(), responded_at = now(), response_type = 'accepted',
           rejection_reason = NULL, updated_at = now()
     WHERE q.id = v_link.quote_id;
    PERFORM public.bw_quote_notify(v_link.quote_id, 'quote_accepted',
      coalesce(v_client, 'The client') || ' accepted the quote',
      coalesce(v_title, 'Quote') || coalesce(' · ' || (v_link.snapshot ->> 'totalLabel'), ''),
      jsonb_build_object('kind', 'accepted', 'eventTitle', v_title, 'ref', v_link.snapshot ->> 'ref',
                         'accepted_name', v_name, 'total', v_link.snapshot ->> 'totalLabel'));
  ELSE
    UPDATE public.quote_links l
       SET status = 'declined', responded_at = now(), decline_reason = v_reason, updated_at = now()
     WHERE l.id = v_link.id;
    INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version)
    VALUES (v_link.quote_id, v_link.band_id, 'declined', v_reason, v_link.version);
    UPDATE public.quotes q
       SET status = 'declined', responded_at = now(), response_type = 'declined',
           rejection_reason = v_reason, updated_at = now()
     WHERE q.id = v_link.quote_id;
    PERFORM public.bw_quote_notify(v_link.quote_id, 'quote_declined',
      coalesce(v_client, 'The client') || ' declined the quote',
      coalesce(v_title, 'Quote') || coalesce(' · "' || left(v_reason, 140) || '"', ''),
      jsonb_build_object('kind', 'declined', 'eventTitle', v_title, 'ref', v_link.snapshot ->> 'ref',
                         'reason', left(v_reason, 140)));
  END IF;
  RETURN public.bw_quote_link_view(p_token);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_respond(text, text, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_respond(text, text, text, text, int) TO anon, authenticated;

-- --------------------------------------------------------------------
-- 3. A message: lock, then check (183's message)
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bw_quote_link_message(p_token text, p_body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.quote_links;
  v_body text := nullif(left(btrim(coalesce(p_body, '')), 2000), '');
  v_recent int;
  v_title text;
  v_client text;
BEGIN
  IF v_body IS NULL THEN RAISE EXCEPTION 'Empty message' USING ERRCODE = '22023'; END IF;
  -- 187: the link row locked, then the checks (as respond).
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  -- 183: the quote first, then the link (the order of a save of the quote: no deadlock).
  PERFORM public.bw_quote_lock_for_token(p_token);
  SELECT * INTO v_link FROM public.quote_links l WHERE l.token = p_token FOR UPDATE;
  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL OR v_link.snapshot IS NULL THEN RETURN NULL; END IF;
  IF public.bw_quote_link_view(p_token) IS NULL THEN RETURN NULL; END IF;
  -- Round 5: this link's messages (a new client is not held back by what the previous one wrote).
  SELECT count(*) INTO v_recent FROM public.quote_activity a
   WHERE a.link_id = v_link.id AND a.kind = 'client_message' AND a.created_at > now() - interval '1 hour';
  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'Too many messages, try again later' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version, link_id)
  VALUES (v_link.quote_id, v_link.band_id, 'client_message', v_body, v_link.version, v_link.id);
  IF v_link.status IN ('draft', 'sent', 'viewed', 'declined') THEN
    UPDATE public.quote_links l SET status = 'discussing', updated_at = now() WHERE l.id = v_link.id;
    UPDATE public.quotes q SET status = 'negotiating', updated_at = now()
     WHERE q.id = v_link.quote_id AND coalesce(q.status, 'draft') NOT IN ('accepted', 'archived');
  END IF;

  v_title := v_link.snapshot ->> 'title';
  SELECT q.client_name INTO v_client FROM public.quotes q WHERE q.id = v_link.quote_id;
  PERFORM public.bw_quote_notify(v_link.quote_id, 'quote_message',
    coalesce(v_client, 'The client') || ' wrote about the quote',
    coalesce(v_title, 'Quote') || ': "' || left(v_body, 140) || '"',
    jsonb_build_object('kind', 'message', 'eventTitle', v_title, 'ref', v_link.snapshot ->> 'ref',
                       'excerpt', left(v_body, 140)));
  RETURN public.bw_quote_link_view(p_token);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_message(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_message(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
