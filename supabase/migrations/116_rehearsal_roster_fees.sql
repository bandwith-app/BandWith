-- 116 · Rehearsal rosters don't carry gig fees.
--
-- Locking in a rehearsal poll (finalizePollIntoRehearsal) and saving the
-- rehearsal wizard copied each member's default GIG fee (band_members.
-- default_fee) into event_members.fee for the rehearsal. Rehearsals have no
-- member fee in the app (no field sets one; the room cost lives on
-- events.fee, admins only), so those amounts were never meant: the
-- rehearsal invite showed "Your fee" from them and "Your fee changed"
-- notifications could fire for a rehearsal. Payouts due (src/lib/payoutsDue.ts),
-- member stats (bw_member_stats, 083) and the members' year totals already
-- leave rehearsals out. The app now writes 0 for rehearsal rosters.
--
-- This migration:
--   1. bw_trg_member_fee_changed (068/089): no "Your fee changed" for
--      rehearsals. Same function as live, plus that one check.
--   2. Data fix, conservative: a rehearsal roster row goes to 0 only when its
--      fee is exactly that member's current default fee and no payout was
--      recorded (paid_at null). Any other amount is left alone. The fee
--      trigger above is replaced first, so nobody is notified.
--      Live data checked on 2026-11-14: no rehearsal row has a fee, so this
--      changes nothing there today.
--
-- Idempotent; safe to re-run on live data.

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_trg_member_fee_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ev record;
  v_label text;
  v_when text;
  v_cur text;
  v_fmt text := 'FM999G999G990D00';
BEGIN
  IF NEW.fee IS NOT DISTINCT FROM OLD.fee THEN RETURN NEW; END IF;
  -- Your own edit doesn't notify you (bw_notify also skips the actor).
  IF NEW.user_id IS NULL OR NEW.user_id = auth.uid() THEN RETURN NEW; END IF;
  -- Someone who declined isn't playing: no fee news.
  IF lower(coalesce(NEW.status, '')) = 'declined' THEN RETURN NEW; END IF;

  SELECT id, band_id, title, event_type, event_date, start_time, currency
    INTO ev FROM public.events WHERE id = NEW.event_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- Rehearsals have no member fee (116).
  IF lower(coalesce(ev.event_type, '')) = 'rehearsal' THEN RETURN NEW; END IF;
  -- Past events: settling payouts afterwards isn't news.
  IF ev.event_date IS NOT NULL AND ev.event_date < current_date THEN RETURN NEW; END IF;

  v_label := CASE WHEN lower(coalesce(ev.event_type, 'gig')) = 'rehearsal' THEN 'Rehearsal' ELSE 'Gig' END;
  v_when := coalesce(to_char(ev.event_date, 'Dy DD Mon'), 'date TBD');
  v_cur := CASE upper(coalesce(ev.currency, 'EUR'))
             WHEN 'EUR' THEN '€' WHEN 'USD' THEN '$' WHEN 'GBP' THEN '£'
             ELSE upper(ev.currency) || ' ' END;

  PERFORM public.bw_notify(
    ARRAY[NEW.user_id],
    ev.band_id,
    'fee_changed',
    'Your fee changed',
    coalesce(ev.title, v_label) || ' · ' || v_when || ': your fee is now ' ||
      v_cur || to_char(coalesce(NEW.fee, 0), v_fmt) ||
      ' (was ' || v_cur || to_char(coalesce(OLD.fee, 0), v_fmt) || ').',
    jsonb_build_object(
      'event_id', ev.id,
      'kind', 'fee_changed',
      'event_type', lower(coalesce(ev.event_type, 'gig')),
      'old_fee', OLD.fee,
      'new_fee', NEW.fee
    ),
    ev.id,
    'event',
    NULL
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_member_fee_changed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

UPDATE public.event_members em
   SET fee = 0
  FROM public.events e, public.band_members bm
 WHERE e.id = em.event_id
   AND lower(coalesce(e.event_type, '')) = 'rehearsal'
   AND e.band_id IS NOT NULL
   AND bm.band_id = e.band_id
   AND bm.user_id = em.user_id
   AND em.fee IS NOT NULL
   AND em.fee <> 0
   AND bm.default_fee IS NOT NULL
   AND em.fee = bm.default_fee
   AND em.paid_at IS NULL;

COMMIT;
