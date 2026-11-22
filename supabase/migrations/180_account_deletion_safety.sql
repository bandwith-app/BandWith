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
         || v_match || $q$ AND o.bucket_id <> 'personal-files'$q$
      USING p_uid;
  ELSE
    v_match := 'o.owner = $1';
    EXECUTE 'UPDATE storage.objects o SET owner = NULL WHERE '
         || v_match || $q$ AND o.bucket_id <> 'personal-files'$q$
      USING p_uid;
  END IF;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  EXECUTE $q$SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'personal-files' AND (o.name LIKE $1::text || '/%' OR $q$
       || v_match || ')'
    INTO v_personal
    USING p_uid;

  RETURN jsonb_build_object('released', v_released, 'personal_left', v_personal);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_account_storage_release(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_account_storage_release(uuid) TO service_role;

COMMIT;
