-- ====================================================================
-- 121: one APNs provider token for every send-push instance
--
-- Apple accepts a new provider token (the signed JWT) at most once every
-- 20 minutes and expires it after 60. send-push kept the token in memory,
-- but the edge runtime starts new instances all the time, so almost every
-- push signed a fresh token and Apple answered 429
-- TooManyProviderTokenUpdates: iOS pushes (chat included) were dropped.
--
-- The token now lives here, shared by every instance. bw_apns_token_claim:
--   * returns the stored token while it is younger than p_max_age seconds
--     and is not the one the caller just saw rejected (p_reject);
--   * otherwise stores the caller's freshly signed p_candidate (with its
--     iat, p_issued_at) and returns it, or returns NULL when the caller has
--     no candidate yet (it then signs one and calls again).
-- The row lock makes concurrent instances agree on one token.
--
-- Only the service role (send-push) can use it. Safe to run more than once.
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.bw_apns_provider_token (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token text,
  issued_at timestamptz
);

ALTER TABLE public.bw_apns_provider_token ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bw_apns_provider_token FROM PUBLIC, anon, authenticated;

INSERT INTO public.bw_apns_provider_token (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bw_apns_token_claim(
  p_candidate text DEFAULT NULL,
  p_issued_at bigint DEFAULT NULL,
  p_reject text DEFAULT NULL,
  p_max_age integer DEFAULT 2700
)
RETURNS TABLE (token text, issued_at bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r public.bw_apns_provider_token%ROWTYPE;
BEGIN
  INSERT INTO public.bw_apns_provider_token (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO r FROM public.bw_apns_provider_token WHERE id = 1 FOR UPDATE;

  IF r.token IS NOT NULL
     AND r.issued_at > now() - make_interval(secs => p_max_age)
     AND r.token IS DISTINCT FROM p_reject THEN
    RETURN QUERY SELECT r.token, extract(epoch FROM r.issued_at)::bigint;
    RETURN;
  END IF;

  IF p_candidate IS NULL OR p_issued_at IS NULL THEN
    RETURN QUERY SELECT NULL::text, NULL::bigint;
    RETURN;
  END IF;

  UPDATE public.bw_apns_provider_token
     SET token = p_candidate, issued_at = to_timestamp(p_issued_at)
   WHERE id = 1;
  RETURN QUERY SELECT p_candidate, p_issued_at;
END;
$$;

REVOKE ALL ON FUNCTION public.bw_apns_token_claim(text, bigint, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_apns_token_claim(text, bigint, text, integer) TO service_role;
