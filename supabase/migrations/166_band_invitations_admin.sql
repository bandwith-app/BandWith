-- 166: Band members → Invited (admins only).
--
-- An admin now sees who was invited and hasn't joined yet, and can send the
-- invite again (invite-member, unchanged) or cancel it. Before this, an
-- invite disappeared from the app once sent, and a half-finished sign-up
-- left the admin with nothing to go on.
--
--   * bw_band_invitations(p_band_id)     → the band's open invites: waiting,
--                                          expired, and declined in the last
--                                          30 days. Accepted ones are members.
--   * bw_cancel_invitation(p_invitation_id) → removes an invite that hasn't
--                                          been accepted, and the invitee's
--                                          "invite received" notice.
--
-- Both: signed-in active admins of the band only (bw_is_band_admin). The
-- table itself stays closed to clients (no grants), as since 079–081.

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_band_invitations(p_band_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  role text,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  email_sent_at timestamptz,
  token uuid,
  inviter_name text,
  has_account boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT bw_is_band_admin(p_band_id) THEN
    RAISE EXCEPTION 'not_band_admin' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    bi.id,
    bi.email,
    bi.role,
    -- A pending invite past its date is expired, whatever the row says yet.
    CASE
      WHEN bi.status = 'pending' AND bi.expires_at IS NOT NULL AND bi.expires_at <= now() THEN 'expired'
      ELSE bi.status
    END,
    bi.created_at,
    bi.expires_at,
    bi.email_sent_at,
    bi.token,
    nullif(btrim(p.full_name), ''),
    EXISTS (SELECT 1 FROM profiles x WHERE lower(x.email) = lower(bi.email))
  FROM band_invitations bi
  LEFT JOIN profiles p ON p.id = bi.invited_by
  WHERE bi.band_id = p_band_id
    AND (
      bi.status IN ('pending', 'expired')
      OR (bi.status = 'declined' AND bi.created_at > now() - interval '30 days')
    )
    -- Someone who joined some other way is a member, not an invite.
    AND NOT EXISTS (
      SELECT 1
      FROM band_members bm
      JOIN profiles m ON m.id = bm.user_id
      WHERE bm.band_id = bi.band_id
        AND bm.is_active
        AND bm.left_at IS NULL
        AND lower(m.email) = lower(bi.email)
    )
  ORDER BY bi.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.bw_cancel_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inv band_invitations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inv FROM band_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND OR v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT bw_is_band_admin(v_inv.band_id) THEN
    RAISE EXCEPTION 'not_band_admin' USING ERRCODE = '42501';
  END IF;

  -- The invitee's in-app notice would only lead to "invite not found".
  DELETE FROM notifications n
  WHERE n.type = 'invite_received'
    AND n.band_id = v_inv.band_id
    AND n.user_id IN (SELECT x.id FROM profiles x WHERE lower(x.email) = lower(v_inv.email));

  DELETE FROM band_invitations WHERE id = v_inv.id;
END;
$$;

REVOKE ALL ON FUNCTION public.bw_band_invitations(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bw_cancel_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_band_invitations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bw_cancel_invitation(uuid) TO authenticated;

COMMIT;
