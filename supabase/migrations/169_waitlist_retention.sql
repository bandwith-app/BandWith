-- 169: Waitlist retention, as promised in the Privacy Policy (bandwith.fun):
-- a waitlist email is deleted once that person has an account, and at the
-- latest 12 months after they joined. Runs daily with pg_cron.
--
-- Test: supabase/tests/waitlist_retention.sql (runs in a transaction, rolls back).

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_prune_waitlist()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.beta_waitlist w
   WHERE w.created_at < now() - interval '12 months'
      OR EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = w.email);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_prune_waitlist() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('bw-prune-waitlist')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-prune-waitlist');
  PERFORM cron.schedule('bw-prune-waitlist', '40 3 * * *', 'SELECT public.bw_prune_waitlist()');
END;
$$;

COMMIT;
