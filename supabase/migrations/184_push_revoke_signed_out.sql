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
--   * if the token was not registered again after the sign-out (a new
--     sign-in on the device sets updated_at later), so it never undoes a
--     newer registration, by the same or another account.
-- It can only switch a token off, never on, and returns whether it did.
--
-- Older app builds: nothing they call changes. Idempotent.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_revoke_push_token(
  p_token text,
  p_user_id uuid,
  p_signed_out_at timestamptz
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
     OR p_user_id IS NULL OR p_signed_out_at IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.push_tokens
     SET is_active = false,
         updated_at = now()
   WHERE token = p_token
     AND user_id = p_user_id
     AND coalesce(is_active, true)
     AND (updated_at IS NULL OR updated_at <= p_signed_out_at);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.bw_revoke_push_token(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_revoke_push_token(text, uuid, timestamptz) TO anon, authenticated, service_role;

COMMIT;
