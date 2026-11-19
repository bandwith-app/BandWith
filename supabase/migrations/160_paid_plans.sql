-- 160 · Paid plans, P1: data layer and read path (docs/plans/paid-plans.md §3).
--
-- Everything here is switched off and empty:
--   * no plan values, no prices, no plan rows are written by any migration
--     (the repository is public): plan_limits and plan_settings are filled by
--     hand with the service role from a local file;
--   * the switches live in platform_switches (130). No row = off, so with
--     this migration applied every band behaves exactly as in the beta.
--
-- Tables (RLS on, no grants to anon or authenticated; read through RPCs):
--   plan_limits      one value per plan and limit key; NULL = unlimited,
--                    no row = unlimited
--   plan_settings    other terms (trial length, grace days, launch notice…)
--   billing_accounts one per paying subscription (Paddle, later Apple)
--   band_plans       the band's current plan, one row per band; no row = Free
--   billing_events   every provider webhook event, unique per provider
--   band_usage       counters that are expensive to compute live (P2)
--   plan_trials      one trial per account (instead of a column on
--                    profiles, so the profiles grants stay untouched)
--
-- Functions:
--   bw_band_effective_plan(band, at)  internal; the same rules as
--                                     src/lib/plans.ts resolvePlan
--   bw_band_plan_usage(band)          internal; counters for the app
--   bw_band_entitlements(band)        the app's read: members only, billing
--                                     details for admins and the payer only
--
-- Additive and idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.plan_limits (
  plan text NOT NULL CHECK (plan IN ('free', 'pro', 'maestro')),
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value integer CHECK (value IS NULL OR value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan, key)
);

CREATE TABLE IF NOT EXISTS public.plan_settings (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  plan text NOT NULL CHECK (plan IN ('pro', 'maestro')),
  status text NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'paused', 'canceled', 'ended')),
  provider text NOT NULL CHECK (provider IN ('paddle', 'apple', 'google')),
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  cancel_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subscription_id)
);

CREATE INDEX IF NOT EXISTS billing_accounts_payer_idx ON public.billing_accounts (payer_user_id);

CREATE TABLE IF NOT EXISTS public.band_plans (
  band_id uuid PRIMARY KEY REFERENCES public.bands(id) ON DELETE CASCADE,
  billing_account_id uuid REFERENCES public.billing_accounts(id) ON DELETE SET NULL,
  plan text NOT NULL CHECK (plan IN ('free', 'pro', 'maestro')),
  source text NOT NULL CHECK (source IN ('paddle', 'apple', 'google', 'grant', 'trial')),
  status text NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'paused', 'canceled', 'ended')),
  trial_ends_at timestamptz,
  past_due_since timestamptz,
  grant_reason text CHECK (grant_reason IS NULL OR grant_reason IN ('founding', 'partner', 'support', 'other')),
  grant_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS band_plans_account_idx ON public.band_plans (billing_account_id);

CREATE TABLE IF NOT EXISTS public.billing_events (
  provider text NOT NULL CHECK (provider IN ('paddle', 'apple', 'google')),
  event_id text NOT NULL,
  type text NOT NULL,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  processed_at timestamptz,
  error text,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS public.band_usage (
  band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- First day of the month for monthly counters, 1970-01-01 for running totals.
  period_start date NOT NULL DEFAULT DATE '1970-01-01',
  value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (band_id, key, period_start)
);

CREATE TABLE IF NOT EXISTS public.plan_trials (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  band_id uuid REFERENCES public.bands(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_trials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.plan_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.plan_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.billing_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.band_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.billing_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.band_usage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.plan_trials FROM PUBLIC, anon, authenticated;

-- The band's plan now. Same rules as resolvePlan in src/lib/plans.ts, checked
-- against src/lib/__fixtures__/planCases.json in the dry run:
--   no row / free                → free
--   trial                        → the plan while trialing and before trial_ends_at
--   grant                        → the plan while active and before grant_until (NULL = forever)
--   paid, active or trialing     → the plan
--   paid, past due               → the plan until past_due_since + grace_days
--                                  (no grace setting or no date: the plan;
--                                  the provider's dunning ends it)
--   anything else                → free
CREATE OR REPLACE FUNCTION public.bw_band_effective_plan(p_band_id uuid, p_at timestamptz DEFAULT now())
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT CASE
      WHEN bp.plan NOT IN ('pro', 'maestro') THEN 'free'
      WHEN bp.source = 'trial' THEN
        CASE WHEN bp.status = 'trialing' AND bp.trial_ends_at > p_at THEN bp.plan ELSE 'free' END
      WHEN bp.source = 'grant' THEN
        CASE WHEN bp.status = 'active' AND (bp.grant_until IS NULL OR bp.grant_until > p_at) THEN bp.plan ELSE 'free' END
      WHEN bp.status IN ('active', 'trialing') THEN bp.plan
      WHEN bp.status = 'past_due' THEN
        CASE
          WHEN bp.past_due_since IS NULL OR g.days IS NULL THEN bp.plan
          WHEN bp.past_due_since + g.days * interval '1 day' > p_at THEN bp.plan
          ELSE 'free'
        END
      ELSE 'free'
    END
    FROM band_plans bp
    LEFT JOIN LATERAL (
      SELECT (s.value #>> '{}')::double precision AS days
      FROM plan_settings s
      WHERE s.key = 'grace_days' AND jsonb_typeof(s.value) = 'number'
    ) g ON true
    WHERE bp.band_id = p_band_id
  ), 'free');
$function$;

REVOKE ALL ON FUNCTION public.bw_band_effective_plan(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- Counters for the app: running totals and this month's (Europe/Rome).
CREATE OR REPLACE FUNCTION public.bw_band_plan_usage(p_band_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_object_agg(u.key, u.value), '{}'::jsonb)
  FROM band_usage u
  WHERE u.band_id = p_band_id
    AND u.period_start IN (DATE '1970-01-01', date_trunc('month', now() AT TIME ZONE 'Europe/Rome')::date);
$function$;

REVOKE ALL ON FUNCTION public.bw_band_plan_usage(uuid) FROM PUBLIC, anon, authenticated;

-- The app's read. Active members of the band only (anyone else: NULL).
-- Members get the plan and the limits; how it is paid (source, dates,
-- checkout, the launch notice) only reaches admins. Provider ids never leave
-- the database.
CREATE OR REPLACE FUNCTION public.bw_band_entitlements(p_band_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin boolean;
  v_plan text;
  v_row band_plans%ROWTYPE;
  v_payer uuid;
  v_enforced boolean;
  v_checkout boolean;
  v_notice jsonb;
BEGIN
  IF p_band_id IS NULL OR NOT public.bw_is_band_member(p_band_id) THEN
    RETURN NULL;
  END IF;

  v_admin := public.bw_is_band_admin(p_band_id);
  v_plan := public.bw_band_effective_plan(p_band_id, now());
  SELECT * INTO v_row FROM band_plans WHERE band_id = p_band_id;
  IF v_row.billing_account_id IS NOT NULL THEN
    SELECT payer_user_id INTO v_payer FROM billing_accounts WHERE id = v_row.billing_account_id;
  END IF;
  v_enforced := COALESCE((SELECT enabled FROM platform_switches WHERE key = 'plans_enforced'), false);
  v_checkout := COALESCE((SELECT enabled FROM platform_switches WHERE key = 'plans_checkout'), false);
  SELECT value INTO v_notice FROM plan_settings WHERE key = 'launch_notice';

  RETURN jsonb_build_object(
    'enforced', v_enforced,
    'plan', v_plan,
    'source', CASE WHEN v_admin THEN v_row.source END,
    'status', CASE WHEN v_admin THEN v_row.status END,
    'trial_ends_at', CASE WHEN v_admin THEN v_row.trial_ends_at END,
    'grant_until', CASE WHEN v_admin THEN v_row.grant_until END,
    'is_payer', v_payer IS NOT NULL AND v_payer = auth.uid(),
    'is_admin', v_admin,
    'limits', COALESCE((SELECT jsonb_object_agg(l.key, l.value) FROM plan_limits l WHERE l.plan = v_plan), '{}'::jsonb),
    'usage', public.bw_band_plan_usage(p_band_id),
    'checkout', v_admin AND v_checkout,
    'notice', CASE WHEN v_admin AND NOT v_enforced AND jsonb_typeof(v_notice) = 'object' THEN v_notice END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.bw_band_entitlements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_band_entitlements(uuid) TO authenticated;

COMMIT;
