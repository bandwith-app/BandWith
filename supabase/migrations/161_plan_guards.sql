-- 161 · Paid plans, P2: the server checks (docs/plans/paid-plans.md §4).
--
-- One guard, bw_plan_guard(band, key, add), called by the triggers below and
-- by bw_quote_link_mark_sent. It does nothing while
-- platform_switches.plans_enforced is off (no row = off), so this migration
-- changes nothing for anyone until the switch is turned on.
--
-- When on, for signed-in people only (the service role, SQL scripts and
-- imports always pass):
--   * no value written for the band's plan and key, or NULL → unlimited;
--   * used + add > limit → SQLSTATE P0001, message BW_PLAN_LIMIT:<key>, and
--     a plain-English HINT for builds that do not know the code.
-- Nothing is ever deleted or hidden: only adding more is refused.
--
-- Counted live (bw_plan_count), no counters to drift:
--   quotes_sent_month     quote links first sent this month (Europe/Rome)
--   contracts_sent_month  contracts (not riders) first sent this month
--   deputies              the band's deputies
--   admins                active admins
--   custom_templates      the band's own to-do templates (built-ins never)
--   gear_items            band gear (personal gear, owner_id set, never)
--   storage_mb            files in the band's folders: song-files/<band>/,
--                         band-branding/<band>/, quotes/quotes/<band>/
--                         (avatars and personal files never count)
--   bands_as_admin        Free bands the person runs (checked when creating one)
-- analytics_days and branding are UI only (§4.3).
--
-- Additive and idempotent. Replaces bw_quote_link_mark_sent (099) with the
-- same body plus the guard on the first send.

BEGIN;

-- ------------------------------------------------------------ counting --

CREATE OR REPLACE FUNCTION public.bw_plan_month_start()
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT date_trunc('month', now() AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'Europe/Rome';
$function$;

CREATE OR REPLACE FUNCTION public.bw_plan_storage_bytes(p_band_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
  SELECT COALESCE(sum(COALESCE((o.metadata->>'size')::bigint, 0)), 0)::bigint
  FROM storage.objects o
  WHERE o.archived_at IS NULL
    AND NOT COALESCE(o.is_delete_marker, false)
    AND (
      (o.bucket_id = 'song-files' AND o.name LIKE p_band_id::text || '/%')
      OR (o.bucket_id = 'band-branding' AND o.name LIKE p_band_id::text || '/%')
      OR (o.bucket_id = 'quotes' AND o.name LIKE 'quotes/' || p_band_id::text || '/%')
    );
$function$;

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

-- The app's counters (replaces the P1 placeholder that read band_usage).
CREATE OR REPLACE FUNCTION public.bw_band_plan_usage(p_band_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_object_agg(k, public.bw_plan_count(p_band_id, k))
  FROM unnest(ARRAY['quotes_sent_month', 'contracts_sent_month', 'deputies', 'admins',
                    'custom_templates', 'gear_items', 'storage_mb']) AS k;
$function$;

-- --------------------------------------------------------------- guard --

CREATE OR REPLACE FUNCTION public.bw_plan_guard(p_band_id uuid, p_key text, p_add integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_enforced boolean;
  v_limit integer;
  v_used bigint;
BEGIN
  v_enforced := COALESCE((SELECT enabled FROM platform_switches WHERE key = 'plans_enforced'), false);
  IF NOT v_enforced THEN
    RETURN;
  END IF;
  IF p_band_id IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN;
  END IF;
  SELECT l.value INTO v_limit FROM plan_limits l
   WHERE l.plan = public.bw_band_effective_plan(p_band_id, now()) AND l.key = p_key;
  IF v_limit IS NULL THEN
    RETURN;
  END IF;
  v_used := public.bw_plan_count(p_band_id, p_key);
  IF v_used + COALESCE(p_add, 1) > v_limit THEN
    RAISE EXCEPTION 'BW_PLAN_LIMIT:%', p_key
      USING ERRCODE = 'P0001',
            DETAIL = format('BW_PLAN_LIMIT:%s used=%s limit=%s', p_key, v_used, v_limit),
            HINT = 'Your band''s plan limit is reached. Update BandWith to see the options.';
  END IF;
END;
$function$;

-- Creating a band: the Free bands this person already runs.
CREATE OR REPLACE FUNCTION public.bw_plan_guard_new_band(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer;
  v_used bigint;
BEGIN
  IF NOT COALESCE((SELECT enabled FROM platform_switches WHERE key = 'plans_enforced'), false) THEN
    RETURN;
  END IF;
  IF p_user_id IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN;
  END IF;
  SELECT l.value INTO v_limit FROM plan_limits l WHERE l.plan = 'free' AND l.key = 'bands_as_admin';
  IF v_limit IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_used FROM band_members m
   WHERE m.user_id = p_user_id AND m.role = 'admin' AND COALESCE(m.is_active, true)
     AND public.bw_band_effective_plan(m.band_id, now()) = 'free';
  IF v_used + 1 > v_limit THEN
    RAISE EXCEPTION 'BW_PLAN_LIMIT:%', 'bands_as_admin'
      USING ERRCODE = 'P0001',
            DETAIL = format('BW_PLAN_LIMIT:bands_as_admin used=%s limit=%s', v_used, v_limit),
            HINT = 'Your account''s Free band limit is reached. Update BandWith to see the options.';
  END IF;
END;
$function$;

-- ------------------------------------------------------------ triggers --

CREATE OR REPLACE FUNCTION public.bw_trg_plan_deputies()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.bw_plan_guard(NEW.band_id, 'deputies', 1);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bw_trg_plan_gear()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.owner_id IS NULL AND NEW.band_id IS NOT NULL THEN
    PERFORM public.bw_plan_guard(NEW.band_id, 'gear_items', 1);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bw_trg_plan_templates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(NEW.is_default, false) AND NEW.band_id IS NOT NULL THEN
    PERFORM public.bw_plan_guard(NEW.band_id, 'custom_templates', 1);
  END IF;
  RETURN NEW;
END;
$function$;

-- Only the first send (sent_at was empty): resends are free; riders never count.
CREATE OR REPLACE FUNCTION public.bw_trg_plan_contracts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.type, 'contract') = 'rider' OR NEW.band_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.sent_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.sent_at IS NULL) THEN
    PERFORM public.bw_plan_guard(NEW.band_id, 'contracts_sent_month', 1);
  END IF;
  RETURN NEW;
END;
$function$;

-- Someone becomes an active admin (added as one, promoted, or reactivated).
CREATE OR REPLACE FUNCTION public.bw_trg_plan_admins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (NEW.role = 'admin' AND COALESCE(NEW.is_active, true)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.band_id IS NOT DISTINCT FROM NEW.band_id
     AND OLD.role = 'admin' AND COALESCE(OLD.is_active, true) THEN
    RETURN NEW;
  END IF;
  PERFORM public.bw_plan_guard(NEW.band_id, 'admins', 1);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bw_trg_plan_bands()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.bw_plan_guard_new_band(COALESCE(NEW.created_by, auth.uid()));
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS bw_plan_deputies ON public.band_deputies;
CREATE TRIGGER bw_plan_deputies BEFORE INSERT ON public.band_deputies
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_plan_deputies();

DROP TRIGGER IF EXISTS bw_plan_gear ON public.inventory;
CREATE TRIGGER bw_plan_gear BEFORE INSERT ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_plan_gear();

DROP TRIGGER IF EXISTS bw_plan_templates ON public.task_templates;
CREATE TRIGGER bw_plan_templates BEFORE INSERT ON public.task_templates
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_plan_templates();

DROP TRIGGER IF EXISTS bw_plan_contracts ON public.contracts;
CREATE TRIGGER bw_plan_contracts BEFORE INSERT OR UPDATE OF sent_at ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_plan_contracts();

DROP TRIGGER IF EXISTS bw_plan_admins ON public.band_members;
CREATE TRIGGER bw_plan_admins BEFORE INSERT OR UPDATE OF role, is_active, band_id ON public.band_members
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_plan_admins();

DROP TRIGGER IF EXISTS bw_plan_bands ON public.bands;
CREATE TRIGGER bw_plan_bands BEFORE INSERT ON public.bands
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_plan_bands();

-- ------------------------------------------------------------- storage --

-- Uploads to a band's folders while the band is at its storage limit. Any
-- error here lets the upload through (never block files because of a bug).
CREATE OR REPLACE FUNCTION public.bw_plan_storage_ok(p_bucket text, p_name text, p_metadata jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
DECLARE
  v_band uuid;
  v_limit integer;
  v_parts text[];
  v_new bigint;
BEGIN
  IF NOT COALESCE((SELECT enabled FROM platform_switches WHERE key = 'plans_enforced'), false) THEN
    RETURN true;
  END IF;
  IF p_bucket NOT IN ('song-files', 'band-branding', 'quotes') OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN true;
  END IF;
  BEGIN
    v_parts := storage.foldername(p_name);
    v_band := (CASE WHEN p_bucket = 'quotes' THEN v_parts[2] ELSE v_parts[1] END)::uuid;
    SELECT l.value INTO v_limit FROM plan_limits l
     WHERE l.plan = public.bw_band_effective_plan(v_band, now()) AND l.key = 'storage_mb';
    IF v_limit IS NULL THEN
      RETURN true;
    END IF;
    v_new := COALESCE((p_metadata->>'size')::bigint, 0);
    RETURN public.bw_plan_storage_bytes(v_band) + v_new <= v_limit::bigint * 1048576;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN true;
  END;
END;
$function$;

DROP POLICY IF EXISTS bw_plan_storage_insert ON storage.objects;
CREATE POLICY bw_plan_storage_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.bw_plan_storage_ok(bucket_id, name, metadata));

-- ------------------------------------------------- quotes: first send --

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

-- ------------------------------------------------------------- grants --

REVOKE ALL ON FUNCTION public.bw_plan_month_start() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_plan_storage_bytes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_plan_count(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_band_plan_usage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_plan_guard(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_plan_guard_new_band(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_trg_plan_deputies() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_trg_plan_gear() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_trg_plan_templates() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_trg_plan_contracts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_trg_plan_admins() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_trg_plan_bands() FROM PUBLIC, anon, authenticated;
-- The storage policy runs as the uploader.
REVOKE ALL ON FUNCTION public.bw_plan_storage_ok(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_plan_storage_ok(text, text, jsonb) TO authenticated;
-- bw_quote_link_mark_sent keeps its 099 grants (CREATE OR REPLACE keeps them).

COMMIT;
