# Kill switches (app flags)

A feature that breaks for users can be switched off from the server in
seconds, with no new build. Table `public.app_flags` (migration
`173_app_flags.sql`), client `src/lib/appFlags.ts`.

## Turn a feature off: the one SQL line

Supabase → SQL editor (prod project), as the service role:

```sql
UPDATE public.app_flags SET enabled = false, note = 'why, who, when', updated_at = now() WHERE key = 'voice_parts';
```

Back on:

```sql
UPDATE public.app_flags SET enabled = true, note = null, updated_at = now() WHERE key = 'voice_parts';
```

See where things stand:

```sql
SELECT key, enabled, min_app_version, note, updated_at FROM public.app_flags ORDER BY key;
```

**How fast it lands**
- Apps in front: within 10 minutes.
- Apps in the background: the moment they come back to the front.
- Apps with no signal: as soon as they have signal again.
- To force it on your own phone: send the app to the background and open it again.

## The keys

All are **ON** by default (built into the app). The table can only turn things off.

| key | Switched off, this goes | This stays | Wrapped |
| --- | --- | --- | --- |
| `live_pack` | Downloads ahead of time (a download already running stops before the next event), the silent-push refresh, the consent sheet, "Download for offline" / "Offline ready" row, "N of M members ready" row and "Remind", the "keep it offline" prompts (`live_pack_ready`: inbox, unread count, banner while the app is open), Settings › Offline & live | The setlist you last opened stays on the phone and opens with no signal (the behaviour from before the live pack, #93). **The tidy-up always runs**: old copies moved into packs once, packs removed 24 h after the event and for bands you left (files and the Bluetooth key with them). **Packs already on the phone stay readable offline** (songs, my notes and files, rehearsal notes): it is data the person already has, and losing it at a gig with no signal is worse than the feature | yes (#267 #269) |
| `voice_parts` | Part colours and styles, the legend and "Highlight my part", Who sings what (nothing fetched), the Voice row and "Mark the voice parts" in the chord editor | Lyrics read as plain lead lines; the `{bv}…{/bv}` markers stay saved in the song and are never shown | yes (#264 #266) |
| `follow_tempo` | Follow the tempo (playhead) on Stage | Stage, the click | **to do by the live-tempo / live-follow session** (B1 #272, B2) |
| `count_in` | Count-in before a song | Stage, the click | **to do by the live-tempo session** (D1) |
| `ble_live` | Leader: the clock and live characteristics over Bluetooth (read when Stage starts). Members: the clock reads over Bluetooth, a read in flight brings no clock back | The song and order over Bluetooth (#93); the click uses the Realtime clock. **Turned off mid-show the leader's Bluetooth is not restarted** (that would drop every member's link): it stops recalibrating, members stop reading the clock. Turned on mid-show: from the next time the leader opens Stage. A restarted leader serves the last song again at once | clock: yes (#265 #268). **B3 (click / playhead / count-in on the live characteristic): to do by the live-bluetooth session** |

## How it works

- Read at app start, on every resume, back online, and every 10 minutes while in front.
  Five rows, a few hundred bytes.
- Kept on the device (`localStorage` key `bandwith.app_flags.v1`). This survives sign-out, so a gig with no signal uses the last answer.
- It **fails open**. The app uses its built-in default (ON), so it behaves exactly as without flags, when:
  - the table is missing (migration not applied),
  - the row is missing,
  - the answer is bad,
  - nothing is cached and there is no signal.
- An error that isn't "no table" (offline, server down, signed out) keeps the cached value.
- Signed-in users can read `key, enabled, min_app_version, updated_at`. `note` is for admins only. Only the service role writes. anon has nothing.
- This is separate from `src/lib/flags.ts` (130: `platform_switches` / `band_features`).
  - That system rolls a feature out per band (paid tiers).
  - This one is the release safety net: global, no band needed, version-aware.

### `min_app_version`: only for newer builds

Use it when a fix ships in a new build: the feature stays off on older installs and is on from that build up.

```sql
-- Same value on every platform (rarely right: the formats differ)
UPDATE public.app_flags SET min_app_version = '1.0.14' WHERE key = 'ble_live';
-- Per platform (a platform not listed has no minimum)
UPDATE public.app_flags SET min_app_version = 'ios=202611250900;android=1.0.14;web=202611250900' WHERE key = 'ble_live';
```

What each platform compares:
- **iOS**: the build number (CFBundleVersion, e.g. `202611211045`).
- **Android**: the version name (e.g. `1.0.14`).
- **Web**: the bundle's build stamp (`yyyymmddhhmm`, UTC).

An install whose version can't be read is not held back.

## Wrapping a feature (for the live sessions)

```ts
import { useFlag, isFlagOn } from '@/lib/appFlags';

const on = useFlag('count_in');      // in a component or hook: re-renders when it flips
if (!isFlagOn('count_in')) return;    // outside React (a send, a timer, a push handler)
```

Rules:
0. **A switch hides and stops, it never skips the housekeeping.** Off hides the feature's entry points and stops its *new* behaviour. Clean-up, privacy sweeps (packs of bands left), data migrations (old copies moved in) and replaying the last state (a restarted Bluetooth leader) always run.
1. **Hide the entry point.** The button, row, sheet or menu entry renders nothing while off. The pattern used for the live pack:
   ```tsx
   export const X: React.FC<P> = (props) => (useFlag('live_pack') ? <XInner {...props} /> : null);
   ```
2. **Stop the behaviour, with no half state.** It can flip while the feature is running, e.g. mid-song on Stage. Use `useFlag` in effect deps, so flipping off stops timers and sends and clears state. Don't leave a pill that waits for something that never comes.
3. **Never touch saved data.** Off means "not shown, not run". Markers, packs and settings stay, so turning it back on restores everything.
4. **Off = like the build before the feature.** Fall back to the old path, not to an error.
5. **A failing-first test** with the flag off. In tests:
   ```ts
   import { __setAppFlagsForTest, __resetAppFlagsForTest } from '@/lib/appFlags';
   beforeEach(() => { localStorage.clear(); __resetAppFlagsForTest(null); });
   act(() => __setAppFlagsForTest({ count_in: false }));
   ```
   See `src/app/components/event/__tests__/livePack.flag.test.tsx`, `useStageBle.flag.test.tsx` and `src/app/components/songs/__tests__/VoiceParts.flag.test.tsx`.

Where to wrap the parts still to come:
- **`follow_tempo`** (B1 #272, B2):
  - the Follow the tempo control on Stage / FloorWedge;
  - the `setPlayhead` send in `useStageLive`;
  - a received playhead is ignored while off;
  - the B2 line highlight (`data-playhead`).
  - Off mid-song: `stopPlayhead`.
- **`count_in`** (D1):
  - the count-in button and `useCountInUi`;
  - the `setCountIn` send, and `receiveCountIn` ignored while off.
  - At GO the click still starts.
- **`ble_live`** (B3):
  - publish / receive the click, playhead and count-in on `b7d50003` only while on.
  - The leader already leaves the characteristic out when off (`useStageBle`).
  - The member's clock reads already stop.
- **Server side, later**: the `live_pack_ready` prompts are written by 170's daily sweep (pg_cron, not applied yet) and drawn by the phone's system while the app is in the background, so the app can't hide that banner. When 170's cron goes live, its sweep should skip everything while `app_flags.live_pack` is off.
- **A new feature** adds:
  - its key to `APP_FLAG_DEFAULTS` (`src/lib/appFlags.ts`),
  - a row here,
  - a seed row in a new migration (`INSERT … ON CONFLICT (key) DO NOTHING`).

  The app works without the row, so the seed row is only there to make the SQL line ready to use.
