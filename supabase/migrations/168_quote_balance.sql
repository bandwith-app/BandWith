-- ====================================================================
-- 168: the final balance (saldo) of an accepted quote
--
-- After the client accepted a quote, an admin asks for the rest from the
-- app: the accepted total less the deposit and any other payment already
-- received. The same client page (/quote.html, 099) then shows the balance
-- due, its due date and the ways to pay the band picked: bank transfer, the
-- band's own Stripe payment link (a plain link the band pasted), cash.
-- BandWith never moves money: "Mark as paid" is the admin saying the money
-- arrived, and it marks the gig paid (events.payment_status = 'paid').
--
-- 1. quote_links: balance (what the client sees, built by the app in the
--    client's language, src/lib/quoteBalance.ts), its version, when it was
--    published, first sent and recorded as paid. quote_links is read by
--    admins only (099: table SELECT + admin RLS), so the new columns are
--    admin-only too; anon has nothing on the table.
-- 2. quote_activity: balance_requested / _updated / _reminded / _paid /
--    _reopened on the quote's timeline.
-- 3. Admin RPCs (band admins of the quote, SECURITY DEFINER):
--    - bw_quote_balance_publish: only for an accepted quote whose gig is
--      not cancelled, with an amount above 0 and at least one way to pay;
--      the payment link must be https, the PDF this band's file. A quote
--      accepted by phone (link never sent or not yet accepted) becomes
--      accepted on the page, as bw_quote_link_set_outcome (105) does.
--    - bw_quote_balance_mark_sent: a send or a reminder, with its channel.
--    - bw_quote_balance_mark_paid: received (or undo): the gig made from
--      the quote gets payment_status 'paid' (and its deposit paid), or back
--      to 'partial' / 'pending'. Works without a balance request too.
-- 4. The deposit (next-big-updates "deposit tweaks", no Stripe):
--    - bw_quote_confirm_gig: the shared step that confirms the gig of an
--      accepted quote (tentative → confirmed). The app's
--      gigFromAcceptedQuote calls it first; only when the quote has no gig
--      yet does the app create one with its lineup (and the lineup pushes).
--    - bw_quote_deposit_received: an admin records the deposit received
--      (method transfer / cash / other in the timeline), or undoes it. The
--      gig gets deposit_paid (+ amount) and payment_status 'partial', and
--      is confirmed through bw_quote_confirm_gig. No gig yet: returns
--      needs_gig, the app makes it and calls again.
-- 5. bw_quote_link_view (page, anon by token): 163's body plus the balance
--    keys. The balance shows only on an accepted quote whose gig is not
--    cancelled. The snapshot's "pay" block (how to pay the deposit: bank
--    rows, the band's own payment link, reference) only once accepted,
--    with deposit_paid. Nothing else of the band: no musicians, fees or
--    notes.
--
-- No new table, no new anon grant: anon keeps EXECUTE on the four page
-- RPCs of 099 only (the view is recreated with the same grant).
-- Safe to run more than once.
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- 1. Columns
-- --------------------------------------------------------------------

ALTER TABLE public.quote_links
  ADD COLUMN IF NOT EXISTS balance jsonb,
  ADD COLUMN IF NOT EXISTS balance_version int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_at timestamptz,
  ADD COLUMN IF NOT EXISTS balance_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS balance_paid_at timestamptz;

-- --------------------------------------------------------------------
-- 2. Timeline kinds
-- --------------------------------------------------------------------

ALTER TABLE public.quote_activity DROP CONSTRAINT IF EXISTS quote_activity_kind_check;
ALTER TABLE public.quote_activity ADD CONSTRAINT quote_activity_kind_check CHECK (kind IN (
  'sent', 'resent', 'reminded', 'viewed', 'updated', 'client_message', 'band_reply',
  'accepted', 'declined', 'link_rotated', 'link_revoked',
  'balance_requested', 'balance_updated', 'balance_reminded', 'balance_paid', 'balance_reopened',
  'deposit_received', 'deposit_reopened'
));

-- --------------------------------------------------------------------
-- Helper (internal): the gig made from a quote
-- --------------------------------------------------------------------

-- quotes.converted_to_event_id first, else the first event that carries
-- the quote's id (convertQuoteToEvent writes both).
CREATE OR REPLACE FUNCTION public.bw_quote_gig_id(p_quote_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
    FROM public.quotes q
    JOIN public.events e ON e.band_id = q.band_id AND (e.id = q.converted_to_event_id OR e.quote_id = q.id)
   WHERE q.id = p_quote_id
   ORDER BY (e.id = q.converted_to_event_id) DESC, e.created_at ASC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_gig_id(uuid) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- 3. Admin RPCs
-- --------------------------------------------------------------------

-- Publish (or change) the balance the client sees. Returns
-- { token, balance_version, changed }.
CREATE OR REPLACE FUNCTION public.bw_quote_balance_publish(p_quote_id uuid, p_balance jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_link public.quote_links;
  v_quote_status text;
  v_client text;
  v_gig_status text;
  v_amount numeric;
  v_stripe text;
  v_pdf text;
  v_cash text;
  v_changed boolean;
BEGIN
  IF p_balance IS NULL OR jsonb_typeof(p_balance) <> 'object' OR octet_length(p_balance::text) > 16000 THEN
    RAISE EXCEPTION 'Invalid balance' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_amount := (p_balance ->> 'amount')::numeric;
  EXCEPTION WHEN others THEN v_amount := NULL;
  END;
  IF v_amount IS NULL OR v_amount <= 0 OR v_amount > 100000000 THEN
    RAISE EXCEPTION 'Nothing left to pay' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_balance ->> 'currency', '') !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Invalid currency' USING ERRCODE = '22023';
  END IF;
  -- The page turns the link into a button: https only, nothing that can break out of it.
  v_stripe := nullif(btrim(coalesce(p_balance ->> 'stripeUrl', '')), '');
  IF v_stripe IS NOT NULL AND (length(v_stripe) > 500 OR v_stripe !~ '^https://[^[:space:]"''<>\\]+$') THEN
    RAISE EXCEPTION 'Invalid payment link' USING ERRCODE = '22023';
  END IF;
  -- Only a PDF of this band in the public "quotes" bucket (as 099).
  v_pdf := nullif(btrim(coalesce(p_balance ->> 'pdfUrl', '')), '');
  IF v_pdf IS NOT NULL AND v_pdf !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/quotes/quotes/' || v_band::text || '/[A-Za-z0-9._%-]+$') THEN
    RAISE EXCEPTION 'Invalid PDF link' USING ERRCODE = '22023';
  END IF;
  v_cash := nullif(btrim(coalesce(p_balance ->> 'cash', '')), '');
  IF v_stripe IS NULL AND v_cash IS NULL
     AND (jsonb_typeof(p_balance -> 'bank') IS DISTINCT FROM 'array' OR jsonb_array_length(p_balance -> 'bank') = 0) THEN
    RAISE EXCEPTION 'Add a way to pay' USING ERRCODE = '22023';
  END IF;

  SELECT q.status, nullif(left(regexp_replace(btrim(coalesce(q.client_name, '')), '\s+', ' ', 'g'), 120), '')
    INTO v_quote_status, v_client
    FROM public.quotes q WHERE q.id = p_quote_id;
  SELECT e.status INTO v_gig_status FROM public.events e WHERE e.id = public.bw_quote_gig_id(p_quote_id);
  IF lower(coalesce(v_gig_status, '')) = 'cancelled' THEN
    RAISE EXCEPTION 'The gig is cancelled' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;
  IF v_link.id IS NULL OR v_link.snapshot IS NULL THEN
    RAISE EXCEPTION 'Publish the quote first' USING ERRCODE = 'P0002';
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'The client link is turned off' USING ERRCODE = '22023';
  END IF;
  IF v_link.status <> 'accepted' THEN
    IF lower(coalesce(v_quote_status, '')) <> 'accepted' THEN
      RAISE EXCEPTION 'The quote is not accepted' USING ERRCODE = '22023';
    END IF;
    -- Accepted by phone or in person: the page shows the quote accepted (as 105).
    UPDATE public.quote_links l
       SET status = 'accepted', responded_at = coalesce(l.responded_at, now()), accepted_name = v_client,
           accepted_version = l.version, accepted_snapshot = l.snapshot,
           accepted_pdf_url = CASE WHEN l.pdf_version = l.version THEN l.pdf_url END,
           decline_reason = NULL, updated_at = now()
     WHERE l.id = v_link.id
    RETURNING * INTO v_link;
    INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version, actor_id)
    VALUES (p_quote_id, v_band, 'accepted', v_client, v_link.version, auth.uid());
  END IF;

  v_changed := v_link.balance IS DISTINCT FROM p_balance;
  IF v_changed THEN
    UPDATE public.quote_links l
       SET balance = p_balance, balance_version = l.balance_version + 1, balance_at = now(),
           balance_paid_at = NULL, updated_at = now()
     WHERE l.id = v_link.id
    RETURNING * INTO v_link;
    -- Already with the client: the timeline says it changed.
    IF v_link.balance_sent_at IS NOT NULL THEN
      INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version, actor_id)
      VALUES (p_quote_id, v_band, 'balance_updated', left(p_balance ->> 'amountLabel', 60), v_link.balance_version, auth.uid());
    END IF;
  END IF;

  RETURN jsonb_build_object('token', v_link.token, 'balance_version', v_link.balance_version, 'changed', v_changed);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_balance_publish(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_balance_publish(uuid, jsonb) TO authenticated;

-- A send ('sent') or a reminder ('reminded') of the balance, with its channel.
-- Returns the timeline kind recorded.
CREATE OR REPLACE FUNCTION public.bw_quote_balance_mark_sent(p_quote_id uuid, p_kind text DEFAULT 'sent', p_channel text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_link public.quote_links;
  v_channel text := nullif(lower(btrim(coalesce(p_channel, ''))), '');
  v_kind text;
BEGIN
  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;
  IF v_link.id IS NULL OR v_link.balance IS NULL THEN
    RAISE EXCEPTION 'Publish the balance first' USING ERRCODE = 'P0002';
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'The client link is turned off' USING ERRCODE = '22023';
  END IF;
  IF v_channel IS NOT NULL AND v_channel NOT IN ('whatsapp', 'sms', 'email', 'copy', 'share') THEN v_channel := NULL; END IF;
  v_kind := CASE WHEN p_kind = 'reminded' AND v_link.balance_sent_at IS NOT NULL THEN 'balance_reminded' ELSE 'balance_requested' END;
  INSERT INTO public.quote_activity (quote_id, band_id, kind, body, channel, version, actor_id)
  VALUES (p_quote_id, v_band, v_kind, left(v_link.balance ->> 'amountLabel', 60), v_channel, v_link.balance_version, auth.uid());
  UPDATE public.quote_links l SET balance_sent_at = coalesce(l.balance_sent_at, now()), updated_at = now() WHERE l.id = v_link.id;
  RETURN v_kind;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_balance_mark_sent(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_balance_mark_sent(uuid, text, text) TO authenticated;

-- The balance was received (p_paid) or not after all (undo). The gig made
-- from the quote follows: 'paid' with its deposit paid, or back to
-- 'partial' (deposit paid) / 'pending'. Returns { paid, event_id }.
CREATE OR REPLACE FUNCTION public.bw_quote_balance_mark_paid(p_quote_id uuid, p_paid boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_paid boolean := coalesce(p_paid, true);
  v_gig uuid := public.bw_quote_gig_id(p_quote_id);
  v_link public.quote_links;
BEGIN
  IF v_gig IS NOT NULL THEN
    UPDATE public.events e
       SET payment_status = CASE WHEN v_paid THEN 'paid' WHEN e.deposit_paid THEN 'partial' ELSE 'pending' END,
           deposit_paid = CASE WHEN v_paid THEN true ELSE e.deposit_paid END
     WHERE e.id = v_gig AND e.band_id = v_band;
  END IF;

  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;
  IF v_link.id IS NOT NULL AND (v_link.balance_paid_at IS NOT NULL) IS DISTINCT FROM v_paid THEN
    UPDATE public.quote_links l
       SET balance_paid_at = CASE WHEN v_paid THEN now() END, updated_at = now()
     WHERE l.id = v_link.id;
    INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version, actor_id)
    VALUES (p_quote_id, v_band, CASE WHEN v_paid THEN 'balance_paid' ELSE 'balance_reopened' END,
            left(v_link.balance ->> 'amountLabel', 60), v_link.balance_version, auth.uid());
  END IF;

  RETURN jsonb_build_object('paid', v_paid, 'event_id', v_gig);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_balance_mark_paid(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_balance_mark_paid(uuid, boolean) TO authenticated;

-- --------------------------------------------------------------------
-- 4. The deposit
-- --------------------------------------------------------------------

-- The gig of an accepted quote becomes confirmed (tentative → confirmed).
-- Shared by "Confirm & open gig" (gigFromAcceptedQuote) and "Deposit
-- received". Returns { event_id, confirmed } ; event_id null = no gig yet.
CREATE OR REPLACE FUNCTION public.bw_quote_confirm_gig(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_gig uuid := public.bw_quote_gig_id(p_quote_id);
  v_status text;
BEGIN
  IF v_gig IS NULL THEN
    RETURN jsonb_build_object('event_id', NULL, 'confirmed', false);
  END IF;
  UPDATE public.events e SET status = 'confirmed'
   WHERE e.id = v_gig AND e.band_id = v_band AND lower(coalesce(e.status, '')) = 'tentative';
  SELECT lower(coalesce(e.status, '')) INTO v_status FROM public.events e WHERE e.id = v_gig;
  RETURN jsonb_build_object('event_id', v_gig, 'confirmed', v_status = 'confirmed');
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_confirm_gig(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_confirm_gig(uuid) TO authenticated;

-- The deposit was received (p_received) with a method, or not after all
-- (undo). Returns { event_id, received, confirmed, needs_gig }.
CREATE OR REPLACE FUNCTION public.bw_quote_deposit_received(
  p_quote_id uuid,
  p_method text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_received boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_received boolean := coalesce(p_received, true);
  v_method text := lower(btrim(coalesce(p_method, '')));
  v_quote_status text;
  v_gig uuid;
  v_gig_status text;
  v_was boolean;
  v_confirm jsonb;
  v_version int;
BEGIN
  IF v_method NOT IN ('transfer', 'cash', 'other') THEN v_method := 'other'; END IF;
  IF p_amount IS NOT NULL AND (p_amount < 0 OR p_amount > 100000000) THEN
    RAISE EXCEPTION 'Invalid amount' USING ERRCODE = '22023';
  END IF;
  SELECT lower(coalesce(q.status, '')) INTO v_quote_status FROM public.quotes q WHERE q.id = p_quote_id;
  IF v_quote_status <> 'accepted'
     AND NOT EXISTS (SELECT 1 FROM public.quote_links l WHERE l.quote_id = p_quote_id AND l.status = 'accepted') THEN
    RAISE EXCEPTION 'The quote is not accepted' USING ERRCODE = '22023';
  END IF;

  v_gig := public.bw_quote_gig_id(p_quote_id);
  IF v_gig IS NULL THEN
    IF NOT v_received THEN
      RETURN jsonb_build_object('event_id', NULL, 'received', false, 'confirmed', false, 'needs_gig', false);
    END IF;
    RETURN jsonb_build_object('event_id', NULL, 'received', false, 'confirmed', false, 'needs_gig', true);
  END IF;
  SELECT lower(coalesce(e.status, '')), coalesce(e.deposit_paid, false) INTO v_gig_status, v_was
    FROM public.events e WHERE e.id = v_gig FOR UPDATE;
  IF v_gig_status = 'cancelled' THEN
    RAISE EXCEPTION 'The gig is cancelled' USING ERRCODE = '22023';
  END IF;

  UPDATE public.events e
     SET deposit_paid = v_received,
         deposit_amount = CASE WHEN v_received AND p_amount IS NOT NULL AND p_amount > 0 THEN p_amount ELSE e.deposit_amount END,
         payment_status = CASE
           WHEN lower(coalesce(e.payment_status, '')) = 'paid' THEN e.payment_status
           WHEN v_received THEN 'partial'
           ELSE 'pending' END
   WHERE e.id = v_gig AND e.band_id = v_band;

  IF v_received THEN
    v_confirm := public.bw_quote_confirm_gig(p_quote_id);
  END IF;

  IF v_was IS DISTINCT FROM v_received THEN
    SELECT l.version INTO v_version FROM public.quote_links l WHERE l.quote_id = p_quote_id;
    INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version, actor_id)
    VALUES (p_quote_id, v_band, CASE WHEN v_received THEN 'deposit_received' ELSE 'deposit_reopened' END,
            CASE WHEN v_received THEN v_method END, coalesce(v_version, 1), auth.uid());
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_gig,
    'received', v_received,
    'confirmed', coalesce((v_confirm ->> 'confirmed')::boolean, v_gig_status = 'confirmed'),
    'needs_gig', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_deposit_received(uuid, text, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_deposit_received(uuid, text, numeric, boolean) TO authenticated;

-- --------------------------------------------------------------------
-- 5. The client's page: 163 plus the balance and the deposit
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
  v_show_balance boolean;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_link FROM public.quote_links l WHERE l.token = p_token;
  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL OR v_link.snapshot IS NULL THEN RETURN NULL; END IF;
  SELECT b.name, q.client_name INTO v_band, v_client
    FROM public.quotes q JOIN public.bands b ON b.id = q.band_id WHERE q.id = v_link.quote_id;
  -- Accepted: what the client accepted, whatever was edited afterwards.
  v_snap := CASE WHEN v_link.status = 'accepted' THEN coalesce(v_link.accepted_snapshot, v_link.snapshot) ELSE v_link.snapshot END;
  BEGIN
    v_valid := nullif(v_snap ->> 'validUntil', '')::date;
  EXCEPTION WHEN others THEN v_valid := NULL;
  END;
  -- 168: the balance and the deposit, on an accepted quote whose gig is not cancelled.
  IF v_link.status = 'accepted' THEN
    SELECT lower(coalesce(e.status, '')), lower(coalesce(e.payment_status, '')), coalesce(e.deposit_paid, false)
      INTO v_gig_status, v_gig_paid, v_gig_deposit
      FROM public.events e WHERE e.id = public.bw_quote_gig_id(v_link.quote_id);
  END IF;
  v_show_balance := v_link.status = 'accepted' AND v_link.balance IS NOT NULL AND coalesce(v_gig_status, '') <> 'cancelled';

  RETURN jsonb_build_object(
    'status', v_link.status,
    'lang', v_link.lang,
    'band_name', v_band,
    'client_name', v_client,
    -- 168: how to pay the deposit, only once accepted.
    'quote', CASE WHEN v_link.status = 'accepted' AND coalesce(v_gig_status, '') <> 'cancelled' THEN v_snap ELSE v_snap - 'pay' END,
    'version', CASE WHEN v_link.status = 'accepted' THEN coalesce(v_link.accepted_version, v_link.version) ELSE v_link.version END,
    'updated_at', CASE WHEN v_link.version > 1 THEN v_link.version_at END,
    'pdf_url', CASE WHEN v_link.status = 'accepted' THEN v_link.accepted_pdf_url
                    WHEN v_link.pdf_version = v_link.version THEN v_link.pdf_url END,
    'accepted_name', v_link.accepted_name,
    'accepted_at', CASE WHEN v_link.status = 'accepted' THEN v_link.responded_at END,
    'declined_at', CASE WHEN v_link.status = 'declined' THEN v_link.responded_at END,
    'decline_reason', CASE WHEN v_link.status = 'declined' THEN v_link.decline_reason END,
    -- A day of slack for time zones.
    'expired', v_link.status <> 'accepted' AND v_valid IS NOT NULL AND v_valid < current_date - 1,
    'messages', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'from', CASE a.kind WHEN 'client_message' THEN 'client' ELSE 'band' END,
               'body', a.body,
               'at', a.created_at
             ) ORDER BY a.created_at)
        FROM public.quote_activity a
       WHERE a.quote_id = v_link.quote_id AND a.kind IN ('client_message', 'band_reply')
    ), '[]'::jsonb),
    -- 163: the "Made with BandWith" mark, decided here (paid plans §4.3).
    'made_with', public.bw_band_shows_mark(v_link.band_id),
    -- 168: the balance request and whether it was received.
    'balance', CASE WHEN v_show_balance THEN v_link.balance END,
    'balance_at', CASE WHEN v_show_balance THEN v_link.balance_at END,
    'balance_paid', v_show_balance AND (v_link.balance_paid_at IS NOT NULL OR v_gig_paid = 'paid'),
    'balance_paid_at', CASE WHEN v_show_balance THEN v_link.balance_paid_at END,
    -- 168: the band recorded the deposit as received.
    'deposit_paid', v_link.status = 'accepted' AND coalesce(v_gig_deposit, false)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_view(text) TO anon, authenticated;

COMMIT;
