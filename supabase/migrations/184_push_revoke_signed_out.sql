-- ============================================================================
-- 184 · Push revocation after an offline sign-out (audit 04 #6)
-- ----------------------------------------------------------------------------
-- Sign-out switches the device's push token off with bw_unregister_push_token
-- (046), which needs the user's session. Offline that call fails, sign-out
-- still succeeds on the device, and the server kept sending chat previews to
-- a phone nobody is signed in on.
--
-- The app now stops delivery on the device and keeps the revocation for when
-- it is online again, by then without a session. bw_revoke_push_token works
-- for anon too, and only:
--   * for the exact token and the account that signed out (both known only to
--     that device and the server);
--   * for exactly the registration the device saved: p_registered_at is the
--     row's own updated_at, read back by the app when it saved the token.
--     Any newer registration (a new sign-in, by the same or another
--     account) changes updated_at, so a late or replayed call never undoes
--     it. No device clock is compared with the server's (Codex review #287).
-- It can only switch a token off, never on, and returns whether it did.
--
-- Older app builds: nothing they call changes. Idempotent.
-- ============================================================================

BEGIN;

-- Not live anywhere yet; the parameter name changed.
DROP FUNCTION IF EXISTS public.bw_revoke_push_token(text, uuid, timestamptz);
CREATE FUNCTION public.bw_revoke_push_token(
  p_token text,
  p_user_id uuid,
  p_registered_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR length(p_token) > 4096
     OR p_user_id IS NULL OR p_registered_at IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.push_tokens
     SET is_active = false,
         updated_at = now()
   WHERE token = p_token
     AND user_id = p_user_id
     AND coalesce(is_active, true)
     AND updated_at = p_registered_at;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.bw_revoke_push_token(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_revoke_push_token(text, uuid, timestamptz) TO anon, authenticated, service_role;

COMMIT;
