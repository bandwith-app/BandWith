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

ALTER TABLE public.stage_keys
  ADD COLUMN IF NOT EXISTS sign_public text,
  ADD COLUMN IF NOT EXISTS sign_private text;

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

-- Members: the gig's public key (base64, 65 raw bytes), or NULL before an
-- admin made the pair.
CREATE OR REPLACE FUNCTION public.bw_stage_verify_key(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  band uuid;
  k text;
BEGIN
  IF auth.uid() IS NULL OR p_event_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT e.band_id INTO band FROM public.events e WHERE e.id = p_event_id;
  IF band IS NULL OR NOT public.bw_is_band_member(band) THEN
    RETURN NULL;
  END IF;
  SELECT s.sign_public INTO k FROM public.stage_keys s WHERE s.event_id = p_event_id;
  RETURN k;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bw_stage_verify_key(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_stage_verify_key(uuid) TO authenticated;

-- Admins: the gig's key pair {public, private}, or NULL when it has none yet
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
BEGIN
  IF public.bw_stage_admin_band(p_event_id) IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT s.sign_public, s.sign_private INTO pub, priv FROM public.stage_keys s WHERE s.event_id = p_event_id;
  IF pub IS NULL OR priv IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('public', pub, 'private', priv);
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
BEGIN
  IF public.bw_stage_admin_band(p_event_id) IS NULL THEN
    RETURN NULL;
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
  SELECT s.sign_public, s.sign_private INTO pub, priv FROM public.stage_keys s WHERE s.event_id = p_event_id;
  RETURN jsonb_build_object('public', pub, 'private', priv);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bw_stage_set_signer(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_stage_set_signer(uuid, text, text) TO authenticated;
