# Crash reports

We learn about errors before users report them.

| What | Where it goes | Code |
| --- | --- | --- |
| JavaScript errors: the web app and the iOS/Android WebView. Window errors, unhandled promise rejections, screens that fail to draw | Our own table `public.client_errors` (migration `174_client_errors.sql`), kept 14 days | `src/lib/crashReports.ts`, `ErrorBoundary` |
| Native crashes: iOS, Android | Firebase Crashlytics, project `bandwith-79115` (the same Firebase project as analytics). **Only with the usage statistics yes** | `@capacitor-firebase/crashlytics` |

**Settings › Privacy & account › Send crash reports**: on by default, per device. It covers our own scrubbed JavaScript reports, and it can stop Crashlytics too.

**Crashlytics only with consent** (owner decision 2026-11-22, for ePrivacy: Crashlytics stores an installation ID on the device):
- Collection off from the very first launch: `FirebaseCrashlyticsCollectionEnabled` = false in `Info.plist`, `firebase_crashlytics_collection_enabled` = false in the Android manifest. So nothing is **uploaded** before the app has asked. Something is still **created on the device**: see "Before the yes" below.
- On only when **both** are true: the user said yes to **Anonymous usage statistics** under the current wording (the same question and Settings row as analytics, #238; its copy says crash details are included), and **Send crash reports** is on.
- **The wording is versioned** (`bw.analytics.consent_version` = 2). A yes given in an older build, before the question named crash details, still covers usage statistics but never Crashlytics, and the question is asked once more. An older no stays a no.
- **A no always wins**: if the device can read storage but not write it, the no holds in memory for the run (over the yes still on disk), and the write is tried again (1 s, 5 s, 15 s, 1 min, 5 min). The answer is written before its version: if only the first write lands and the app closes, a no is still a no, and a yes is asked again.
- While it is off, crash reports Crashlytics kept but hasn't sent are deleted at every start and at every change.

**Before the yes: what Crashlytics creates on the device** (read in the SDK source, FirebaseCrashlytics 12.19; not measured on a device). Nothing of it leaves the phone while collection is off.
- **iOS**: both Capacitor plugins call `FirebaseApp.configure()` when they load, at launch, whenever `GoogleService-Info.plist` is in the bundle. Crashlytics is an eager component, so it starts then too:
  - a random installation UUID in the app's user defaults (`com.crashlytics.iuuid`, `FIRCLSInstallIdentifierModel`);
  - its folder `Library/Caches/com.crashlytics.data` and a report for the current run (`FIRCLSReportManager startWithProfiling`); the crash handler is installed, so a crash is written there;
  - no settings fetch and no upload: those wait for `isCrashlyticsCollectionEnabled`. Our start-up `deleteUnsentReports()` removes the written reports while it is off.
- **Android** (from the SDK's documented behaviour, not read in source here): `FirebaseInitProvider` starts Firebase at process start, which push (FCM) needs anyway; Crashlytics is eager there too, keeps its files under the app's files folder and an installation id in its shared preferences. Same: no upload while off.
- **Decision for this release (2026-11-22): accepted as it is, on both platforms.** Nothing leaves the device before the yes (no settings fetch, no upload), the kept reports are deleted while it is off, and the local installation ID and cache folder are stated here and in the Privacy Policy line below.
- **Follow-up after the release, iOS only**: start Firebase only after the yes. Patch both Capacitor plugins (`@capacitor-firebase/analytics`, `@capacitor-firebase/crashlytics`) so they don't call `FirebaseApp.configure()` when they load, and configure it on the first yes. Crashes before the yes are then not recorded at all. **Only if it doesn't affect push**: check that APNs registration and any FCM init still work with Firebase configured late, on a simulator and a device, before it ships.
- Android stays as it is: Firebase must start at launch for push (FCM), and Crashlytics can't be delayed there, only removed.

Switching **Send crash reports** off:
- no more rows in `client_errors`;
- Crashlytics collection is turned off (Crashlytics keeps that across launches), and its unsent reports are deleted;
- reports waiting on the device are dropped, and requests already out are aborted, even one still waiting for a session refresh;
- on the web the choice is shared by every tab: an opt-out in one tab wins over another tab that still had it on;
- if the device's storage is blocked, an opt-out still holds until the app is closed (it can only turn reports off, never back on);
- the switch survives the storage clear a failed sign-out does (`src/lib/privacyChoices.ts` keeps it, and the analytics answer with its version): a missing key means on, which only a new install should get;
- if storage stops answering, the last answer this run saw holds; with none (unreadable from the start), reports are off: it fails closed.

## What is sent (and what never is)

- **Sent**:
  - the error message and stack;
  - the app version (iOS build number, Android version name, web build stamp);
  - the platform (`ios` / `android` / `web`);
  - the screen name (`Stage`, `Gig`, `Calendar`, …).
- **Never sent**:
  - user id, email, names;
  - song, gig, message or contact content.

Before sending, the device scrubs the message and **every line** of the stack (the first line repeats the message):

| Found | Sent as |
| --- | --- |
| Emails, URL-encoded ones too (`mary%40gmail.com`) | `<email>` |
| UUIDs | `<id>` |
| JWTs (even just their first part, `eyJ…`), `Bearer …`, keys with a known prefix (`sk_`, `pk_`, `rk_`, `sb_`, `whsec_`) and long tokens | `<token>` |
| Postgres details, any shape: `Key (email)=(mary@x.com)`, expression keys (`Key (lower(name::text))=(mary smith)`), brackets in the value, every kind (already exists, is not present, is still referenced, conflicts with), a message cut short | `Key (email)=(…)`, `Key (lower(name::text))=(…)` |
| `file://` paths, whole: brackets and percent-encoding in a name too (`chart%20(Private%20Gig).pdf`), and the words after them up to a file extension. Only a file of the app's own bundle (`…/App.app/public/…`, `file:///android_asset/public/…`) keeps its name, with a frame's line and column | `file://…`, `file://…/index-B4xK9q1a.js:1:2` |
| NUL and other control characters | removed |
| A JSON parse error or another `SyntaxError` that quotes or echoes what it read (`"[ "Lola", no ]" is not valid JSON`, `/Mary Smith(/`): everything from the first quote or the echoed `/…/`, whatever the nesting. The engine's own words at the end stay | `Unexpected token … is not valid JSON` |
| Numbers of 7+ digits (phone numbers, ids) | `<n>` |
| Query strings on any link, relative ones too (`/deputy.html?deputy=…`, `/quote.html?t=…`), and fragments after a path | removed |
| Link paths: everything after the origin, except the app's own files (`/assets/…`, a page like `/quote.html`) on **our own origins** only (`app.bandwith.fun`, `bandwith.fun`, `capacitor://localhost`, `localhost`, the page's own origin): any host can have an `/assets/` folder. A path can name a band, a person or a file (`/storage/v1/object/sign/audio/Mirage/Mary Smith - Yesterday.mp3`), so the words after it up to a file extension go too, with brackets in the path or the query (`Chart(Private%20Gig).pdf`, `?t=ab(cd)`) | `https://xyz.supabase.co/…` |
| Random-looking strings: 16+ characters with a digit, or 40+ of anything (the app's own bundle names under `/assets/` stay) | `<token>` |
| **All** quoted text, even one word (a song called "Yesterday"). Each opening quote with its own closing one, typographic ones too (`“ ” ‘ ’ „ ‚ « » ‹ ›`); double quotes first, so an apostrophe inside ("Don't Stop Me Now") is just text; a quote left open hides the rest of the line. The message is made one line first, so a quote across a line break (a lyric) still goes, in the stack's first lines too | `"…"` (so `(reading 'map')` is sent as `(reading '…')`: the stack's file, line and column still point at the code) |

Kept: error names, function names, file names, and each stack line's `:line:column`.

The server cuts everything to size again.

**Limits**
- Device: each error once per session, at most 10 per session.
- Server, per person: **no count** (review #277 round 4), so nothing per person is stored. The device sends at most 10 a session; one account sending more can only use up the global caps below (crash reports stop for everyone for that hour), nothing else.
- Server, everyone together: 300 an hour, 1000 a day, and at most 15,000 reports kept. In the worst case that is about 65 MB, far below the Free plan's 500 MB. The counters are one row each, bumped atomically, so two reports at the limit can't both pass. The hourly prune locks the row counter before it counts, so a report committing meanwhile is never lost from the count.
- **No stored link to a person**: the user id is only checked (signed in), never stored. A report's transaction writes only the report and the global counters, which everyone shares. Report times are kept to the minute only. That is not anonymity, said plainly:
  - ordering metadata: a row's `xmin` and its identity order put a report next to the reporter's own writes in other tables made around the same time, which undoes the minute rounding;
  - tiny cohorts: in stages 1 and 2 only the owner and the partner run a prerelease, so `app_version` and `platform` alone say who sent it;
  - Supabase's own API logs (outside our database, kept for a short time) see who called the function, as for any request.

  So the service role is trusted not to correlate: we read reports grouped by version and screen, never joined to people. No one else can read any of these tables. The App Store label stays "not linked" because we never associate reports with an identity.
- Pruned every hour (pg_cron `bw-prune-client-errors`, at minute 7): reports older than 14 days, the counters of past hours and days, and its own run history in `cron.job_run_details` older than a day.
- A report the server refuses for good (a 4xx other than 401, 403, 408, 429) is dropped, so it can't hold up the others.
- Not signed in, or no signal: up to 5 reports wait on the device and go out after sign-in, when the signal is back (`online`), when the user comes back to the app, or with the next error (a full queue is sent first, then the new one).

## Reading them

**JavaScript errors**: Supabase → SQL editor (prod), as the service role.

What happened in the last 24 hours, the most frequent first:

```sql
SELECT platform, app_version, route, kind, message, count(*) AS n, max(created_at) AS last_seen
  FROM public.client_errors
 WHERE created_at > now() - interval '24 hours'
 GROUP BY 1, 2, 3, 4, 5
 ORDER BY n DESC
 LIMIT 50;
```

One error with its stack:

```sql
SELECT created_at, platform, app_version, route, message, stack
  FROM public.client_errors WHERE message ILIKE '%stage%' ORDER BY created_at DESC LIMIT 5;
```

**Native crashes**: Firebase console → project `bandwith-79115` → Crashlytics, one app at a time:
- Android: `com.bandwith.app`;
- iOS: `app.bandwith.mobile`.

Readable iOS stacks need the dSYMs. The Xcode phase **Crash reports dSYM upload** uploads them on Release builds, but only when `ios/App/App/GoogleService-Info.plist` is present. The plist is local-only, so copy it into the release worktree before archiving, as for analytics. Its inputs are the dSYM (so it runs after `dsymutil`), never the plist: a build without the plist still passes, and the script also waits up to 60 s for a dSYM newer than the binary.

**Android**
- The Crashlytics Gradle plugin is applied only when `android/app/google-services.json` is present (also local-only).
- R8 is off (`minifyEnabled false`), so no mapping upload is needed.

## Builds

- iOS:
  - pod `CapacitorFirebaseCrashlytics`, which brings FirebaseCrashlytics, FirebaseSessions and GoogleDataTransport;
  - `PrivacyInfo.xcprivacy` declares Crash Data + Other Diagnostic Data (not linked, no tracking, App Functionality).
- Android:
  - Gradle plugin `com.google.firebase:firebase-crashlytics-gradle:3.0.6`;
  - project `:capacitor-firebase-crashlytics`.
- `cap sync` with pnpm's node_modules writes `.pnpm/…` paths into `android/capacitor.settings.gradle` and `ios/App/Podfile`. Keep the flat `node_modules/@scope/pkg` paths: restore the files and run `pod install` in `ios/App`. Run it with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.

## For the owner: privacy label and Privacy Policy (not done in code)

**App Store Connect › App Privacy**: add **Diagnostics**:
- **Crash Data**: collected, **not linked** to the user, **not used for tracking**, purpose **App Functionality**. (Our own JavaScript reports, on by default, and Crashlytics, only after the user's yes.)
- **Other Diagnostic Data** (Crashlytics, Firebase installations, Google Data Transport, only after the user's yes): collected, **not linked**, **not used for tracking**, purpose **App Functionality**.
- "Performance Data" isn't needed: Performance Monitoring isn't in the app.

**Google Play › Data safety** (if the app goes on Play):
- **App info and performance › Crash logs** and **Diagnostics**: collected, not shared (Google processes them as our service provider), processed ephemerally: no.
- Optional for the user: yes (the switches).

**Privacy Policy** (bandwith.fun/privacy, en/it/es): add a "Crash reports" paragraph:
- what is sent: the error, the screen, the app version and the device type;
- what never is: no content, no account details;
- BandWith's own server (Supabase) keeps JavaScript errors for 14 days; on by default, switched off in Settings › Privacy & account › Send crash reports;
- on the phone apps, Google Firebase Crashlytics processes native crash reports **only if the user allows Anonymous usage statistics** (the same question as analytics); before that nothing is sent, though the Crashlytics library keeps a random installation ID and its crash files on the device (see "Before the yes");
- both can be switched off at any time in Settings › Privacy & account.
