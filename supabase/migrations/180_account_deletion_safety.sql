-- ============================================================================
-- 180 · Account deletion: keep what the band still uses (audit 02 #1-2, 04 #1, #4, #8)
-- ----------------------------------------------------------------------------
-- Rule (Codex review #282): everything that can refuse a deletion is decided
-- before anything is erased.
--
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
--    The migration stops if its role can't update storage.objects (or row
--    security would hide the rows), so a dry run shows it.
--
-- 3. bw_account_deletion_begin(uid), before any file goes: records a
--    short-lived pending deletion (15 minutes) and the bands that go with the
--    account (no other active member), so their files are cleaned even when a
--    first attempt fails after the bands are gone. It refuses, recording
--    nothing, when the person is the last admin of a band with members,
--    counting a co-admin who is deleting their own account as gone (round 2,
--    B2), or when everyone else in a band is deleting too.
--    While the deletion is pending, the trigger bw_band_admin_deletion_guard
--    refuses any band_members change (insert, role, is_active, delete) that
--    would make prepare or Auth refuse later: demoting or removing the last
--    other admin (B1), joining or coming back to a band that goes with the
--    account (B3) and, after prepare, the last other member leaving a band
--    that stays (it would be left with nobody and its files public, B1).
--    Advisory locks order begin against every membership change, and the
--    changes in a band with a pending deletion against each other, so two
--    co-admins stepping down at once can't both pass (B4).
--
-- 4. Chat history (owner decision 11-22, "keep the messages as a former
--    member"): the person's band and event chat messages stay, with
--    sender_id NULL (the app shows "Former member"); direct messages and
--    messages they had already deleted go. Their id is stripped from message
--    metadata and attachments (their own messages and mentions in others').
--    Song suggestions stay with the band without author (created_by ON
--    DELETE SET NULL, same constraint name: older builds embed the author
--    through it).
--
-- 5. Round 3 (Codex review #282):
--    * B1: authors and senders can be NULL now, so every live check that
--      compares one with a user by <> uses IS DISTINCT FROM (withdrawing a
--      suggestion, the suggested-song close trigger, marking chats read or
--      delivered); the rest compare with = and deny on NULL.
--    * B2: after prepare the person can't send messages (trigger
--      bw_messages_deleting_sender), and bw_account_deletion_finish(uid),
--      called by delete-account right before Auth, handles their messages
--      once more (a direct message that got in while prepare ran).
--    * B4: prepare takes the guard's locks in the guard's order.
--    * A poll keeps its creator's time zone (rehearsal_polls.creator_timezone,
--      read only by bw_poll_vote_deadline), so a closed vote stays closed.
--
-- Older app builds: nothing they call changes shape. They show a NULL sender
-- as "Member" (bubble), "Unknown" (search) and no name (chat list). Idempotent.
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

-- The release must be able to change storage.objects: stop here (and in a
-- dry run) if the role that owns these functions can't, instead of finding
-- out when Auth refuses an account whose data is already gone.
DO $$
DECLARE
  v_role record;
  v_rel record;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;
  IF NOT (has_table_privilege(current_user, 'storage.objects', 'SELECT')
          AND has_table_privilege(current_user, 'storage.objects', 'UPDATE')) THEN
    RAISE EXCEPTION '180: role % cannot SELECT and UPDATE storage.objects (bw_account_storage_release)', current_user;
  END IF;
  SELECT rolsuper, rolbypassrls, oid INTO v_role FROM pg_roles WHERE rolname = current_user;
  SELECT relrowsecurity, relforcerowsecurity, relowner INTO v_rel FROM pg_class WHERE oid = 'storage.objects'::regclass;
  IF v_rel.relrowsecurity AND NOT v_role.rolsuper AND NOT v_role.rolbypassrls
     AND (v_rel.relowner <> v_role.oid OR v_rel.relforcerowsecurity) THEN
    RAISE EXCEPTION '180: row security on storage.objects applies to role %: bw_account_storage_release would release nothing', current_user;
  END IF;
END $$;

-- ── 3. A pending deletion holds the band check ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_deletions_pending (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  -- Bands the deletion removes: their files go too, even on a retry.
  band_ids uuid[] NOT NULL DEFAULT '{}',
  -- Set by prepare: from then on the bands not in band_ids stay, so their
  -- last other member can't leave them empty.
  prepared_at timestamptz
);
ALTER TABLE public.account_deletions_pending ADD COLUMN IF NOT EXISTS prepared_at timestamptz;
ALTER TABLE public.account_deletions_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletions_pending FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_deletions_pending TO service_role;

-- Locks, so the checks below always see each other's committed result
-- (round 2, B4), held to the end of the transaction:
--   * every membership change takes the deletion lock shared, begin takes it
--     exclusive: a begin and a change never overlap (begin is a few ms);
--   * a change in a band with a pending deletion also takes that band's lock,
--     so two changes there (two co-admins stepping down) run one after the
--     other and the second sees the first. Only bands with a pending
--     deletion: a bulk update elsewhere takes one lock, not one per band.
CREATE OR REPLACE FUNCTION public.bw_band_deletion_lock(p_band uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF p_band IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('bw_account_deletion', 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('bw_band_deletion:' || p_band::text, 0));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_band_deletion_lock(uuid) FROM PUBLIC, anon, authenticated;

-- Why person p_uid's deletion could no longer finish in band p_band, or NULL.
-- p_noted: the band goes with the account. p_prepared: prepare already ran.
-- A co-admin who is deleting their own account (pending) doesn't count as
-- staying (round 2, B2).
CREATE OR REPLACE FUNCTION public.bw_account_deletion_conflict(
  p_band uuid, p_uid uuid, p_noted boolean, p_prepared boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin boolean;
  v_others integer;
  v_staying integer;
  v_staying_admins integer;
BEGIN
  SELECT bool_or(me.role::text = 'admin') INTO v_admin
    FROM public.band_members me
   WHERE me.band_id = p_band AND me.user_id = p_uid AND coalesce(me.is_active, true);
  IF v_admin IS NULL THEN
    RETURN NULL; -- not an active member: the band doesn't depend on them
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE NOT x.leaving),
         count(*) FILTER (WHERE NOT x.leaving AND x.is_admin)
    INTO v_others, v_staying, v_staying_admins
    FROM (SELECT o.role::text = 'admin' AS is_admin,
                 EXISTS (SELECT 1 FROM public.account_deletions_pending d
                          WHERE d.user_id = o.user_id
                            AND d.started_at > now() - interval '15 minutes') AS leaving
            FROM public.band_members o
           WHERE o.band_id = p_band AND o.user_id <> p_uid AND coalesce(o.is_active, true)) x;

  IF v_others = 0 THEN
    -- Alone: the band goes with the account, unless prepare already kept it.
    RETURN CASE WHEN p_noted OR NOT p_prepared THEN NULL ELSE 'band_left_empty' END;
  END IF;
  IF v_admin AND v_staying_admins = 0 THEN
    RETURN 'last_admin';
  END IF;
  IF v_staying = 0 THEN
    RETURN 'others_leaving';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_account_deletion_conflict(uuid, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_account_deletion_begin(p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_band record;
  v_conflict text;
  v_blocked text[] := '{}';
  v_busy boolean := false;
  v_solo uuid[];
  v_bands uuid[];
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'p_uid is required' USING ERRCODE = '22004';
  END IF;
  -- Exclusive: waits for membership changes in flight, holds new ones.
  PERFORM public.bw_band_deletion_lock(NULL);

  FOR v_band IN
    SELECT b.id, b.name::text AS name
      FROM public.bands b
     WHERE b.id IN (SELECT bm.band_id FROM public.band_members bm WHERE bm.user_id = p_uid)
     ORDER BY b.name
  LOOP
    v_conflict := public.bw_account_deletion_conflict(v_band.id, p_uid, true, false);
    IF v_conflict = 'last_admin' THEN
      v_blocked := v_blocked || v_band.name;
    ELSIF v_conflict IS NOT NULL THEN
      v_busy := true;
    END IF;
  END LOOP;
  IF cardinality(v_blocked) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'bands', to_jsonb(v_blocked));
  END IF;
  -- Everyone else in a band is deleting too: wait until they are done.
  IF v_busy THEN
    RETURN jsonb_build_object('ok', false, 'code', 'deletion_in_progress', 'bands', '[]'::jsonb);
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

-- ── 4. Chat history stays, as a former member's ───────────────────────────
-- A person's id out of a JSON document: object keys that are the id, values
-- that are the id, and objects that describe the person ({"id": <id>, ...}).
CREATE OR REPLACE FUNCTION public.bw_jsonb_without_person(p_doc jsonb, p_uid text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_out jsonb;
  v_key text;
  v_val jsonb;
  v_me jsonb := to_jsonb(p_uid);
BEGIN
  IF p_doc IS NULL OR p_uid IS NULL THEN
    RETURN p_doc;
  END IF;
  IF jsonb_typeof(p_doc) = 'object' THEN
    v_out := '{}'::jsonb;
    FOR v_key, v_val IN SELECT e.key, e.value FROM jsonb_each(p_doc) e LOOP
      CONTINUE WHEN v_key = p_uid OR v_val = v_me
        OR (jsonb_typeof(v_val) = 'object' AND EXISTS (SELECT 1 FROM jsonb_each(v_val) i WHERE i.value = v_me));
      v_out := v_out || jsonb_build_object(v_key, public.bw_jsonb_without_person(v_val, p_uid));
    END LOOP;
    RETURN v_out;
  ELSIF jsonb_typeof(p_doc) = 'array' THEN
    v_out := '[]'::jsonb;
    FOR v_val IN SELECT e.value FROM jsonb_array_elements(p_doc) e LOOP
      CONTINUE WHEN v_val = v_me
        OR (jsonb_typeof(v_val) = 'object' AND EXISTS (SELECT 1 FROM jsonb_each(v_val) i WHERE i.value = v_me));
      v_out := v_out || jsonb_build_array(public.bw_jsonb_without_person(v_val, p_uid));
    END LOOP;
    RETURN v_out;
  END IF;
  RETURN p_doc;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_jsonb_without_person(jsonb, text) FROM PUBLIC, anon, authenticated;

-- A message without author is a former member's. Nothing else may clear or
-- change the sender: only the account deletion (prepare sets the flag) or
-- the profile itself going (the FK's ON DELETE SET NULL, e.g. a message
-- sent between prepare and Auth deleting the user).
ALTER TABLE public.messages ALTER COLUMN sender_id DROP NOT NULL;
DO $$
DECLARE
  c record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.conrelid = 'public.messages'::regclass AND con.contype = 'f'
       AND array_length(con.conkey, 1) = 1 AND a.attname = 'sender_id' AND con.confdeltype = 'n'
  ) THEN
    FOR c IN
      SELECT con.conname FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
       WHERE con.conrelid = 'public.messages'::regclass AND con.contype = 'f' AND a.attname = 'sender_id'
    LOOP
      EXECUTE format('ALTER TABLE public.messages DROP CONSTRAINT %I', c.conname);
    END LOOP;
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_sender_id_fkey
      FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- As 050, plus the two ways a sender becomes NULL. SECURITY DEFINER so the
-- "profile is gone" check isn't hidden by row security on profiles.
CREATE OR REPLACE FUNCTION public.bw_messages_immutable_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.chat_id IS DISTINCT FROM OLD.chat_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.sender_id IS DISTINCT FROM OLD.sender_id
         AND NOT (NEW.sender_id IS NULL AND OLD.sender_id IS NOT NULL
                  AND (current_setting('bw.account_deletion_uid', true) = OLD.sender_id::text
                       OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.sender_id)))) THEN
    RAISE EXCEPTION 'messages: chat_id, sender_id and created_at cannot change';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_messages_immutable_keys() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_messages_immutable_keys ON public.messages;
CREATE TRIGGER bw_messages_immutable_keys
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.bw_messages_immutable_keys();

-- Song suggestions stay with the band, without author. Same constraint name:
-- the app embeds the author with profiles!song_suggestions_created_by_fkey.
DO $$
DECLARE
  c record;
BEGIN
  IF to_regclass('public.song_suggestions') IS NULL THEN
    RETURN;
  END IF;
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.conrelid = 'public.song_suggestions'::regclass AND con.contype = 'f'
       AND array_length(con.conkey, 1) = 1 AND a.attname = 'created_by' AND con.confdeltype <> 'n'
  LOOP
    EXECUTE format('ALTER TABLE public.song_suggestions DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.song_suggestions ALTER COLUMN created_by DROP NOT NULL;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.conrelid = 'public.song_suggestions'::regclass AND con.contype = 'f' AND a.attname = 'created_by'
  ) THEN
    ALTER TABLE public.song_suggestions
      ADD CONSTRAINT song_suggestions_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- The person's messages (owner decision 11-22), for prepare and again for
-- the last step before Auth (round 3, B2: a message sent from another device
-- while prepare ran).
CREATE OR REPLACE FUNCTION public.bw_account_deletion_messages(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col text;
BEGIN
  -- Messages (owner decision 11-22): direct messages, and messages they had
  -- already deleted, go; band and event chat messages stay, as a former
  -- member's (sender_id NULL, the immutable-keys trigger allows it here).
  PERFORM set_config('bw.account_deletion_uid', p_uid::text, true);
  DELETE FROM public.messages m
   WHERE m.sender_id = p_uid
     AND (coalesce((to_jsonb(m) ->> 'deleted')::boolean, false)
          OR NOT EXISTS (SELECT 1 FROM public.chats c
                          WHERE c.id = m.chat_id AND c.type::text IN ('band', 'event', 'group')));
  -- Their id out of message metadata and attachments: their own messages,
  -- and mentions in the chats they were in.
  FOREACH v_col IN ARRAY ARRAY['metadata', 'attachments'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'messages'
                  AND column_name = v_col AND data_type = 'jsonb') THEN
      EXECUTE format($f$
        UPDATE public.messages m
           SET %1$I = public.bw_jsonb_without_person(m.%1$I, $1::text)
         WHERE (m.sender_id = $1
                OR m.chat_id IN (SELECT cp.chat_id FROM public.chat_participants cp WHERE cp.user_id = $1)
                OR m.chat_id IN (SELECT c.id FROM public.chats c
                                   JOIN public.band_members bm ON bm.band_id = c.band_id
                                  WHERE bm.user_id = $1))
           AND strpos(m.%1$I::text, $1::text) > 0$f$, v_col)
      USING p_uid;
    END IF;
  END LOOP;
  UPDATE public.messages SET sender_id = NULL WHERE sender_id = p_uid;
  PERFORM set_config('bw.account_deletion_uid', '', true);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_account_deletion_messages(uuid) FROM PUBLIC, anon, authenticated;

-- As 059, plus: the bands it deletes are noted with the pending deletion
-- (prepared from then on), band and event chat messages stay without author
-- instead of being deleted, and its band check takes the guard's locks.
CREATE OR REPLACE FUNCTION public.bw_prepare_account_deletion(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fk record;
  v_band uuid;
BEGIN
  -- The guard's locks, in its order (round 3, B4). A membership change holds
  -- its row (and a new member its band, through the FK) before the guard
  -- takes the deletion lock shared and then the band's lock, so prepare
  -- takes them the same way: the bands and their member rows first, then
  -- the deletion lock shared, then each band's lock by id. A co-admin leaving
  -- at the same moment either commits first (prepare then sees it) or waits
  -- and sees the deletion prepared; neither side can wait on the other.
  PERFORM 1 FROM public.bands b
   WHERE b.id IN (SELECT bm.band_id FROM public.band_members bm WHERE bm.user_id = p_uid)
   ORDER BY b.id FOR UPDATE;
  PERFORM 1 FROM public.band_members bm
   WHERE bm.band_id IN (SELECT me.band_id FROM public.band_members me WHERE me.user_id = p_uid)
   ORDER BY bm.band_id, bm.user_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('bw_account_deletion', 0));
  FOR v_band IN
    SELECT DISTINCT bm.band_id FROM public.band_members bm WHERE bm.user_id = p_uid ORDER BY bm.band_id
  LOOP
    PERFORM public.bw_band_deletion_lock(v_band);
  END LOOP;

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
  INSERT INTO public.account_deletions_pending AS p (user_id, band_ids, prepared_at)
  SELECT p_uid, coalesce(array_agg(id), '{}'), now() FROM gone
  ON CONFLICT (user_id) DO UPDATE
    SET band_ids = ARRAY(SELECT DISTINCT x FROM unnest(p.band_ids || EXCLUDED.band_ids) AS x),
        prepared_at = now();

  -- Personal gigs are deleted with the account.
  DELETE FROM events WHERE band_id IS NULL AND created_by = p_uid;

  -- Their polls keep the time zone their vote-by deadline is read in
  -- (round 3: without it a closed New York poll reopened under UTC-12).
  UPDATE public.rehearsal_polls rp
     SET creator_timezone = nullif(trim(pr.timezone), '')
    FROM public.profiles pr
   WHERE pr.id = p_uid AND rp.created_by = p_uid AND nullif(trim(pr.timezone), '') IS NOT NULL;

  PERFORM public.bw_account_deletion_messages(p_uid);

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


-- ── 5. Round 3 (Codex review #282) ───────────────────────────────────────
-- B2: once prepare has run, the person sends nothing more (another device
-- still signed in): a direct message would outlive the deletion with no
-- sender. One that got in while prepare ran is caught by the last step.
CREATE OR REPLACE FUNCTION public.bw_trg_messages_deleting_sender()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.sender_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.account_deletions_pending p
     WHERE p.user_id = NEW.sender_id AND p.prepared_at IS NOT NULL
       AND p.started_at > now() - interval '15 minutes'
  ) THEN
    RAISE EXCEPTION 'account_deletion_in_progress' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_messages_deleting_sender() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_messages_deleting_sender ON public.messages;
CREATE TRIGGER bw_messages_deleting_sender
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_messages_deleting_sender();

-- The last step before Auth deletes the user (delete-account): their
-- messages once more.
CREATE OR REPLACE FUNCTION public.bw_account_deletion_finish(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'p_uid is required' USING ERRCODE = '22004';
  END IF;
  PERFORM public.bw_account_deletion_messages(p_uid);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_account_deletion_finish(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_account_deletion_finish(uuid) TO service_role;

-- B1: authors and senders can now be NULL. A check like "created_by <> me"
-- is then NULL and lets anyone through, so every live definition that
-- compares one with a user (grep of all migrations, round 3) now uses
-- IS DISTINCT FROM. The rest compare with = (NULL denies) and stay.

-- As 108, with IS DISTINCT FROM: nobody withdraws a former member's suggestion.
CREATE OR REPLACE FUNCTION public.bw_withdraw_song_suggestion(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  g record;
  s record;
  v_files jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO g FROM public.song_suggestions WHERE id = p_id FOR UPDATE;
  IF v_uid IS NULL OR g.id IS NULL OR g.created_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Not your suggestion' USING ERRCODE = '42501';
  END IF;
  IF g.status <> 'pending' THEN
    RAISE EXCEPTION 'This suggestion was already reviewed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.song_suggestions SET status = 'withdrawn', reviewed_at = now() WHERE id = g.id;
  IF g.kind = 'new_song' THEN
    SELECT id, status, audio_url, chart_url INTO s FROM public.songs WHERE id = g.song_id;
    IF s.id IS NOT NULL AND s.status = 'suggested' THEN
      v_files := to_jsonb(array_remove(ARRAY[s.audio_url, s.chart_url], NULL));
      DELETE FROM public.songs WHERE id = s.id;
    END IF;
  END IF;
  -- The admins' unread notification about it goes away.
  DELETE FROM public.notifications
   WHERE type = 'song_suggestion' AND reference_id = g.id AND NOT coalesce(read, false);
  RETURN jsonb_build_object('status', 'withdrawn', 'files', v_files);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_withdraw_song_suggestion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_withdraw_song_suggestion(uuid) TO authenticated;

-- As 108, with IS DISTINCT FROM: an admin deleting a former member's
-- suggested song rejects the suggestion (it was left to "withdrawn").
CREATE OR REPLACE FUNCTION public.bw_trg_song_suggestion_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (OLD.status = 'suggested' AND NEW.status IS DISTINCT FROM 'suggested') THEN RETURN NEW; END IF;
    v_status := 'accepted';
  ELSE
    IF OLD.status IS DISTINCT FROM 'suggested' THEN RETURN OLD; END IF;
    v_status := 'rejected';
  END IF;
  FOR v_id IN
    UPDATE public.song_suggestions
       SET status = v_status, reviewed_by = auth.uid(), reviewed_at = now()
     WHERE song_id = OLD.id AND kind = 'new_song' AND status = 'pending'
       -- The author withdrawing their own song: no notification.
       AND (auth.uid() IS NULL OR created_by IS DISTINCT FROM auth.uid() OR v_status = 'accepted')
    RETURNING id
  LOOP
    PERFORM public.bw_notify_song_suggestion_outcome(v_id);
  END LOOP;
  -- Corrections still waiting for a deleted song can't be applied any more.
  IF TG_OP = 'DELETE' THEN
    UPDATE public.song_suggestions SET status = 'withdrawn', reviewed_at = now()
     WHERE song_id = OLD.id AND status = 'pending';
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_song_suggestion_close() FROM PUBLIC, anon, authenticated;

-- As 049 / 122, with IS DISTINCT FROM: a former member's message counts as
-- someone else's, so opening the chat marks it read and delivered.
CREATE OR REPLACE FUNCTION public.bw_mark_chats_delivered()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  UPDATE chat_participants cp
     SET last_delivered_at = now()
   WHERE cp.user_id = auth.uid()
     AND EXISTS (
       SELECT 1 FROM messages m
        WHERE m.chat_id = cp.chat_id
          AND m.sender_id IS DISTINCT FROM auth.uid()
          AND m.created_at > coalesce(cp.last_delivered_at, '-infinity'::timestamptz)
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_mark_chats_delivered() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_mark_chats_delivered() TO authenticated;

CREATE OR REPLACE FUNCTION public.bw_mark_chat_read(p_chat_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  UPDATE chat_participants cp
     SET last_read_at = now(),
         last_delivered_at = now()
   WHERE cp.chat_id = p_chat_id
     AND cp.user_id = auth.uid()
     AND (
       cp.last_read_at IS NULL
       OR EXISTS (
         SELECT 1 FROM messages m
          WHERE m.chat_id = cp.chat_id
            AND m.sender_id IS DISTINCT FROM auth.uid()
            AND m.created_at > cp.last_read_at
       )
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_mark_chat_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_mark_chat_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bw_mark_chat_delivered_by_push(p_chat_id uuid, p_user_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_chat_id IS NULL OR p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN RETURN 0; END IF;
  UPDATE chat_participants cp
     SET last_delivered_at = now()
   WHERE cp.chat_id = p_chat_id
     AND cp.user_id = ANY (p_user_ids)
     AND EXISTS (
       SELECT 1 FROM messages m
        WHERE m.chat_id = cp.chat_id
          AND m.sender_id IS DISTINCT FROM cp.user_id
          AND m.created_at > coalesce(cp.last_delivered_at, '-infinity'::timestamptz)
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bw_mark_chat_delivered_by_push(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_mark_chat_delivered_by_push(uuid, uuid[]) TO service_role;

-- The poll keeps the creator's time zone once the creator is gone (above).
ALTER TABLE public.rehearsal_polls ADD COLUMN IF NOT EXISTS creator_timezone text;

-- As 117, plus the poll's own copy of the time zone (#297's
-- bw_poll_vote_deadlines reads this function, so it follows).
CREATE OR REPLACE FUNCTION public.bw_poll_vote_deadline(p_poll_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_by date;
  v_time time;
  v_tz text;
  v_local timestamp;
BEGIN
  SELECT rp.vote_by, rp.vote_by_time, coalesce(nullif(trim(p.timezone), ''), nullif(trim(rp.creator_timezone), ''))
    INTO v_by, v_time, v_tz
  FROM rehearsal_polls rp
  LEFT JOIN profiles p ON p.id = rp.created_by
  WHERE rp.id = p_poll_id;
  IF v_by IS NULL THEN
    RETURN NULL;
  END IF;
  v_local := v_by + coalesce(v_time, time '23:59:59');
  IF v_tz IS NOT NULL THEN
    BEGIN
      RETURN v_local AT TIME ZONE v_tz;
    EXCEPTION WHEN invalid_parameter_value OR data_exception THEN
      NULL; -- unknown zone name: fall through
    END;
  END IF;
  RETURN v_local AT TIME ZONE 'Etc/GMT+12';
END;
$$;
REVOKE ALL ON FUNCTION public.bw_poll_vote_deadline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_poll_vote_deadline(uuid) TO authenticated;

-- While a deletion is pending, no membership change may make it refuse
-- later (round 2, B1-B4): checked on the band as it is after the change,
-- under the band's lock (so a concurrent change is seen once it commits).
CREATE OR REPLACE FUNCTION public.bw_trg_band_admin_deletion_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_band uuid;
  v_conflict text;
BEGIN
  FOR v_band IN
    SELECT DISTINCT x
      FROM unnest(ARRAY[CASE WHEN TG_OP <> 'INSERT' THEN OLD.band_id END,
                        CASE WHEN TG_OP <> 'DELETE' THEN NEW.band_id END]) AS x
     WHERE x IS NOT NULL
     ORDER BY x
  LOOP
    -- The whole band is being deleted (cascade): nothing to protect.
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.bands WHERE id = v_band);
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('bw_account_deletion', 0));
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.account_deletions_pending p
        JOIN public.band_members d ON d.band_id = v_band AND d.user_id = p.user_id
       WHERE p.started_at > now() - interval '15 minutes');
    PERFORM public.bw_band_deletion_lock(v_band);
    SELECT c.conflict INTO v_conflict
      FROM public.account_deletions_pending p
      JOIN public.band_members d
        ON d.band_id = v_band AND d.user_id = p.user_id AND coalesce(d.is_active, true)
      CROSS JOIN LATERAL (SELECT public.bw_account_deletion_conflict(
                            v_band, p.user_id, v_band = ANY (p.band_ids), p.prepared_at IS NOT NULL) AS conflict) c
     WHERE p.started_at > now() - interval '15 minutes'
       AND c.conflict IS NOT NULL
     LIMIT 1;
    IF v_conflict IS NOT NULL THEN
      RAISE EXCEPTION 'account_deletion_in_progress'
        USING ERRCODE = 'P0001',
              DETAIL = v_conflict,
              HINT = 'Another admin of this band is deleting their account. Try again in a few minutes.';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_band_admin_deletion_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_band_admin_deletion_guard ON public.band_members;
CREATE TRIGGER bw_band_admin_deletion_guard
  AFTER INSERT OR DELETE OR UPDATE OF role, is_active, band_id, user_id ON public.band_members
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_band_admin_deletion_guard();

NOTIFY pgrst, 'reload schema';

COMMIT;
