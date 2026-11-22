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
--    pending deletion (15 minutes; no limit once committed, round 5) and the bands that go with the
--    account (no other active member), so their files are cleaned even when a
--    first attempt fails after the bands are gone. It refuses, recording
--    nothing, when the person is the last admin of a band with members,
--    counting a co-admin who is deleting their own account as gone (round 2,
--    B2), or when everyone else in a band is deleting too.
--    While the deletion is pending, the trigger bw_band_admin_deletion_guard
--    refuses any band_members change (insert, role, is_active, delete) that
--    would make prepare or Auth refuse later: demoting or removing the last
--    other admin (B1), joining or coming back to a band that goes with the
--    account (B3) and, once committed, the last other member leaving a band
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
--    Only the id: an "@Full Name" typed into a message stays in its text.
--    Notifications follow the messages (round 4, below).
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
-- 6. Round 4 (Claude review #282):
--    * A committed deletion holds until the account is gone (round 5 below).
--      The message refusal follows the same rule. A retry after prepare
--      skips the band checks in begin and prepare and only finishes the job.
--    * A co-admin whose only fellow admins are deleting their accounts gets
--      deletion_in_progress (wait), not account_has_bands.
--    * Codex B1: prepare marks the deletion prepared (row lock) before it
--      deletes direct messages; the messages trigger reads that row FOR
--      SHARE, so a message from another device commits first or is refused.
--      The last step deletes what is left in their direct chats by chat.
--    * Codex B2 (owner's rule): notifications about their direct chats go,
--      on both sides; band, gig and group chat and song-suggestion
--      notifications show "Former member" in the recipient's language, text
--      kept; their id goes from every notification's data. Other
--      notifications keep the name in their text.
--    * Codex B3: no uploads while their deletion holds (restrictive policies
--      on storage.objects); the last step re-checks Storage and stops while
--      a personal file is there.
--    * A poll's invitees no longer count them (round 5: also the last one);
--      the proposal-expiry job reads the poll's copy of the time zone.
--    * Chat receipts (bw_mark_chat_read, bw_mark_chats_delivered) are 175's
--      bodies (#281, 44cf49fc), with its stale-participant rule called only
--      when bw_chat_scope_ok_for exists.
--    * The hold's errors are plain English (older builds show the message
--      as it is); the code account_deletion_in_progress is the hint.
--
-- 7. Round 5 (Codex and Claude reviews #282, da668d13):
--    * Two states. Begun (account_deletions_pending without committed_at):
--      nothing is erased yet, the hold lapses after 15 minutes. Committed
--      (committed_at, set by bw_prepare_account_deletion in the same
--      transaction as its first erase): the point of no return, before any
--      file goes (delete-account erases files only after prepare). It never
--      lapses: the job bw-finish-account-deletions (pg_cron, every 5
--      minutes) asks delete-account to finish committed deletions nobody
--      touched for 5 minutes (files, Auth, final scrub), so the others are
--      held for minutes, not for good. A retry and the job can overlap: every
--      step can run twice, and the job leases each row (SKIP LOCKED).
--    * Notifications: direct chats are found by chat type plus creator,
--      participant row or their messages (a chat the other person started
--      and they had left); band chat notices only by sender id or message id.
--      An old notice with neither, matching one of their messages, is
--      deleted, never relabelled by name. Song suggestions: exactly the name
--      bw_display_name wrote (the full email when there was no name).
--    * Leaving the band as Auth deletes the account (band_members cascade):
--      member_left names a former member, with no id; after the profile goes
--      their id is scrubbed from notifications once more (trigger on
--      profiles, and delete-account calls bw_account_deletion_scrub).
--    * A poll they were the only invitee of closes (cancelled, no notice) and
--      stays private to its creator (an empty list means the whole band).
--    * The guard's error names who is deleting (admin or member, DETAIL);
--      the send refusal has its own hint, account_being_deleted.
--    * Withdrawing a suggestion returns only files no other song uses, when
--      #295's bw_song_files_left_unused exists (any order with 197).
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
  -- Set by prepare with its first erase (round 5): the point of no return.
  -- From then on the bands not in band_ids stay, so their last other member
  -- can't leave them empty, and the job finishes the deletion.
  committed_at timestamptz
);
-- An earlier draft of this migration called it prepared_at.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'account_deletions_pending' AND column_name = 'prepared_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'account_deletions_pending' AND column_name = 'committed_at') THEN
    ALTER TABLE public.account_deletions_pending RENAME COLUMN prepared_at TO committed_at;
  END IF;
END $$;
ALTER TABLE public.account_deletions_pending ADD COLUMN IF NOT EXISTS committed_at timestamptz;
ALTER TABLE public.account_deletions_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletions_pending FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_deletions_pending TO service_role;

-- Whether a pending deletion still holds. Begun only, nothing is erased yet:
-- it lapses after 15 minutes (an attempt that stopped early). Committed,
-- part of the account is already gone: it holds until the account is deleted
-- (the row cascades with the profile), so a retry, or the job a few minutes
-- later (round 5), still finds the bands as prepare left them.
CREATE OR REPLACE FUNCTION public.bw_account_deletion_holds(p_started timestamptz, p_committed timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT p_committed IS NOT NULL OR p_started > now() - interval '15 minutes';
$$;
REVOKE ALL ON FUNCTION public.bw_account_deletion_holds(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

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
-- p_noted: the band goes with the account. p_committed: prepare already ran
-- (the deletion is committed).
-- A co-admin who is deleting their own account (pending) doesn't count as
-- staying (round 2, B2).
CREATE OR REPLACE FUNCTION public.bw_account_deletion_conflict(
  p_band uuid, p_uid uuid, p_noted boolean, p_committed boolean)
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
  v_other_admins integer;
BEGIN
  SELECT bool_or(me.role::text = 'admin') INTO v_admin
    FROM public.band_members me
   WHERE me.band_id = p_band AND me.user_id = p_uid AND coalesce(me.is_active, true);
  IF v_admin IS NULL THEN
    RETURN NULL; -- not an active member: the band doesn't depend on them
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE NOT x.leaving),
         count(*) FILTER (WHERE NOT x.leaving AND x.is_admin),
         count(*) FILTER (WHERE x.is_admin)
    INTO v_others, v_staying, v_staying_admins, v_other_admins
    FROM (SELECT o.role::text = 'admin' AS is_admin,
                 EXISTS (SELECT 1 FROM public.account_deletions_pending d
                          WHERE d.user_id = o.user_id
                            AND public.bw_account_deletion_holds(d.started_at, d.committed_at)) AS leaving
            FROM public.band_members o
           WHERE o.band_id = p_band AND o.user_id <> p_uid AND coalesce(o.is_active, true)) x;

  IF v_others = 0 THEN
    -- Alone: the band goes with the account, unless prepare already kept it.
    RETURN CASE WHEN p_noted OR NOT p_committed THEN NULL ELSE 'band_left_empty' END;
  END IF;
  IF v_admin AND v_staying_admins = 0 THEN
    -- The other admins are deleting their accounts too: wait for them (round
    -- 4); once they are gone this is a plain last_admin.
    RETURN CASE WHEN v_other_admins > 0 THEN 'admins_leaving' ELSE 'last_admin' END;
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

  -- A retry once committed (round 4, 5): part of the account is already gone
  -- and the hold kept the bands as prepare left them, so the band checks
  -- passed for good. Only finish the job (started_at: the job leaves a row
  -- alone for 5 minutes after this).
  SELECT p.band_ids INTO v_bands
    FROM public.account_deletions_pending p
   WHERE p.user_id = p_uid AND p.committed_at IS NOT NULL;
  IF FOUND THEN
    UPDATE public.account_deletions_pending SET started_at = now() WHERE user_id = p_uid;
    RETURN jsonb_build_object('ok', true, 'committed', true, 'band_ids', to_jsonb(v_bands));
  END IF;

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

-- The person's direct chats (round 5, Codex B2): not a band, gig or group
-- chat, and they started it, are in it, or wrote in it. Not only by the
-- participant row: in an old chat the other person started, theirs may be
-- gone. Read before their messages lose their sender.
CREATE OR REPLACE FUNCTION public.bw_account_deletion_dm_chats(p_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id FROM public.chats c
   WHERE coalesce(c.type::text, '') NOT IN ('band', 'event', 'group')
     AND (c.created_by = p_uid
          OR EXISTS (SELECT 1 FROM public.chat_participants cp WHERE cp.chat_id = c.id AND cp.user_id = p_uid)
          OR EXISTS (SELECT 1 FROM public.messages m WHERE m.chat_id = c.id AND m.sender_id = p_uid));
$$;
REVOKE ALL ON FUNCTION public.bw_account_deletion_dm_chats(uuid) FROM PUBLIC, anon, authenticated;

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
  -- First the block (round 4, Codex B1). Marking the pending deletion
  -- committed holds its row lock to the end of this transaction, and the
  -- messages trigger reads that row FOR SHARE: a message being sent from
  -- another device either commits first (and is handled below) or waits for
  -- this transaction and is refused. Nothing can slip in between the steps.
  UPDATE public.account_deletions_pending
     SET committed_at = coalesce(committed_at, now())
   WHERE user_id = p_uid;

  -- Messages (owner decision 11-22): direct messages, and messages they had
  -- already deleted, go; band and event chat messages stay, as a former
  -- member's (sender_id NULL, the immutable-keys trigger allows it here).
  -- Direct chats go by chat too: a message without sender left in one of
  -- theirs (anonymised by an earlier attempt) can only be theirs.
  PERFORM set_config('bw.account_deletion_uid', p_uid::text, true);
  DELETE FROM public.messages m
   WHERE (m.sender_id = p_uid
          AND (coalesce((to_jsonb(m) ->> 'deleted')::boolean, false)
               OR NOT EXISTS (SELECT 1 FROM public.chats c
                               WHERE c.id = m.chat_id AND c.type::text IN ('band', 'event', 'group'))))
      OR (m.sender_id IS NULL
          AND m.chat_id IN (SELECT public.bw_account_deletion_dm_chats(p_uid)));
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

  -- A retry after prepare skips the band check: it passed, and the hold has
  -- kept it true since (round 4).
  IF NOT EXISTS (SELECT 1 FROM public.account_deletions_pending p
                  WHERE p.user_id = p_uid AND p.committed_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.bw_account_deletion_blockers(p_uid)) THEN
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
  INSERT INTO public.account_deletions_pending AS p (user_id, band_ids, committed_at)
  SELECT p_uid, coalesce(array_agg(id), '{}'), now() FROM gone
  ON CONFLICT (user_id) DO UPDATE
    SET band_ids = ARRAY(SELECT DISTINCT x FROM unnest(p.band_ids || EXCLUDED.band_ids) AS x),
        committed_at = coalesce(p.committed_at, now());

  -- Personal gigs are deleted with the account.
  DELETE FROM events WHERE band_id IS NULL AND created_by = p_uid;

  -- Their polls keep the time zone their vote-by deadline is read in
  -- (round 3: without it a closed New York poll reopened under UTC-12).
  UPDATE public.rehearsal_polls rp
     SET creator_timezone = nullif(trim(pr.timezone), '')
    FROM public.profiles pr
   WHERE pr.id = p_uid AND rp.created_by = p_uid AND nullif(trim(pr.timezone), '') IS NOT NULL;

  -- A poll they were invited to vote on no longer counts them (round 4: the
  -- room cost split among the rest). Round 5 (Claude): the last invitee too.
  -- Then nobody is left to vote: an open poll closes (cancelled, no notice),
  -- and it stays private to its creator, since an empty list means the whole
  -- band. A poll that was only theirs (they made it, only for themselves)
  -- goes.
  DELETE FROM public.rehearsal_polls rp
   WHERE rp.invited_user_ids = ARRAY[p_uid] AND rp.created_by = p_uid;
  UPDATE public.rehearsal_polls rp
     SET invited_user_ids = CASE WHEN cardinality(rp.invited_user_ids) > 1
                                 THEN array_remove(rp.invited_user_ids, p_uid)
                                 ELSE ARRAY[rp.created_by] END,
         status = CASE WHEN cardinality(rp.invited_user_ids) = 1 AND rp.status IN ('proposed', 'polling')
                       THEN 'cancelled' ELSE rp.status END,
         updated_at = CASE WHEN cardinality(rp.invited_user_ids) = 1 THEN now() ELSE rp.updated_at END
   WHERE p_uid = ANY (rp.invited_user_ids);

  -- Notifications first: they find the person's chat messages by sender.
  PERFORM public.bw_account_deletion_notifications(p_uid);
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
-- B2: once committed, the person sends nothing more (another device
-- still signed in; no time limit, like the hold, round 4): a direct message would outlive the deletion with no
-- sender. One that got in while prepare ran is caught by the last step.
CREATE OR REPLACE FUNCTION public.bw_trg_messages_deleting_sender()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_committed timestamptz;
BEGIN
  IF NEW.sender_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- FOR SHARE: waits while prepare is marking this row (round 4, B1), then
  -- reads what it committed. Deadlock note (Claude round 5): this row lock
  -- is taken inside a message insert, after the insert's own locks; prepare
  -- takes bands and band_members first and this row last. So no AFTER
  -- trigger on messages may ever lock bands or band_members rows (FOR
  -- UPDATE / FOR SHARE, or an UPDATE of them): it would wait on prepare
  -- while prepare waits on this row.
  SELECT p.committed_at INTO v_committed
    FROM public.account_deletions_pending p
   WHERE p.user_id = NEW.sender_id
     FOR SHARE;
  IF v_committed IS NOT NULL THEN
    -- Readable as it is (older builds show the message); the code is the hint.
    RAISE EXCEPTION 'Your account is being deleted.'
      USING ERRCODE = 'P0001', HINT = 'account_being_deleted';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_messages_deleting_sender() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_messages_deleting_sender ON public.messages;
CREATE TRIGGER bw_messages_deleting_sender
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_messages_deleting_sender();

-- The last step before Auth deletes the user (delete-account): their files
-- (round 4, B3: another device uploaded before the block), notifications and
-- messages once more. A personal file still there stops it (storage_not_ready,
-- nothing changed): the function removes those through the Storage API first.
CREATE OR REPLACE FUNCTION public.bw_account_deletion_finish(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_storage jsonb;
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'p_uid is required' USING ERRCODE = '22004';
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    v_storage := public.bw_account_storage_release(p_uid);
    IF coalesce((v_storage ->> 'personal_left')::int, 1) > 0 THEN
      RAISE EXCEPTION 'storage_not_ready' USING ERRCODE = 'P0001', DETAIL = v_storage::text;
    END IF;
  END IF;
  PERFORM public.bw_account_deletion_notifications(p_uid);
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
-- Round 5 (Claude review of #295): with #295's 197 applied (in either order)
-- it returns only the files no other song uses, as 197's copy does; without
-- 197, as before.
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
  IF g.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'This suggestion was already reviewed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.song_suggestions SET status = 'withdrawn', reviewed_at = now() WHERE id = g.id;
  IF g.kind = 'new_song' THEN
    SELECT id, status, audio_url, chart_url INTO s FROM public.songs WHERE id = g.song_id;
    IF s.id IS NOT NULL AND s.status = 'suggested' THEN
      DELETE FROM public.songs WHERE id = s.id;
      IF to_regprocedure('public.bw_song_files_left_unused(text[])') IS NOT NULL THEN
        -- 197: after the delete, the files nothing else uses (claimed).
        EXECUTE 'SELECT public.bw_song_files_left_unused($1)' INTO v_files
          USING ARRAY[s.audio_url, s.chart_url];
        v_files := coalesce(v_files, '[]'::jsonb);
      ELSE
        v_files := to_jsonb(array_remove(ARRAY[s.audio_url, s.chart_url], NULL));
      END IF;
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
-- The two receipts start from the previous definition in the apply order:
-- #281's 175 (bw_mark_chats_delivered and bw_mark_chat_read, fix/security-
-- audit 44cf49fc), which already has IS DISTINCT FROM and the stale-row rule
-- bw_chat_scope_ok_for. Same bodies; the only change is that the rule is
-- added at run time (EXECUTE) when that function exists, so 180 also works
-- without 175. PGlite loads the real 175 by function name, then 180.
CREATE OR REPLACE FUNCTION public.bw_mark_chats_delivered()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_scope text := CASE WHEN to_regprocedure('public.bw_chat_scope_ok_for(uuid,uuid)') IS NOT NULL
                       THEN 'AND public.bw_chat_scope_ok_for(cp.chat_id, cp.user_id)' ELSE '' END;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  EXECUTE format($q$
    UPDATE chat_participants cp
       SET last_delivered_at = now()
     WHERE cp.user_id = $1
       %s
       AND EXISTS (
         SELECT 1 FROM messages m
          WHERE m.chat_id = cp.chat_id
            AND m.sender_id IS DISTINCT FROM $1
            AND m.created_at > coalesce(cp.last_delivered_at, '-infinity'::timestamptz)
       )$q$, v_scope)
  USING auth.uid();
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
  v_scope text := CASE WHEN to_regprocedure('public.bw_chat_scope_ok_for(uuid,uuid)') IS NOT NULL
                       THEN 'AND public.bw_chat_scope_ok_for(cp.chat_id, cp.user_id)' ELSE '' END;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  EXECUTE format($q$
    UPDATE chat_participants cp
       SET last_read_at = now(),
           last_delivered_at = now()
     WHERE cp.chat_id = $2
       AND cp.user_id = $1
       %s
       AND (
         cp.last_read_at IS NULL
         OR EXISTS (
           SELECT 1 FROM messages m
            WHERE m.chat_id = cp.chat_id
              AND m.sender_id IS DISTINCT FROM $1
              AND m.created_at > cp.last_read_at
         )
       )$q$, v_scope)
  USING auth.uid(), p_chat_id;
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
-- No GRANT/REVOKE: CREATE OR REPLACE keeps the function's privileges, so
-- #297's 195 (it revokes EXECUTE from authenticated) holds in either order.


-- ── 6. Round 4 (Claude and Codex reviews #282) ────────────────────────────
-- "Former member" in the notification's language (the app's wording).
CREATE OR REPLACE FUNCTION public.bw_former_member_label(p_lang text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE lower(left(btrim(coalesce(p_lang, '')), 2))
           WHEN 'it' THEN 'Ex membro'
           WHEN 'es' THEN 'Antiguo miembro'
           WHEN 'fr' THEN 'Ancien membre'
           WHEN 'de' THEN 'Ehemaliges Mitglied'
           WHEN 'pt' THEN 'Antigo membro'
           ELSE 'Former member' END;
$$;
REVOKE ALL ON FUNCTION public.bw_former_member_label(text) FROM PUBLIC, anon, authenticated;

-- p_text with its first p_from replaced by p_to.
CREATE OR REPLACE FUNCTION public.bw_text_replace_first(p_text text, p_from text, p_to text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN p_text IS NULL OR coalesce(p_from, '') = '' OR position(p_from IN p_text) = 0 THEN p_text
              ELSE overlay(p_text PLACING coalesce(p_to, '') FROM position(p_from IN p_text) FOR length(p_from)) END;
$$;
REVOKE ALL ON FUNCTION public.bw_text_replace_first(text, text, text) FROM PUBLIC, anon, authenticated;

-- Other people's notifications about the person (Codex B2, owner's rule):
--   * about their direct chats: deleted, on both sides;
--   * about their band and gig chat messages: the sender's name becomes
--     "Former member" in the recipient's language (title, data.senderName /
--     sender_name, a mention's data.title); the text stays, like the message;
--   * about their song suggestions: no `by`, no id in the tag, the name in
--     the text replaced; a review they made: the name replaced;
--   * their id goes from every other notification's data.
-- Round 5 (Codex B2, B3, Claude minors 1-2):
--   * direct chats are found by chat (bw_account_deletion_dm_chats), not
--     only by their participant row;
--   * a chat notification is theirs only by its sender id (data.sender_id,
--     written since round 5) or its message (data.message_id, #284 / #291).
--     Never by name: names change, and two members can share one. An older
--     one with neither id that matches one of their messages in that chat
--     (same text, sent around then) is deleted, not relabelled;
--   * suggestions: exactly the text bw_display_name (066) wrote, so the full
--     email when they had no name, never "Former member@example.com".
-- Runs again after the profile is gone (bw_account_deletion_scrub): then
-- only the id parts can still find anything.
CREATE OR REPLACE FUNCTION public.bw_account_deletion_notifications(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_who text;
BEGIN
  IF to_regclass('public.notifications') IS NULL THEN
    RETURN;
  END IF;
  -- The name the server texts used, as they wrote it (NULL without profile).
  v_who := nullif(public.bw_display_name(p_uid), 'A member');

  DELETE FROM public.notifications n
   WHERE n.type IN ('chat_message', 'chat_mention')
     AND coalesce(n.data ->> 'chat_id', n.data ->> 'chatId') IN (
           SELECT c::text FROM public.bw_account_deletion_dm_chats(p_uid) AS c);

  -- Older notices with neither id first (the relabel below drops sender_id).
  DELETE FROM public.notifications n
   WHERE n.type IN ('chat_message', 'chat_mention')
     AND n.user_id IS DISTINCT FROM p_uid
     AND NOT n.data ? 'sender_id' AND NOT n.data ? 'message_id'
     AND EXISTS (SELECT 1 FROM public.messages m
                  WHERE m.sender_id = p_uid
                    AND m.chat_id::text = coalesce(n.data ->> 'chat_id', n.data ->> 'chatId')
                    AND starts_with(coalesce(m.content, ''), coalesce(n.data ->> 'content', n.body, ''))
                    AND n.created_at BETWEEN m.created_at - interval '1 minute' AND m.created_at + interval '10 minutes');

  UPDATE public.notifications n
     SET title = CASE WHEN n.type = 'chat_message' THEN x.label
                      ELSE public.bw_text_replace_first(n.title, x.from_name, x.label) END,
         data = (n.data - 'sender_id')
                || CASE WHEN n.data ? 'senderName' THEN jsonb_build_object('senderName', x.label) ELSE '{}'::jsonb END
                || CASE WHEN n.data ? 'sender_name' THEN jsonb_build_object('sender_name', x.label) ELSE '{}'::jsonb END
                || CASE WHEN n.data ? 'title'
                        THEN jsonb_build_object('title', public.bw_text_replace_first(n.data ->> 'title', x.from_name, x.label))
                        ELSE '{}'::jsonb END
    FROM (SELECT n2.id,
                 coalesce(n2.data ->> 'sender_name', n2.data ->> 'senderName') AS from_name,
                 public.bw_former_member_label(
                   (SELECT r.preferred_language FROM public.profiles r WHERE r.id = n2.user_id)) AS label
            FROM public.notifications n2
           WHERE n2.type IN ('chat_message', 'chat_mention')
             AND n2.user_id IS DISTINCT FROM p_uid
             AND (n2.data ->> 'sender_id' = p_uid::text
                  OR (n2.data ? 'message_id'
                      AND EXISTS (SELECT 1 FROM public.messages m
                                   WHERE m.id::text = n2.data ->> 'message_id' AND m.sender_id = p_uid)))) x
   WHERE n.id = x.id;

  UPDATE public.notifications n
     SET body = public.bw_text_replace_first(n.body, v_who,
                  public.bw_former_member_label((SELECT r.preferred_language FROM public.profiles r WHERE r.id = n.user_id))),
         data = (n.data - 'by')
                || CASE WHEN n.data ? 'tag'
                        THEN jsonb_build_object('tag', 'song-suggestion-' || coalesce(n.data ->> 'suggestion_id', n.reference_id::text, ''))
                        ELSE '{}'::jsonb END
   WHERE n.type = 'song_suggestion' AND n.data ->> 'by' = p_uid::text AND n.user_id IS DISTINCT FROM p_uid;

  UPDATE public.notifications n
     SET body = public.bw_text_replace_first(n.body, v_who,
                  public.bw_former_member_label((SELECT r.preferred_language FROM public.profiles r WHERE r.id = n.user_id)))
   WHERE n.type = 'song_suggestion_reviewed' AND n.user_id IS DISTINCT FROM p_uid AND v_who IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.song_suggestions g
                  WHERE g.id::text = coalesce(n.data ->> 'suggestion_id', n.reference_id::text)
                    AND g.reviewed_by = p_uid);

  UPDATE public.notifications n
     SET data = public.bw_jsonb_without_person(n.data, p_uid::text)
   WHERE n.user_id IS DISTINCT FROM p_uid AND n.data IS NOT NULL
     AND strpos(n.data::text, p_uid::text) > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_account_deletion_notifications(uuid) FROM PUBLIC, anon, authenticated;

-- B3: no uploads while one's own deletion holds (from begin; for good once
-- prepared). A file uploaded from another device after the storage step
-- would stay owned by the account and stop Auth after data is gone.
CREATE OR REPLACE FUNCTION public.bw_my_account_deletion_pending()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.account_deletions_pending p
     WHERE p.user_id = auth.uid() AND public.bw_account_deletion_holds(p.started_at, p.committed_at));
$$;
REVOKE ALL ON FUNCTION public.bw_my_account_deletion_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_my_account_deletion_pending() TO authenticated;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;
  DROP POLICY IF EXISTS bw_no_upload_while_deleting ON storage.objects;
  CREATE POLICY bw_no_upload_while_deleting ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (NOT public.bw_my_account_deletion_pending());
  DROP POLICY IF EXISTS bw_no_overwrite_while_deleting ON storage.objects;
  CREATE POLICY bw_no_overwrite_while_deleting ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (NOT public.bw_my_account_deletion_pending())
    WITH CHECK (NOT public.bw_my_account_deletion_pending());
END $$;

-- As 123, plus the poll's copy of the creator's time zone (Codex minor:
-- without it a deleted creator's proposal lapsed only after 8 days).
CREATE OR REPLACE FUNCTION public.bw_expire_rehearsal_proposals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.rehearsal_polls rp
     SET status = 'expired', updated_at = now()
   WHERE rp.status = 'proposed'
     AND now() >= public.bw_rehearsal_proposal_ends(
           rp.created_at, rp.notes,
           coalesce((SELECT nullif(btrim(p.timezone), '') FROM public.profiles p WHERE p.id = rp.created_by),
                    nullif(btrim(rp.creator_timezone), '')));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_expire_rehearsal_proposals() FROM PUBLIC, anon, authenticated;

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
  v_by text;
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
       WHERE public.bw_account_deletion_holds(p.started_at, p.committed_at));
    PERFORM public.bw_band_deletion_lock(v_band);
    SELECT c.conflict, CASE WHEN d.role::text = 'admin' THEN 'admin' ELSE 'member' END
      INTO v_conflict, v_by
      FROM public.account_deletions_pending p
      JOIN public.band_members d
        ON d.band_id = v_band AND d.user_id = p.user_id AND coalesce(d.is_active, true)
      CROSS JOIN LATERAL (SELECT public.bw_account_deletion_conflict(
                            v_band, p.user_id, v_band = ANY (p.band_ids), p.committed_at IS NOT NULL) AS conflict) c
     WHERE public.bw_account_deletion_holds(p.started_at, p.committed_at)
       AND c.conflict IS NOT NULL
     LIMIT 1;
    IF v_conflict IS NOT NULL THEN
      -- Older builds show the message as it is (round 4): plain English;
      -- newer ones read the code from the hint and who is deleting (round 5,
      -- Claude minor 4: an admin, or a member) from the detail.
      IF v_by = 'admin' THEN
        RAISE EXCEPTION 'An admin of this band is deleting their account. Try again in a few minutes.'
          USING ERRCODE = 'P0001',
                DETAIL = jsonb_build_object('conflict', v_conflict, 'by', v_by)::text,
                HINT = 'account_deletion_in_progress';
      END IF;
      RAISE EXCEPTION 'A member of this band is deleting their account. Try again in a few minutes.'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object('conflict', v_conflict, 'by', v_by)::text,
              HINT = 'account_deletion_in_progress';
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

-- ── 8. Round 5 (Codex and Claude reviews #282) ────────────────────────────
-- Codex B4: as 046, plus a member who leaves because their account is being
-- deleted (committed, or the profile already gone: the band_members cascade
-- from Auth) is named "Former member" in each recipient's language, with no
-- id (member_user_id stays as a key, empty, so 089's text trigger still
-- words it "left"). Nobody gets "an admin removed you" for it.
CREATE OR REPLACE FUNCTION public.bw_trg_band_member_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_band_name text;
  v_name text;
  v_others uuid[];
  r record;
  v_joined boolean := false;
  v_left boolean := false;
  v_to uuid;
  v_label text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    v_joined := coalesce(NEW.is_active, true);
  ELSIF TG_OP = 'UPDATE' THEN
    v_joined := coalesce(NEW.is_active, true) AND NOT coalesce(OLD.is_active, true);
    v_left := NOT coalesce(NEW.is_active, true) AND coalesce(OLD.is_active, true);
  ELSE
    v_left := coalesce(OLD.is_active, true);
  END IF;

  IF NOT v_joined AND NOT v_left THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;

  SELECT name INTO v_band_name FROM public.bands WHERE id = r.band_id;
  IF v_band_name IS NULL THEN  -- band itself is being deleted
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  v_name := coalesce(public.bw_display_name(r.user_id), 'A member');
  v_others := array_remove(public.bw_active_band_member_ids(r.band_id), r.user_id);

  IF v_left AND (NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = r.user_id)
                 OR EXISTS (SELECT 1 FROM public.account_deletions_pending d
                             WHERE d.user_id = r.user_id AND d.committed_at IS NOT NULL)) THEN
    FOREACH v_to IN ARRAY v_others LOOP
      v_label := public.bw_former_member_label(
        (SELECT pr.preferred_language FROM public.profiles pr WHERE pr.id = v_to));
      PERFORM public.bw_notify(ARRAY[v_to], r.band_id, 'member_left',
        v_label || ' left ' || v_band_name, v_label || ' left the band.',
        jsonb_build_object('member_user_id', NULL::text, 'member_name', v_label, 'band_name', v_band_name),
        r.band_id, 'band');
    END LOOP;
  ELSIF v_joined THEN
    PERFORM public.bw_notify(v_others, r.band_id, 'member_joined',
      v_name || ' joined ' || v_band_name, 'Say hi and add them to your next lineup.',
      jsonb_build_object('member_user_id', r.user_id, 'member_name', v_name, 'band_name', v_band_name),
      r.band_id, 'band');
  ELSE
    IF v_actor IS NOT NULL AND v_actor <> r.user_id THEN
      -- Removed by someone else: tell the person, then the band.
      PERFORM public.bw_notify(ARRAY[r.user_id], r.band_id, 'member_left',
        'Removed from ' || v_band_name, 'An admin removed you from ' || v_band_name || '.',
        jsonb_build_object('removed', true, 'band_name', v_band_name), r.band_id, 'band');
      PERFORM public.bw_notify(v_others, r.band_id, 'member_left',
        v_name || ' left ' || v_band_name, v_name || ' is no longer in the band.',
        jsonb_build_object('member_user_id', r.user_id, 'member_name', v_name, 'band_name', v_band_name, 'removed', true),
        r.band_id, 'band');
    ELSE
      PERFORM public.bw_notify(v_others, r.band_id, 'member_left',
        v_name || ' left ' || v_band_name, v_name || ' left the band.',
        jsonb_build_object('member_user_id', r.user_id, 'member_name', v_name, 'band_name', v_band_name),
        r.band_id, 'band');
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_band_member_changed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bw_band_member_changed_notify ON public.band_members;
CREATE TRIGGER bw_band_member_changed_notify
  AFTER INSERT OR UPDATE OF is_active OR DELETE ON public.band_members
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_band_member_changed();

-- Codex B4: the final scrub, once Auth has deleted the user (their profile
-- and pending row are gone by then): their id out of every notification
-- written meanwhile (cascades into memberships, lineups...). delete-account
-- calls it after Auth; the trigger below runs it inside the Auth delete
-- itself, after the cascades, so it can't be skipped.
CREATE OR REPLACE FUNCTION public.bw_account_deletion_scrub(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'p_uid is required' USING ERRCODE = '22004';
  END IF;
  PERFORM public.bw_account_deletion_notifications(p_uid);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_account_deletion_scrub(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_account_deletion_scrub(uuid) TO service_role;

-- AFTER DELETE on profiles: the foreign-key cascades (band_members and the
-- rest) have run and written their notifications by then. Never stops the
-- delete: the explicit call after Auth goes over it again.
CREATE OR REPLACE FUNCTION public.bw_trg_profile_deleted_scrub()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.bw_account_deletion_notifications(OLD.id);
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_profile_deleted_scrub: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_profile_deleted_scrub() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_profile_deleted_scrub ON public.profiles;
CREATE TRIGGER bw_profile_deleted_scrub
  AFTER DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_profile_deleted_scrub();

-- Claude B1 + Codex B1: committed deletions nobody is working on get
-- finished by the server. Committed more than 5 minutes ago and untouched
-- for 5 minutes (a retry's begin, or an earlier run of the job, sets
-- started_at): each row returned is leased to the caller for 5 minutes
-- (SKIP LOCKED: two runs never get the same row at once).
CREATE OR REPLACE FUNCTION public.bw_account_deletions_due(p_limit integer DEFAULT 3)
RETURNS SETOF uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.account_deletions_pending p
     SET started_at = now()
   WHERE p.user_id IN (
           SELECT d.user_id FROM public.account_deletions_pending d
            WHERE d.committed_at IS NOT NULL
              AND d.committed_at < now() - interval '5 minutes'
              AND d.started_at < now() - interval '5 minutes'
            ORDER BY d.started_at
            LIMIT greatest(coalesce(p_limit, 3), 1)
              FOR UPDATE SKIP LOCKED)
  RETURNING p.user_id;
$$;
REVOKE ALL ON FUNCTION public.bw_account_deletions_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_account_deletions_due(integer) TO service_role;

-- The job: when something is due, delete-account's sweep (it removes the
-- files through the Storage API and deletes the user through Auth, which
-- SQL can't). Same dispatch secret and Vault entries as the push triggers
-- (048, 170); delete-account checks it with bw_verify_push_dispatch_secret.
-- Until delete-account with the sweep is deployed the call is a 401: harmless.
CREATE OR REPLACE FUNCTION public.bw_finish_account_deletions_dispatch()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.account_deletions_pending d
                  WHERE d.committed_at IS NOT NULL
                    AND d.committed_at < now() - interval '5 minutes'
                    AND d.started_at < now() - interval '5 minutes') THEN
    RETURN false;
  END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'bw_project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'bw_push_dispatch_secret' LIMIT 1;
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN false;
  END IF;
  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/delete-account',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bw-dispatch-secret', v_secret),
    body := jsonb_build_object('sweep', true),
    timeout_milliseconds := 120000
  );
  RETURN true;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_finish_account_deletions_dispatch: %', SQLERRM;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_finish_account_deletions_dispatch() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('bw-finish-account-deletions')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-finish-account-deletions');
  PERFORM cron.schedule('bw-finish-account-deletions', '*/5 * * * *', 'SELECT public.bw_finish_account_deletions_dispatch()');
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
