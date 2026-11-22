# Release checklist

How a release goes out: in stages, with a way back at every step.

**Releases are manual.**
- The owner (or the partner) triggers every web deploy, APK publish and TestFlight upload.
- Claude sessions stop at **Candidate ready** below.

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

## 2 · Release-day order

Do it in this order, so every build in use keeps working at every step:

1. **Additive migrations**
   - Apply them with the service role, one at a time, in number order.
   - After each, run its test from `supabase/tests/` (they roll back), or a quick `SELECT` on what it added.
2. **Edge functions**
   - Deploy from a **clean worktree** on the release commit, only the functions that changed:
     ```sh
     supabase functions deploy <name> --no-verify-jwt --project-ref elvlzpowkohjbhxjasvd
     ```
   - Then check the function's logs in the Supabase dashboard for the first calls.
3. **Builds for stage 1**
   - TestFlight: archive and upload from the Xcode Organizer (the CLI can't use the Xcode account).
   - APK: publish as a prerelease (below).
4. **Stages 1 → 2 → 3**: see the next section. The **web app ships in stage 3**, because it has no stages of its own.
   - Exception: a web-only fix for a live bug can go out the same day, once the migrations it needs are in.
5. **"Later" migrations** (revokes, drops) only after **every** build that used the old thing has updated. Raise `min_version` first (section 4) so stragglers are asked to update. Example: 119 waited for every build, TestFlight included.

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

1. **Android**: promote the prerelease. From now on the in-app update offers it, and the latest link serves it:
   ```sh
   gh release edit android-v1.0.14 --repo bandwith-app/BandWith --prerelease=false --latest
   ```
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
5. Watch the crash reports for the first hours, then the next morning.

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
2. Turn off the feature's flag if there is one.
3. Ship a **new version** (1.0.15) with the fix, or with the revert, through the stages.

### iOS: stop distributing, testers can go back

- App Store Connect › TestFlight: remove the build from **Amici** (and from Team BandWith if needed). New testers stop getting it.
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
- [ ] Release notes for testers: `scripts/android-release-notes.md`, and the TestFlight "What to Test".
