-- ====================================================================
-- 183: quote page fixes (audit of release 383f15b, public pages #3, #9,
-- #10, #11, and the reviews of PR #286)
--
-- 1. A new recipient gets a new link (#3). The band sent the quote to
--    client A, then changed the client to B and saved: the app republished
--    on the same token, so A's link showed B's quote and A could accept
--    it, and B saw A's messages. Now a BEFORE UPDATE trigger on quotes
--    sees the recipient change and, in the same transaction:
--    - gives the link a new token (A's link stops working at once, as
--      "New link" does) and puts it back to draft: B has not been sent it.
--      sent_at stays: bw_plan_count (161) still counts the send to A;
--    - drops A's PDF from the link (it is addressed to A): B's page shows
--      "PDF on its way" until B's own PDF is published;
--    - starts B's conversation (quote_links.recipient_changed_at): the
--      page shows only messages from then on. The band keeps the whole
--      history (quote_activity is untouched);
--    - puts the quote's own pipeline status (sent / viewed / negotiating /
--      declined) back to draft, so the app offers "Send to client";
--    - records link_rotated with body 'recipient_changed'.
--    The summary goes too (snapshot NULL: the page says the link is not
--    available until B's version is published): Copy, SMS and WhatsApp
--    hand the new token over before publishing finishes, which can fail.
--    The recipient changed when (names and emails compared without case
--    and extra spaces):
--    a. an email or a phone on file is replaced or cleared. Two phones are
--       one when they are the same number with the same country code
--       (bw_same_phone): "+1 9175550101" is not "+91 9175550101", and a
--       number without its country code is not one with it;
--    b. the name changes and a contact is added;
--    c. no contact on file (sent with Copy link): the name changes, or a
--       contact is given to a quote with no name (saved as "Client").
--    Older builds leave a cleared email or phone out of a save (supabase-js
--    drops undefined): a save that writes the client name but not the
--    email clears the email, the same for the phone, so A's address never
--    stays on B's quote (three UPDATE OF triggers tell which columns the
--    save wrote). A name fix next to an unchanged contact and a contact
--    added under the same name are left alone. A link never recorded as
--    sent gets a new token quietly (its token may be out: the send can
--    fail after the copy). An accepted link keeps the acceptance and gets
--    a new token too: the balance emails go to the new address, which gets
--    its own conversation, no PDF of the signer and no signature.
--    While the link waits for the new client, a full save from a screen
--    opened before the change (the old client's viewed / negotiating /
--    declined written back, no answer recorded) is refused with an error;
--    a status change alone goes through. A trigger, not the publish RPC:
--    every way of saving the quote (old builds, any screen) is covered.
-- 2. bw_quote_link_publish (105's body): the key named in its ON CONFLICT
--    (the draft branch failed with 42702, audit #10), and the new
--    recipient's first publish is always a new version, even with the same
--    summary: the version A saw, accepted or declined stays as it was.
--    A new optional p_token: a publish meant for a link replaced since
--    (a slow PDF upload for A landing after the quote went to B) writes
--    nothing and fails (BW_LINK_CHANGED). Older builds don't send it.
-- 3. Consent per version (#9): bw_quote_link_respond (120) made the
--    version optional, so an acceptance without one landed on whatever
--    version was current. Now 'accept' needs the exact version the client
--    saw (decline unchanged). Every /quote.html ever shipped sends
--    p_version (since 099 / PR #128); the HTML is served by Vercel with
--    max-age=0, must-revalidate and its scripts are content-hashed, so no
--    browser keeps an older page.
-- 4. An accepted link keeps the client name it was accepted under
--    (quote_links.accepted_client_name, set by a trigger when the link
--    becomes accepted, backfilled for links accepted before 183): renaming
--    the client afterwards does not show the new name to the signer.
-- 5. The deposit received (#11): bw_quote_deposit_received (168's body)
--    keeps the amount the band typed and the gig's currency on the link
--    (deposit_received_amount / _currency; nothing typed = no amount, not
--    the amount asked). bw_quote_link_view gives them as
--    deposit_paid_amount / deposit_paid_currency while the gig's deposit
--    is paid at that amount.
-- 6. Lock order: the functions that write the link, then the quote (seen,
--    message, respond, mark sent) lock the quote first, as a save of the
--    quote does, so the two cannot deadlock.
--
-- bw_quote_link_view is 168's body plus the conversation start, the
-- "updated" rule for a new recipient, the accepted client name and the
-- deposit amount; bw_quote_link_respond is 120's body plus the version
-- check; seen, message and mark sent are 099's / 161's plus one lock. No
-- new anon grant: the trigger and helper functions are not callable by anon
-- or authenticated. Safe to run more than once.
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- 1. A new recipient gets a new link
-- --------------------------------------------------------------------

ALTER TABLE public.quote_links
  -- Where the current recipient's conversation starts (null: from the first message).
  ADD COLUMN IF NOT EXISTS recipient_changed_at timestamptz,
  -- The client name the quote was accepted under (what the signer's page shows).
  ADD COLUMN IF NOT EXISTS accepted_client_name text,
  -- The deposit the band recorded as received: the amount typed, the gig's currency.
  ADD COLUMN IF NOT EXISTS deposit_received_amount numeric,
  ADD COLUMN IF NOT EXISTS deposit_received_currency text;

-- Two phone numbers are one person's when they are the same number with
-- the same country code: "+1 917 555 0101" = "001 (917) 555-0101", but
-- "+1 9175550101" is not "+91 9175550101", and a number written without
-- its country code is not the same as one written with it (a leading +
-- or 00 is the country code; nothing is guessed).
CREATE OR REPLACE FUNCTION public.bw_same_phone(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT a = b
  FROM (SELECT CASE WHEN btrim(coalesce(p_a, '')) ~ '^(\+|00)'
                    THEN '+' || regexp_replace(regexp_replace(btrim(p_a), '\D', '', 'g'), '^00', '')
                    ELSE regexp_replace(coalesce(p_a, ''), '\D', '', 'g') END AS a,
               CASE WHEN btrim(coalesce(p_b, '')) ~ '^(\+|00)'
                    THEN '+' || regexp_replace(regexp_replace(btrim(p_b), '\D', '', 'g'), '^00', '')
                    ELSE regexp_replace(coalesce(p_b, ''), '\D', '', 'g') END AS b) d;
$$;
REVOKE ALL ON FUNCTION public.bw_same_phone(text, text) FROM PUBLIC, anon, authenticated;

-- Which client fields an UPDATE writes. "UPDATE OF col" fires only when the
-- column is in the UPDATE's SET list (whatever its value), so these three
-- tell the recipient trigger (it runs after them: triggers of one event run
-- in name order) that the save wrote the name, the email, the phone. Every
-- app build writes client_name on each save of the wizard; older builds
-- leave an empty email or phone out (supabase-js drops undefined).
CREATE OR REPLACE FUNCTION public.bw_trg_quote_field_listed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('bw.quote_listed_' || TG_ARGV[0], NEW.id::text, true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_quote_field_listed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_quote_0_listed_name ON public.quotes;
CREATE TRIGGER bw_quote_0_listed_name BEFORE UPDATE OF client_name ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_quote_field_listed('name');
DROP TRIGGER IF EXISTS bw_quote_0_listed_email ON public.quotes;
CREATE TRIGGER bw_quote_0_listed_email BEFORE UPDATE OF client_email ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_quote_field_listed('email');
DROP TRIGGER IF EXISTS bw_quote_0_listed_phone ON public.quotes;
CREATE TRIGGER bw_quote_0_listed_phone BEFORE UPDATE OF client_phone ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_quote_field_listed('phone');

-- The quote row of a link, locked: the functions that write a link and then
-- the quote take the quote first, as a save of the quote does (its trigger
-- below locks the link), so the two never wait on each other (deadlock).
CREATE OR REPLACE FUNCTION public.bw_quote_lock_for_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
  PERFORM 1 FROM public.quotes q
   WHERE q.id = (SELECT l.quote_id FROM public.quote_links l WHERE l.token = p_token)
     FOR UPDATE;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_lock_for_token(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_trg_quote_recipient_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text := NEW.id::text;
  -- A save of the whole quote (the wizard): it writes the client name.
  v_save boolean := coalesce(current_setting('bw.quote_listed_name', true), '') = v_id;
  v_email_listed boolean := coalesce(current_setting('bw.quote_listed_email', true), '') = v_id;
  v_phone_listed boolean := coalesce(current_setting('bw.quote_listed_phone', true), '') = v_id;
  v_old_name text;
  v_new_name text;
  v_old_email text;
  v_new_email text;
  v_old_phone text;
  v_new_phone text;
  v_renamed boolean;
  v_no_name boolean;
  v_new_recipient boolean;
  v_link public.quote_links;
BEGIN
  PERFORM set_config('bw.quote_listed_name', '', true);
  PERFORM set_config('bw.quote_listed_email', '', true);
  PERFORM set_config('bw.quote_listed_phone', '', true);
  -- An older build's save leaves a cleared email or phone out: the form has
  -- it empty, so it is cleared here too (as newer builds send it), and the
  -- old client's address never stays on the new client's quote.
  IF v_save AND NOT v_email_listed THEN NEW.client_email := NULL; END IF;
  IF v_save AND NOT v_phone_listed THEN NEW.client_phone := NULL; END IF;
  IF OLD.client_name IS NOT DISTINCT FROM NEW.client_name AND OLD.client_email IS NOT DISTINCT FROM NEW.client_email
     AND OLD.client_phone IS NOT DISTINCT FROM NEW.client_phone AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_old_name := lower(regexp_replace(btrim(coalesce(OLD.client_name, '')), '\s+', ' ', 'g'));
  v_new_name := lower(regexp_replace(btrim(coalesce(NEW.client_name, '')), '\s+', ' ', 'g'));
  v_old_email := lower(btrim(coalesce(OLD.client_email, '')));
  v_new_email := lower(btrim(coalesce(NEW.client_email, '')));
  v_old_phone := regexp_replace(coalesce(OLD.client_phone, ''), '\D', '', 'g');
  v_new_phone := regexp_replace(coalesce(NEW.client_phone, ''), '\D', '', 'g');
  v_renamed := v_new_name <> v_old_name;
  -- The wizard saves an empty name as "Client": that is no name.
  v_no_name := v_old_name IN ('', 'client');
  v_new_recipient :=
    -- a. a contact on file replaced or cleared
    (v_old_email <> '' AND v_new_email <> v_old_email)
    OR (v_old_phone <> '' AND NOT public.bw_same_phone(OLD.client_phone, NEW.client_phone))
    -- b. another name and a contact added
    OR (v_renamed AND ((v_old_email = '' AND v_new_email <> '') OR (v_old_phone = '' AND v_new_phone <> '')))
    -- c. no contact on file (sent with Copy link): another name, or a
    --    contact given to a quote with no name (whose link it is, unknown)
    OR (v_old_email = '' AND v_old_phone = ''
        AND (v_renamed OR (v_no_name AND (v_new_email <> '' OR v_new_phone <> ''))));

  IF NOT v_new_recipient THEN
    -- Waiting for the new client: a save from a screen opened before the
    -- change (it writes back the old client's viewed / negotiating /
    -- declined, with no answer recorded) is refused, with an error the app
    -- shows; the screen opened again has the quote as it is now. A status
    -- change alone (no full save) is the band's own and goes through, and
    -- "sent" stays possible (the PDF shared as a file).
    IF v_save
       AND lower(coalesce(OLD.status, '')) = 'draft'
       AND lower(coalesce(NEW.status, '')) IN ('viewed', 'negotiating', 'declined')
       AND NEW.response_type IS NOT DISTINCT FROM OLD.response_type
       AND EXISTS (SELECT 1 FROM public.quote_links l
                    WHERE l.quote_id = NEW.id AND l.status = 'draft' AND l.recipient_changed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'This quote changed while it was open. Close it and open it again.' USING ERRCODE = '40001';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = NEW.id FOR UPDATE;
  IF v_link.id IS NULL THEN RETURN NEW; END IF;
  IF v_link.status = 'draft' THEN
    -- Never recorded as sent, but its token may be out: Copy, SMS and
    -- WhatsApp hand it over before the send is recorded, which can fail.
    -- A new token, quietly (nothing was sent, nothing to tell).
    UPDATE public.quote_links l
       SET token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), updated_at = now()
     WHERE l.id = v_link.id;
    RETURN NEW;
  END IF;

  IF v_link.status = 'accepted' THEN
    -- The acceptance stays (the deal is done), but the old address no
    -- longer holds the link the balance emails go out with: a new token,
    -- the new addressee's conversation from now, and no PDF of the signer
    -- (the version history keeps it). The page shows them no signature.
    UPDATE public.quote_links l
       SET token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
           pdf_url = NULL, pdf_version = NULL, accepted_pdf_url = NULL,
           recipient_changed_at = now(), updated_at = now()
     WHERE l.id = v_link.id;
    INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version, actor_id)
    VALUES (NEW.id, v_link.band_id, 'link_rotated', 'recipient_changed', v_link.version, auth.uid());
    RETURN NEW;
  END IF;

  -- The summary goes too: the new token can be handed out (Copy, SMS,
  -- WhatsApp) before the new client's version is published, and until it
  -- is the page says the link is not available, never the old terms.
  UPDATE public.quote_links l
     SET token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         status = 'draft', first_viewed_at = NULL, last_viewed_at = NULL,
         responded_at = NULL, accepted_name = NULL, decline_reason = NULL,
         snapshot = NULL, pdf_url = NULL, pdf_version = NULL,
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

-- Every update (no column list): it also clears what the three above noted.
DROP TRIGGER IF EXISTS bw_quote_recipient_changed ON public.quotes;
CREATE TRIGGER bw_quote_recipient_changed
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.bw_trg_quote_recipient_changed();

-- --------------------------------------------------------------------
-- An accepted link keeps the client name it was accepted under
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bw_trg_quote_link_accepted_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    SELECT q.client_name INTO NEW.accepted_client_name FROM public.quotes q WHERE q.id = NEW.quote_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_quote_link_accepted_name() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_quote_link_accepted_name ON public.quote_links;
CREATE TRIGGER bw_quote_link_accepted_name
  BEFORE UPDATE OF status ON public.quote_links
  FOR EACH ROW
  WHEN (NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted')
  EXECUTE FUNCTION public.bw_trg_quote_link_accepted_name();

-- Links accepted before 183: the name on the quote now (the best there is).
UPDATE public.quote_links l
   SET accepted_client_name = q.client_name
  FROM public.quotes q
 WHERE q.id = l.quote_id AND l.status = 'accepted' AND l.accepted_client_name IS NULL;

-- --------------------------------------------------------------------
-- 2. Publish
-- --------------------------------------------------------------------

-- 105's body with three changes:
-- - the draft branch failed: its ON CONFLICT (quote_id, version) is
--   ambiguous with the function's output column "version" (42702, audit
--   #10); the key is named instead;
-- - a new recipient's first publish is always a new version, even with the
--   same summary, so the version the old client saw (accepted, declined)
--   is never overwritten; later drafts before the send replace that one;
-- - p_token (new, optional): the link the caller is publishing for, as it
--   read it. When the link has another token now (the client changed, or
--   "New link"), nothing is written and the call fails (P0001 BW_LINK_CHANGED): a
--   publish that started for the old client (a slow PDF upload, a screen
--   left open on another device) never lands on the new client's link.
--   Older builds don't send it and publish as before. The function is
--   dropped and created again with the new parameter (a default, so the
--   four named arguments of older builds still find it); same grants.
DROP FUNCTION IF EXISTS public.bw_quote_link_publish(uuid, jsonb, text, text);
CREATE OR REPLACE FUNCTION public.bw_quote_link_publish(
  p_quote_id uuid,
  p_snapshot jsonb,
  p_lang text DEFAULT NULL,
  p_pdf_url text DEFAULT NULL,
  p_token text DEFAULT NULL
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
  v_fresh boolean;
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
  -- 183: published for a link that has been replaced since.
  IF p_token IS NOT NULL AND v_link.token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'BW_LINK_CHANGED: the quote link was replaced, open the quote again' USING ERRCODE = 'P0001';
  END IF;

  -- 183: back to draft for a new recipient, and nothing published for them yet.
  v_fresh := v_link.status = 'draft' AND v_link.recipient_changed_at IS NOT NULL
             AND (v_link.version_at IS NULL OR v_link.version_at <= v_link.recipient_changed_at);
  v_changed := v_link.snapshot IS DISTINCT FROM p_snapshot OR v_fresh;
  IF v_changed AND v_link.status = 'draft' AND v_link.version >= 1 AND NOT v_fresh THEN
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
REVOKE ALL ON FUNCTION public.bw_quote_link_publish(uuid, jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_publish(uuid, jsonb, text, text, text) TO authenticated;

-- --------------------------------------------------------------------
-- 3. Accept needs the version the client saw (120 + one check, and the
--    quote locked before the link)
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
  -- 183: the quote first, then the link (the order of a save of the quote).
  PERFORM public.bw_quote_lock_for_token(p_token);
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
-- 4. The deposit received: 168's body plus the amount and currency kept
--    on the link for the client's receipt
-- --------------------------------------------------------------------

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
  v_currency text;
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
  SELECT lower(coalesce(e.status, '')), coalesce(e.deposit_paid, false),
         upper(coalesce(nullif(btrim(e.currency), ''), (SELECT q.currency FROM public.quotes q WHERE q.id = p_quote_id)))
    INTO v_gig_status, v_was, v_currency
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

  -- 183: what the client's receipt says: the amount typed, in the gig's
  -- currency; nothing typed = no amount (not the amount asked).
  UPDATE public.quote_links l
     SET deposit_received_amount = CASE WHEN v_received AND p_amount > 0 THEN p_amount END,
         deposit_received_currency = CASE WHEN v_received AND p_amount > 0 AND v_currency ~ '^[A-Z]{3}$' THEN v_currency END
   WHERE l.quote_id = p_quote_id;

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
-- 5. The client's page: 168 plus the recipient's own conversation, the
--    accepted client name and the deposit amount received
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
  -- 183: the link is the signer's (not given to another client since the acceptance).
  v_signer := v_link.status = 'accepted'
              AND (v_link.recipient_changed_at IS NULL OR v_link.recipient_changed_at <= v_link.responded_at);
  v_show_balance := v_link.status = 'accepted' AND v_link.balance IS NOT NULL AND coalesce(v_gig_status, '') <> 'cancelled';
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
    -- 183: and how much it recorded, in the gig's currency (the receipt says
    -- this, not the amount asked). Only while the gig still has the deposit
    -- paid at that amount (changed in the gig itself: no amount).
    'deposit_paid_amount', CASE WHEN v_show_deposit THEN v_link.deposit_received_amount END,
    'deposit_paid_currency', CASE WHEN v_show_deposit THEN v_link.deposit_received_currency END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_view(text) TO anon, authenticated;

-- --------------------------------------------------------------------
-- 6. The quote before the link: seen (099), message (099), mark sent
--    (161), each with one line that locks the quote row first. A save of
--    the quote locks the quote, then (its trigger) the link; these locked
--    the link, then wrote the quote, so a save and a client's tap at the
--    same moment could deadlock and one of them failed.
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bw_quote_link_seen(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.quote_links;
  v_title text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  PERFORM public.bw_quote_lock_for_token(p_token); -- 183: the quote first
  SELECT * INTO v_link FROM public.quote_links l WHERE l.token = p_token FOR UPDATE;
  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL OR v_link.snapshot IS NULL THEN RETURN NULL; END IF;

  IF v_link.first_viewed_at IS NULL THEN
    UPDATE public.quote_links l
       SET first_viewed_at = now(), last_viewed_at = now(),
           status = CASE WHEN l.status IN ('draft', 'sent') THEN 'viewed' ELSE l.status END,
           updated_at = now()
     WHERE l.id = v_link.id;
    INSERT INTO public.quote_activity (quote_id, band_id, kind, version)
    VALUES (v_link.quote_id, v_link.band_id, 'viewed', v_link.version);
    UPDATE public.quotes q
       SET status = CASE WHEN coalesce(q.status, 'draft') IN ('draft', 'sent') THEN 'viewed' ELSE q.status END,
           viewed_at = coalesce(q.viewed_at, now())
     WHERE q.id = v_link.quote_id;
    v_title := v_link.snapshot ->> 'title';
    PERFORM public.bw_quote_notify(v_link.quote_id, 'quote_viewed',
      coalesce((SELECT q.client_name FROM public.quotes q WHERE q.id = v_link.quote_id), 'The client') || ' opened the quote',
      coalesce(v_title, 'Quote') || coalesce(' · ' || (v_link.snapshot ->> 'ref'), ''),
      jsonb_build_object('kind', 'viewed', 'eventTitle', v_title, 'ref', v_link.snapshot ->> 'ref'));
  ELSIF v_link.last_viewed_at IS NULL OR v_link.last_viewed_at < now() - interval '5 minutes' THEN
    UPDATE public.quote_links l SET last_viewed_at = now() WHERE l.id = v_link.id;
  END IF;
  RETURN public.bw_quote_link_view(p_token);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_seen(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_seen(text) TO anon, authenticated;

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
  PERFORM public.bw_quote_lock_for_token(p_token); -- 183: the quote first
  IF public.bw_quote_link_view(p_token) IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_link FROM public.quote_links l WHERE l.token = p_token FOR UPDATE;
  SELECT count(*) INTO v_recent FROM public.quote_activity a
   WHERE a.quote_id = v_link.quote_id AND a.kind = 'client_message' AND a.created_at > now() - interval '1 hour';
  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'Too many messages, try again later' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version)
  VALUES (v_link.quote_id, v_link.band_id, 'client_message', v_body, v_link.version);
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

CREATE OR REPLACE FUNCTION public.bw_quote_link_mark_sent(p_quote_id uuid, p_kind text DEFAULT 'sent'::text, p_channel text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_link public.quote_links;
  v_kind text;
  v_channel text := nullif(lower(btrim(coalesce(p_channel, ''))), '');
BEGIN
  IF v_channel IS NOT NULL AND v_channel NOT IN ('whatsapp', 'sms', 'email', 'copy', 'share') THEN v_channel := NULL; END IF;
  PERFORM 1 FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE; -- 183: the quote first
  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Publish the quote first' USING ERRCODE = 'P0002';
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'The link is turned off' USING ERRCODE = '22023';
  END IF;
  -- Paid plans (161): the first send counts towards this month's sends.
  IF v_link.status = 'draft' AND COALESCE(p_kind, 'sent') <> 'reminded' THEN
    PERFORM public.bw_plan_guard(v_band, 'quotes_sent_month', 1);
  END IF;
  v_kind := CASE WHEN p_kind = 'reminded' THEN 'reminded'
                 WHEN v_link.status = 'draft' THEN 'sent' ELSE 'resent' END;

  INSERT INTO public.quote_activity (quote_id, band_id, kind, channel, version, actor_id)
  VALUES (p_quote_id, v_band, v_kind, v_channel, v_link.version, auth.uid());

  IF v_link.status = 'draft' THEN
    UPDATE public.quote_links l SET status = 'sent', sent_at = now(), updated_at = now() WHERE l.id = v_link.id;
    v_link.status := 'sent';
  END IF;
  UPDATE public.quotes q SET status = 'sent', sent_at = coalesce(q.sent_at, now()), updated_at = now()
   WHERE q.id = p_quote_id AND coalesce(q.status, 'draft') = 'draft';
  RETURN v_link.status;
END;
$function$;
REVOKE ALL ON FUNCTION public.bw_quote_link_mark_sent(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_mark_sent(uuid, text, text) TO authenticated;

-- bw_quote_link_publish has a new parameter: PostgREST reads it now.
NOTIFY pgrst, 'reload schema';

COMMIT;
