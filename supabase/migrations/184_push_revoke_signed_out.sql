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
--   * for the exact token and the account that signed out;
--   * signed out (anon): with the revocation secret of exactly that
--     registration (Codex review #287 round 4). The device makes a random
--     secret, keeps it, and sends it with the save
--     (bw_register_push_token_stamped); the row stores only its sha256.
--     When no secret matches, by token, account and the exact stamp
--     (push_tokens.updated_at, microseconds) that registration's save
--     returned to the device (main's decision, round 6): a former user of a
--     shared iPad holds the token and a bandmate's id, but not the stamp of
--     the bandmate's own save; a NULL stamp is never enough. Every new registration
--     rotates the secret; any other change of the registration (a re-save by
--     046, a move to another account, a switch back on) clears it (trigger),
--     so a replayed call never undoes a newer registration. Signed out, the
--     answer says only whether the credential matched that registration (on
--     or already off), never whether the account is on the device (round 8).
--   * signed in as the row's owner: the own token, with the row's stamp
--     (push_tokens.updated_at, returned by the save) or without one.
-- It can only switch a token off, never on. Signed in as the owner it
-- returns whether it switched (or nothing of the owner's is on); signed out,
-- whether the credential matched.
--
-- No lookup by token (main's decision on #287 round 5). The device keeps a
-- refused revocation and tries again with backoff until the server takes it,
-- a confirmed save of the token on the device makes it moot, or 30 days have
-- passed since its first refusal, or the device's token changed (rounds 8-10).
-- bw_push_token_registered, from an earlier draft that was never live, is
-- dropped.
--
-- push_tokens.uid_gated (Codex review #287 round 5): the token belongs to an
-- Android build that shows a push only when it is for the account signed in
-- on the device (checked natively, cleared at sign-out before anything goes
-- out). send-push gives those tokens data-only messages tagged with the
-- recipient; every other token keeps the notification message, because an
-- older APK shows nothing for a data-only message in the background. Only the
-- new save sets it; any other change of the registration clears it, like the
-- secret.
--
-- bw_register_push_token_stamped (Codex review #287 round 2): the same save
-- as bw_register_push_token (046), storing the secret's hash and returning
-- the row's updated_at in the same reply.
--
-- bw_unregister_push_token (046) now returns whether it switched a token off
-- (Codex review #287 round 6): "no error" for 0 rows (the token is still
-- another account's) is not a revocation. Same name and argument; older
-- builds read only the error, so the return type is all that changes (DROP +
-- CREATE, as Postgres requires for a new return type).
--
-- Older app builds: nothing they call changes shape (bw_register_push_token
-- keeps its shape and body; bw_unregister_push_token its name, argument and
-- update). They never queued a
-- signed-out revocation. What a registration they made loses: it has no
-- secret, so a later signed-out revocation of it is refused; signed in, the
-- owner still switches it off. The new app falls back to 046 when this
-- migration is not applied yet. Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS revoke_secret_hash text;
ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS uid_gated boolean NOT NULL DEFAULT false;

-- revoke_secret_hash and uid_gated are written only by the stamped save,
-- which sets the transaction-local GUC bw.push_secret_set around its upsert
-- (a client can't set it: PostgREST runs no SET, and set_config isn't
-- exposed). Any other write keeps them as they were (Claude review #287
-- round 5: the owner can update its own rows through RLS), and any other
-- change of the registration (a re-save by 046, a move, a switch-off)
-- clears them, except that a switch-off alone keeps the secret (round 8).
-- An insert by
-- anything else starts with neither.
CREATE OR REPLACE FUNCTION public.bw_push_tokens_secret_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(current_setting('bw.push_secret_set', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.revoke_secret_hash := NULL;
    NEW.uid_gated := false;
    RETURN NEW;
  END IF;
  NEW.revoke_secret_hash := OLD.revoke_secret_hash;
  NEW.uid_gated := OLD.uid_gated;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.token IS DISTINCT FROM OLD.token
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    NEW.uid_gated := false;
    -- A switch-off alone (send-push after an APNs 410, a revocation) keeps
    -- the secret: that registration delivers nothing, and a late revocation
    -- with its secret still gets its true (Codex review #287 round 8, B1).
    -- Anything that leaves the row on again, or moves it, clears it.
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.token IS DISTINCT FROM OLD.token
       OR coalesce(NEW.is_active, true) THEN
      NEW.revoke_secret_hash := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_push_tokens_secret_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_push_tokens_secret_guard ON public.push_tokens;
CREATE TRIGGER bw_push_tokens_secret_guard
  BEFORE INSERT OR UPDATE ON public.push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.bw_push_tokens_secret_guard();

-- Not live anywhere yet: earlier drafts had other parameters.
DROP FUNCTION IF EXISTS public.bw_revoke_push_token(text, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.bw_revoke_push_token(text, uuid, timestamptz, text);
CREATE FUNCTION public.bw_revoke_push_token(
  p_token text,
  p_user_id uuid,
  p_registered_at timestamptz DEFAULT NULL,
  p_secret text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_hash text;
BEGIN
  -- The same token lengths the save takes (10+, Claude review #287 r7 C4).
  IF p_token IS NULL OR length(p_token) < 10 OR length(p_token) > 4096
     OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_uid IS NOT NULL AND v_uid = p_user_id AND p_secret IS NULL THEN
    -- The owner, signed in: nothing of the own account is on for this token
    -- any more (switched off after an APNs 410 or an earlier revocation, or
    -- the rows went with the account): done (Claude review #287 round 7, C2).
    -- Only here: the owner may know about the own rows.
    IF NOT EXISTS (
      SELECT 1 FROM public.push_tokens
       WHERE token = p_token AND user_id = p_user_id AND coalesce(is_active, true)
    ) THEN
      RETURN true;
    END IF;
    -- The own token, at that stamp or any.
    UPDATE public.push_tokens
       SET is_active = false, updated_at = now()
     WHERE token = p_token
       AND user_id = p_user_id
       AND coalesce(is_active, true)
       AND (p_registered_at IS NULL OR updated_at = p_registered_at);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count > 0;
  END IF;

  -- Anyone else, signed out included (Codex review #287 round 8, B1): the
  -- answer says only whether the credential given matches a registration of
  -- (token, account), on or already off. Without a matching credential it is
  -- always false, whether that account's row is on, off or absent, so the
  -- token and a bandmate's id never tell whether that bandmate uses this
  -- device. A revocation that can't match any more (its row cleared or
  -- gone) is dropped by the device after 30 days, or once its token changed.
  IF p_secret IS NOT NULL AND length(p_secret) BETWEEN 32 AND 256 THEN
    v_hash := encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
    IF EXISTS (
      SELECT 1 FROM public.push_tokens
       WHERE token = p_token AND user_id = p_user_id
         AND revoke_secret_hash IS NOT NULL AND revoke_secret_hash = v_hash
    ) THEN
      -- The switch-off keeps the secret (the guard keeps it on a row that
      -- goes off) and the stamp (no updated_at bump, as send-push switches
      -- off), so a replay after a lost answer still answers true (round 10);
      -- any new registration changes the stamp and replaces or clears it.
      UPDATE public.push_tokens
         SET is_active = false
       WHERE token = p_token AND user_id = p_user_id
         AND coalesce(is_active, true) AND revoke_secret_hash = v_hash;
      RETURN true;
    END IF;
  END IF;
  -- No secret matched (a registration by an older build or a database
  -- without 184 has none; a lost answer left the device unsure): exactly
  -- the registration the device saved, by token, account and the stamp the
  -- save returned (main's decision on #287 round 6). Any later save
  -- changes the stamp, so a replay never undoes a newer registration. The
  -- switch-off leaves the stamp as it is (round 10): a replay after a lost
  -- answer finds the same registration, now off, and answers true.
  IF p_registered_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.push_tokens
     WHERE token = p_token AND user_id = p_user_id AND updated_at = p_registered_at
  ) THEN
    UPDATE public.push_tokens
       SET is_active = false
     WHERE token = p_token AND user_id = p_user_id
       AND coalesce(is_active, true) AND updated_at = p_registered_at;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.bw_revoke_push_token(text, uuid, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_revoke_push_token(text, uuid, timestamptz, text) TO anon, authenticated, service_role;

-- 046's sign-out, now telling whether it switched something off.
DROP FUNCTION IF EXISTS public.bw_unregister_push_token(text);
CREATE FUNCTION public.bw_unregister_push_token(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.push_tokens SET is_active = false, updated_at = now()
  WHERE token = p_token AND user_id = auth.uid();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_unregister_push_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_unregister_push_token(text) TO authenticated;

-- From earlier drafts, never live: no lookup by token at all.
DROP FUNCTION IF EXISTS public.bw_push_token_registered(text, uuid);
DROP FUNCTION IF EXISTS public.bw_push_token_registered(text, uuid, text);

-- The save of 046's bw_register_push_token, plus the revocation secret's
-- hash and the stamp it wrote. Not live anywhere yet: the earlier draft
-- returned only the stamp.
DROP FUNCTION IF EXISTS public.bw_register_push_token_stamped(text, text);
DROP FUNCTION IF EXISTS public.bw_register_push_token_stamped(text, text, text);
DROP FUNCTION IF EXISTS public.bw_register_push_token_stamped(text, text, text, boolean);
CREATE FUNCTION public.bw_register_push_token_stamped(
  p_token text,
  p_platform text,
  p_secret text DEFAULT NULL,
  p_uid_gated boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_at timestamptz;
  v_secret text := p_secret;
  v_made boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_token IS NULL OR length(p_token) < 10 OR length(p_token) > 4096 THEN RAISE EXCEPTION 'Invalid token'; END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android', 'web') THEN RAISE EXCEPTION 'Invalid platform'; END IF;
  IF v_secret IS NULL THEN
    v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    v_made := true;
  ELSIF length(v_secret) < 32 OR length(v_secret) > 256 THEN
    RAISE EXCEPTION 'Invalid secret';
  END IF;

  PERFORM set_config('bw.push_secret_set', 'on', true);
  INSERT INTO public.push_tokens (user_id, token, platform, is_active, updated_at, revoke_secret_hash, uid_gated)
  VALUES (v_uid, p_token, p_platform, true, now(), encode(sha256(convert_to(v_secret, 'UTF8')), 'hex'),
          coalesce(p_uid_gated, false) AND p_platform = 'android')
  ON CONFLICT (token) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        platform = EXCLUDED.platform,
        is_active = true,
        updated_at = now(),
        revoke_secret_hash = EXCLUDED.revoke_secret_hash,
        uid_gated = EXCLUDED.uid_gated
  RETURNING updated_at INTO v_at;
  PERFORM set_config('bw.push_secret_set', '', true);

  RETURN jsonb_build_object('registered_at', v_at, 'secret', CASE WHEN v_made THEN v_secret END);
END;
$$;

REVOKE ALL ON FUNCTION public.bw_register_push_token_stamped(text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_register_push_token_stamped(text, text, text, boolean) TO authenticated, service_role;

COMMIT;
