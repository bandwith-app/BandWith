# Crash reports

We learn about errors before users report them.

| What | Where it goes | Code |
| --- | --- | --- |
| JavaScript errors: the web app and the iOS/Android WebView. Window errors, unhandled promise rejections, screens that fail to draw | Our own table `public.client_errors` (migration `174_client_errors.sql`), kept 14 days | `src/lib/crashReports.ts`, `ErrorBoundary` |
| Native crashes: iOS, Android | Firebase Crashlytics, project `bandwith-79115` (the same Firebase project as analytics). **Only with the usage statistics yes** | `@capacitor-firebase/crashlytics` |

**Settings › Privacy & account › Send crash reports**: on by default, per device. It covers our own scrubbed JavaScript reports, and it can stop Crashlytics too.

**Crashlytics only with consent** (owner decision 2026-11-22, for ePrivacy: Crashlytics stores an installation ID on the device):
- Off from the very first launch: `FirebaseCrashlyticsCollectionEnabled` = false in `Info.plist`, `firebase_crashlytics_collection_enabled` = false in the Android manifest. So nothing is uploaded and no installation ID is made before the app has asked.
- On only when **both** are true: the user said yes to **Anonymous usage statistics** (the same one-time question and Settings row as analytics, #238; its copy says crash details are included), and **Send crash reports** is on.
- While it is off, crash reports Crashlytics kept but hasn't sent are deleted at every start and at every change.

Switching **Send crash reports** off:
- no more rows in `client_errors`;
- Crashlytics collection is turned off (Crashlytics keeps that across launches), and its unsent reports are deleted;
- reports waiting on the device are dropped, and requests already out are aborted, even one still waiting for a session refresh;
- on the web the choice is shared by every tab: an opt-out in one tab wins over another tab that still had it on;
- if the device's storage is blocked, an opt-out still holds until the app is closed (it can only turn reports off, never back on).

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
| Emails | `<email>` |
| UUIDs | `<id>` |
| JWTs and long tokens | `<token>` |
| Numbers of 7+ digits (phone numbers, ids) | `<n>` |
| Query strings on any link, relative ones too (`/deputy.html?deputy=…`, `/quote.html?t=…`), and fragments after a path | removed |
| Link paths: everything after the origin, except the app's own files (`/assets/…`, a page like `/quote.html`). A path can name a band, a person or a file (`/storage/v1/object/sign/audio/Mirage/Mary Smith - Yesterday.mp3`), so the words after it up to a file extension go too | `https://xyz.supabase.co/…` |
| Random-looking strings: 16+ characters with a digit, or 40+ of anything (the app's own bundle names under `/assets/` stay) | `<token>` |
| **All** quoted text, even one word (a song called "Yesterday"). Each opening quote with its own closing one, typographic ones too (`“ ” ‘ ’ „ ‚ « » ‹ ›`); double quotes first, so an apostrophe inside ("Don't Stop Me Now") is just text; a quote left open hides the rest of the line | `"…"` (so `(reading 'map')` is sent as `(reading '…')`: the stack's file, line and column still point at the code) |

Kept: error names, function names, file names, and each stack line's `:line:column`.

The server cuts everything to size again.

**Limits**
- Device: each error once per session, at most 10 per session.
- Server, per person: 10 per clock hour (the device sends at most 10 a session).
- Server, everyone together: 300 an hour, 1000 a day, and at most 15,000 reports kept. In the worst case that is about 65 MB, far below the Free plan's 500 MB. The counters are one row each, bumped atomically, so two reports at the limit can't both pass. The hourly prune locks the row counter before it counts, so a report committing meanwhile is never lost from the count.
- The per-person counter never holds the user id: its key is `sha256(this hour's random secret || user id)`, it holds only the clock hour, and the counter and the secret are both deleted at the next hourly prune. After that, a key leads to no one.
- Every minute (pg_cron `bw-seal-client-errors`) the new reports and every counter row are rewritten in one transaction of their own, the counters in random order. Report times are kept to the minute only.
- **What a reader with the service role can still link**, said plainly:
  - for up to a minute, until the seal, a report and its counter row share a transaction id (`xmin`);
  - while the hour is live the secret is readable, so they can tell **which** users reported in that hour (not which reports are whose). If only one person reported in an hour, those reports are theirs;
  - the Supabase API logs see who called the function, as for any request.
  No one else can read any of these tables.
- Pruned every hour (pg_cron `bw-prune-client-errors`, at minute 7): reports older than 14 days, and the counters and secrets of past hours and days.
- Not signed in: a few reports wait and go out after sign-in.

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

Readable iOS stacks need the dSYMs. The Xcode phase **Crash reports dSYM upload** uploads them on Release builds, but only when `ios/App/App/GoogleService-Info.plist` is present. The plist is local-only, so copy it into the release worktree before archiving, as for analytics.

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
- on the phone apps, Google Firebase Crashlytics processes native crash reports **only if the user allows Anonymous usage statistics** (the same question as analytics); before that, no Crashlytics collection and no Firebase installation ID;
- both can be switched off at any time in Settings › Privacy & account.
