-- ====================================================================
-- 183: quote page fixes (audit of release 383f15b, public pages #3, #9, #11)
--
-- 1. A new recipient gets a new link (#3). The band sent the quote to
--    client A, then changed the client to B and saved: the app republished
--    on the same token, so A's link showed B's quote and A could accept
--    it, and B saw A's messages. Now a BEFORE UPDATE trigger on quotes
--    sees the recipient change and, in the same transaction:
--    - gives the link a new token (A's link stops working at once, as
--      "New link" does) and puts it back to draft: B has not been sent it;
--    - starts B's conversation (quote_links.recipient_changed_at): the
--      page shows only messages from then on. The band keeps the whole
--      history (quote_activity is untouched);
--    - puts the quote's own pipeline status (sent / viewed / negotiating /
--      declined) back to draft, so the app offers "Send to client";
--    - records link_rotated with body 'recipient_changed'.
--    The recipient changed when the email changed from an address to
--    another one (case and spaces ignored) or was cleared; when the quote
--    had no email (sent by WhatsApp / SMS), when the phone changed to
--    another number (digits compared, a country prefix ignored). A name
--    fix, a first email added, a never-sent (draft) link and an accepted
--    link are left alone. A trigger, not the publish RPC: every way of
--    saving the quote (old builds, offline queue, any screen) is covered
--    and the RPC signatures do not change. bw_quote_link_publish is 105's
--    body with its ON CONFLICT on the key's name: the draft branch the new
--    recipient's first Share takes failed with 42702 (audit #10).
-- 2. Consent per version (#9): bw_quote_link_respond (120) made the
--    version optional, so an acceptance without one landed on whatever
--    version was current. Now 'accept' needs the exact version the client
--    saw (decline unchanged). Every /quote.html ever shipped sends
--    p_version (since 099 / PR #128); the HTML is served by Vercel with
--    max-age=0, must-revalidate and its scripts are content-hashed, so no
--    browser keeps an older page.
-- 3. The deposit received (#11): bw_quote_link_view gives the amount the
--    band recorded (deposit_paid_amount, events.deposit_amount once
--    deposit_paid), so the receipt says what was received, not what was
--    asked.
--
-- bw_quote_link_publish is 105's body with the named key;
-- bw_quote_link_view is 168's body plus the conversation start, the
-- "updated" rule for a new recipient and deposit_paid_amount;
-- bw_quote_link_respond is 120's body plus the version check. No new anon
-- grant: the trigger function is not callable by anon or authenticated.
-- Safe to run more than once.
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- 1. A new recipient gets a new link
-- --------------------------------------------------------------------

-- Where the current recipient's conversation starts (null: from the first message).
ALTER TABLE public.quote_links ADD COLUMN IF NOT EXISTS recipient_changed_at timestamptz;

-- Two phone numbers are the same when one ends with the other's digits (a
-- country prefix, spaces, dashes and brackets ignored), with 6 digits at least.
CREATE OR REPLACE FUNCTION public.bw_same_phone(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN least(length(a), length(b)) < 6 THEN a = b
    WHEN length(a) >= length(b) THEN right(a, length(b)) = b
    ELSE right(b, length(a)) = a
  END
  FROM (SELECT regexp_replace(coalesce(p_a, ''), '\D', '', 'g') AS a,
               regexp_replace(coalesce(p_b, ''), '\D', '', 'g') AS b) d;
$$;
REVOKE ALL ON FUNCTION public.bw_same_phone(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_trg_quote_recipient_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_email text := lower(btrim(coalesce(OLD.client_email, '')));
  v_new_email text := lower(btrim(coalesce(NEW.client_email, '')));
  v_old_phone text := regexp_replace(coalesce(OLD.client_phone, ''), '\D', '', 'g');
  v_link public.quote_links;
BEGIN
  IF v_old_email <> '' THEN
    IF v_new_email = v_old_email THEN RETURN NEW; END IF;
  ELSIF v_old_phone = '' OR public.bw_same_phone(OLD.client_phone, NEW.client_phone) THEN
    -- No email: the phone is the recipient (WhatsApp / SMS); none known, nothing to compare.
    RETURN NEW;
  END IF;

  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = NEW.id FOR UPDATE;
  -- Never sent (nobody has the link) or already accepted (the acceptance stays).
  IF v_link.id IS NULL OR v_link.status IN ('draft', 'accepted') THEN RETURN NEW; END IF;

  UPDATE public.quote_links l
     SET token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         status = 'draft', sent_at = NULL, first_viewed_at = NULL, last_viewed_at = NULL,
         responded_at = NULL, accepted_name = NULL, decline_reason = NULL,
         recipient_changed_at = now(), updated_at = now()
   WHERE l.id = v_link.id;
  INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version, actor_id)
  VALUES (NEW.id, v_link.band_id, 'link_rotated', 'recipient_changed', v_link.version, auth.uid());

  -- Where the quote stood with the old client: not sent to the new one yet.
  IF lower(coalesce(NEW.status, '')) IN ('sent', 'viewed', 'negotiating', 'declined') THEN
    NEW.status := 'draft';
    NEW.sent_at := NULL;
    NEW.viewed_at := NULL;
    NEW.responded_at := NULL;
    NEW.response_type := NULL;
    NEW.rejection_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_quote_recipient_changed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_quote_recipient_changed ON public.quotes;
CREATE TRIGGER bw_quote_recipient_changed
  BEFORE UPDATE OF client_email, client_phone ON public.quotes
  FOR EACH ROW
  WHEN (OLD.client_email IS DISTINCT FROM NEW.client_email OR OLD.client_phone IS DISTINCT FROM NEW.client_phone)
  EXECUTE FUNCTION public.bw_trg_quote_recipient_changed();

-- The link back to draft for the new recipient takes 105's draft branch on
-- the next publish (Share), and that branch fails: its ON CONFLICT
-- (quote_id, version) is ambiguous with the function's output column
-- "version" (42702, audit #10). 105's body with the key named instead.
CREATE OR REPLACE FUNCTION public.bw_quote_link_publish(
  p_quote_id uuid,
  p_snapshot jsonb,
  p_lang text DEFAULT NULL,
  p_pdf_url text DEFAULT NULL
)
RETURNS TABLE (token text, status text, version int, revoked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_link public.quote_links;
  v_lang text := lower(left(btrim(coalesce(p_lang, '')), 2));
  v_pdf text := nullif(btrim(coalesce(p_pdf_url, '')), '');
  v_changed boolean;
BEGIN
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR octet_length(p_snapshot::text) > 48000 THEN
    RAISE EXCEPTION 'Invalid quote summary' USING ERRCODE = '22023';
  END IF;
  IF v_lang NOT IN ('en', 'it', 'es', 'fr', 'de', 'pt') THEN v_lang := NULL; END IF;
  -- Only a PDF of this band in the public "quotes" bucket.
  IF v_pdf IS NOT NULL AND v_pdf !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/quotes/quotes/' || v_band::text || '/[A-Za-z0-9._%-]+$') THEN
    RAISE EXCEPTION 'Invalid PDF link' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.quote_links (quote_id, band_id, lang)
  VALUES (p_quote_id, v_band, coalesce(v_lang, 'en'))
  ON CONFLICT (quote_id) DO NOTHING;
  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;

  v_changed := v_link.snapshot IS DISTINCT FROM p_snapshot;
  IF v_changed AND v_link.status = 'draft' AND v_link.version >= 1 THEN
    -- Never sent: the client has seen no version yet, so this one is still
    -- version 1 (or the draft's current version, for links made before 105).
    INSERT INTO public.quote_link_versions (quote_id, band_id, version, snapshot, pdf_url)
    VALUES (p_quote_id, v_band, v_link.version, p_snapshot, v_pdf)
    -- 183: by the key's name; "version" alone is also this function's output column (42702).
    ON CONFLICT ON CONSTRAINT quote_link_versions_pkey DO UPDATE
      SET snapshot = EXCLUDED.snapshot, pdf_url = EXCLUDED.pdf_url, created_at = now();
  ELSIF v_changed THEN
    v_link.version := v_link.version + 1;
    INSERT INTO public.quote_link_versions (quote_id, band_id, version, snapshot, pdf_url)
    VALUES (p_quote_id, v_band, v_link.version, p_snapshot, v_pdf);
    -- After the first send, an edit is news for the client and the timeline.
    IF v_link.status <> 'draft' AND v_link.version > 1 THEN
      INSERT INTO public.quote_activity (quote_id, band_id, kind, version, actor_id)
      VALUES (p_quote_id, v_band, 'updated', v_link.version, auth.uid());
    END IF;
  ELSIF v_pdf IS NOT NULL THEN
    UPDATE public.quote_link_versions qv SET pdf_url = v_pdf
     WHERE qv.quote_id = p_quote_id AND qv.version = v_link.version;
  END IF;

  UPDATE public.quote_links l
     SET snapshot = p_snapshot,
         version = v_link.version,
         version_at = CASE WHEN v_changed THEN now() ELSE l.version_at END,
         lang = coalesce(v_lang, l.lang),
         -- A new version without its PDF yet hides the old PDF.
         pdf_url = CASE WHEN v_pdf IS NOT NULL THEN v_pdf WHEN v_changed THEN NULL ELSE l.pdf_url END,
         pdf_version = CASE WHEN v_pdf IS NOT NULL THEN v_link.version WHEN v_changed THEN NULL ELSE l.pdf_version END,
         updated_at = now()
   WHERE l.id = v_link.id
  RETURNING * INTO v_link;

  RETURN QUERY SELECT v_link.token, v_link.status, v_link.version, v_link.revoked_at IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_publish(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_publish(uuid, jsonb, text, text) TO authenticated;

-- --------------------------------------------------------------------
-- 2. Accept needs the version the client saw (120 + one check)
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
  v_view := public.bw_quote_link_view(p_token);
  IF v_view IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_link FROM public.quote_links l WHERE l.token = p_token FOR UPDATE;
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
-- 3. The client's page: 168 plus the recipient's own conversation and
--    the deposit amount received
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
    SELECT lower(coalesce(e.status, '')), lower(coalesce(e.payment_status, '')), coalesce(e.deposit_paid, false), e.deposit_amount
      INTO v_gig_status, v_gig_paid, v_gig_deposit, v_gig_deposit_amount
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
    -- 183: for a new recipient, only a version published after it was sent to them is "updated".
    'updated_at', CASE WHEN v_link.version > 1
                        AND (v_link.recipient_changed_at IS NULL OR v_link.version_at > v_link.sent_at)
                       THEN v_link.version_at END,
    'pdf_url', CASE WHEN v_link.status = 'accepted' THEN v_link.accepted_pdf_url
                    WHEN v_link.pdf_version = v_link.version THEN v_link.pdf_url END,
    'accepted_name', v_link.accepted_name,
    'accepted_at', CASE WHEN v_link.status = 'accepted' THEN v_link.responded_at END,
    'declined_at', CASE WHEN v_link.status = 'declined' THEN v_link.responded_at END,
    'decline_reason', CASE WHEN v_link.status = 'declined' THEN v_link.decline_reason END,
    -- A day of slack for time zones.
    'expired', v_link.status <> 'accepted' AND v_valid IS NOT NULL AND v_valid < current_date - 1,
    -- 183: the current recipient's conversation only (the band keeps all of it).
    'messages', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'from', CASE a.kind WHEN 'client_message' THEN 'client' ELSE 'band' END,
               'body', a.body,
               'at', a.created_at
             ) ORDER BY a.created_at)
        FROM public.quote_activity a
       WHERE a.quote_id = v_link.quote_id AND a.kind IN ('client_message', 'band_reply')
         AND (v_link.recipient_changed_at IS NULL OR a.created_at >= v_link.recipient_changed_at)
    ), '[]'::jsonb),
    -- 163: the "Made with BandWith" mark, decided here (paid plans §4.3).
    'made_with', public.bw_band_shows_mark(v_link.band_id),
    -- 168: the balance request and whether it was received.
    'balance', CASE WHEN v_show_balance THEN v_link.balance END,
    'balance_at', CASE WHEN v_show_balance THEN v_link.balance_at END,
    'balance_paid', v_show_balance AND (v_link.balance_paid_at IS NOT NULL OR v_gig_paid = 'paid'),
    'balance_paid_at', CASE WHEN v_show_balance THEN v_link.balance_paid_at END,
    -- 168: the band recorded the deposit as received.
    'deposit_paid', v_link.status = 'accepted' AND coalesce(v_gig_deposit, false),
    -- 183: and how much it recorded (the receipt says this, not the amount asked).
    'deposit_paid_amount', CASE WHEN v_link.status = 'accepted' AND coalesce(v_gig_deposit, false)
                                     AND v_gig_deposit_amount > 0 THEN v_gig_deposit_amount END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_view(text) TO anon, authenticated;

COMMIT;
