-- ====================================================================
-- 185: quote money fixes (audit of release 383f15b, money & documents)
--
-- 1. The lineup of a saved quote (#3). Editing a quote wrote only the
--    quotes row: a musician replaced or a fee changed showed on the
--    success screen, then the old quote_musicians rows came back on
--    reload, and a gig made from the quote used the old names and fees.
--    bw_quote_save_musicians replaces the quote's rows in one transaction
--    (admins of the quote's band only) and returns the rows saved.
-- 2. "Mark as paid", then Undo (#7). Marking the balance paid also set
--    the gig's deposit_paid, and Undo kept it: a deposit nobody received
--    was then taken off the next balance. Marking paid now remembers the
--    deposit as it was (quote_links.balance_paid_deposit_was) and Undo
--    puts it back. Same signature: old builds get the fix too. A changed
--    balance keeps "paid" (link and gig) until it is sent; the send
--    reopens both together.
-- 3. Preview does not reach the client (#8). Preview called the publish
--    RPC, and the page showed whatever was published, sent or not.
--    - quote_links.balance_sent: the balance the client was sent. It is
--      set when a send or reminder is recorded (bw_quote_balance_mark_sent,
--      which every build calls after it publishes and sends). Migration
--      187 makes the page read it instead of balance. Existing balances
--      are copied once when that version was sent (its send is on the
--      timeline); a later version only previewed is not.
--    - "The balance changed" goes on the timeline when the changed
--      balance is sent, not when it is published (a preview is not news).
--    - bw_quote_balance_preview (admin): keeps a draft balance for 30
--      minutes and returns a preview key; bw_quote_link_preview (the page,
--      anon, token + key) shows the page with that draft. Only the admin
--      who asked has the key (quote_links is read by admins only); the
--      key is random and changes on every preview. Nothing is recorded.
--
-- 4. Round 3 (Codex review of #293):
--    - bw_quote_balance_mark_sent takes the balance_version that was sent
--      (p_balance_version, optional) and refuses a send recorded for a
--      balance another admin replaced meanwhile (BW_BALANCE_CHANGED).
--    - Undo after "Mark as paid" gives back the deposit as it was only
--      while the deposit is as "Mark as paid" left it: one recorded or
--      changed since (deposit received, its amount) stays.
--    - One lock order: every function here that writes a link or a gig
--      locks the quote first, then the link, then the gig (as a save of the
--      quote does), so two of them at the same moment never deadlock.
--
-- 5. Round 4 (Codex review of #293): bw_quote_save_lineup saves the
--    quote's lineup and the lineup of the tentative gig holding its date in
--    one transaction (a musician replaced on the quote leaves the gig).
--
-- 6. Round 5 (Codex + Claude review of #293): bw_quote_save_lineup takes
--    the lineup the wizard opened with (p_base, optional) and refuses one
--    changed meanwhile (40001, BW_LINEUP_CHANGED), and takes off the gig
--    only who was on the quote's previous lineup (never someone added to
--    the gig directly, the admin, a deputy).
--
-- 7. Round 12 (Claude review of #294's last 178): a save of the lineup
--    locks the quote's events rows FOR UPDATE right after the quote and
--    before anything is written (bw_quote_lock_events, new). It took the
--    events row FOR UPDATE at the end, after 178's trigger on
--    quote_musicians (or on the quote's own update) had taken the row FOR
--    NO KEY UPDATE and then the hold's lock; a member answering the hold
--    (178 bw_answer_date_hold: the events row FOR KEY SHARE, then the
--    hold's lock) met it, and one of the two got 40P01. The rule: a
--    transaction takes its strongest events-row lock before the hold's
--    lock.
-- 8. Round 13 (Claude review of 97e80955): bw_quote_balance_publish locks
--    the gig's row (FOR NO KEY UPDATE, after the quote and the link) and
--    reads its status in the next statement. It is the third writer of an
--    accepted link (a quote accepted by phone), and read the gig's status
--    unlocked: an admin's cancel at the same moment was not seen.
--
-- No function here comes from an open PR (168 and 099 bodies). New anon
-- grant: bw_quote_link_preview only (it needs the token and the key).
-- Safe to run more than once.
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- 1. The quote's lineup, saved with the quote
-- --------------------------------------------------------------------

-- p_musicians: [{user_id, name, instrument, fee, is_external, is_available}]
-- Returns the rows saved, in the order given.
CREATE OR REPLACE FUNCTION public.bw_quote_save_musicians(p_quote_id uuid, p_musicians jsonb)
RETURNS SETOF public.quote_musicians
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
BEGIN
  IF jsonb_typeof(p_musicians) IS DISTINCT FROM 'array' OR jsonb_array_length(p_musicians) > 100 THEN
    RAISE EXCEPTION 'p_musicians must be an array of at most 100' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_musicians) m
     WHERE nullif(btrim(coalesce(m ->> 'name', '')), '') IS NULL
        OR (m ->> 'fee') IS NOT NULL AND (m ->> 'fee') !~ '^\d{1,8}(\.\d{1,2})?$'
  ) THEN
    RAISE EXCEPTION 'Every musician needs a name and a valid fee' USING ERRCODE = '22023';
  END IF;

  -- One save at a time per quote; the old rows go and the new ones come in this transaction.
  PERFORM 1 FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE;
  DELETE FROM public.quote_musicians qm WHERE qm.quote_id = p_quote_id;

  RETURN QUERY
    INSERT INTO public.quote_musicians (quote_id, user_id, name, instrument, fee, is_external, is_available)
    SELECT p_quote_id,
           -- Only someone of this band (a former member keeps no link, an external none).
           CASE WHEN (m ->> 'user_id') ~ '^[0-9a-fA-F-]{36}$'
                 AND EXISTS (SELECT 1 FROM public.band_members bm
                              WHERE bm.band_id = v_band AND bm.user_id = (m ->> 'user_id')::uuid)
                THEN (m ->> 'user_id')::uuid END,
           left(btrim(m ->> 'name'), 255),
           nullif(left(btrim(coalesce(m ->> 'instrument', '')), 100), ''),
           coalesce((m ->> 'fee')::numeric, 0),
           coalesce((m ->> 'is_external')::boolean, false),
           coalesce((m ->> 'is_available')::boolean, true)
      FROM jsonb_array_elements(p_musicians) WITH ORDINALITY AS t(m, ord)
     ORDER BY ord
    RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_save_musicians(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_save_musicians(uuid, jsonb) TO authenticated;

-- Round 4 (Codex review of #293): the quote's lineup and the lineup of the
-- tentative gig that holds its date, in one transaction. A musician
-- replaced on the quote leaves the gig, so confirming the quote never
-- confirms the old lineup. Only while the gig is tentative: one confirmed
-- meanwhile is the band's own and its lineup is not touched ("confirmed":
-- true, the quote's lineup is still saved). People who stay keep their
-- answer; who joins is pending (the admin saving: confirmed); everyone's
-- fee and instrument as on the quote. Admins only (bw_quote_admin_band);
-- it returns the quote's rows (quote_musicians: admins only) and never a
-- member's fee to anyone else.
-- Round 5: the lineup the musicians of a quote make, as one comparable
-- value (who, what they play, their fee; in any order).
-- Round 6 (Codex): who includes the profile (user_id), so two musicians
-- with the same name and fee are told apart. A profile that is not of the
-- band counts as none, on both sides: bw_quote_save_musicians drops the
-- link of a former member, which is not a change anyone made. The
-- one-argument form of round 5 is replaced (never shipped in a build).
DROP FUNCTION IF EXISTS public.bw_quote_lineup_key(jsonb);
CREATE OR REPLACE FUNCTION public.bw_quote_lineup_key(p_musicians jsonb, p_band uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(k ORDER BY k::text), '[]'::jsonb)
    FROM (SELECT jsonb_build_array(
                   CASE WHEN (m ->> 'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         AND EXISTS (SELECT 1 FROM public.band_members bm
                                      WHERE bm.band_id = p_band AND bm.user_id = (m ->> 'user_id')::uuid)
                        THEN lower(m ->> 'user_id') ELSE '' END,
                   lower(left(btrim(coalesce(m ->> 'name', '')), 255)),
                   lower(coalesce(left(btrim(m ->> 'instrument'), 100), '')),
                   CASE WHEN (m ->> 'fee') ~ '^-?\d+(\.\d+)?$' THEN round((m ->> 'fee')::numeric, 2)::text
                        ELSE coalesce(nullif(m ->> 'fee', ''), '0.00') END) AS k
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_musicians) = 'array' THEN p_musicians ELSE '[]'::jsonb END) m
           WHERE nullif(btrim(coalesce(m ->> 'name', '')), '') IS NOT NULL) x;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_lineup_key(jsonb, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_quote_lineup_stale_message()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE lower(left(coalesce((SELECT p.preferred_language FROM public.profiles p WHERE p.id = auth.uid()), 'en'), 2))
    WHEN 'it' THEN 'Qualcun altro ha cambiato i musicisti di questo preventivo mentre era aperto. Chiudilo e riaprilo: i musicisti non sono stati salvati.'
    WHEN 'es' THEN 'Otra persona cambió los músicos de este presupuesto mientras estaba abierto. Ciérralo y vuelve a abrirlo: los músicos no se guardaron.'
    WHEN 'fr' THEN 'Quelqu’un a modifié les musiciens de ce devis pendant qu’il était ouvert. Fermez-le et rouvrez-le : les musiciens n’ont pas été enregistrés.'
    WHEN 'de' THEN 'Jemand hat die Besetzung dieses Angebots geändert, während es geöffnet war. Schließe es und öffne es erneut: Die Besetzung wurde nicht gespeichert.'
    WHEN 'pt' THEN 'Outra pessoa mudou os músicos deste orçamento enquanto estava aberto. Feche-o e abra-o de novo: os músicos não foram guardados.'
    ELSE 'Someone else changed this quote’s lineup while it was open. Close it and open it again: the lineup was not saved.'
  END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_lineup_stale_message() FROM PUBLIC, anon, authenticated;

-- Round 6 (Claude review): the check of p_base on its own, the quote
-- locked first. Raises 40001 (hint BW_LINEUP_CHANGED) when the lineup
-- stored is not the one p_base says the editor opened with; null p_base:
-- no check. Admins only. bw_quote_save_lineup and
-- bw_quote_save_with_lineup both call it before writing anything.
CREATE OR REPLACE FUNCTION public.bw_quote_lineup_current(p_quote_id uuid, p_base jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
BEGIN
  PERFORM 1 FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE;
  IF p_base IS NOT NULL AND public.bw_quote_lineup_key(p_base, v_band) IS DISTINCT FROM public.bw_quote_lineup_key(
       (SELECT coalesce(jsonb_agg(to_jsonb(qm)), '[]'::jsonb) FROM public.quote_musicians qm WHERE qm.quote_id = p_quote_id), v_band) THEN
    RAISE EXCEPTION '%', public.bw_quote_lineup_stale_message() USING ERRCODE = '40001', HINT = 'BW_LINEUP_CHANGED';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_lineup_current(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_lineup_current(uuid, jsonb) TO authenticated;

-- Round 12: the events rows of a quote (the one it points at, and any made
-- from it), locked FOR UPDATE in id order (the order of 178's triggers).
-- The rule: a transaction takes its strongest events-row lock before the
-- hold's lock. A save of the lineup needs the events row FOR UPDATE, and
-- 178's triggers on what it writes take the hold's lock (after the row FOR
-- NO KEY UPDATE), so the row is locked FOR UPDATE here first, right after
-- the quote (quote -> event -> hold's lock). p_also: an event the same
-- save is about to point the quote at. A quote with no event locks
-- nothing. Admins of the quote's band only (bw_quote_admin_band), and only
-- their band's events; authenticated may call it because
-- bw_quote_save_with_lineup runs as the caller.
CREATE OR REPLACE FUNCTION public.bw_quote_lock_events(p_quote_id uuid, p_also uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_linked uuid;
BEGIN
  SELECT q.converted_to_event_id INTO v_linked FROM public.quotes q WHERE q.id = p_quote_id;
  PERFORM 1 FROM public.events e
    WHERE e.band_id = v_band AND (e.id = v_linked OR e.quote_id = p_quote_id OR e.id = p_also)
    ORDER BY e.id
      FOR UPDATE;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_lock_events(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_lock_events(uuid, uuid) TO authenticated;

-- Round 5: p_base (optional) is the lineup the wizard opened with. When
-- given, a lineup someone else changed meanwhile is refused (40001, hint
-- BW_LINEUP_CHANGED): the save would bring back who they removed and the
-- fees as they were. The gig loses only who was on the quote's lineup
-- before this save and is not on it now: someone added to the gig
-- directly, the admin, a deputy stay. The two-argument form of round 4
-- is replaced (never shipped in a build).
DROP FUNCTION IF EXISTS public.bw_quote_save_lineup(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.bw_quote_save_lineup(p_quote_id uuid, p_musicians jsonb, p_base jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_rows jsonb;
  v_linked uuid;
  v_event uuid;
  v_status text;
  v_before uuid[];
BEGIN
  -- The quote first (as bw_quote_save_musicians), then the gig.
  PERFORM public.bw_quote_lineup_current(p_quote_id, p_base);
  -- Round 12: the gig's row FOR UPDATE now, before the lineup is written
  -- (178's trigger on quote_musicians takes the hold's lock; the strongest
  -- events-row lock comes before it). The same row is read below.
  PERFORM public.bw_quote_lock_events(p_quote_id);
  -- Who the quote's lineup had before this save (the only ones it can take off the gig).
  v_before := ARRAY(SELECT DISTINCT qm.user_id FROM public.quote_musicians qm
                     WHERE qm.quote_id = p_quote_id AND qm.user_id IS NOT NULL);
  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO v_rows
    FROM public.bw_quote_save_musicians(p_quote_id, p_musicians) m;

  SELECT q.converted_to_event_id INTO v_linked FROM public.quotes q WHERE q.id = p_quote_id;
  SELECT e.id, lower(coalesce(e.status, '')) INTO v_event, v_status
    FROM public.events e
   WHERE e.band_id = v_band AND (e.id = v_linked OR e.quote_id = p_quote_id)
   ORDER BY (e.id IS NOT DISTINCT FROM v_linked) DESC, e.created_at
   LIMIT 1
   FOR UPDATE;
  IF v_event IS NULL THEN
    RETURN jsonb_build_object('musicians', v_rows, 'event_id', NULL, 'synced', false, 'confirmed', false);
  END IF;
  IF v_status <> 'tentative' THEN
    RETURN jsonb_build_object('musicians', v_rows, 'event_id', v_event, 'synced', false, 'confirmed', true);
  END IF;

  DELETE FROM public.event_members em
   WHERE em.event_id = v_event
     AND em.user_id = ANY (v_before)
     AND em.user_id NOT IN (SELECT qm.user_id FROM public.quote_musicians qm
                             WHERE qm.quote_id = p_quote_id AND qm.user_id IS NOT NULL);
  INSERT INTO public.event_members (event_id, user_id, role, fee, status)
  SELECT v_event, w.user_id, w.role, w.fee,
         CASE WHEN w.user_id = auth.uid() THEN 'confirmed' ELSE 'pending' END
    FROM (SELECT DISTINCT ON (qm.user_id) qm.user_id,
                 coalesce(nullif(btrim(qm.instrument), ''), 'Musician') AS role,
                 round(coalesce(qm.fee, 0), 2) AS fee
            FROM public.quote_musicians qm
           WHERE qm.quote_id = p_quote_id AND qm.user_id IS NOT NULL
           ORDER BY qm.user_id, qm.created_at, qm.id) w
   WHERE public.bw_is_band_member(v_band, w.user_id)
  ON CONFLICT (event_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        fee = EXCLUDED.fee;
  RETURN jsonb_build_object('musicians', v_rows, 'event_id', v_event, 'synced', true, 'confirmed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_save_lineup(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_save_lineup(uuid, jsonb, jsonb) TO authenticated;

-- Round 6 (Claude review r8): an edited quote and its lineup in one call,
-- so neither is written without the other. With the quote written first
-- and the lineup refused after (40001), a stale editor's base fee (a
-- musician someone else removed, still counted) stayed in the quote's
-- total, and every retry was refused again. Here p_base is checked first,
-- under the quote's lock; then the quote's columns (p_updates, as the
-- table update: SECURITY INVOKER, so RLS and the column grants apply as
-- they do to the app's direct update, and the quote's own triggers run);
-- then the lineup and the gig on hold (bw_quote_save_lineup). Any refusal
-- rolls everything back. Older builds keep the direct update and the two
-- calls, unchanged. Returns {quote: the row saved, lineup: as
-- bw_quote_save_lineup}.
CREATE OR REPLACE FUNCTION public.bw_quote_save_with_lineup(
  p_quote_id uuid,
  p_updates jsonb,
  p_musicians jsonb,
  p_base jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bad text;
  v_cols text;
  v_vals text;
  v_row jsonb;
BEGIN
  IF jsonb_typeof(p_updates) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'p_updates must be an object' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad
    FROM jsonb_object_keys(p_updates) k
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = 'public.quotes'::regclass AND a.attname = k
                        AND a.attnum > 0 AND NOT a.attisdropped)
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'column "%" of relation "quotes" does not exist', v_bad USING ERRCODE = '42703';
  END IF;

  -- The lineup it opened with, under the quote's lock, before anything is written.
  PERFORM public.bw_quote_lineup_current(p_quote_id, p_base);
  -- Round 12: the gig's row FOR UPDATE before the quote is written (178's
  -- triggers on the quote's update take the hold's lock, and
  -- bw_quote_save_lineup below needs the row FOR UPDATE); also the event
  -- this save points the quote at, if it names one.
  PERFORM public.bw_quote_lock_events(p_quote_id,
    CASE WHEN (p_updates ->> 'converted_to_event_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         THEN (p_updates ->> 'converted_to_event_id')::uuid END);

  SELECT string_agg(format('%I', k), ', ' ORDER BY k), string_agg(format('r.%I', k), ', ' ORDER BY k)
    INTO v_cols, v_vals
    FROM jsonb_object_keys(p_updates - 'id') k;
  IF v_cols IS NULL THEN
    SELECT to_jsonb(q.*) INTO v_row FROM public.quotes q WHERE q.id = p_quote_id;
  ELSE
    EXECUTE format('UPDATE public.quotes q SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.quotes, $1) r) '
                   'WHERE q.id = $2 RETURNING to_jsonb(q.*)', v_cols, v_vals)
       INTO v_row USING p_updates, p_quote_id;
  END IF;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Quote not found or you do not have permission to update it' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('quote', v_row,
                            'lineup', public.bw_quote_save_lineup(p_quote_id, p_musicians, p_base));
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_save_with_lineup(uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_save_with_lineup(uuid, jsonb, jsonb, jsonb) TO authenticated;

-- --------------------------------------------------------------------
-- 2. Mark as paid remembers the deposit, Undo puts it back (168 + #7)
-- --------------------------------------------------------------------

-- The gig's deposit_paid before "Mark as paid" (null: not marked paid here).
ALTER TABLE public.quote_links ADD COLUMN IF NOT EXISTS balance_paid_deposit_was boolean;
-- What the deposit looked like when "Mark as paid" left it (the gig's
-- amount, the amount recorded as received on the link): Undo gives back the
-- deposit as it was only while these are unchanged (round 3).
ALTER TABLE public.quote_links
  ADD COLUMN IF NOT EXISTS balance_paid_deposit_amount numeric,
  ADD COLUMN IF NOT EXISTS balance_paid_deposit_received numeric;

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
  v_deposit_was boolean;
  v_deposit_now boolean;
  v_amount numeric;
BEGIN
  -- Round 3: one lock order everywhere, the quote, then the link, then the gig.
  PERFORM 1 FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE;
  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;
  IF v_gig IS NOT NULL THEN
    SELECT coalesce(e.deposit_paid, false), e.deposit_amount INTO v_deposit_was, v_amount
      FROM public.events e WHERE e.id = v_gig AND e.band_id = v_band FOR UPDATE;
    v_deposit_now := CASE
      WHEN v_paid THEN true
      -- 185: Undo gives back the deposit as it was before "Mark as paid"
      -- (marked paid before 185: nothing remembered, kept as it is).
      -- Round 3: only while the deposit is as "Mark as paid" left it (still
      -- received, same amount on the gig, same amount recorded on the
      -- link): a deposit recorded or changed since then stays.
      WHEN v_link.balance_paid_at IS NOT NULL AND v_link.balance_paid_deposit_was IS NOT NULL
           AND v_deposit_was
           AND v_amount IS NOT DISTINCT FROM v_link.balance_paid_deposit_amount
           AND v_link.deposit_received_amount IS NOT DISTINCT FROM v_link.balance_paid_deposit_received
        THEN v_link.balance_paid_deposit_was
      ELSE v_deposit_was END;
    UPDATE public.events e
       SET deposit_paid = v_deposit_now,
           payment_status = CASE WHEN v_paid THEN 'paid' WHEN v_deposit_now THEN 'partial' ELSE 'pending' END
     WHERE e.id = v_gig AND e.band_id = v_band;
  END IF;

  IF v_link.id IS NOT NULL AND (v_link.balance_paid_at IS NOT NULL) IS DISTINCT FROM v_paid THEN
    UPDATE public.quote_links l
       SET balance_paid_at = CASE WHEN v_paid THEN now() END,
           balance_paid_deposit_was = CASE WHEN v_paid THEN v_deposit_was END,
           balance_paid_deposit_amount = CASE WHEN v_paid THEN v_amount END,
           balance_paid_deposit_received = CASE WHEN v_paid THEN l.deposit_received_amount END,
           updated_at = now()
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
-- 3. What the client was sent, and the admin's preview
-- --------------------------------------------------------------------

ALTER TABLE public.quote_links
  ADD COLUMN IF NOT EXISTS balance_sent jsonb,
  ADD COLUMN IF NOT EXISTS balance_preview jsonb,
  ADD COLUMN IF NOT EXISTS balance_preview_key text,
  ADD COLUMN IF NOT EXISTS balance_preview_at timestamptz;

-- Once: a balance already sent is what the client has. Only when that very
-- version was sent (168 records each send with the balance_version): a
-- balance_sent_at says only that some earlier version went out, and a
-- trial amount previewed (published) after it was never sent. What that
-- earlier version said is not kept anywhere, so such a link shows no
-- balance until the band sends one again.
UPDATE public.quote_links l SET balance_sent = l.balance
 WHERE l.balance IS NOT NULL AND l.balance_sent_at IS NOT NULL AND l.balance_sent IS NULL
   AND EXISTS (SELECT 1 FROM public.quote_activity a
                WHERE a.quote_id = l.quote_id AND a.kind IN ('balance_requested', 'balance_reminded')
                  AND a.version = l.balance_version);

-- The checks every balance the client may see goes through (168's publish).
CREATE OR REPLACE FUNCTION public.bw_quote_balance_check(p_band uuid, p_balance jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_amount numeric;
  v_stripe text;
  v_pdf text;
  v_cash text;
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
  v_stripe := nullif(btrim(coalesce(p_balance ->> 'stripeUrl', '')), '');
  IF v_stripe IS NOT NULL AND (length(v_stripe) > 500 OR v_stripe !~ '^https://[^[:space:]"''<>\\]+$') THEN
    RAISE EXCEPTION 'Invalid payment link' USING ERRCODE = '22023';
  END IF;
  v_pdf := nullif(btrim(coalesce(p_balance ->> 'pdfUrl', '')), '');
  IF v_pdf IS NOT NULL AND v_pdf !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/quotes/quotes/' || p_band::text || '/[A-Za-z0-9._%-]+$') THEN
    RAISE EXCEPTION 'Invalid PDF link' USING ERRCODE = '22023';
  END IF;
  v_cash := nullif(btrim(coalesce(p_balance ->> 'cash', '')), '');
  IF v_stripe IS NULL AND v_cash IS NULL
     AND (jsonb_typeof(p_balance -> 'bank') IS DISTINCT FROM 'array' OR jsonb_array_length(p_balance -> 'bank') = 0) THEN
    RAISE EXCEPTION 'Add a way to pay' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_balance_check(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 168's publish without its "balance_updated" line (that is now written
-- when the changed balance is sent). The client sees nothing until a send.
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
  v_changed boolean;
BEGIN
  PERFORM public.bw_quote_balance_check(v_band, p_balance);

  -- Round 3: the quote, then the link (then the gig), as every quote write.
  PERFORM 1 FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE;
  SELECT q.status, nullif(left(regexp_replace(btrim(coalesce(q.client_name, '')), '\s+', ' ', 'g'), 120), '')
    INTO v_quote_status, v_client
    FROM public.quotes q WHERE q.id = p_quote_id;

  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;
  -- Round 13: the gig's row locked (quote -> link -> event), then its
  -- status read in the next statement. This publish can write the link as
  -- accepted (below); with the status read unlocked, an admin's cancel that
  -- had not committed yet was not seen, and the cancelled event was left
  -- with an accepted link and no private period closed (as 187's accept).
  PERFORM 1 FROM public.events e
    WHERE e.id = public.bw_quote_gig_id(p_quote_id)
      FOR NO KEY UPDATE;
  SELECT e.status INTO v_gig_status FROM public.events e WHERE e.id = public.bw_quote_gig_id(p_quote_id);
  IF lower(coalesce(v_gig_status, '')) = 'cancelled' THEN
    RAISE EXCEPTION 'The gig is cancelled' USING ERRCODE = '22023';
  END IF;
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
    -- "Paid" stays as it is until the changed balance is sent (mark sent
    -- reopens it, with the gig): a publish may be an older build's preview,
    -- and clearing it here left the gig paid with nothing for Undo to restore.
    UPDATE public.quote_links l
       SET balance = p_balance, balance_version = l.balance_version + 1, balance_at = now(), updated_at = now()
     WHERE l.id = v_link.id
    RETURNING * INTO v_link;
  END IF;

  RETURN jsonb_build_object('token', v_link.token, 'balance_version', v_link.balance_version, 'changed', v_changed);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_balance_publish(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_balance_publish(uuid, jsonb) TO authenticated;

-- 168's send record, which now also hands the client the balance: what was
-- published becomes what was sent. A changed balance sent again is
-- "balance_updated" on the timeline (168 wrote it at publish time).
-- Round 3: p_balance_version (new, optional) is the balance_version the
-- caller published and sent. If another admin published a different
-- balance in between, this send is not the one on the link: nothing is
-- recorded and the call fails (P0001 BW_BALANCE_CHANGED), so the page never
-- asks for an amount the client was not sent. Older builds don't pass it
-- and record as before. Dropped and created again with the new parameter
-- (a default: the three named arguments of older builds still find it).
-- Round 6 (Codex): p_pending (new, optional). An email is sent by the
-- server after the app asks, and an app closed right after the send never
-- recorded it: the client had the email with the new amount and a page
-- with the old one. Now the app records the send first (p_pending true:
-- the page shows this balance at once, and the link keeps what it showed
-- before in balance_send_pending), then sends the email, then confirms it
-- (p_pending false: nothing new is recorded, the pending mark goes). When
-- the server says the email did not go out, bw_quote_balance_send_failed
-- puts back what the page showed. Null (older builds, WhatsApp, Copy): as
-- round 3. Dropped and created again with the new parameter (a default:
-- older builds' named arguments still find it).
ALTER TABLE public.quote_links ADD COLUMN IF NOT EXISTS balance_send_pending jsonb;
DROP FUNCTION IF EXISTS public.bw_quote_balance_mark_sent(uuid, text, text);
DROP FUNCTION IF EXISTS public.bw_quote_balance_mark_sent(uuid, text, text, int);
CREATE OR REPLACE FUNCTION public.bw_quote_balance_mark_sent(
  p_quote_id uuid,
  p_kind text DEFAULT 'sent',
  p_channel text DEFAULT NULL,
  p_balance_version int DEFAULT NULL,
  p_pending boolean DEFAULT NULL
)
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
  v_updated uuid;
  v_requested uuid;
BEGIN
  -- Round 3: the quote, then the link (then the gig, through mark paid).
  PERFORM 1 FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE;
  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;
  IF v_link.id IS NULL OR v_link.balance IS NULL THEN
    RAISE EXCEPTION 'Publish the balance first' USING ERRCODE = 'P0002';
  END IF;
  IF p_balance_version IS NOT NULL AND p_balance_version IS DISTINCT FROM v_link.balance_version THEN
    RAISE EXCEPTION 'BW_BALANCE_CHANGED: the balance was changed after this one was sent' USING ERRCODE = 'P0001';
  END IF;
  -- Round 6: the email went out: the send was recorded before it.
  IF p_pending IS FALSE THEN
    IF jsonb_typeof(v_link.balance_send_pending) = 'object'
       AND (v_link.balance_send_pending ->> 'version')::int IS NOT DISTINCT FROM v_link.balance_version THEN
      UPDATE public.quote_links l SET balance_send_pending = NULL WHERE l.id = v_link.id;
      RETURN v_link.balance_send_pending ->> 'kind';
    END IF;
    RETURN NULL;
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'The client link is turned off' USING ERRCODE = '22023';
  END IF;
  -- An email goes out only for an open balance (send-email says no_balance).
  IF p_pending AND v_link.balance_paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'There is no open balance to send' USING ERRCODE = 'P0001', HINT = 'BW_NO_BALANCE';
  END IF;
  IF v_channel IS NOT NULL AND v_channel NOT IN ('whatsapp', 'sms', 'email', 'copy', 'share') THEN v_channel := NULL; END IF;
  -- A changed balance sent after "Mark as paid": a new request, so not paid
  -- any more, on the link and on the gig together (as Undo: the deposit as
  -- it was before "Mark as paid").
  IF v_link.balance_paid_at IS NOT NULL AND v_link.balance_sent IS DISTINCT FROM v_link.balance THEN
    PERFORM public.bw_quote_balance_mark_paid(p_quote_id, false);
  END IF;
  IF v_link.balance_sent_at IS NOT NULL AND v_link.balance_sent IS DISTINCT FROM v_link.balance THEN
    INSERT INTO public.quote_activity (quote_id, band_id, kind, body, version, actor_id)
    VALUES (p_quote_id, v_band, 'balance_updated', left(v_link.balance ->> 'amountLabel', 60), v_link.balance_version, auth.uid())
    RETURNING id INTO v_updated;
  END IF;
  v_kind := CASE WHEN p_kind = 'reminded' AND v_link.balance_sent_at IS NOT NULL THEN 'balance_reminded' ELSE 'balance_requested' END;
  INSERT INTO public.quote_activity (quote_id, band_id, kind, body, channel, version, actor_id)
  VALUES (p_quote_id, v_band, v_kind, left(v_link.balance ->> 'amountLabel', 60), v_channel, v_link.balance_version, auth.uid())
  RETURNING id INTO v_requested;
  UPDATE public.quote_links l
     SET balance_sent_at = coalesce(l.balance_sent_at, now()), balance_sent = l.balance, updated_at = now(),
         balance_send_pending = CASE WHEN p_pending THEN jsonb_build_object(
           'version', v_link.balance_version, 'kind', v_kind, 'at', now(),
           'activity', jsonb_build_array(v_requested) || CASE WHEN v_updated IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_updated) END,
           'sent', v_link.balance_sent, 'sent_at', v_link.balance_sent_at) END
   WHERE l.id = v_link.id;
  RETURN v_kind;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_balance_mark_sent(uuid, text, text, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_balance_mark_sent(uuid, text, text, int, boolean) TO authenticated;

-- Round 6: the email of a send recorded first (p_pending) did not go out
-- (the server said so): the page shows again what it showed before, and
-- the timeline loses that send. Only that send: another balance published
-- or sent since (another version, or no pending mark) is left as it is.
-- Returns whether it was put back.
CREATE OR REPLACE FUNCTION public.bw_quote_balance_send_failed(p_quote_id uuid, p_balance_version int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_link public.quote_links;
  v_p jsonb;
BEGIN
  PERFORM 1 FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE;
  SELECT * INTO v_link FROM public.quote_links l WHERE l.quote_id = p_quote_id FOR UPDATE;
  v_p := v_link.balance_send_pending;
  IF v_link.id IS NULL OR jsonb_typeof(v_p) IS DISTINCT FROM 'object'
     OR (v_p ->> 'version')::int IS DISTINCT FROM p_balance_version
     OR v_link.balance_version IS DISTINCT FROM p_balance_version THEN
    RETURN false;
  END IF;
  DELETE FROM public.quote_activity a
   WHERE a.quote_id = p_quote_id AND a.band_id = v_band
     AND a.id IN (SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(coalesce(v_p -> 'activity', '[]'::jsonb)) x);
  UPDATE public.quote_links l
     SET balance_sent = CASE WHEN jsonb_typeof(v_p -> 'sent') = 'object' THEN v_p -> 'sent' END,
         balance_sent_at = (v_p ->> 'sent_at')::timestamptz,
         balance_send_pending = NULL,
         updated_at = now()
   WHERE l.id = v_link.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_balance_send_failed(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_balance_send_failed(uuid, int) TO authenticated;

-- The admin's preview: keeps the draft (nothing the client sees changes)
-- and returns the key the preview page opens it with.
CREATE OR REPLACE FUNCTION public.bw_quote_balance_preview(p_quote_id uuid, p_balance jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band uuid := public.bw_quote_admin_band(p_quote_id);
  v_key text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
BEGIN
  PERFORM public.bw_quote_balance_check(v_band, p_balance);
  PERFORM 1 FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE; -- round 3: the quote, then the link
  UPDATE public.quote_links l
     SET balance_preview = p_balance, balance_preview_key = v_key, balance_preview_at = now()
   WHERE l.quote_id = p_quote_id AND l.snapshot IS NOT NULL AND l.revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Publish the quote first' USING ERRCODE = 'P0002'; END IF;
  RETURN v_key;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_balance_preview(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_quote_balance_preview(uuid, jsonb) TO authenticated;

-- The preview page: the client's page as it is, with the admin's draft
-- balance in place of the one sent. A wrong or old key (30 minutes) gives
-- the page as the client sees it.
CREATE OR REPLACE FUNCTION public.bw_quote_link_preview(p_token text, p_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_view jsonb := public.bw_quote_link_view(p_token);
  v_link public.quote_links;
BEGIN
  IF v_view IS NULL OR p_key IS NULL OR p_key !~ '^[0-9a-f]{64}$' THEN RETURN v_view; END IF;
  SELECT * INTO v_link FROM public.quote_links l WHERE l.token = p_token;
  IF v_link.balance_preview_key IS DISTINCT FROM p_key OR v_link.balance_preview IS NULL
     OR v_link.balance_preview_at < now() - interval '30 minutes' THEN
    RETURN v_view;
  END IF;
  IF v_view ->> 'status' <> 'accepted' THEN
    -- Accepted by phone or in person, the link not marked yet (a link made
    -- for the balance is a draft; the first publish of the balance marks it,
    -- as 105): the preview shows the page as it will be then.
    IF NOT EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = v_link.quote_id AND lower(coalesce(q.status, '')) = 'accepted') THEN
      RETURN v_view;
    END IF;
    v_view := v_view || jsonb_build_object('status', 'accepted', 'accepted_at', coalesce(v_link.responded_at, now()),
                                           'expired', false, 'declined_at', NULL, 'decline_reason', NULL);
  END IF;
  RETURN v_view || jsonb_build_object(
    'balance', v_link.balance_preview,
    'balance_at', v_link.balance_preview_at,
    'balance_paid', false,
    'balance_paid_at', NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_preview(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_preview(text, text) TO anon, authenticated;

-- bw_quote_balance_mark_sent has a new parameter: PostgREST reads it now.
NOTIFY pgrst, 'reload schema';

COMMIT;
