-- ============================================================================
-- 180 · Account deletion: keep what the band still uses (audit 02 #1-2, 04 #1, #4, #8)
-- ----------------------------------------------------------------------------
-- 1. A rehearsal poll belonged to its creator: deleting the creator's account
--    cascaded into the band's poll, its options and every member's votes.
--    Now the poll stays with the band and loses only its author
--    (created_by ON DELETE SET NULL). The app already copes with a poll
--    without author (no creator name).
--
-- 2. bw_account_storage_release(uid), for the delete-account function,
--    before anything is deleted:
--      * files the person uploaded that stay (song files, branding, quote
--        PDFs of bands that go on, leftover avatars) stop being "owned" by
--        the account, so Auth can delete it (Supabase refuses to delete a
--        user who still owns Storage objects) and the band keeps them;
--      * it reports how many of their personal files (bucket personal-files,
--        <uid>/...) are still there: the function removes those through the
--        Storage API first and stops if any is left, before any data goes.
--    Only Storage metadata changes (owner); no file is moved or deleted here.
--    The profile photo (avatars/<uid>/...) counts as personal too: it is
--    never released, so a photo the Storage API failed to remove stops the
--    deletion instead of staying public (Codex review #282).
--
-- 3. bw_account_deletion_begin(uid), before any file goes (Codex review
--    #282): re-checks the last-admin rule under a row lock and records a
--    short-lived pending deletion. While it is pending (15 minutes), a
--    co-admin can't step down or be removed if that would leave the deleting
--    person the band's last admin with members; the personal files are only
--    removed once the band check can no longer change. It also keeps the
--    ids of the bands the deletion will remove (no other active member), so
--    their files are cleaned even when a first attempt fails after the bands
--    are gone (a retry can no longer find them through band_members).
--
-- Older app builds: nothing they call changes. Idempotent.
-- ============================================================================

BEGIN;

-- ── 1. Polls survive their author ──────────────────────────────────────────
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.conrelid = 'public.rehearsal_polls'::regclass
       AND con.contype = 'f'
       AND array_length(con.conkey, 1) = 1
       AND a.attname = 'created_by'
       AND con.confdeltype <> 'n'
  LOOP
    EXECUTE format('ALTER TABLE public.rehearsal_polls DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.rehearsal_polls ALTER COLUMN created_by DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.conrelid = 'public.rehearsal_polls'::regclass AND con.contype = 'f' AND a.attname = 'created_by'
  ) THEN
    ALTER TABLE public.rehearsal_polls
      ADD CONSTRAINT rehearsal_polls_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 2. Storage before the account goes ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bw_account_storage_release(p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_released integer;
  v_personal integer;
  v_match text;
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'p_uid is required' USING ERRCODE = '22004';
  END IF;

  -- Newer Storage versions also keep the owner as text (owner_id).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'owner_id'
  ) THEN
    v_match := '(o.owner = $1 OR o.owner_id = $1::text)';
    EXECUTE 'UPDATE storage.objects o SET owner = NULL, owner_id = NULL WHERE '
         || v_match || $q$ AND o.bucket_id <> 'personal-files'
              AND NOT (o.bucket_id = 'avatars' AND o.name LIKE $1::text || '/%')$q$
      USING p_uid;
  ELSE
    v_match := 'o.owner = $1';
    EXECUTE 'UPDATE storage.objects o SET owner = NULL WHERE '
         || v_match || $q$ AND o.bucket_id <> 'personal-files'
              AND NOT (o.bucket_id = 'avatars' AND o.name LIKE $1::text || '/%')$q$
      USING p_uid;
  END IF;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  EXECUTE $q$SELECT count(*) FROM storage.objects o
     WHERE (o.bucket_id = 'personal-files' AND (o.name LIKE $1::text || '/%' OR $q$ || v_match || $q$))
        OR (o.bucket_id = 'avatars' AND o.name LIKE $1::text || '/%')$q$
    INTO v_personal
    USING p_uid;

  RETURN jsonb_build_object('released', v_released, 'personal_left', v_personal);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_account_storage_release(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_account_storage_release(uuid) TO service_role;

-- ── 3. A pending deletion holds the band check ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_deletions_pending (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  -- Bands the deletion removes: their files go too, even on a retry.
  band_ids uuid[] NOT NULL DEFAULT '{}'
);
ALTER TABLE public.account_deletions_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletions_pending FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_deletions_pending TO service_role;

CREATE OR REPLACE FUNCTION public.bw_account_deletion_begin(p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_blocked text[];
  v_solo uuid[];
  v_bands uuid[];
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'p_uid is required' USING ERRCODE = '22004';
  END IF;
  -- Same order as a step-down: lock the memberships of the person's bands.
  PERFORM 1 FROM public.band_members bm
   WHERE bm.band_id IN (SELECT band_id FROM public.band_members WHERE user_id = p_uid)
   ORDER BY bm.band_id, bm.user_id
   FOR UPDATE;

  SELECT coalesce(array_agg(b.band_name ORDER BY b.band_name), '{}') INTO v_blocked
    FROM public.bw_account_deletion_blockers(p_uid) b;
  IF array_length(v_blocked, 1) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'bands', to_jsonb(v_blocked));
  END IF;

  SELECT coalesce(array_agg(DISTINCT me.band_id), '{}') INTO v_solo
    FROM public.band_members me
   WHERE me.user_id = p_uid
     AND NOT EXISTS (SELECT 1 FROM public.band_members o
                      WHERE o.band_id = me.band_id AND o.user_id <> p_uid AND coalesce(o.is_active, true));

  INSERT INTO public.account_deletions_pending AS p (user_id, started_at, band_ids)
  VALUES (p_uid, now(), v_solo)
  ON CONFLICT (user_id) DO UPDATE
    SET started_at = now(),
        band_ids = ARRAY(SELECT DISTINCT x FROM unnest(p.band_ids || EXCLUDED.band_ids) AS x)
  RETURNING band_ids INTO v_bands;
  RETURN jsonb_build_object('ok', true, 'band_ids', to_jsonb(v_bands));
END;
$$;
REVOKE ALL ON FUNCTION public.bw_account_deletion_begin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_account_deletion_begin(uuid) TO service_role;

-- As 059, plus: the bands it deletes are noted with the pending deletion.
CREATE OR REPLACE FUNCTION public.bw_prepare_account_deletion(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fk record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.bw_account_deletion_blockers(p_uid)) THEN
    RAISE EXCEPTION 'account_has_bands' USING ERRCODE = 'P0001';
  END IF;

  -- Bands with no other active member go with the account. Their ids are
  -- kept with the pending deletion, so delete-account cleans their files
  -- even if this attempt fails later (180, Codex review #282).
  WITH gone AS (
    DELETE FROM bands b
    WHERE EXISTS (SELECT 1 FROM band_members me WHERE me.band_id = b.id AND me.user_id = p_uid)
      AND NOT EXISTS (
        SELECT 1 FROM band_members o
        WHERE o.band_id = b.id AND o.user_id <> p_uid AND COALESCE(o.is_active, true))
    RETURNING b.id
  )
  INSERT INTO public.account_deletions_pending AS p (user_id, band_ids)
  SELECT p_uid, array_agg(id) FROM gone HAVING count(*) > 0
  ON CONFLICT (user_id) DO UPDATE
    SET band_ids = ARRAY(SELECT DISTINCT x FROM unnest(p.band_ids || EXCLUDED.band_ids) AS x);

  -- Personal gigs and the user's messages are deleted with the account.
  DELETE FROM events WHERE band_id IS NULL AND created_by = p_uid;
  DELETE FROM messages WHERE sender_id = p_uid;

  -- Remaining single-column FKs to profiles(id) / auth.users(id) that would
  -- block the delete: NO ACTION / RESTRICT, or SET NULL on a NOT NULL column.
  FOR fk IN
    SELECT n.nspname AS schema_name,
           c.relname AS table_name,
           a.attname AS column_name,
           a.attnotnull AS not_null,
           con.confdeltype AS del_type
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND array_length(con.conkey, 1) = 1
      AND (con.confdeltype IN ('a', 'r') OR (con.confdeltype = 'n' AND a.attnotnull))
      AND con.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
      AND n.nspname = 'public'
  LOOP
    IF fk.not_null THEN
      EXECUTE format('DELETE FROM %I.%I WHERE %I = $1',
                     fk.schema_name, fk.table_name, fk.column_name)
      USING p_uid;
    ELSE
      EXECUTE format('UPDATE %I.%I SET %I = NULL WHERE %I = $1',
                     fk.schema_name, fk.table_name, fk.column_name, fk.column_name)
      USING p_uid;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_prepare_account_deletion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_prepare_account_deletion(uuid) TO service_role;

-- A co-admin stepping down (or removed) while an admin's deletion is pending,
-- if that would leave the deleting admin the band's last admin with members.
CREATE OR REPLACE FUNCTION public.bw_trg_band_admin_deletion_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.role::text <> 'admin' OR NOT coalesce(OLD.is_active, true) THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role::text = 'admin' AND coalesce(NEW.is_active, true) THEN
    RETURN NEW;
  END IF;
  -- The whole band is being deleted (cascade): nothing to protect.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.bands WHERE id = OLD.band_id) THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.account_deletions_pending p
      JOIN public.band_members d
        ON d.band_id = OLD.band_id AND d.user_id = p.user_id
       AND d.role::text = 'admin' AND coalesce(d.is_active, true)
     WHERE p.user_id <> OLD.user_id
       AND p.started_at > now() - interval '15 minutes'
       -- no third admin would remain…
       AND NOT EXISTS (SELECT 1 FROM public.band_members a
                        WHERE a.band_id = OLD.band_id AND a.user_id NOT IN (p.user_id, OLD.user_id)
                          AND a.role::text = 'admin' AND coalesce(a.is_active, true))
       -- …for a band that has other members.
       AND EXISTS (SELECT 1 FROM public.band_members o
                    WHERE o.band_id = OLD.band_id AND o.user_id NOT IN (p.user_id, OLD.user_id)
                      AND coalesce(o.is_active, true))
  ) THEN
    RAISE EXCEPTION 'account_deletion_in_progress'
      USING ERRCODE = 'P0001',
            HINT = 'Another admin of this band is deleting their account. Try again in a few minutes.';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_band_admin_deletion_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_band_admin_deletion_guard ON public.band_members;
CREATE TRIGGER bw_band_admin_deletion_guard
  BEFORE UPDATE OF role, is_active OR DELETE ON public.band_members
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_band_admin_deletion_guard();

COMMIT;
