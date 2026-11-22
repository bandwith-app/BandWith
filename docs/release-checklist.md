# Release checklist

How a release goes out: in stages, with a way back at every step.

**Releases are manual.**
- The owner (or the partner) triggers every web deploy, APK publish and TestFlight upload.
- Claude sessions stop at **Candidate ready** below.

**Merge order:** this checklist (#278) merges **after** #273 (kill switches, migration 173) and #277 (crash reports, migration 174). It describes `app_flags`, `client_errors` and the `live_pack` switch, which those two add.

Surfaces:

| Surface | Who gets it | How it updates |
| --- | --- | --- |
| Web app, app.bandwith.fun (Vercel project `bandwith`) | Everyone, at once | On the next page load (no service worker) |
| Product site, bandwith.fun (Vercel project `bandwith-site`) | Everyone | On the next page load |
| Android APK (GitHub releases `android-v*`) | Whoever has the link, or the in-app update | In-app update, from 1.0.3 |
| iOS (TestFlight) | The group the build is added to | TestFlight app |
| Database + edge functions (Supabase `elvlzpowkohjbhxjasvd`) | Every build at once, old ones included | Immediately |

The web app and the database reach everyone at once. That is why they get the most care: old builds must keep working against the new database, and the web app ships last.

## 1 · Candidate ready

- [ ] All PRs for the release are merged on `main`. CI and the e2e suite passed: they are required checks.
- [ ] Emulator check passed on the **exact release commit**:
  ```sh
  scripts/emulator-check.sh
  scripts/emulator-check.sh --duo-ok
  ```
  - The `--duo-ok` run is the sign-off after checking every Duo posture.
  - `deploy-web.sh` and `release-android.sh --publish` refuse a commit without it.
- [ ] **170 is not applied anywhere yet**: `supabase_migrations.schema_migrations` has no `170` on prod, and no other database got it. 170 was edited in place on 11-22, so a copy applied before that is the old version.
- [ ] Each new migration was dry-run against prod and rolled back:
  - first strip the migration's own `BEGIN;` / `COMMIT;`, or it commits for real;
  - afterwards, check that its objects are **absent**.
- [ ] List the release's migrations in two groups:
  - **additive**: new tables, columns, functions, GRANTs;
  - **later**: revokes, drops, renames, anything an older build still uses.
- [ ] Each new feature has its kill switch in `app_flags` (see [flags.md](flags.md)). Seeded ON, unless it should start off.
- [ ] Academy and the handbook match the release. Run `node academy/scripts/prerender.mjs --update-lastmod` after text edits.
- [ ] Release worktree (clean checkout of the release commit) has the local-only files copied in:
  - `ios/App/App/GoogleService-Info.plist`;
  - `android/app/google-services.json`;
  - `android/local.properties`.

  Without the plist: no dSYM upload, so iOS crashes are unreadable. Without the json: no push, and no Crashlytics on Android.
- [ ] Before archiving iOS or building the APK, in the release worktree, build the web code and copy it into both apps:
  ```sh
  npx -y pnpm@10.34.9 install --frozen-lockfile
  npx -y pnpm@10.34.9 build          # app + academy/ (vite build alone leaves the apps without /academy/)
  LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx cap sync ios
  LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx cap sync android
  ```
  - Without UTF-8, CocoaPods stops with a `unicode_normalize` error.
  - `cap sync ios` rewrites `ios/App/Podfile` to `node_modules/.pnpm/…` paths, and `pod install` then clashes on the Firebase subspecs. Undo it and install from the committed Podfile:
    ```sh
    git checkout ios/App/Podfile ios/App/Podfile.lock
    LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx cap copy ios
    (cd ios/App && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install)
    ```
  - Check that `dist/academy/index.html` exists, then archive or build.

## 2 · Release-day order

Do it in this order, so every build in use keeps working at every step:

1. **Edge functions, before the migrations**
   - The new migrations' triggers and cron jobs call the functions (pushes, emails), so the new function code must already be there when they start.
   - A function that needs a table or column from this release must cope with it missing for those few minutes, or deploy that one right after its migration.
   - Deploy from a **clean worktree** on the release commit, only the functions that changed:
     ```sh
     supabase functions deploy <name> --no-verify-jwt --project-ref elvlzpowkohjbhxjasvd
     ```
   - Then check the function's logs in the Supabase dashboard for the first calls.
2. **Additive migrations**
   - Apply them with the service role, one at a time, **kill switches first**, then in number order. For the live release:
     1. `173_app_flags`;
     2. turn the live pack **off**, before 170 starts its invites:
        ```sql
        UPDATE public.app_flags SET enabled = false, updated_at = now() WHERE key = 'live_pack';
        ```
     3. `170_live_pack`;
     4. `174_client_errors`, then 175–189, then 190 and 191, in number order. All of them are additive.
   - 170 reads the switch itself (no table or no row means on), so the wrong order fails safe; it just leaves no way to stop its invites until 173 is in.
   - After each, run its test from `supabase/tests/` (they roll back), or a quick `SELECT` on what it added.
   - 174 schedules one pg_cron job, `bw-prune-client-errors` (hourly, minute 7). Check it shows in `cron.job`.
   - **live_pack stays off until stage 3**, when the new builds reach everyone (see there). While it is off, nobody gets invites or new packs. The trade-off for stages 1 and 2: `app_flags` is global, there is no per-band switch for it. To try the live pack on two phones, the owner turns it on for a short test window and off again after; every band with automatic packs gets invites during that window. A per-band switch would need a follow-up change.
3. **Builds for stage 1**
   - TestFlight: archive and upload from the Xcode Organizer (the CLI can't use the Xcode account).
   - APK: publish as a prerelease (below).
4. **Stages 1 → 2 → 3**: see the next section. The **web app ships in stage 3**, because it has no stages of its own.
   - Exception: a web-only fix for a live bug can go out the same day, once the migrations it needs are in.
5. **"Later" migrations** (revokes, drops) only after **every** build that used the old thing has updated. Raise `min_version` first (section 4) so stragglers are asked to update. Example: 119 waited for every build, TestFlight included. The code that waits for the same moment is in the **sunset list** (section 6).

## 3 · Staged rollout

### Stage 1 · Us: owner + partner (at least a day, and one real use)

- **iOS**: in App Store Connect › TestFlight, add the build to the internal group **Team BandWith** only. Add the partner as an internal tester if they aren't one yet.
- **iPhone Duo and iPad (giPad)**: install the same build.
- **Android**: publish a prerelease. The in-app updater and the fixed latest link both **skip prereleases**, so only whoever gets its own link installs it:
  ```sh
  scripts/release-android.sh 1.0.14 --publish --prerelease
  ```
  It prints the prerelease link, `…/releases/download/android-v1.0.14/BandWith.apk`. Send it to the partner.
- **Use it for real**: a rehearsal, or Stage on two phones, on every surface the release touched.
- **Read the crash reports** (section 5). Go on only when the new version shows nothing new.

### Stage 2 · A few testers (1–2 days)

- **Android**: send the same prerelease link to 3–5 testers who play gigs soon.
- **iOS**: the external group **Amici** has a public link, so adding a build there reaches every iOS tester.
  - For a small iOS stage, create a second external group (e.g. "Amici · first") with a few testers, and add the build there first.
  - The first build of a new version waits for Apple's beta review on external groups.
- **Read the crash reports** again, grouped by `app_version`.

### Stage 3 · Everyone

1. **Android**: promote the prerelease. From now on the in-app update offers it, and the latest link serves it.
   - Mark it **Latest only if it is the highest version** released, so a hotfix of an older line never takes the latest link. `scripts/android-latest-flag.sh` picks `--latest` or `--latest=false`:
     ```sh
     CURRENT=$(gh release view --repo bandwith-app/BandWith --json tagName -q .tagName)
     gh release edit android-v1.0.14 --repo bandwith-app/BandWith --prerelease=false \
       "$(scripts/android-latest-flag.sh 1.0.14 "$CURRENT")"
     ```
   - `release-android.sh --publish` (without `--prerelease`) uses the same check.
2. **iOS**: add the build to **Amici**.
3. **Web**:
   - from the `vercel-prod` worktree, on the release commit:
     ```sh
     scripts/deploy-web.sh
     ```
   - Note the deployment URL it prints: you need it to roll back.
4. **Product site** (only if `site/` changed):
   ```sh
   scripts/deploy-site.sh --prod
   scripts/indexnow.sh
   ```
5. **Turn the live pack on**, now that the new builds are out to everyone:
   ```sql
   UPDATE public.app_flags SET enabled = true, updated_at = now() WHERE key = 'live_pack';
   ```
6. **Tell the admins** what changed. This release, also: once 177 makes the quotes bucket private, quote PDF links shared before stop working. Line for admins: "Re-send the quote from the app to get a fresh link."
7. Watch the crash reports for the first hours, then the next morning.

## 4 · When something goes wrong

Pick the smallest fix that stops the harm, then ship a real fix through the stages again.

### A feature misbehaves: turn its flag off (seconds, every build)

Prod SQL editor, service role:

```sql
UPDATE public.app_flags SET enabled = false, updated_at = now() WHERE key = 'live_pack';
```

- Open apps pick it up on resume, on reconnect, or within 10 minutes. The feature disappears cleanly: no half state.
- Turn it back on with `enabled = true`.
- To cut off only the builds below a fixed version, use `min_app_version`.
- Keys and details: [flags.md](flags.md).

### Web app: roll back on Vercel (seconds)

From the `vercel-prod` worktree (linked to the `bandwith` project):

```sh
npx vercel@latest list --environment production
npx vercel@latest rollback <previous-production-url> --yes
npx vercel@latest rollback status
```

- On the Hobby plan, rollback goes to the **previous** production deployment only.
- To go further back, promote any earlier Ready deployment from the list:
  ```sh
  npx vercel@latest promote <older-deployment-url> --yes
  ```
- **After a rollback, Vercel stops moving the domains to new production deploys.** The next `scripts/deploy-web.sh` builds but does not go live. When the fix is deployed, make it live with:
  ```sh
  npx vercel@latest promote <fixed-deployment-url> --yes
  ```
  Or use "Undo Rollback" in the dashboard.
- The same works in the dashboard: Project › Deployments › ⋯ › Instant Rollback / Promote.

### Product site: same, for the `bandwith-site` project

There is no linked folder, so link one for the commands:

```sh
mkdir -p /tmp/bw-site/.vercel && cd /tmp/bw-site
printf '{"projectId":"prj_EwNYSQ4eHF7xCnFWaoOMkzhqyBUB","orgId":"team_M6xaMWJfK2rvNzXwTs3ng8Km","projectName":"bandwith-site"}' > .vercel/project.json
npx vercel@latest list --environment production
npx vercel@latest rollback <previous-production-url> --yes
```

### Android: stop it spreading, then ship a fix

An installed APK can't be downgraded: the version code only goes up. So:

1. Hide the bad release from the updater and the latest link at once. The previous release becomes "latest" again:
   ```sh
   gh release edit android-v1.0.14 --repo bandwith-app/BandWith --prerelease --latest=false
   gh release edit android-v1.0.13 --repo bandwith-app/BandWith --latest
   ```
2. Remove the bad APK itself. A prerelease's direct link (`…/download/android-v1.0.14/BandWith.apk`) keeps working, and testers have it. Delete the asset, or rename it so the old link stops:
   ```sh
   gh release delete-asset android-v1.0.14 BandWith.apk --repo bandwith-app/BandWith --yes
   ```
   To keep the file for debugging, download it first (`gh release download android-v1.0.14 --repo bandwith-app/BandWith`) and upload it again under another name, e.g. `BandWith-withdrawn.apk`.
3. **The in-app updater caches the newest release for 6 hours** (`src/lib/androidUpdate.ts`). A phone that checked just before can still offer the bad version for up to 6 hours. With the asset gone, its download fails instead of installing. Tell testers not to update until the fix is out.
4. Turn off the feature's flag if there is one.
5. Ship a **new version** (1.0.15) with the fix, or with the revert, through the stages.

### iOS: stop distributing, testers can go back

- App Store Connect › TestFlight: remove the build from **Amici**, from the external pilot group **Amici · first** (stage 2), and from Team BandWith if needed. New testers stop getting it.
- Testers who already have it can install the previous build: TestFlight app › BandWith › Previous Builds.
- Don't **expire** the build unless it is harmful: an expired build no longer opens.
- Ship a fixed build through the stages.

### Force an update after a fix (any platform)

Below `min_version` the app shows a full-screen "Update BandWith" (migration 162):
- iOS: compares the build number;
- Android: compares the version name;
- web: compares the build stamp.

```sql
INSERT INTO public.app_versions (platform, min_version, updated_at)
VALUES ('android', '1.0.15', now())
ON CONFLICT (platform) DO UPDATE SET min_version = EXCLUDED.min_version, updated_at = now();
```

- Set it only once the fixed build is **available to everyone** on that platform, or people get stuck on the block screen.
- For iOS, also set `store_url`: the TestFlight link while there is no App Store page.

### Edge function: redeploy the previous version

```sh
git worktree add /tmp/bw-fn-rollback <previous-release-commit>
cd /tmp/bw-fn-rollback
supabase functions deploy <name> --no-verify-jwt --project-ref elvlzpowkohjbhxjasvd
```

### Migration: fix forward

- There is no automatic undo.
- An additive migration is safe to leave in place while the app is rolled back.
- If one breaks something, write the next-numbered migration that fixes it. Dry-run it as in section 1, then apply.

## 5 · Reading crash reports

Details and more queries: [crash-reports.md](crash-reports.md).

- **JavaScript errors** (web app + the WebView in the apps): prod SQL editor, the last 24 hours by version. A new message on the new `app_version` is the signal:
  ```sql
  SELECT platform, app_version, route, kind, message, count(*) AS n, max(created_at) AS last_seen
    FROM public.client_errors
   WHERE created_at > now() - interval '24 hours'
   GROUP BY 1, 2, 3, 4, 5
   ORDER BY n DESC
   LIMIT 50;
  ```
- **Native crashes**: Firebase console › project `bandwith-79115` › Crashlytics:
  - Android: `com.bandwith.app`;
  - iOS: `app.bandwith.mobile`.

  Filter by the new version, and look at "New issues".

**Stop the rollout** (section 4) when either happens on the new version:
- a crash, or an error that repeats on the same screen;
- something a tester reports during a gig or rehearsal.

Go on when the new version shows nothing that the previous one didn't.

## 6 · After

- [ ] All surfaces are on the release, and the APK release is marked **Latest**.
- [ ] "Later" migrations scheduled, if any (section 2, step 5).
- [ ] Release notes for testers: `scripts/android-release-notes.md`, and the TestFlight "What to Test". Put in any line the admins need (stage 3, step 6), e.g. for 177: "Re-send the quote from the app to get a fresh link."

### Sunset list: when `min_version` is raised past this release

Code that stays only for older builds. Remove it once `min_version` (section 4) is past the release that made it unnecessary, on every platform:

- **Drop Bluetooth HMAC acceptance (audit #1).** Once `min_version` is raised past the release that shipped migration 190 (every leader signs), remove the band-key path on members:
  - `decodeStageState` fallback in `useStageBle` (`signedLink` false → band key);
  - the `'old-leader'` status and its line;
  - the leader's `StageBle.update` on `b7d50001` (keep the characteristic, empty).

  Until then, a member posing as an old leader can still lead phones out of range of the real admin.
- **Stop accepting deputy reply tokens as calendar keys** (182's fallback). 182 gives deputies a separate, read-only calendar key, but `bw_deputy_calendar_feed` still takes the old reply token, so calendar subscriptions made before 182 keep working. Remove that fallback once those subscriptions have been re-made: tell deputies to subscribe again from the reply page, and give it a release or two. Until then, whoever has a deputy's old subscription link can read that deputy's gigs with the band.
