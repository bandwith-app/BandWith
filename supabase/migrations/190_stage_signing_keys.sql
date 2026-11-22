-- Stage mode over Bluetooth: only admins can lead (audit #1).
--
-- The band key of migration 087 is the same for every member: it finds the
-- gig's Bluetooth service, and it also signed the leader's messages, so any
-- member could pose as the leader. Each gig now also gets an ECDSA P-256 key
-- pair: the private key reaches only the band's admins (bw_stage_signer),
-- members get the public key (bw_stage_verify_key) and check the leader's
-- signature with it. The band key still derives the service id.
--
-- Postgres can't make P-256 keys, so the first admin app that needs one makes
-- it and stores it with bw_stage_set_signer; the first stored pair wins.
-- stage_keys keeps RLS on with no policies: reached only through these
-- functions, nothing for anon.
--
-- An admin who stops being one (demoted, made inactive, removed from the
-- band) may still hold the private key on their phone. So the band's gig
-- pairs are cleared and their version goes up (bw_stage_rotate_signer): the
-- next admin who opens the gig makes a new pair, members fetch the new public
-- key, and the leader's messages carry the version, so a member's app knows
-- when its key is out of date. Apps fetch the keys from here first and use
-- their copy only offline, and drop it when the server says no.

ALTER TABLE public.stage_keys
  ADD COLUMN IF NOT EXISTS sign_public text,
  ADD COLUMN IF NOT EXISTS sign_private text,
  ADD COLUMN IF NOT EXISTS sign_version integer NOT NULL DEFAULT 1;

-- The gig's band, when the caller is one of its admins.
CREATE OR REPLACE FUNCTION public.bw_stage_admin_band(p_event_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  band uuid;
BEGIN
  IF auth.uid() IS NULL OR p_event_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT e.band_id INTO band FROM public.events e WHERE e.id = p_event_id;
  IF band IS NULL OR NOT public.bw_is_band_admin(band) THEN
    RETURN NULL;
  END IF;
  RETURN band;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bw_stage_admin_band(uuid) FROM PUBLIC, anon, authenticated;

-- Members: the gig's public key (base64, 65 raw bytes) and its version, as
-- {public, version}, or NULL before an admin made the pair (or for a gig the
-- caller can't see).
DROP FUNCTION IF EXISTS public.bw_stage_verify_key(uuid);
CREATE FUNCTION public.bw_stage_verify_key(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  band uuid;
  k text;
  ver integer;
BEGIN
  IF auth.uid() IS NULL OR p_event_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT e.band_id INTO band FROM public.events e WHERE e.id = p_event_id;
  IF band IS NULL OR NOT public.bw_is_band_member(band) OR NOT public.bw_can_view_event(p_event_id) THEN
    RETURN NULL;
  END IF;
  SELECT s.sign_public, s.sign_version INTO k, ver FROM public.stage_keys s WHERE s.event_id = p_event_id;
  IF k IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('public', k, 'version', ver);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bw_stage_verify_key(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_stage_verify_key(uuid) TO authenticated;

-- Admins: the gig's key pair {public, private, version}, or NULL when it has none yet
-- (or the caller isn't an admin of the gig's band).
CREATE OR REPLACE FUNCTION public.bw_stage_signer(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pub text;
  priv text;
  ver integer;
BEGIN
  IF public.bw_stage_admin_band(p_event_id) IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT s.sign_public, s.sign_private, s.sign_version INTO pub, priv, ver FROM public.stage_keys s WHERE s.event_id = p_event_id;
  IF pub IS NULL OR priv IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('public', pub, 'private', priv, 'version', ver);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bw_stage_signer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_stage_signer(uuid) TO authenticated;

-- Admins: store a new key pair for the gig; the first stored pair wins, and
-- the stored one is returned (so two admins starting together agree).
CREATE OR REPLACE FUNCTION public.bw_stage_set_signer(p_event_id uuid, p_public text, p_private text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pub_bytes bytea;
  priv_bytes bytea;
  pub text;
  priv text;
  ver integer;
BEGIN
  IF public.bw_stage_admin_band(p_event_id) IS NULL THEN
    RETURN NULL;
  END IF;
  -- decode(NULL) is NULL, and NULL passes every length check below.
  IF p_public IS NULL OR p_private IS NULL THEN
    RAISE EXCEPTION 'bad stage key' USING ERRCODE = '22023';
  END IF;
  BEGIN
    pub_bytes := decode(p_public, 'base64');
    priv_bytes := decode(p_private, 'base64');
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'bad stage key' USING ERRCODE = '22023';
  END;
  -- A raw uncompressed P-256 point, and a PKCS#8 P-256 private key.
  IF length(pub_bytes) <> 65 OR get_byte(pub_bytes, 0) <> 4
     OR length(priv_bytes) < 60 OR length(priv_bytes) > 200 THEN
    RAISE EXCEPTION 'bad stage key' USING ERRCODE = '22023';
  END IF;
  -- The row (and the band key) are made on first use.
  PERFORM public.bw_stage_key(p_event_id);
  UPDATE public.stage_keys
     SET sign_public = p_public, sign_private = p_private
   WHERE event_id = p_event_id AND sign_public IS NULL;
  SELECT s.sign_public, s.sign_private, s.sign_version INTO pub, priv, ver FROM public.stage_keys s WHERE s.event_id = p_event_id;
  RETURN jsonb_build_object('public', pub, 'private', priv, 'version', ver);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bw_stage_set_signer(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_stage_set_signer(uuid, text, text) TO authenticated;

-- An admin stops being one (demoted, inactive, removed, moved): the band's
-- gig pairs are cleared and their version goes up. Their phone may keep the
-- old private key, but members with the new public key (and the new
-- version) refuse what it signs.
CREATE OR REPLACE FUNCTION public.bw_stage_rotate_signer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.role = 'admin' AND COALESCE(OLD.is_active, true)
     AND (TG_OP = 'DELETE'
          OR NEW.role IS DISTINCT FROM 'admin'
          OR NOT COALESCE(NEW.is_active, true)
          OR NEW.band_id IS DISTINCT FROM OLD.band_id
          OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    UPDATE public.stage_keys s
       SET sign_public = NULL, sign_private = NULL, sign_version = s.sign_version + 1
      FROM public.events e
     WHERE e.id = s.event_id AND e.band_id = OLD.band_id AND s.sign_public IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bw_stage_rotate_signer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_stage_rotate_signer ON public.band_members;
CREATE TRIGGER bw_stage_rotate_signer
  AFTER UPDATE OF role, is_active, band_id, user_id OR DELETE ON public.band_members
  FOR EACH ROW EXECUTE FUNCTION public.bw_stage_rotate_signer();
