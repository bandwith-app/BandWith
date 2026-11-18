-- 128: Beta capacity. 300 spots, 45 of them kept for band invites, and a waitlist.
--
-- What we can serve well today is about 300 active people (free plans:
-- egress, realtime connections, emails per day). A spot is one account:
-- downloads of the APK or TestFlight installs cost nothing until someone
-- creates an account, so the limit sits where the account is created.
--
-- * beta_capacity: one row, total and reserved. Change the numbers with an
--   UPDATE (no migration needed). Deleting the row removes the limit.
-- * Who counts (bw_beta_taken): every account, except anonymous ones,
--   accounts listed in beta_capacity_exempt (our own test and review
--   accounts), and email sign-ups never confirmed after 2 days.
-- * The gate (trigger bw_beta_gate, BEFORE INSERT on auth.users):
--     taken <  total - reserved            → anyone gets in;
--     taken <  total, the email is invited → gets in (the reserve);
--     otherwise                            → the sign-up fails.
--   "Invited" = a pending, unexpired band invitation for that email, or a
--   deputy saved with that email and not linked to an account yet.
--   Auth answers a refused sign-up with "Database error saving new user";
--   the app shows it as "BandWith is full" (src/lib/authErrors.ts).
-- * bw_capacity_status(): public totals for the site's counter (no personal
--   data). state: open (public spots left) | invites (only band invites) |
--   full.
-- * bw_join_waitlist(email, ...): the site's waitlist form. Nobody can read
--   the waitlist through the API; read it from the dashboard.
--
-- Test: supabase/tests/beta_capacity.sql (runs in a transaction, rolls back).

-- ── Settings ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.beta_capacity (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  total      integer NOT NULL CHECK (total >= 0),
  reserved   integer NOT NULL CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved <= total)
);
INSERT INTO public.beta_capacity (id, total, reserved) VALUES (true, 300, 45)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.beta_capacity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.beta_capacity FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.beta_capacity_exempt (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.beta_capacity_exempt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.beta_capacity_exempt FROM anon, authenticated;

-- ── Waitlist ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.beta_waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  email      text NOT NULL UNIQUE CHECK (
               email = lower(email)
               AND char_length(email) <= 254
               AND email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
             ),
  platform   text NOT NULL DEFAULT '' CHECK (platform IN ('', 'web', 'android', 'ios')),
  locale     text NOT NULL DEFAULT '' CHECK (char_length(locale) <= 35),
  source     text NOT NULL DEFAULT 'site' CHECK (char_length(source) <= 30),
  invited_at timestamptz
);
ALTER TABLE public.beta_waitlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.beta_waitlist FROM anon, authenticated;

-- ── Who counts ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bw_beta_taken()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::integer
  FROM auth.users u
  WHERE NOT coalesce(u.is_anonymous, false)
    AND u.deleted_at IS NULL
    AND (u.email_confirmed_at IS NOT NULL OR u.created_at > now() - interval '2 days')
    AND NOT EXISTS (SELECT 1 FROM public.beta_capacity_exempt e WHERE e.user_id = u.id);
$$;

CREATE OR REPLACE FUNCTION public.bw_beta_is_invited(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(btrim(p_email), '') <> '' AND (
    EXISTS (
      SELECT 1 FROM public.band_invitations bi
      WHERE bi.email = lower(btrim(p_email))
        AND bi.status = 'pending'
        AND (bi.expires_at IS NULL OR bi.expires_at > now())
    )
    OR EXISTS (
      SELECT 1 FROM public.band_deputies d
      WHERE lower(btrim(d.email)) = lower(btrim(p_email))
        AND d.user_id IS NULL
    )
  );
$$;

REVOKE ALL ON FUNCTION public.bw_beta_taken() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_beta_is_invited(text) FROM PUBLIC, anon, authenticated;

-- ── The gate ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bw_beta_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c public.beta_capacity;
  v_taken integer;
BEGIN
  IF coalesce(NEW.is_anonymous, false) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO c FROM public.beta_capacity WHERE id;
  IF NOT FOUND THEN
    RETURN NEW; -- no settings row: no limit
  END IF;
  -- One sign-up at a time, so two people can't both take the last spot.
  PERFORM pg_advisory_xact_lock(hashtext('bw_beta_gate'));
  v_taken := public.bw_beta_taken();
  IF v_taken < c.total - c.reserved THEN
    RETURN NEW;
  END IF;
  IF v_taken < c.total AND public.bw_beta_is_invited(NEW.email) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'bw_beta_full' USING ERRCODE = 'P0001', HINT = 'Every BandWith beta spot is taken.';
END;
$$;
REVOKE ALL ON FUNCTION public.bw_beta_gate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_beta_gate ON auth.users;
CREATE TRIGGER bw_beta_gate
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.bw_beta_gate();

-- ── Public counter ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bw_capacity_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c public.beta_capacity;
  v_taken integer;
  v_public integer;
  v_invite integer;
BEGIN
  SELECT * INTO c FROM public.beta_capacity WHERE id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'open', 'cap', NULL);
  END IF;
  v_taken  := public.bw_beta_taken();
  v_public := greatest(0, c.total - c.reserved - v_taken);
  v_invite := greatest(0, c.total - v_taken);
  RETURN jsonb_build_object(
    'cap', c.total,
    'reserved', c.reserved,
    'taken', least(v_taken, c.total),
    'public_left', v_public,
    'invite_left', v_invite,
    'state', CASE WHEN v_public > 0 THEN 'open' WHEN v_invite > 0 THEN 'invites' ELSE 'full' END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_capacity_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_capacity_status() TO anon, authenticated;

-- ── Waitlist form ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bw_join_waitlist(
  p_email text,
  p_platform text DEFAULT '',
  p_locale text DEFAULT '',
  p_source text DEFAULT 'site'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_created timestamptz;
  v_already boolean := false;
BEGIN
  IF char_length(v_email) > 254 OR v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  INSERT INTO public.beta_waitlist (email, platform, locale, source)
  VALUES (
    v_email,
    CASE WHEN p_platform IN ('web', 'android', 'ios') THEN p_platform ELSE '' END,
    left(coalesce(p_locale, ''), 35),
    left(coalesce(nullif(btrim(p_source), ''), 'site'), 30)
  )
  ON CONFLICT (email) DO NOTHING
  RETURNING created_at INTO v_created;

  IF v_created IS NULL THEN
    v_already := true;
    SELECT w.created_at INTO v_created FROM public.beta_waitlist w WHERE w.email = v_email;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already', v_already,
    'position', (SELECT count(*) FROM public.beta_waitlist w WHERE w.invited_at IS NULL AND w.created_at <= v_created)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bw_join_waitlist(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_join_waitlist(text, text, text, text) TO anon, authenticated;
