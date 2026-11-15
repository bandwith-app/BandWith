-- 113 · band_members: a band always keeps an admin; joiners get their
-- instrument.
--
-- Part 1 · A band always keeps an admin.
--
-- BandMembersView blocks removing or demoting the last admin, but the
-- database did not: band_members_delete_policy lets anyone delete their own
-- row and bw_guard_band_member_update (071) does not count admins, so a
-- direct call could leave an active band with members and no admin (nobody
-- could then manage gigs, the lineup, fees or invitations).
--
-- This trigger refuses any change that takes away the last active admin of a
-- band that still has other active members: demoting them (role), making
-- them inactive (is_active false) or deleting their row. It does not get in
-- the way of:
--   * deleting the band: the rows go by cascade after the band row, and the
--     check skips a band that no longer exists;
--   * the delete-account flow (delete-account edge function): it refuses when
--     the user is the only admin of a band with other active members
--     (bw_account_deletion_blockers), and bw_prepare_account_deletion deletes
--     the bands the user is alone in before the account goes;
--   * the last person leaving a band they are alone in (no other active
--     member: nothing to protect).
-- It is a deferred constraint trigger, checked at the end of the transaction,
-- so "make B admin, then step down" in one transaction also works.
-- Applies to everyone, the service role included: an admin-less band is
-- never a valid state. Live data checked on 2026-11-14: no band without an
-- active admin.
--
-- An admin can still leave (delete their own row) while another active admin
-- remains, and a member can always delete their own row.
--
-- Part 2 · Instrument on join.
-- bw_accept_invitation inserted members without an instrument, so
-- band_members.instrument stayed empty for everyone who joined by invite and
-- "Who covers what" (deputies) missed them. It now copies the joiner's
-- profile instrument (profiles.instrument) on insert, and on a re-join keeps
-- a band instrument already set. Existing active rows with no instrument get
-- the profile one (only where the profile has one).
--
-- Idempotent; safe to re-run on live data.

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_guard_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only a row that was an active admin and no longer is one.
  IF NOT (OLD.role = 'admin' AND coalesce(OLD.is_active, true)) THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.band_id IS NOT DISTINCT FROM OLD.band_id
     AND NEW.role = 'admin' AND coalesce(NEW.is_active, true) THEN
    RETURN NULL;
  END IF;

  -- The band itself is being deleted (cascade).
  IF NOT EXISTS (SELECT 1 FROM bands WHERE id = OLD.band_id) THEN
    RETURN NULL;
  END IF;
  -- Another active admin is left.
  IF EXISTS (
    SELECT 1 FROM band_members
    WHERE band_id = OLD.band_id AND role = 'admin' AND coalesce(is_active, true)
  ) THEN
    RETURN NULL;
  END IF;
  -- Nobody active is left to run the band for.
  IF NOT EXISTS (
    SELECT 1 FROM band_members
    WHERE band_id = OLD.band_id AND coalesce(is_active, true)
  ) THEN
    RETURN NULL;
  END IF;

  RAISE EXCEPTION 'last_admin: a band needs at least one admin. Make another member admin first.'
    USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.bw_guard_last_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_guard_last_admin ON public.band_members;
CREATE CONSTRAINT TRIGGER bw_guard_last_admin
  AFTER UPDATE OR DELETE ON public.band_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.bw_guard_last_admin();

-- ── Part 2: instrument on join (the live 061 function + instrument) ──────
CREATE OR REPLACE FUNCTION public.bw_accept_invitation(p_token uuid DEFAULT NULL::uuid, p_invitation_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_inv band_invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;

  SELECT * INTO v_inv
  FROM band_invitations bi
  WHERE (p_token IS NOT NULL AND bi.token = p_token)
     OR (p_token IS NULL AND p_invitation_id IS NOT NULL AND bi.id = p_invitation_id)
  FOR UPDATE;

  IF NOT FOUND OR v_inv.status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'invite_email_mismatch' USING ERRCODE = '42501';
  END IF;

  -- Accepting twice is harmless: return the band.
  IF v_inv.status = 'accepted' AND v_inv.accepted_by = v_uid THEN
    RETURN v_inv.band_id;
  ELSIF v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at <= now() THEN
    UPDATE band_invitations SET status = 'expired' WHERE id = v_inv.id;
    RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO band_members (band_id, user_id, role, is_active, left_at, instrument)
  VALUES (
    v_inv.band_id, v_uid, COALESCE(v_inv.role, 'member')::user_role, true, NULL,
    (SELECT nullif(btrim(p.instrument), '') FROM profiles p WHERE p.id = v_uid)
  )
  ON CONFLICT (band_id, user_id) DO UPDATE
    SET is_active = true,
        left_at = NULL,
        -- never downgrade an existing admin through an invitation
        role = CASE WHEN band_members.role = 'admin' THEN 'admin' ELSE EXCLUDED.role END,
        -- a band instrument already set wins over the profile one
        instrument = coalesce(nullif(btrim(band_members.instrument), ''), EXCLUDED.instrument);

  UPDATE band_invitations
  SET status = 'accepted', accepted_at = now(), accepted_by = v_uid
  WHERE id = v_inv.id;

  -- Joiners become 'member' unless they already run their own band.
  UPDATE profiles
  SET user_mode = 'member'
  WHERE id = v_uid AND (user_mode IS NULL OR user_mode = 'solo');

  RETURN v_inv.band_id;
END;
$function$;

-- Backfill: active members with no band instrument get their profile one.
UPDATE public.band_members bm
   SET instrument = nullif(btrim(p.instrument), '')
  FROM public.profiles p
 WHERE p.id = bm.user_id
   AND coalesce(bm.is_active, true)
   AND nullif(btrim(bm.instrument), '') IS NULL
   AND nullif(btrim(p.instrument), '') IS NOT NULL;

COMMIT;
