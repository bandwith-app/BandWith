-- ====================================================================
-- 183: quote page fixes (audit of release 383f15b, public pages #3, #9,
-- #10, #11, and the reviews of PR #286)
--
-- Do not run 183 again once 187 is applied (187 redefines the page
-- functions on top of it): a guard below refuses to.
--
-- 1. A new recipient gets a new link (#3). The band sent the quote to
--    client A, then changed the client to B and saved: the app republished
--    on the same token, so A's link showed B's quote and A could accept
--    it, and B saw A's messages. Now a BEFORE UPDATE trigger on quotes
--    sees the recipient change and, in the same locked transaction
--    (whatever the link's state: draft, sent, accepted):
--    - revokes A's link: its row moves to quote_link_retired (the token
--      opens nothing; the send still counts for the plan, bw_plan_count);
--    - makes a new, empty link for B: no summary, PDF, balance, payment
--      note, signature or conversation (a new row: every column starts
--      from its default, also those other migrations add). It is
--      unpublished: the page shows nothing and the app shares nothing until
--      B's version is published on it. The version count goes on (A's
--      versions stay in quote_link_versions);
--    - puts the quote's pipeline status (sent / viewed / negotiating /
--      declined) back to draft, so the app offers "Send to client";
--    - records link_rotated with body 'recipient_changed'.
--    Every timeline row now names its link (quote_activity.link_id, filled
--    by a trigger when the caller doesn't): the page shows only its own
--    link's conversation, and a band reply written in A's conversation
--    stays on A's link (bw_quote_reply p_token), or fails once it is gone.
--    The recipient changed when (names and emails compared without case
--    and extra spaces):
--    a. an email or a phone on file is replaced or cleared. Two phones are
--       one when the digits match, or one is the other with its country
--       code added (bw_same_phone); both with a code, the codes must match
--       ("+1 9175550101" is not "+91 9175550101");
--    b. the name changes and a contact is added;
--    c. no contact on file (sent with Copy link): the name changes, or a
--       contact is given to a quote with no name (saved as "Client"). Not
--       on an accepted link: a rename there is a fix.
--    Round 4: an accepted quote keeps its client: a new recipient there is
--    refused (P0001, hint BW_QUOTE_ACCEPTED, "duplicate it" in the admin's
--    language); the acceptance, the deposit and the balance stay on its
--    link. A correction of the same client (the name, the phone with its
--    country code or trunk 0, the email's case) is no new recipient and is
--    copied onto the link's recipient. Phones: the number without a
--    country code may start with its trunk 0 ("06 12 34 56 78" =
--    "+33 6 12 34 56 78"), and the national part has at least 9 digits.
--    Older builds leave a cleared field out of a save (supabase-js drops
--    undefined): a full save of the wizard (it writes the client name and
--    the prices) that leaves out the email, phone, company, billing
--    address, VAT number, fiscal code or client notes clears them, so A's
--    data never stays on B's quote (UPDATE OF triggers tell which columns
--    the save wrote). Any other update clears nothing.
--    An older build's screen opened before the change writes back A's
--    viewed / negotiating / declined: its save is kept without that status,
--    and refused (40001, in the admin's language) only when it would undo
--    what changed since it read the quote: the client, the prices, the
--    amounts (quote_links.reassign_guard keeps the quote before and after
--    the change). Newer builds never write the status in an edit.
--    Round 4: newer builds write only the fields that changed, and say when
--    their screen read the quote (quotes.edit_base_at, cleared by the
--    trigger, never stored). Any edit made on a screen read before the
--    quote went to a new client is refused (40001), whatever it sends
--    (Codex 11-22: also notes, fees or a date alone, which a republish
--    would put on the new client's page); the full-save clearing above is
--    for older builds only, and so is every save without edit_base_at.
-- 2. bw_quote_link_publish (105's body): the key named in its ON CONFLICT
--    (the draft branch failed with 42702, audit #10), and the new
--    recipient's first publish is always a new version, even with the same
--    summary: the version A saw, accepted or declined stays as it was.
--    A new optional p_token: a publish meant for a link replaced since
--    (a slow PDF upload for A landing after the quote went to B) writes
--    nothing and fails (BW_LINK_CHANGED). Older builds don't send it: on a
--    link made for a new recipient their publish is refused.
--    Round 4: a new optional p_version, the version the admin's screen
--    shows: another version published since writes nothing and fails
--    (BW_VERSION_CHANGED). A summary with the same contentKey (the app's
--    hash of its content in English) is no new version: switching the
--    page's language keeps the version and the client's "I accept". The
--    link keeps who it was published for (recipient_email / _name, read
--    under the quote's lock): send-email writes to that address only, by
--    the link id the app holds, and sends nothing on a link replaced since.
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
--    keeps the amount the band typed and the quote's currency on the link
--    (deposit_received_amount / _currency; nothing typed = no amount, not
--    the amount asked). bw_quote_link_view gives them as
--    deposit_paid_amount / deposit_paid_currency while the gig's deposit
--    is paid at that amount. Round 4: the amount in cents (round(.., 2)),
--    at most 99,999,999.99; the receipt's currency is the one recorded with
--    the payment (deposits recorded before get the quote's); a quote with a
--    payment recorded (the deposit, or the balance marked paid) cannot
--    change currency (P0001, hint BW_QUOTE_CURRENCY_LOCKED, detail = the
--    currency).
-- 6. Lock order, one for all: the quote, then the link, then the gig.
--    publish, seen, message, respond, mark sent, reply and the deposit
--    received lock the quote first, as a save of the quote does. Mark sent
--    also needs the link and the version that went out (p_token, p_version).
--
-- bw_quote_link_view is 168's body plus the conversation start, the
-- "updated" rule for a new recipient, the accepted client name and the
-- deposit amount; bw_quote_link_respond is 120's body plus the version
-- check; seen, message and mark sent are 099's / 161's plus one lock. No
-- new anon grant: the trigger and helper functions are not callable by anon
-- or authenticated. Safe to run more than once.
--
-- Round 5 (Codex + Claude reviews of 8f5922d7):
--  - older builds (383f15b: no token) are no longer refused for good on a
--    link made for a new recipient: their publish lands when its summary is
--    for the client the quote has now (notes, PDF name: what their summary
--    carries of the client), else 40001 with "update the app" in the
--    admin's language; their mark sent and reply go once that link is
--    published for its current recipient (bw_quote_link_current);
--  - publish: a stale screen is refused with 40001 (another token, another
--    version, or p_version 0 = "I saw no link" and one exists); the first
--    publish is version 1 with its history row (coalesce on a NULL summary);
--  - the totals are computed by the database in the same UPDATE, from the
--    change of the stored parts (bw_quote_totals): concurrent fee edits both
--    count, newer builds send no totals;
--  - recipient trigger: an accepted quote with no link keeps its client; an
--    email typo on an accepted quote is a fix until the balance is asked; a
--    name edit alone with no email or phone on file is a fix; an older
--    build's full save keeps "accepted" and the billing address; the
--    reassign guard keeps only the guarded columns;
--  - bw_same_phone ignores spaces, brackets, dots and dashes before the
--    country-code test.
-- Round 6 (Codex review of 86dd51f6):
--  - newer builds name who the summary is for (snapshot "client": name,
--    email); publish checks it against the quote under the lock (40001 when
--    the quote now goes to someone else) and never stores it;
--  - a summary with no client in it and no PDF (383f15b): also refused when the quote's
--    client is not the one the link was last published for (the link's
--    recipient, or, on a link made for a new recipient, the one kept in
--    reassign_guard.published at the change), 40001 "update the app"; with
--    nothing recorded, the notes + PDF name check alone;
--  - an older build's reply (no token) never lands on a link made for a new
--    recipient: its screen may hold a draft for the previous client; round
--    6b: unless that link was renewed ("New link", bw_quote_link_rotate,
--    same shape as 099) for the same client after it was published for
--    them;
--  - a quote whose gig has a deposit recorded (accepted by phone, no link)
--    keeps its currency too.
-- New functions take no grants beyond the definer's (REVOKE ALL). The
-- redefined bw_quote_link_rotate keeps 099's GRANT EXECUTE to authenticated
-- (its admin check is inside); no RPC older builds call changed shape.
-- Known limit (accepted, release note): an older build (383f15b) with a
-- reply typed for client A, while another device gives the quote to B,
-- publishes, sends and renews the link ("New link"): its 20 s poll shows
-- B's conversation but keeps the typed text, and Send then delivers it to
-- B. The admin sees B's conversation when tapping Send; refusing every
-- reply without a token after a client change would stop replies for all
-- 383f15b users.
--
-- Deploy order: 183, 185, 186, 187, then redeploy send-email (it reads
-- quote_links.recipient_email and balance_version and claims the email
-- slot with a conditional update; round 5: admin check before the link,
-- idempotency key, slot kept when the send may have gone out).
-- ====================================================================

BEGIN;

-- 183 must not run again once 187 is in: 187 redefines the page functions
-- below (view, respond, message) on top of 185, and running 183 again would
-- put the older bodies back. 187's view reads balance_sent.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'bw_quote_link_view'
                AND p.prosrc LIKE '%balance_sent%') THEN
    RAISE EXCEPTION '183 is already followed by 187 on this database: do not run 183 again (it would undo 187)';
  END IF;
END
$guard$;

-- --------------------------------------------------------------------
-- 1. A new recipient gets a new link
-- --------------------------------------------------------------------

ALTER TABLE public.quote_links
  -- When this link was made for a new recipient (null: the quote's first link).
  ADD COLUMN IF NOT EXISTS recipient_changed_at timestamptz,
  -- The client name the quote was accepted under (what the signer's page shows).
  ADD COLUMN IF NOT EXISTS accepted_client_name text,
  -- The deposit the band recorded as received: the amount typed, in the quote's currency.
  ADD COLUMN IF NOT EXISTS deposit_received_amount numeric,
  ADD COLUMN IF NOT EXISTS deposit_received_currency text,
  -- What the quote held when it was given to the new recipient (before /
  -- after the save, and the old client's status): an older build's screen
  -- opened before that save is recognised by it (see the trigger).
  ADD COLUMN IF NOT EXISTS reassign_guard jsonb,
  -- Round 4: who this link was published for (the quote's contact at the
  -- publish, under the quote's lock). The email goes to this address, never
  -- to the quote's contact read separately (it may be the next client's).
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS recipient_name text;

-- Round 4: the quote as the admin's screen read it (its updated_at), sent by
-- newer builds with an edit. An edit of the client's contact made on a
-- screen read before the quote went to a new client is refused (whatever
-- other fields the save sends). Never kept: the trigger clears it.
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS edit_base_at timestamptz;

-- The links a new recipient replaced. Their tokens open nothing (the page
-- finds only quote_links), and the sends they had still count for the plan.
CREATE TABLE IF NOT EXISTS public.quote_link_retired (
  link_id uuid PRIMARY KEY,
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  status text,
  sent_at timestamptz,
  reason text NOT NULL DEFAULT 'recipient_changed',
  retired_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quote_link_retired_quote_idx ON public.quote_link_retired (quote_id);
CREATE INDEX IF NOT EXISTS quote_link_retired_band_idx ON public.quote_link_retired (band_id, sent_at);
ALTER TABLE public.quote_link_retired ENABLE ROW LEVEL SECURITY;
-- No policy: only the SECURITY DEFINER functions read it.
REVOKE ALL ON public.quote_link_retired FROM PUBLIC, anon, authenticated;

-- Which link a conversation line (or any timeline row) belongs to. A reply
-- written in A's conversation stays A's: B's page shows only its own link's.
ALTER TABLE public.quote_activity ADD COLUMN IF NOT EXISTS link_id uuid;
CREATE INDEX IF NOT EXISTS quote_activity_link_idx ON public.quote_activity (link_id);

CREATE OR REPLACE FUNCTION public.bw_trg_quote_activity_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.link_id IS NULL THEN
    SELECT l.id INTO NEW.link_id FROM public.quote_links l WHERE l.quote_id = NEW.quote_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_quote_activity_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_quote_activity_link ON public.quote_activity;
CREATE TRIGGER bw_quote_activity_link
  BEFORE INSERT ON public.quote_activity
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_quote_activity_link();

-- Rows before 183: the quote's one link (no quote had a new recipient yet).
UPDATE public.quote_activity a
   SET link_id = l.id
  FROM public.quote_links l
 WHERE a.link_id IS NULL AND l.quote_id = a.quote_id;

-- The plan's sends (161's body): a send to a replaced link still counts.
CREATE OR REPLACE FUNCTION public.bw_plan_count(p_band_id uuid, p_key text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN CASE p_key
    WHEN 'quotes_sent_month' THEN
      (SELECT count(*) FROM quote_links l WHERE l.band_id = p_band_id AND l.sent_at >= public.bw_plan_month_start())
      -- 183: and the links a new recipient replaced.
      + (SELECT count(*) FROM quote_link_retired r WHERE r.band_id = p_band_id AND r.sent_at >= public.bw_plan_month_start())
    WHEN 'contracts_sent_month' THEN
      (SELECT count(*) FROM contracts c WHERE c.band_id = p_band_id AND COALESCE(c.type, 'contract') <> 'rider'
         AND c.sent_at >= public.bw_plan_month_start())
    WHEN 'deputies' THEN
      (SELECT count(*) FROM band_deputies d WHERE d.band_id = p_band_id)
    WHEN 'admins' THEN
      (SELECT count(*) FROM band_members m WHERE m.band_id = p_band_id AND m.role = 'admin' AND COALESCE(m.is_active, true))
    WHEN 'custom_templates' THEN
      (SELECT count(*) FROM task_templates t WHERE t.band_id = p_band_id AND NOT COALESCE(t.is_default, false))
    WHEN 'gear_items' THEN
      (SELECT count(*) FROM inventory i WHERE i.band_id = p_band_id AND i.owner_id IS NULL)
    WHEN 'storage_mb' THEN
      ceil(public.bw_plan_storage_bytes(p_band_id) / 1048576.0)::bigint
    ELSE 0
  END;
END;
$function$;

-- Two phone numbers are one person's when their digits are the same, or
-- when one is the other with its country code added ("917-555-0101" =
-- "+1 917 555 0101", 00 = +). Round 4: the number written without a
-- country code may start with the national trunk 0, which the
-- international form drops ("06 12 34 56 78" = "+33 6 12 34 56 78",
-- "030 1234567" = "+49 30 1234567", "07700 900123" = "+44 7700 900123");
-- kept too where the 0 stays ("06 1234 5678" = "+39 06 1234 5678"). Both
-- written with a country code, the codes must match: "+1 9175550101" is not
-- "+91 9175550101". A shorter number inside a longer one is not enough: the
-- national part has at least 9 digits ("555-0101" is not "+1 646 555 0101").
CREATE OR REPLACE FUNCTION public.bw_same_phone(p_a text, p_b text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  -- Round 5: spaces, brackets, dots and dashes go before the prefix test,
  -- so "(+1) 917 555 0101" has its country code.
  v_a_raw text := regexp_replace(coalesce(p_a, ''), '[\s().-]', '', 'g');
  v_b_raw text := regexp_replace(coalesce(p_b, ''), '[\s().-]', '', 'g');
  v_a_cc boolean := v_a_raw ~ '^(\+|00)';
  v_b_cc boolean := v_b_raw ~ '^(\+|00)';
  v_a text := regexp_replace(coalesce(p_a, ''), '\D', '', 'g');
  v_b text := regexp_replace(coalesce(p_b, ''), '\D', '', 'g');
  v_long text;
  v_short text;
  v_national text;
BEGIN
  IF v_a_raw ~ '^00' THEN v_a := substr(v_a, 3); END IF;
  IF v_b_raw ~ '^00' THEN v_b := substr(v_b, 3); END IF;
  IF v_a = v_b THEN RETURN true; END IF;
  -- Both with a country code (or both without): the digits must match.
  IF v_a_cc = v_b_cc THEN RETURN false; END IF;
  IF v_a_cc THEN v_long := v_a; v_short := v_b; ELSE v_long := v_b; v_short := v_a; END IF;
  FOREACH v_national IN ARRAY ARRAY[v_short, CASE WHEN v_short ~ '^0[1-9]' THEN substr(v_short, 2) END] LOOP
    CONTINUE WHEN v_national IS NULL;
    IF length(v_national) >= 9
       AND length(v_long) - length(v_national) BETWEEN 1 AND 3
       AND right(v_long, length(v_national)) = v_national THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_same_phone(text, text) FROM PUBLIC, anon, authenticated;

-- Which columns an UPDATE writes. "UPDATE OF col" fires only when the
-- column is in the UPDATE's SET list (whatever its value), so these
-- triggers (bw_quote_0_listed_*, they run before the recipient trigger:
-- triggers of one event run in name order) note in bw.quote_listed which
-- columns the save wrote: "<quote id>:col,col,...". Every app build
-- writes client_name, base_fee and custom_items on each save of the
-- wizard (a full save); older builds leave an empty field out
-- (supabase-js drops undefined).
CREATE OR REPLACE FUNCTION public.bw_trg_quote_field_listed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur text := coalesce(current_setting('bw.quote_listed', true), '');
BEGIN
  PERFORM set_config('bw.quote_listed',
    CASE WHEN split_part(v_cur, ':', 1) = NEW.id::text THEN v_cur || ',' || TG_ARGV[0]
         ELSE NEW.id::text || ':' || TG_ARGV[0] END, true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_quote_field_listed() FROM PUBLIC, anon, authenticated;

-- Round 2's three triggers, replaced by the ones below.
DROP TRIGGER IF EXISTS bw_quote_0_listed_name ON public.quotes;
DROP TRIGGER IF EXISTS bw_quote_0_listed_email ON public.quotes;
DROP TRIGGER IF EXISTS bw_quote_0_listed_phone ON public.quotes;
DO $listed$
DECLARE
  c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['client_name', 'client_email', 'client_phone', 'client_company', 'billing_address',
                           'vat_number', 'fiscal_code', 'client_notes', 'base_fee', 'custom_items', 'status'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.quotes', 'bw_quote_0_listed_' || c);
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'quotes' AND column_name = c) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OF %I ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.bw_trg_quote_field_listed(%L)',
                     'bw_quote_0_listed_' || c, c, c);
    END IF;
  END LOOP;
END
$listed$;

-- The quote first, then its link: every function that writes a link locks
-- the quote row before it, as a save of the quote does (the save locks the
-- quote, its trigger then the link), so the two never wait on each other.
-- Then, if needed, the gig.
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

-- An error the admin reads in the app, in their language (older builds
-- show the server's text as it is).
CREATE OR REPLACE FUNCTION public.bw_quote_stale_message()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE lower(left(coalesce((SELECT p.preferred_language FROM public.profiles p WHERE p.id = auth.uid()), 'en'), 2))
    WHEN 'it' THEN 'Qualcun altro ha cambiato il cliente o i prezzi di questo preventivo mentre era aperto. Chiudilo e riaprilo: le tue modifiche non sono state salvate.'
    WHEN 'es' THEN 'Otra persona cambió el cliente o los precios de este presupuesto mientras estaba abierto. Ciérralo y vuelve a abrirlo: tus cambios no se guardaron.'
    WHEN 'fr' THEN 'Quelqu’un a modifié le client ou les prix de ce devis pendant qu’il était ouvert. Fermez-le et rouvrez-le : vos modifications n’ont pas été enregistrées.'
    WHEN 'de' THEN 'Jemand hat den Kunden oder die Preise dieses Angebots geändert, während es geöffnet war. Schließe es und öffne es erneut: Deine Änderungen wurden nicht gespeichert.'
    WHEN 'pt' THEN 'Outra pessoa mudou o cliente ou os preços deste orçamento enquanto estava aberto. Feche-o e abra-o de novo: as suas alterações não foram guardadas.'
    ELSE 'Someone else changed this quote’s client or prices while it was open. Close it and open it again: your changes were not saved.'
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_stale_message() FROM PUBLIC, anon, authenticated;

-- Round 4: an accepted quote keeps its client (the deal, the signature, the
-- payments are theirs). Hint BW_QUOTE_ACCEPTED: newer builds show their own text.
CREATE OR REPLACE FUNCTION public.bw_quote_accepted_message()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE lower(left(coalesce((SELECT p.preferred_language FROM public.profiles p WHERE p.id = auth.uid()), 'en'), 2))
    WHEN 'it' THEN 'Questo preventivo è stato accettato: per mandarlo a qualcun altro, duplicalo.'
    WHEN 'es' THEN 'Este presupuesto ya fue aceptado: para enviarlo a otra persona, duplícalo.'
    WHEN 'fr' THEN 'Ce devis a été accepté : pour l’envoyer à quelqu’un d’autre, duplique-le.'
    WHEN 'de' THEN 'Dieses Angebot wurde angenommen: Um es jemand anderem zu schicken, dupliziere es.'
    WHEN 'pt' THEN 'Este orçamento foi aceito: para enviá-lo a outra pessoa, duplique-o.'
    ELSE 'This quote has been accepted: to send it to someone else, duplicate it.'
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_accepted_message() FROM PUBLIC, anon, authenticated;

-- Round 4: a payment recorded in one currency keeps it. Hint BW_QUOTE_CURRENCY_LOCKED.
CREATE OR REPLACE FUNCTION public.bw_quote_currency_message(p_currency text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE lower(left(coalesce((SELECT p.preferred_language FROM public.profiles p WHERE p.id = auth.uid()), 'en'), 2))
    WHEN 'it' THEN 'Su questo preventivo ci sono pagamenti registrati in ' || p_currency || ': la valuta non si può cambiare.'
    WHEN 'es' THEN 'Este presupuesto tiene pagos registrados en ' || p_currency || ': no se puede cambiar su moneda.'
    WHEN 'fr' THEN 'Ce devis a des paiements enregistrés en ' || p_currency || ' : sa devise ne peut pas être changée.'
    WHEN 'de' THEN 'Für dieses Angebot sind Zahlungen in ' || p_currency || ' erfasst: Die Währung lässt sich nicht ändern.'
    WHEN 'pt' THEN 'Este orçamento tem pagamentos registrados em ' || p_currency || ': a moeda não pode ser alterada.'
    ELSE 'This quote has payments recorded in ' || p_currency || ', so its currency can’t be changed.'
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_currency_message(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_trg_quote_recipient_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flags text := coalesce(current_setting('bw.quote_listed', true), '');
  v_listed text[];
  v_full boolean;
  c text;
  -- What an older build's screen holds next to what the quote holds now.
  v_guarded text[] := ARRAY['client_name', 'client_email', 'client_phone', 'client_company',
    'base_fee', 'travel_fee', 'accommodation_fee', 'meals_fee', 'sound_fee', 'lights_fee', 'backline_fee',
    'custom_items', 'discount_type', 'discount_value', 'vat_rate', 'vat_exempt', 'reverse_charge', 'currency',
    'subtotal', 'discount_amount', 'net_amount', 'vat_amount', 'total',
    'deposit_required', 'deposit_percentage', 'deposit_amount'];
  v_guard jsonb;
  v_new jsonb;
  v_cur jsonb;
  v_old_name text;
  v_new_name text;
  v_old_email text;
  v_new_email text;
  v_old_phone text;
  v_new_phone text;
  v_renamed boolean;
  v_no_name boolean;
  v_new_recipient boolean;
  v_accepted boolean;
  v_link public.quote_links;
  v_new_link uuid;
  v_base timestamptz;
  v_changed_at timestamptz;
BEGIN
  PERFORM set_config('bw.quote_listed', '', true);
  -- Round 4: a newer build's edit says when its screen read the quote; never stored.
  v_base := NEW.edit_base_at;
  NEW.edit_base_at := NULL;
  v_listed := CASE WHEN split_part(v_flags, ':', 1) = NEW.id::text
                   THEN string_to_array(split_part(v_flags, ':', 2), ',') ELSE ARRAY[]::text[] END;
  -- A full save is an older build's: newer builds (they send edit_base_at)
  -- write only the fields that changed, and what they leave out stays.
  v_full := v_base IS NULL AND v_listed @> ARRAY['client_name', 'base_fee', 'custom_items'];

  -- Round 4: an edit made on a screen that read the quote before it went
  -- to a new client: refused, whatever the save sends (newer builds send no
  -- status; the guard below needs one). Codex 11-22: not only an edit of
  -- the contact. Notes typed for the previous client would be saved and
  -- then published on the new client's page. Only a save that says when
  -- its screen read the quote (edit_base_at): older builds send none and
  -- are never refused here.
  IF v_base IS NOT NULL THEN
    SELECT l.recipient_changed_at INTO v_changed_at FROM public.quote_links l WHERE l.quote_id = NEW.id;
    IF v_changed_at > v_base THEN
      RAISE EXCEPTION '%', public.bw_quote_stale_message() USING ERRCODE = '40001';
    END IF;
  END IF;

  -- An older build's full save leaves a cleared field out: the form has it
  -- empty, so it is cleared here too, as newer builds send it (null), and
  -- the old client's address, company or notes never stay on the new
  -- client's quote. Only on a full save: an update that does not write the
  -- client name and the prices clears nothing.
  IF v_full THEN
    -- Round 5: not the billing address (older builds have no field for it,
    -- so a full save never carries it: it is not a cleared field).
    FOREACH c IN ARRAY ARRAY['client_email', 'client_phone', 'client_company',
                             'vat_number', 'fiscal_code', 'client_notes'] LOOP
      IF NOT (c = ANY (v_listed)) AND to_jsonb(NEW) ? c AND to_jsonb(NEW) ->> c IS NOT NULL THEN
        NEW := jsonb_populate_record(NEW, jsonb_build_object(c, NULL));
      END IF;
    END LOOP;
  END IF;

  -- Round 5: an older build's full save echoes the status its screen was
  -- opened with: an acceptance that came in meanwhile stays.
  IF v_full AND lower(coalesce(OLD.status, '')) = 'accepted'
     AND lower(coalesce(NEW.status, '')) IS DISTINCT FROM 'accepted' THEN
    NEW.status := OLD.status;
    NEW.responded_at := OLD.responded_at;
    NEW.response_type := OLD.response_type;
  END IF;

  -- An older build's screen opened before the quote went to a new client
  -- writes back the old client's viewed / negotiating / declined (older
  -- builds send the status they were opened with; newer ones never do).
  -- What it typed is kept and its status is not: the quote keeps the one
  -- it has now. Refused (40001, in the admin's language) only when the save
  -- would undo what changed since that screen read the quote: the client,
  -- the prices, the amounts.
  IF v_full AND 'status' = ANY (v_listed)
     AND lower(coalesce(NEW.status, '')) IN ('viewed', 'negotiating', 'declined')
     AND lower(coalesce(NEW.status, '')) IS DISTINCT FROM lower(coalesce(OLD.status, ''))
     AND NEW.response_type IS NOT DISTINCT FROM OLD.response_type THEN
    SELECT l.reassign_guard INTO v_guard FROM public.quote_links l WHERE l.quote_id = NEW.id;
    IF v_guard IS NOT NULL AND lower(coalesce(NEW.status, '')) = v_guard ->> 'status' THEN
      v_new := to_jsonb(NEW);
      v_cur := to_jsonb(OLD);
      FOREACH c IN ARRAY v_guarded LOOP
        CONTINUE WHEN NOT (v_cur ? c);
        IF (v_new -> c) IS DISTINCT FROM (v_cur -> c)
           AND ((v_new -> c) IS NOT DISTINCT FROM (v_guard -> 'before' -> c)
                OR (v_cur -> c) IS DISTINCT FROM (v_guard -> 'after' -> c)) THEN
          RAISE EXCEPTION '%', public.bw_quote_stale_message() USING ERRCODE = '40001';
        END IF;
      END LOOP;
      NEW.status := OLD.status;
    END IF;
  END IF;

  IF OLD.client_name IS NOT DISTINCT FROM NEW.client_name AND OLD.client_email IS NOT DISTINCT FROM NEW.client_email
     AND OLD.client_phone IS NOT DISTINCT FROM NEW.client_phone THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = NEW.id FOR UPDATE;
  -- Round 5: accepted on the link, or by phone (no link at all).
  v_accepted := coalesce(v_link.status, '') = 'accepted' OR lower(coalesce(OLD.status, '')) = 'accepted';

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
    -- c. no contact on file (sent with Copy link): a contact given to a
    --    quote with no name (whose link it is, unknown). Round 5: a name
    --    edit alone is a fix ("Emma Cartr" -> "Emma Carter", "Client" ->
    --    the real name), never a new client: the link and the status stay.
    --    Never on an accepted quote.
    OR (v_old_email = '' AND v_old_phone = '' AND NOT v_accepted
        AND v_no_name AND (v_new_email <> '' OR v_new_phone <> ''));
  -- Round 5: a typo in the email of an accepted quote, fixed before the
  -- balance was asked: the same client (same name, same phone), the link
  -- and the acceptance stay, the emails go to the address as fixed.
  IF v_new_recipient AND v_accepted AND v_link.id IS NOT NULL AND NOT v_renamed
     AND v_new_email <> '' AND v_link.balance_sent_at IS NULL
     AND (v_old_phone = '' AND v_new_phone = '' OR public.bw_same_phone(OLD.client_phone, NEW.client_phone)) THEN
    v_new_recipient := false;
  END IF;
  -- Round 5: no link (accepted by phone, never shared): nothing to rotate,
  -- but an accepted quote still keeps its client.
  IF v_link.id IS NULL THEN
    IF v_new_recipient AND v_accepted THEN
      RAISE EXCEPTION '%', public.bw_quote_accepted_message() USING ERRCODE = 'P0001', HINT = 'BW_QUOTE_ACCEPTED';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT v_new_recipient THEN
    -- Round 4: the same client, written another way (a name fixed, the
    -- phone with its country code, the email's case): the link's recipient
    -- follows, so its emails reach them as they are written now.
    IF v_link.recipient_email IS NOT NULL OR v_link.recipient_name IS NOT NULL THEN
      UPDATE public.quote_links l
         SET recipient_email = nullif(lower(btrim(coalesce(NEW.client_email, ''))), ''),
             recipient_name = nullif(btrim(coalesce(NEW.client_name, '')), '')
       WHERE l.id = v_link.id;
    END IF;
    RETURN NEW;
  END IF;
  -- Round 4: an accepted quote keeps its client: the acceptance, the
  -- signature, the deposit and the balance are theirs. To send it to
  -- someone else, the band duplicates it.
  IF v_accepted THEN
    RAISE EXCEPTION '%', public.bw_quote_accepted_message() USING ERRCODE = 'P0001', HINT = 'BW_QUOTE_ACCEPTED';
  END IF;

  -- A new recipient, whatever the link's state (draft, sent, viewed...):
  -- the old link is revoked (its token kept in quote_link_retired opens
  -- nothing) and a new, empty one takes its place, all in this
  -- transaction. Empty: no summary, PDF, balance, payment note, signature
  -- or conversation of the old client (a new row: every column, also the
  -- ones added later, starts from its default). Unpublished: the page
  -- shows nothing until the new client's version is published, and the app
  -- shares nothing until then. Kept: the version count (the old client's
  -- versions stay in quote_link_versions), the language, the plan's send.
  INSERT INTO public.quote_link_retired (link_id, quote_id, band_id, token, status, sent_at)
  VALUES (v_link.id, v_link.quote_id, v_link.band_id, v_link.token, v_link.status, v_link.sent_at)
  ON CONFLICT (link_id) DO NOTHING;
  DELETE FROM public.quote_links l WHERE l.id = v_link.id;
  INSERT INTO public.quote_links (quote_id, band_id, lang, version, status, recipient_changed_at, reassign_guard)
  VALUES (NEW.id, v_link.band_id, v_link.lang, v_link.version, 'draft', now(),
          -- Round 5: only the guarded columns (never the old client's
          -- notes, address or anything else of theirs).
          jsonb_build_object('status', lower(coalesce(OLD.status, '')),
                             -- Round 6: who the link was last published for
                             -- (an older build's summary names nobody).
                             'published', CASE WHEN v_link.recipient_email IS NOT NULL OR v_link.recipient_name IS NOT NULL
                                               THEN jsonb_build_object('name', v_link.recipient_name, 'email', v_link.recipient_email)
                                               WHEN jsonb_typeof(v_link.reassign_guard -> 'published') = 'object'
                                               THEN v_link.reassign_guard -> 'published' END,
                             'before', (SELECT jsonb_object_agg(k, to_jsonb(OLD) -> k) FROM unnest(v_guarded) k WHERE to_jsonb(OLD) ? k),
                             'after', (SELECT jsonb_object_agg(k, to_jsonb(NEW) -> k) FROM unnest(v_guarded) k WHERE to_jsonb(NEW) ? k)))
  RETURNING id INTO v_new_link;
  INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version, actor_id, link_id)
  VALUES (NEW.id, v_link.band_id, 'link_rotated', 'recipient_changed', v_link.version, auth.uid(), v_new_link);

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

-- Every update (no column list): it also clears what the triggers above noted.
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
-- Not a link made for a new recipient (it has no signer).
UPDATE public.quote_links l
   SET accepted_client_name = q.client_name
  FROM public.quotes q
 WHERE q.id = l.quote_id AND l.status = 'accepted' AND l.accepted_client_name IS NULL
   AND l.recipient_changed_at IS NULL;

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
--   Older builds don't send it: they publish as before on a quote whose
--   link was never given to a new recipient, and are refused (the same
--   error) on a link made for one, since nothing tells which client their
--   screen was built for. The function is dropped and created again with
--   the new parameter (a default, so the four named arguments of older
--   builds still find it); same grants;
-- - the quote is locked first (then the link), as everywhere else.
-- Round 4: p_version (new, optional): the version the admin's screen
-- shows. Another version published since (another admin, another device):
-- nothing is written (P0001 BW_VERSION_CHANGED), the screen reloads. The
-- link also keeps who it was published for (recipient_email / _name, the
-- quote's contact under its lock): the email goes there.
-- Round 5: what an older build (no token) is told when its screen is for
-- the previous client: older builds show the server's text as it is.
CREATE OR REPLACE FUNCTION public.bw_quote_update_app_message()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE lower(left(coalesce((SELECT p.preferred_language FROM public.profiles p WHERE p.id = auth.uid()), 'en'), 2))
    WHEN 'it' THEN 'Questo preventivo ora è per un altro cliente. Aggiorna BandWith per inviarlo: questa versione dell’app non può farlo.'
    WHEN 'es' THEN 'Este presupuesto ahora es para otro cliente. Actualiza BandWith para enviarlo: esta versión de la app no puede hacerlo.'
    WHEN 'fr' THEN 'Ce devis est maintenant pour un autre client. Mets à jour BandWith pour l’envoyer : cette version de l’app ne peut pas le faire.'
    WHEN 'de' THEN 'Dieses Angebot ist jetzt für einen anderen Kunden. Aktualisiere BandWith, um es zu senden: Diese App-Version kann das nicht.'
    WHEN 'pt' THEN 'Este orçamento agora é para outro cliente. Atualize o BandWith para enviá-lo: esta versão do app não consegue.'
    ELSE 'This quote is now for another client. Update BandWith to send it: this version of the app can’t.'
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_update_app_message() FROM PUBLIC, anon, authenticated;

-- Round 5: is a summary sent without a token (older builds) for the
-- client the quote has now? Older builds' summaries carry no name, email
-- or phone; what they carry of the client is the notes for them and the
-- PDF, whose file name ends with the client name ("Quote_<band>_<client>.pdf",
-- non-ASCII as "_"). Both must be the current client's. A summary with a
-- "client" object (none yet) is checked on its name, email and phone.
CREATE OR REPLACE FUNCTION public.bw_quote_snapshot_for_client(p_quote_id uuid, p_snapshot jsonb, p_pdf_url text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q public.quotes;
  v_safe text;
BEGIN
  SELECT * INTO v_q FROM public.quotes q WHERE q.id = p_quote_id;
  IF v_q.id IS NULL THEN RETURN false; END IF;
  IF (p_snapshot ->> 'notes') IS DISTINCT FROM nullif(left(btrim(coalesce(v_q.client_notes, '')), 1500), '') THEN
    RETURN false;
  END IF;
  IF nullif(btrim(coalesce(p_pdf_url, '')), '') IS NOT NULL THEN
    v_safe := regexp_replace(coalesce(nullif(v_q.client_name, ''), 'Client'), '[^a-zA-Z0-9_-]', '_', 'g');
    IF right(p_pdf_url, length(v_safe) + 5) IS DISTINCT FROM '_' || v_safe || '.pdf' THEN RETURN false; END IF;
  END IF;
  IF jsonb_typeof(p_snapshot -> 'client') = 'object' THEN
    IF regexp_replace(lower(regexp_replace(btrim(coalesce(p_snapshot -> 'client' ->> 'name', '')), '\s+', ' ', 'g')), '^client$', '')
         IS DISTINCT FROM regexp_replace(lower(regexp_replace(btrim(coalesce(v_q.client_name, '')), '\s+', ' ', 'g')), '^client$', '')
       OR lower(btrim(coalesce(p_snapshot -> 'client' ->> 'email', ''))) IS DISTINCT FROM lower(btrim(coalesce(v_q.client_email, '')))
       OR NOT (coalesce(p_snapshot -> 'client' ->> 'phone', '') = coalesce(v_q.client_phone, '')
               OR public.bw_same_phone(p_snapshot -> 'client' ->> 'phone', v_q.client_phone)) THEN
      RETURN false;
    END IF;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_snapshot_for_client(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.bw_quote_link_publish(uuid, jsonb, text, text);
DROP FUNCTION IF EXISTS public.bw_quote_link_publish(uuid, jsonb, text, text, text);
CREATE OR REPLACE FUNCTION public.bw_quote_link_publish(
  p_quote_id uuid,
  p_snapshot jsonb,
  p_lang text DEFAULT NULL,
  p_pdf_url text DEFAULT NULL,
  p_token text DEFAULT NULL,
  p_version int DEFAULT NULL
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
  v_email text;
  v_name text;
  v_made uuid;
  v_last jsonb;
BEGIN
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR octet_length(p_snapshot::text) > 48000 THEN
    RAISE EXCEPTION 'Invalid quote summary' USING ERRCODE = '22023';
  END IF;
  IF v_lang NOT IN ('en', 'it', 'es', 'fr', 'de', 'pt') THEN v_lang := NULL; END IF;
  -- Only a PDF of this band in the public "quotes" bucket.
  IF v_pdf IS NOT NULL AND v_pdf !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/quotes/quotes/' || v_band::text || '/[A-Za-z0-9._%-]+$') THEN
    RAISE EXCEPTION 'Invalid PDF link' USING ERRCODE = '22023';
  END IF;

  -- 183: the quote first, then the link (the order of a save of the quote).
  SELECT nullif(lower(btrim(q.client_email)), ''), nullif(btrim(q.client_name), '') INTO v_email, v_name
    FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE;
  INSERT INTO public.quote_links (quote_id, band_id, lang)
  VALUES (p_quote_id, v_band, coalesce(v_lang, 'en'))
  ON CONFLICT (quote_id) DO NOTHING
  RETURNING id INTO v_made;
  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;
  -- Round 5: a stale screen is refused with 40001 (nothing written).
  -- p_version 0: the screen saw no link, and one was made since.
  IF p_version = 0 AND v_made IS NULL THEN
    RAISE EXCEPTION 'BW_LINK_CHANGED: the quote link was made meanwhile, open the quote again' USING ERRCODE = '40001';
  END IF;
  -- 183: published for a link that has been replaced since.
  IF p_token IS NOT NULL AND v_link.token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'BW_LINK_CHANGED: the quote link was replaced, open the quote again' USING ERRCODE = '40001';
  END IF;
  -- Round 6: who the summary is for. Newer builds name the client
  -- ("client": name, email): the quote must still be for them (checked
  -- here, never stored). A summary that names nobody and has no PDF
  -- (383f15b; with a PDF its file name says whose it is, below): refused
  -- when the quote's client is not the one the link was last published for.
  IF jsonb_typeof(p_snapshot -> 'client') = 'object' THEN
    -- Round 6 (Claude r9): "Client", the name a quote saved without one
    -- gets, is no name, in any case and on either side (as the app's
    -- sameQuoteContact since round 10).
    IF regexp_replace(lower(regexp_replace(btrim(coalesce(p_snapshot -> 'client' ->> 'name', '')), '\s+', ' ', 'g')), '^client$', '')
         IS DISTINCT FROM regexp_replace(lower(regexp_replace(coalesce(v_name, ''), '\s+', ' ', 'g')), '^client$', '')
       OR lower(btrim(coalesce(p_snapshot -> 'client' ->> 'email', ''))) IS DISTINCT FROM coalesce(v_email, '') THEN
      RAISE EXCEPTION 'BW_LINK_CHANGED: the quote now goes to another client, open the quote again' USING ERRCODE = '40001';
    END IF;
    p_snapshot := p_snapshot - 'client';
  ELSIF v_pdf IS NULL AND p_token IS NULL AND p_version IS NULL THEN
    v_last := CASE WHEN v_link.recipient_email IS NOT NULL OR v_link.recipient_name IS NOT NULL
                   THEN jsonb_build_object('name', v_link.recipient_name, 'email', v_link.recipient_email)
                   ELSE v_link.reassign_guard -> 'published' END;
    IF jsonb_typeof(v_last) = 'object'
       AND ((v_last ->> 'email') IS DISTINCT FROM v_email
            OR lower(v_last ->> 'name') IS DISTINCT FROM lower(v_name)) THEN
      RAISE EXCEPTION '%', public.bw_quote_update_app_message() USING ERRCODE = '40001', HINT = 'BW_UPDATE_APP';
    END IF;
  END IF;
  -- Round 5: an older build (no token, no version) on a link made for a new
  -- recipient: published when its summary is for the client the quote has
  -- now; one for the previous client is refused, and the text (older builds
  -- show it as it is) asks to update the app.
  IF p_token IS NULL AND p_version IS NULL AND v_link.recipient_changed_at IS NOT NULL
     AND NOT public.bw_quote_snapshot_for_client(p_quote_id, p_snapshot, v_pdf) THEN
    RAISE EXCEPTION '%', public.bw_quote_update_app_message() USING ERRCODE = '40001', HINT = 'BW_UPDATE_APP';
  END IF;
  -- Round 4: the screen shows another version than the link has now.
  IF p_version IS NOT NULL AND p_version <> 0 AND v_link.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'BW_VERSION_CHANGED: another version was published meanwhile, open the quote again' USING ERRCODE = '40001';
  END IF;

  -- 183: a link made for a new recipient, nothing published on it yet.
  v_fresh := v_link.recipient_changed_at IS NOT NULL AND v_link.version_at IS NULL;
  -- Round 4: the same quote in another language (same contentKey) is not a
  -- new version: the client's page keeps its version and its "I accept".
  -- Round 5: coalesce, so a first publish (no summary yet: NULL) is a change.
  v_changed := (v_link.snapshot IS DISTINCT FROM p_snapshot
                AND NOT coalesce(v_link.snapshot ? 'contentKey' AND p_snapshot ? 'contentKey'
                                 AND v_link.snapshot ->> 'contentKey' = p_snapshot ->> 'contentKey', false))
               OR v_fresh;
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
    -- After the first send, an edit is news for the client and the timeline
    -- (not the new recipient's first version).
    IF v_link.status <> 'draft' AND v_link.version > 1 AND NOT v_fresh THEN
      INSERT INTO public.quote_activity (quote_id, band_id, kind, version, actor_id)
      VALUES (p_quote_id, v_band, 'updated', v_link.version, auth.uid());
    END IF;
  ELSIF v_pdf IS NOT NULL THEN
    UPDATE public.quote_link_versions qv SET pdf_url = v_pdf
     WHERE qv.quote_id = p_quote_id AND qv.version = v_link.version;
  END IF;

  UPDATE public.quote_links l
     SET snapshot = p_snapshot,
         recipient_email = v_email,
         recipient_name = v_name,
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
REVOKE ALL ON FUNCTION public.bw_quote_link_publish(uuid, jsonb, text, text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_publish(uuid, jsonb, text, text, text, int) TO authenticated;

-- Round 4: links published before this keep their client as they were then
-- (the best there is: no link has had a new recipient before 183).
UPDATE public.quote_links l
   SET recipient_email = nullif(lower(btrim(q.client_email)), ''), recipient_name = nullif(btrim(q.client_name), '')
  FROM public.quotes q
 WHERE q.id = l.quote_id AND l.snapshot IS NOT NULL AND l.recipient_email IS NULL AND l.recipient_name IS NULL
   AND l.recipient_changed_at IS NULL;

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
  -- Round 4: in cents, as the gig and the receipt store it.
  v_amount numeric := round(p_amount, 2);
  v_quote_status text;
  v_gig uuid;
  v_gig_status text;
  v_was boolean;
  v_confirm jsonb;
  v_version int;
  v_currency text;
BEGIN
  IF v_method NOT IN ('transfer', 'cash', 'other') THEN v_method := 'other'; END IF;
  IF v_amount IS NOT NULL AND (v_amount < 0 OR v_amount > 99999999.99) THEN
    RAISE EXCEPTION 'Invalid amount' USING ERRCODE = '22023';
  END IF;
  -- 183: the quote, then the link, then the gig (the order everywhere).
  SELECT lower(coalesce(q.status, '')), upper(nullif(btrim(q.currency), ''))
    INTO v_quote_status, v_currency
    FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE;
  PERFORM 1 FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;
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
  -- 183: the receipt is in the quote's currency (what the client was asked
  -- in); the gig's only when the quote has none (released builds make the
  -- tentative gig without one, and events.currency defaults to EUR).
  SELECT lower(coalesce(e.status, '')), coalesce(e.deposit_paid, false),
         coalesce(v_currency, upper(nullif(btrim(e.currency), '')))
    INTO v_gig_status, v_was, v_currency
    FROM public.events e WHERE e.id = v_gig FOR UPDATE;
  IF v_gig_status = 'cancelled' THEN
    RAISE EXCEPTION 'The gig is cancelled' USING ERRCODE = '22023';
  END IF;

  UPDATE public.events e
     SET deposit_paid = v_received,
         deposit_amount = CASE WHEN v_received AND v_amount > 0 THEN v_amount ELSE e.deposit_amount END,
         payment_status = CASE
           WHEN lower(coalesce(e.payment_status, '')) = 'paid' THEN e.payment_status
           WHEN v_received THEN 'partial'
           ELSE 'pending' END
   WHERE e.id = v_gig AND e.band_id = v_band;

  -- 183: what the client's receipt says: the amount typed, in the quote's
  -- currency; nothing typed = no amount (not the amount asked).
  UPDATE public.quote_links l
     SET deposit_received_amount = CASE WHEN v_received AND v_amount > 0 THEN v_amount END,
         deposit_received_currency = CASE WHEN v_received AND v_amount > 0 AND v_currency ~ '^[A-Z]{3}$' THEN v_currency END
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

-- Round 4: deposits recorded before the currency was kept with them: the
-- quote's currency now (the one they were asked in, as far as is known).
UPDATE public.quote_links l
   SET deposit_received_currency = upper(btrim(q.currency))
  FROM public.quotes q
 WHERE q.id = l.quote_id AND l.deposit_received_amount > 0 AND l.deposit_received_currency IS NULL
   AND upper(btrim(coalesce(q.currency, ''))) ~ '^[A-Z]{3}$';

-- Round 4: a quote with a payment recorded keeps that payment's currency
-- (the deposit received, or a balance marked as paid): another currency
-- would change what the receipts and the totals mean.
CREATE OR REPLACE FUNCTION public.bw_trg_quote_currency_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid text;
  v_gig uuid;
BEGIN
  IF upper(btrim(coalesce(NEW.currency, ''))) IS NOT DISTINCT FROM upper(btrim(coalesce(OLD.currency, ''))) THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(CASE WHEN l.deposit_received_amount > 0 THEN l.deposit_received_currency END,
                  CASE WHEN l.balance_paid_at IS NOT NULL THEN upper(nullif(btrim(l.balance ->> 'currency'), '')) END)
    INTO v_paid
    FROM public.quote_links l WHERE l.quote_id = NEW.id;
  -- Round 6: a deposit recorded on the gig (accepted by phone, no link, or
  -- no amount typed): it was taken in the currency the quote has now.
  IF v_paid IS NULL THEN
    v_gig := public.bw_quote_gig_id(NEW.id);
    IF v_gig IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.events e
          WHERE e.id = v_gig
            AND (coalesce(e.deposit_paid, false) OR lower(coalesce(e.payment_status, '')) = 'paid')) THEN
      v_paid := upper(nullif(btrim(OLD.currency), ''));
    END IF;
  END IF;
  IF v_paid ~ '^[A-Z]{3}$' AND upper(btrim(coalesce(NEW.currency, ''))) <> v_paid THEN
    RAISE EXCEPTION '%', public.bw_quote_currency_message(v_paid)
      USING ERRCODE = 'P0001', HINT = 'BW_QUOTE_CURRENCY_LOCKED', DETAIL = v_paid;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_quote_currency_locked() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_quote_currency_locked ON public.quotes;
CREATE TRIGGER bw_quote_currency_locked
  BEFORE UPDATE OF currency ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.bw_trg_quote_currency_locked();

-- Round 5: the totals are the server's. Two admins editing different fees
-- at the same time each write only the fee they changed (newer builds send
-- no totals); the subtotal moves by what the stored parts moved in this
-- UPDATE (under the row lock), so both edits count. Discount, VAT, total
-- and deposit follow, with the app's math (src/lib/services/quoteMath.ts:
-- cents half away from zero per line, then subtotal, discount, net, VAT,
-- total). By difference, not from scratch: a quote whose parts never added
-- up to its subtotal (older wizards) keeps what it showed its client.
CREATE OR REPLACE FUNCTION public.bw_quote_num(p text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN btrim(coalesce(p, '')) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(p)::numeric ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_num(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_quote_money_parts(p jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    -- the lineup (with the older wizards' moments) is one line
    round(public.bw_quote_num(p ->> 'base_fee')
          + coalesce((SELECT sum(public.bw_quote_num(m ->> 'price'))
                        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p -> 'presentation' -> 'selectedMoments') = 'array'
                                                       THEN p -> 'presentation' -> 'selectedMoments' ELSE '[]'::jsonb END) m), 0), 2)
    + round(public.bw_quote_num(p ->> 'travel_fee'), 2)
    + round(public.bw_quote_num(p ->> 'accommodation_fee'), 2)
    + round(public.bw_quote_num(p ->> 'meals_fee'), 2)
    + round(public.bw_quote_num(p ->> 'sound_fee'), 2)
    + round(public.bw_quote_num(p ->> 'lights_fee'), 2)
    + round(public.bw_quote_num(p ->> 'backline_fee'), 2)
    + coalesce((SELECT sum(round(public.bw_quote_num(ci ->> 'amount')
                                 * CASE WHEN ci ? 'quantity' AND ci ->> 'quantity' IS NOT NULL
                                        THEN public.bw_quote_num(ci ->> 'quantity') ELSE 1 END, 2))
                  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p -> 'custom_items') = 'array'
                                                 THEN p -> 'custom_items' ELSE '[]'::jsonb END) ci), 0);
$$;
REVOKE ALL ON FUNCTION public.bw_quote_money_parts(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_trg_quote_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := to_jsonb(OLD);
  v_parts_new numeric := public.bw_quote_money_parts(v_new);
  v_parts_old numeric := public.bw_quote_money_parts(v_old);
  v_sub numeric;
  v_disc numeric;
  v_net numeric;
  v_rate numeric;
  v_vat numeric;
  v_total numeric;
  v_pct numeric;
  v_out jsonb;
BEGIN
  IF v_parts_new = v_parts_old
     AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['discount_type', 'discount_value', 'vat_rate', 'vat_exempt',
                                                'reverse_charge', 'deposit_required', 'deposit_percentage']) k
                      WHERE (v_new -> k) IS DISTINCT FROM (v_old -> k)) THEN
    RETURN NEW;
  END IF;
  v_sub := greatest(0, round(coalesce(public.bw_quote_num(v_old ->> 'subtotal'), v_parts_old)
                             + v_parts_new - v_parts_old, 2));
  v_disc := CASE lower(coalesce(v_new ->> 'discount_type', ''))
    WHEN 'percentage' THEN round(v_sub * least(100, greatest(0, public.bw_quote_num(v_new ->> 'discount_value'))) / 100, 2)
    WHEN 'fixed' THEN round(least(v_sub, greatest(0, public.bw_quote_num(v_new ->> 'discount_value'))), 2)
    WHEN 'none' THEN 0
    -- older rows: no type, a fixed amount
    ELSE round(least(v_sub, greatest(0, public.bw_quote_num(v_new ->> 'discount_amount'))), 2) END;
  v_disc := least(greatest(v_disc, 0), v_sub);
  v_net := round(v_sub - v_disc, 2);
  v_rate := CASE WHEN coalesce((v_new ->> 'vat_exempt')::boolean, false) OR coalesce((v_new ->> 'reverse_charge')::boolean, false)
                 THEN 0 ELSE greatest(0, public.bw_quote_num(v_new ->> 'vat_rate')) END;
  v_vat := round(v_net * v_rate / 100, 2);
  v_total := round(v_net + v_vat, 2);
  v_out := jsonb_build_object('subtotal', v_sub, 'discount_amount', v_disc, 'net_amount', v_net,
                              'vat_amount', v_vat, 'total', v_total);
  IF (v_new ->> 'deposit_required') = 'false' THEN
    v_out := v_out || jsonb_build_object('deposit_amount', 0);
  ELSIF v_new ? 'deposit_percentage' AND v_new ->> 'deposit_percentage' IS NOT NULL THEN
    v_pct := least(100, greatest(0, public.bw_quote_num(v_new ->> 'deposit_percentage')));
    v_out := v_out || jsonb_build_object('deposit_amount', round(v_total * v_pct / 100, 2));
  END IF;
  -- Only the columns the table has.
  SELECT jsonb_object_agg(k, v) INTO v_out FROM jsonb_each(v_out) AS e(k, v) WHERE v_new ? k;
  IF v_out IS NOT NULL THEN NEW := jsonb_populate_record(NEW, v_out); END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_quote_totals() FROM PUBLIC, anon, authenticated;
-- After the recipient trigger (name order), before updated_at.
DROP TRIGGER IF EXISTS bw_quote_totals ON public.quotes;
CREATE TRIGGER bw_quote_totals
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.bw_trg_quote_totals();

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
  v_currency text;
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
    'balance', CASE WHEN v_show_balance THEN v_link.balance END,
    'balance_at', CASE WHEN v_show_balance THEN v_link.balance_at END,
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

-- Mark sent (161's body): the quote first; and the send is recorded for
-- the link and the version that went out. New optional p_token / p_version
-- (dropped and created again, a default each, so the three named arguments
-- of older builds still find it; same grants):
-- - nothing published on the link (a new recipient's, before their
--   version): refused, nothing went out that the page can show;
-- - p_token not the link's token (it was replaced since: the share was for
--   the old client) or p_version not its version (another admin published
--   a new one meanwhile): refused (BW_LINK_CHANGED / BW_VERSION_CHANGED),
--   nothing recorded;
-- - older builds (no token) on a link made for a new recipient: refused,
--   as their publish is.
DROP FUNCTION IF EXISTS public.bw_quote_link_mark_sent(uuid, text, text);
-- Round 5: may an older build (no token) send on this link? Yes unless it
-- was made for a new recipient and not yet published for the client the
-- quote has now (version_at set, the recipient it was published for =
-- the quote's contact now).
CREATE OR REPLACE FUNCTION public.bw_quote_link_current(p_link public.quote_links)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_link.recipient_changed_at IS NULL
      OR (p_link.version_at IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.quotes q
             WHERE q.id = p_link.quote_id
               AND p_link.recipient_email IS NOT DISTINCT FROM nullif(lower(btrim(coalesce(q.client_email, ''))), '')
               AND p_link.recipient_name IS NOT DISTINCT FROM nullif(btrim(coalesce(q.client_name, '')), '')));
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_current(public.quote_links) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_quote_link_mark_sent(
  p_quote_id uuid,
  p_kind text DEFAULT 'sent'::text,
  p_channel text DEFAULT NULL::text,
  p_token text DEFAULT NULL,
  p_version int DEFAULT NULL
)
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
  IF v_link.id IS NULL OR v_link.snapshot IS NULL THEN
    RAISE EXCEPTION 'Publish the quote first' USING ERRCODE = 'P0002';
  END IF;
  IF p_token IS NOT NULL AND v_link.token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'BW_LINK_CHANGED: the quote link was replaced, open the quote again' USING ERRCODE = 'P0001';
  END IF;
  -- Round 5: an older build (no token) on a link made for a new recipient:
  -- recorded once that link is published for the client the quote has now.
  IF p_token IS NULL AND NOT public.bw_quote_link_current(v_link) THEN
    RAISE EXCEPTION '%', public.bw_quote_update_app_message() USING ERRCODE = '40001', HINT = 'BW_UPDATE_APP';
  END IF;
  IF p_version IS NOT NULL AND p_version <> v_link.version THEN
    RAISE EXCEPTION 'BW_VERSION_CHANGED: the quote was updated after this was sent' USING ERRCODE = 'P0001';
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

  INSERT INTO public.quote_activity (quote_id, band_id, kind, channel, version, actor_id, link_id)
  VALUES (p_quote_id, v_band, v_kind, v_channel, v_link.version, auth.uid(), v_link.id);

  IF v_link.status = 'draft' THEN
    UPDATE public.quote_links l SET status = 'sent', sent_at = now(), updated_at = now() WHERE l.id = v_link.id;
    v_link.status := 'sent';
  END IF;
  UPDATE public.quotes q SET status = 'sent', sent_at = coalesce(q.sent_at, now()), updated_at = now()
   WHERE q.id = p_quote_id AND coalesce(q.status, 'draft') = 'draft';
  RETURN v_link.status;
END;
$function$;
REVOKE ALL ON FUNCTION public.bw_quote_link_mark_sent(uuid, text, text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_mark_sent(uuid, text, text, text, int) TO authenticated;

-- Round 6b (main's decision on item 2): "New link" (099) as before, the
-- quote locked first (one lock order: the quote, then the link). A link
-- given to a new client and published for them records who it was renewed
-- for (reassign_guard.renewed): the client and the conversation are the
-- same, so older builds' replies go there again (bw_quote_reply).
CREATE OR REPLACE FUNCTION public.bw_quote_link_rotate(p_quote_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_link public.quote_links;
  v_token text;
BEGIN
  PERFORM 1 FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE;
  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;
  IF v_link.id IS NULL THEN RAISE EXCEPTION 'No link yet' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.quote_links l
     SET token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         revoked_at = NULL, updated_at = now(),
         reassign_guard = CASE WHEN l.recipient_changed_at IS NOT NULL AND public.bw_quote_link_current(v_link)
                               THEN coalesce(l.reassign_guard, '{}'::jsonb)
                                    || jsonb_build_object('renewed', jsonb_build_object('name', l.recipient_name, 'email', l.recipient_email))
                               ELSE l.reassign_guard END
   WHERE l.id = v_link.id
  RETURNING l.token INTO v_token;
  INSERT INTO public.quote_activity (quote_id, band_id, kind, actor_id) VALUES (p_quote_id, v_band, 'link_rotated', auth.uid());
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_rotate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_rotate(uuid) TO authenticated;

-- The band's reply (099's body): on the link of the conversation it was
-- written in. New optional p_token (dropped and created again, same
-- grants): written in a conversation whose link was replaced since (the
-- old client's), it fails (BW_LINK_CHANGED) and nothing is written, so the
-- new client never sees or gets by email a line meant for the old one.
-- Older builds (no token) on a link made for a new recipient: refused too.
DROP FUNCTION IF EXISTS public.bw_quote_reply(uuid, text);
CREATE OR REPLACE FUNCTION public.bw_quote_reply(p_quote_id uuid, p_body text, p_token text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_body text := nullif(left(btrim(coalesce(p_body, '')), 2000), '');
  v_link public.quote_links;
  v_id uuid;
BEGIN
  IF v_body IS NULL THEN RAISE EXCEPTION 'Empty message' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE; -- 183: the quote first
  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;
  IF v_link.id IS NULL THEN RAISE EXCEPTION 'Publish the quote first' USING ERRCODE = 'P0002'; END IF;
  IF p_token IS NOT NULL AND v_link.token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'BW_LINK_CHANGED: this conversation is with a client the quote is no longer for' USING ERRCODE = 'P0001';
  END IF;
  -- Round 5: older builds (no token): as mark sent. Round 6: and never on a
  -- link made for a new recipient: an older screen can hold a draft written
  -- to the previous client, and nothing says which link it was written on.
  -- Round 6b (main): refused only when the link's client changed since an
  -- older screen could have loaded it. A link given to a new client is
  -- written to again once it was renewed ("New link") for that same client
  -- after being published for them (bw_quote_link_rotate records who it was
  -- renewed for); a link never given to another client, as before.
  IF p_token IS NULL AND v_link.recipient_changed_at IS NOT NULL
     AND NOT (public.bw_quote_link_current(v_link)
              AND jsonb_typeof(v_link.reassign_guard -> 'renewed') = 'object'
              AND (v_link.reassign_guard -> 'renewed' ->> 'email') IS NOT DISTINCT FROM v_link.recipient_email
              AND lower(v_link.reassign_guard -> 'renewed' ->> 'name') IS NOT DISTINCT FROM lower(v_link.recipient_name)) THEN
    RAISE EXCEPTION '%', public.bw_quote_update_app_message() USING ERRCODE = '40001', HINT = 'BW_UPDATE_APP';
  END IF;
  INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version, actor_id, link_id)
  VALUES (p_quote_id, v_band, 'band_reply', v_body, v_link.version, auth.uid(), v_link.id)
  RETURNING id INTO v_id;
  UPDATE public.quote_links l SET updated_at = now() WHERE l.id = v_link.id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_reply(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_reply(uuid, text, text) TO authenticated;

-- New parameters on publish, mark sent and reply: PostgREST reads them now.
NOTIFY pgrst, 'reload schema';

COMMIT;
