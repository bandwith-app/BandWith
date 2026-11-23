-- Replay bridge for supabase/tests/integration-chain.pglite.mjs (Codex, #278).
--
-- Prod was not built from these files alone: tables, columns and types were
-- also made by hand or in the dashboard, and some files were alternatives
-- (002 v2) or never matched (024's FK test). Replaying 001 → latest on an
-- empty database needs what follows, and only this: each block says what prod
-- has that no migration made. Never change a migration to make the replay
-- pass; add the missing piece here, with the reason.
--
-- Directives (one per line, read by the suite):
--   -- @order a.sql b.sql …       these first, in this order; then the rest by name
--   -- @skip f.sql (reason)        never applied
--   -- @sub f.sql <old> => <new>  one literal replacement in f before it runs
--                                 (the replay fails if <old> is not in f)
--   -- @before f.sql              the SQL up to the next directive runs before f
--
-- @order 002_complete_schema.sql 001_onboarding.sql
-- @skip 002_complete_schema_v2.sql (an alternative 002 that drops and recreates the types; v3 is the one for an existing database)
-- @before 002_complete_schema.sql
-- prod's band_members.role is the enum user_role (052, 061, 066, 073 cast to it); 002 wrote varchar
CREATE TYPE public.user_role AS ENUM ('admin', 'member');
-- prod's events.event_type and status are text (the app writes 'quote', 'pending', … and 083 compares with '')
-- @sub 002_complete_schema.sql event_type event_type NOT NULL, => event_type text NOT NULL,
-- @sub 002_complete_schema.sql status event_status DEFAULT 'draft', => status text DEFAULT 'draft',
-- @sub 002_complete_schema.sql role VARCHAR(20) DEFAULT 'member', -- admin, member => role user_role DEFAULT 'member', -- admin, member
-- @before 008_rehearsal_tables.sql
-- prod's rehearsal_tasks has 008's shape (002 made it without these columns)
ALTER TABLE public.rehearsal_tasks ADD COLUMN IF NOT EXISTS is_completed boolean DEFAULT false, ADD COLUMN IF NOT EXISTS notes text;
-- @before 023_fix_band_members_profiles_relationship.sql
-- the legacy invitations table was made by hand on prod (044 copies its pending rows)
CREATE TABLE IF NOT EXISTS public.invitations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, email text, role text, status text DEFAULT 'pending', token uuid, created_at timestamptz DEFAULT now());
-- @before 024_fix_all_schema_issues.sql
-- 024's "points at auth.users" test compares the referenced column with 'user_id', so it never
-- matches: on prod neither FK had these names yet (024 adds them unconditionally)
ALTER TABLE public.chat_participants DROP CONSTRAINT IF EXISTS chat_participants_user_id_fkey;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;
-- @before 034_auto_set_member_mode.sql
-- profiles columns added by hand on prod (onboarding writes them)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_mode text, ADD COLUMN IF NOT EXISTS sub_tier text;
-- @before 051_quotes_members_songs_access.sql
-- quote child tables made by hand on prod (051 only re-scopes their policies)
CREATE TABLE IF NOT EXISTS public.quote_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid REFERENCES public.quotes(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS public.quote_musicians (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid REFERENCES public.quotes(id) ON DELETE CASCADE);
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_musicians ENABLE ROW LEVEL SECURITY;
-- @before 071_member_permissions.sql
-- added by hand on prod (the decline sheet writes it; 105 and 163 read it)
ALTER TABLE public.event_members ADD COLUMN IF NOT EXISTS decline_reason text;
-- @before 073_baseline_live_policies.sql
-- tables made on prod outside the migrations (062 beta_requests is a local-only file; the rest by hand
-- or by the dashboard): 073 re-creates their live policies, so here they get the columns those read
CREATE TABLE IF NOT EXISTS public.beta_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
  platform text, name text, email text, status text NOT NULL DEFAULT 'pending', invited_at timestamptz);
CREATE TABLE IF NOT EXISTS public.kv_store_c689d939 (key text PRIMARY KEY, value jsonb);
CREATE TABLE IF NOT EXISTS public.playlists (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid REFERENCES public.bands(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS public.playlist_songs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), playlist_id uuid REFERENCES public.playlists(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS public.proposals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid REFERENCES public.bands(id) ON DELETE CASCADE, proposed_by uuid);
CREATE TABLE IF NOT EXISTS public.push_subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE IF NOT EXISTS public.subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE IF NOT EXISTS public.tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid REFERENCES public.bands(id) ON DELETE CASCADE, assigned_to uuid);
-- @before 076_band_member_fees_rpc.sql
-- added by hand on prod (the member fee sheet writes it)
ALTER TABLE public.band_members ADD COLUMN IF NOT EXISTS fee_percentage numeric;
-- @before 078_event_private_rpc.sql
-- added by hand on prod (the gig money section writes it)
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS pay numeric;
-- @before 081_event_private_revoke.sql
-- legacy event columns made by hand on prod (081 grants them column by column)
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue text, ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS date date, ADD COLUMN IF NOT EXISTS time time, ADD COLUMN IF NOT EXISTS duration_hours numeric;
