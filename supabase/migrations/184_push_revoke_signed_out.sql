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
--     row's own updated_at, returned to the app by the save (below).
--     Any newer registration (a new sign-in, by the same or another
--     account) changes updated_at, so a late or replayed call never undoes
--     it. No device clock is compared with the server's (Codex review #287).
--   * p_registered_at NULL (Codex review #287 round 3): the device never
--     learned its stamp (a registration made by an older build, then the
--     first start after the upgrade offline; or a save whose reply was
--     lost). Then the exact token and account must match. The token is the
--     key: only that device and the server hold it (push_tokens is readable
--     by its owner only). The app drops such a revocation before it saves
--     the token again for the same account, and waits for a flush on its
--     way, so it never lands after a new registration from that device.
-- It can only switch a token off, never on, and returns whether it did.
--
-- bw_register_push_token_stamped (Codex review #287 round 2): the same save
-- as bw_register_push_token (046), returning that updated_at in the same
-- reply. The app read it back with a second request, and a connection lost
-- between the two left it without the stamp, so a later offline sign-out
-- could not be queued.
--
-- Older app builds: nothing they call changes (bw_register_push_token keeps
-- its shape and body; the new app falls back to it when this migration is
-- not applied yet). Idempotent.
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
     OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.push_tokens
     SET is_active = false,
         updated_at = now()
   WHERE token = p_token
     AND user_id = p_user_id
     AND coalesce(is_active, true)
     AND (p_registered_at IS NULL OR updated_at = p_registered_at);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.bw_revoke_push_token(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_revoke_push_token(text, uuid, timestamptz) TO anon, authenticated, service_role;

-- The save of 046's bw_register_push_token, plus the stamp it wrote.
CREATE OR REPLACE FUNCTION public.bw_register_push_token_stamped(p_token text, p_platform text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_token IS NULL OR length(p_token) < 10 OR length(p_token) > 4096 THEN RAISE EXCEPTION 'Invalid token'; END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android', 'web') THEN RAISE EXCEPTION 'Invalid platform'; END IF;

  INSERT INTO public.push_tokens (user_id, token, platform, is_active, updated_at)
  VALUES (v_uid, p_token, p_platform, true, now())
  ON CONFLICT (token) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        platform = EXCLUDED.platform,
        is_active = true,
        updated_at = now()
  RETURNING updated_at INTO v_at;
  RETURN v_at;
END;
$$;

REVOKE ALL ON FUNCTION public.bw_register_push_token_stamped(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_register_push_token_stamped(text, text) TO authenticated, service_role;

COMMIT;
