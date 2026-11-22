# Crash reports

We learn about errors before users report them.

| What | Where it goes | Code |
| --- | --- | --- |
| JavaScript errors: the web app and the iOS/Android WebView. Window errors, unhandled promise rejections, screens that fail to draw | Our own table `public.client_errors` (migration `174_client_errors.sql`), kept 30 days | `src/lib/crashReports.ts`, `ErrorBoundary` |
| Native crashes: iOS, Android | Firebase Crashlytics, project `bandwith-79115` (the same Firebase project as analytics) | `@capacitor-firebase/crashlytics` |

**Settings › Privacy & account › Send crash reports**: on by default, per device. Off stops both:
- no more rows in `client_errors`;
- Crashlytics collection is turned off, and Crashlytics keeps that choice across launches.

## What is sent (and what never is)

- **Sent**:
  - the error message and stack;
  - the app version (iOS build number, Android version name, web build stamp);
  - the platform (`ios` / `android` / `web`);
  - the screen name (`Stage`, `Gig`, `Calendar`, …).
- **Never sent**:
  - user id, email, names;
  - song, gig, message or contact content.

Before sending, the device scrubs the message and the stack:

| Found | Sent as |
| --- | --- |
| Emails | `<email>` |
| UUIDs | `<id>` |
| JWTs and long tokens | `<token>` |
| Numbers of 7+ digits (phone numbers, ids) | `<n>` |
| URL query strings and fragments | removed |
| Quoted text that isn't a plain identifier | `"…"` (so `'map'` stays, `"Hudson Line lyrics"` doesn't) |

The server cuts everything to size again.

**Limits**
- Device: each error once per session, at most 10 per session.
- Server: 30 per person per hour, 2000 per hour in all.
- The per-person counter keeps the user id **apart** from the reports, for one hour only.
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
- **Crash Data**: collected, **not linked** to the user, **not used for tracking**, purpose **App Functionality**.
- **Other Diagnostic Data** (Crashlytics, Firebase installations, Google Data Transport): collected, **not linked**, **not used for tracking**, purpose **App Functionality**.
- "Performance Data" isn't needed: Performance Monitoring isn't in the app.

**Google Play › Data safety** (if the app goes on Play):
- **App info and performance › Crash logs** and **Diagnostics**: collected, not shared (Google processes them as our service provider), processed ephemerally: no.
- Optional for the user: yes (the switch).

**Privacy Policy** (bandwith.fun/privacy, en/it/es): add a "Crash reports" paragraph:
- what is sent: the error, the screen, the app version and the device type;
- what never is: no content, no account details;
- Google Firebase Crashlytics processes native crash reports;
- BandWith's own server (Supabase) keeps JavaScript errors for 30 days;
- on by default, switched off in Settings › Privacy & account.
