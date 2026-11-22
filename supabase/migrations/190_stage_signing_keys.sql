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
--
-- Until that new pair is made the gig is "pending": members are told the
-- version with no public key, and refuse band-key states (anyone with the
-- band key can make one) until the new key arrives, instead of taking the
-- gig for one that never had a pair.

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
-- {public, version}; {public: null, version} after a rotation, until an
-- admin makes the new pair ("pending"); NULL before any pair was made at
-- all (or for a gig the caller can't see).
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
  -- No pair made yet: an answer (version 0), not a no. SQL NULL is only ever
  -- the server's no, and the phone then drops every key it kept for the gig
  -- (Codex on #288).
  IF ver IS NULL OR (k IS NULL AND ver <= 1) THEN
    RETURN jsonb_build_object('public', NULL, 'version', 0);
  END IF;
  -- k NULL past version 1: rotated, the new pair not made yet ("pending").
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
-- p_replace_public: an admin app whose stored pair doesn't work (its private
-- key doesn't sign for its public one) replaces it by naming that public
-- key; the version goes up, so members drop the broken one.
DROP FUNCTION IF EXISTS public.bw_stage_set_signer(uuid, text, text);
CREATE OR REPLACE FUNCTION public.bw_stage_set_signer(p_event_id uuid, p_public text, p_private text, p_replace_public text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  band uuid;
  pub_bytes bytea;
  priv_bytes bytea;
  pub text;
  priv text;
  ver integer;
BEGIN
  band := public.bw_stage_admin_band(p_event_id);
  IF band IS NULL THEN
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
  -- First the band's row, FOR KEY SHARE: a band being deleted holds it FOR
  -- UPDATE and then locks its members' rows (the cascade), so this waits for
  -- that before it locks an admin row, and the two can't deadlock. No
  -- trigger locks the band's row (they take its advisory lock, below), so
  -- nothing else waits on this (Claude on #288).
  PERFORM 1 FROM public.bands b WHERE b.id = band FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- Lock the caller's admin row, so this serialises with a demotion or a
  -- removal (bw_stage_rotate_signer). One that commits first: the locked
  -- re-check finds no admin row (READ COMMITTED re-reads it) and nothing is
  -- stored. One that comes later waits for this call, and its rotation then
  -- clears the pair stored here.
  PERFORM 1 FROM public.band_members bm
   WHERE bm.band_id = band AND bm.user_id = auth.uid()
     AND bm.role = 'admin' AND COALESCE(bm.is_active, true)
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- Then the gig's own row, and it must still be that band's: a move to
  -- another band in progress makes this wait, and the re-check under the
  -- lock then finds the new band and stores nothing (Codex on #288).
  -- FOR SHARE is enough for that (a move updates the row, which conflicts),
  -- and it doesn't block the foreign-key checks of rows pointing at the gig
  -- (bw_stage_key's insert below). Two admins storing at once both get it;
  -- the stage_keys update then lets only the first pair in (Claude round 7).
  PERFORM 1 FROM public.events e WHERE e.id = p_event_id AND e.band_id = band FOR SHARE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- Then the band's advisory lock, shared: a rotation (bw_stage_rotate_signer,
  -- bw_stage_event_moved, and 191's key triggers) takes it exclusive before it
  -- looks at the pairs, so a pair stored while another admin is demoted can't
  -- slip past it unseen (READ COMMITTED skips a row whose committed pair is
  -- still empty). An advisory lock, not the band's row (Claude round 8): a
  -- band delete holds that row and cascades into the members' and gigs' rows
  -- the triggers fire on; no delete takes this lock (191's
  -- bw_stage_member_left has the whole order).
  -- Tried, never waited for (Claude round 10): this already holds the admin
  -- row and the gig's row, and whoever holds the lock exclusive may need one
  -- of them next (an account being deleted: its membership first, then its
  -- gigs' rows), which would be a cycle. Busy for a moment: the app is told
  -- to ask again (40001; stageBleNative's ask does).
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('bw-stage-band:' || band::text, 0)) THEN
    RAISE EXCEPTION 'stage keys are changing, try again' USING ERRCODE = '40001';
  END IF;
  -- The row (and the band key) are made on first use.
  PERFORM public.bw_stage_key(p_event_id);
  UPDATE public.stage_keys
     SET sign_public = p_public, sign_private = p_private,
         sign_version = sign_version + CASE WHEN sign_public IS NULL THEN 0 ELSE 1 END
   WHERE event_id = p_event_id
     AND (sign_public IS NULL OR (p_replace_public IS NOT NULL AND sign_public = p_replace_public));
  SELECT s.sign_public, s.sign_private, s.sign_version INTO pub, priv, ver FROM public.stage_keys s WHERE s.event_id = p_event_id;
  RETURN jsonb_build_object('public', pub, 'private', priv, 'version', ver);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bw_stage_set_signer(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_stage_set_signer(uuid, text, text, text) TO authenticated;

-- An admin stops being one (demoted, inactive, removed, moved): the band's
-- gig pairs are cleared and their version goes up. Their phone may keep the
-- old private key, but members with the new public key (and the new version)
-- refuse what it signs, and until then refuse band-key states ("pending").
-- Only gigs that had a real pair (one now, or a version past 1): one that
-- never had one (a band whose admins are all on 383f15b, which never makes
-- one) stays as it was, so members keep following its band-key state
-- instead of waiting for a pair nobody makes. The band's advisory lock is
-- taken first (bw_stage_set_signer needs it shared): a pair being stored meanwhile is
-- either committed before this looks (and cleared) or stored after the
-- demotion is (when the demoted admin can't fetch it).
-- Note for older apps: after an admin's role change, a gig that had a pair
-- needs an admin on this app to open it online once (Academy, Stage mode).
CREATE OR REPLACE FUNCTION public.bw_stage_rotate_signer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- The band itself going (its members go with it): its gigs and their pairs
  -- go too, nothing to clear and no lock to take (Claude round 10; see 191's
  -- bw_stage_member_left).
  IF NOT EXISTS (SELECT 1 FROM public.bands b WHERE b.id = OLD.band_id) THEN
    RETURN NULL;
  END IF;
  IF OLD.role = 'admin' AND COALESCE(OLD.is_active, true)
     AND (TG_OP = 'DELETE'
          OR NEW.role IS DISTINCT FROM 'admin'
          OR NOT COALESCE(NEW.is_active, true)
          OR NEW.band_id IS DISTINCT FROM OLD.band_id
          OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    -- The band's advisory lock, exclusive: waits for a shared one held (bw_stage_set_signer, bw_stage_key's first use).
    PERFORM pg_advisory_xact_lock(hashtextextended('bw-stage-band:' || OLD.band_id::text, 0));
    UPDATE public.stage_keys s
       SET sign_public = NULL, sign_private = NULL, sign_version = s.sign_version + 1
      FROM public.events e
     WHERE e.id = s.event_id AND e.band_id = OLD.band_id
       AND (s.sign_public IS NOT NULL OR s.sign_version > 1);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bw_stage_rotate_signer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_stage_rotate_signer ON public.band_members;
CREATE TRIGGER bw_stage_rotate_signer
  AFTER UPDATE OF role, is_active, band_id, user_id OR DELETE ON public.band_members
  FOR EACH ROW EXECUTE FUNCTION public.bw_stage_rotate_signer();

-- A gig moved to another band: its pair goes and its version goes up, like
-- a demotion, so the old band's admins (who may keep the private key on
-- their phone) lead nobody there. (Its band key is changed by 191.)
CREATE OR REPLACE FUNCTION public.bw_stage_event_moved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.band_id IS DISTINCT FROM OLD.band_id THEN
    -- As in bw_stage_rotate_signer: an old-band admin storing a pair meanwhile waits, then finds the gig moved.
    PERFORM pg_advisory_xact_lock(hashtextextended('bw-stage-band:' || OLD.band_id::text, 0));
    UPDATE public.stage_keys s
       SET sign_public = NULL, sign_private = NULL, sign_version = s.sign_version + 1
     WHERE s.event_id = NEW.id
       AND (s.sign_public IS NOT NULL OR s.sign_version > 1);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bw_stage_event_moved() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_stage_event_moved ON public.events;
CREATE TRIGGER bw_stage_event_moved
  AFTER UPDATE OF band_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.bw_stage_event_moved();

-- 178 (date on hold) hides a tentative quote from every member, lineup
-- included, through bw_can_view_event; spelled out here too, as in the stage
-- key and topic (191), when 178 is in (it comes first in the release order).
DO $$
DECLARE
  def text;
BEGIN
  IF to_regprocedure('public.bw_event_quote_hidden(uuid, uuid)') IS NULL THEN
    RETURN;
  END IF;
  def := pg_get_functiondef('public.bw_stage_verify_key(uuid)'::regprocedure);
  IF position('bw_event_quote_hidden' IN def) > 0 THEN
    RETURN;
  END IF;
  IF position('OR NOT public.bw_can_view_event(p_event_id) THEN' IN def) = 0 THEN
    RAISE EXCEPTION 'bw_stage_verify_key is not the expected body';
  END IF;
  EXECUTE replace(def, 'OR NOT public.bw_can_view_event(p_event_id) THEN',
    'OR NOT public.bw_can_view_event(p_event_id) OR public.bw_event_quote_hidden(p_event_id) THEN');
END $$;
