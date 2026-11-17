#!/usr/bin/env bash
# Emulator check: the Maestro flows (maestro/) on a real iOS simulator build
# and a real Android debug build of THIS commit. Nothing ships before it
# passes: scripts/release-android.sh --publish and scripts/deploy-web.sh
# refuse a commit without .emulator-check/<sha>.json (scripts/emulator-gate.mjs).
#
#   scripts/emulator-check.sh                 # build, boot, run every flow, shut down
#   scripts/emulator-check.sh --duo-ok        # after checking the Duo postures by hand
#   scripts/emulator-check.sh --devices iphone,android   # a subset (no marker written)
#   scripts/emulator-check.sh --reuse-build   # skip the builds if they are of this commit
#   scripts/emulator-check.sh --flows smoke,keyboard --keep-devices   # while writing flows
#
# What it does:
# 1. Demo web bundle of HEAD (VITE_DEMO_MODE, dev mode) with the Maestro setup
#    script (maestro/setup/bw-maestro-setup.js) injected. Production builds
#    never contain it.
# 2. A fresh simulator App.app (xcodebuild, never a re-signed old one: that gave
#    the black WebView) and a debug APK, both with that bundle.
# 3. Private devices, created if missing: "BW Check iPhone" (iPhone 17 Pro Max,
#    iOS 27.0), "BW Check iPad" (iPad Pro 11 (M5), iOS 27.0) and the AVD
#    BW_Check_API36 (Pixel 7, API 36, hw.keyboard=yes). Nobody else's devices
#    are touched.
# 4. Installs the app and runs the flows: iPhone `ios`, iPad `ios` minus
#    `phone-only`, Android `android` (tags in each flow).
# 5. Shuts the devices down. On success writes .emulator-check/<sha>.json
#    (git-ignored; also copied to the main clone's .emulator-check/ when run
#    from a worktree) with the date, devices, Maestro version, flow results and
#    the screenshot folder. Exit 1 and "FAILED: <flow> on <device>" otherwise.
#
# The iPhone Duo postures can't be set from Maestro: check them by hand (the
# list is printed at the end), then `scripts/emulator-check.sh --duo-ok`.
#
# Needs: Xcode + CocoaPods, the Android SDK (emulator, cmdline-tools, the
# android-36 arm64 image), openjdk 21, Maestro (brew install
# mobile-dev-inc/tap/maestro), node + pnpm deps installed. See maestro/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

export JAVA_HOME="${JAVA_HOME_21:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

IPHONE_NAME="BW Check iPhone"
IPHONE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max"
IPAD_NAME="BW Check iPad"
IPAD_TYPE="com.apple.CoreSimulator.SimDeviceType.iPad-Pro-11-inch-M5-12GB"
IOS_RUNTIME="com.apple.CoreSimulator.SimRuntime.iOS-27-0"
AVD_NAME="BW_Check_API36"
AVD_IMAGE="system-images;android-36;default;arm64-v8a"
AVD_PORT=5584
ANDROID_SERIAL_ID="emulator-$AVD_PORT"
IOS_APP_ID="app.bandwith.mobile"
ANDROID_APP_ID="com.bandwith.app"

CHECK_DIR="$ROOT/.emulator-check"
BUILD_DIR="$CHECK_DIR/build"
DERIVED="${BW_EMULATOR_DERIVED_DATA:-$HOME/Library/Caches/bandwith-emulator-check/DerivedData}"

DUO_CHECKLIST='Duo (iPhone Duo simulator, Device Hub postures; Maestro cannot set them):
  [ ] Closed, Book, Laptop (Partially Open + Rotate Right), Open: Home, Calendar, a gig, Chat
      and Settings render, nothing on the fold band, nothing blank.
  [ ] Book: Notifications inbox fills its pane, nothing behind it; the rail Back closes it.
  [ ] Laptop: inbox rows and a notification detail off the fold; Sign in password field off the fold.
  [ ] Laptop: Create account, What brings you here?, Deputy reply, Stage mode off the fold.
  [ ] Laptop: "No contract yet" -> Contracts & docs -> rail Back -> back on the gig.
  [ ] Posture change (Closed -> Open -> Laptop) with a gig open: it stays open, still usable.
  [ ] Every posture: a rehearsal -> Open live mode (rail) -> Next song -> Exit live mode, and the rail /
      system Back, return to the rehearsal; Laptop: the floor wedge is off the fold.
Then: scripts/emulator-check.sh --duo-ok'

usage() { sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; }

DUO_OK=""
REUSE_BUILD=""
KEEP_DEVICES=""
FLOWS=""
DEVICES="iphone,ipad,android"
while [ $# -gt 0 ]; do
  case "$1" in
    --duo-ok) DUO_OK=1 ;;
    --reuse-build) REUSE_BUILD=1 ;;
    --devices) DEVICES="${2:?--devices needs a list, e.g. iphone,android}"; shift ;;
    --flows) FLOWS="${2:?--flows needs a list, e.g. smoke,keyboard}"; shift ;;
    --keep-devices) KEEP_DEVICES=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
  shift
done

SHA="$(git rev-parse HEAD)"
MARKER="$CHECK_DIR/$SHA.json"
MAIN_CHECK_DIR="$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd)")/.emulator-check"
mkdir -p "$CHECK_DIR"

publish_marker() {
  if [ "$MAIN_CHECK_DIR" != "$CHECK_DIR" ] && [ -d "$(dirname "$MAIN_CHECK_DIR")" ]; then
    mkdir -p "$MAIN_CHECK_DIR" && cp "$MARKER" "$MAIN_CHECK_DIR/"
  fi
}

# --duo-ok: sign off the Duo postures on this commit's passing run.
if [ -n "$DUO_OK" ]; then
  [ -f "$MARKER" ] || { echo "No passing emulator check for ${SHA:0:12}: run scripts/emulator-check.sh first." >&2; exit 1; }
  node -e '
    const fs = require("fs"); const [file, sha] = process.argv.slice(1);
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    if (m.sha !== sha || m.status !== "passed") { console.error("The marker is not a passing run of this commit."); process.exit(1); }
    m.duo = { ok: true, date: new Date().toISOString(), by: process.env.USER || "unknown", checklist: "manual (Device Hub)" };
    fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
  ' "$MARKER" "$SHA"
  publish_marker
  echo "Duo postures signed off for ${SHA:0:12}. $(node scripts/emulator-gate.mjs 2>&1)"
  exit 0
fi

for tool in maestro xcrun pod node adb emulator; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool (see maestro/README.md)." >&2; exit 1; }
done
AVDMANAGER="$(ls "$ANDROID_HOME"/cmdline-tools/*/bin/avdmanager 2>/dev/null | head -1)"
MAESTRO_VERSION="$(maestro --version 2>/dev/null | tail -1)"

# The check is of HEAD: the app sources must be committed.
if [ -n "$(git status --porcelain --untracked-files=no -- src academy public index.html '*.html' vite.config.ts package.json pnpm-lock.yaml ios/App/App android/app/src maestro)" ]; then
  echo "Uncommitted changes in the app or the flows: commit them first (the check is of HEAD, ${SHA:0:12})." >&2
  exit 1
fi

START_TS=$(date +%s)
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-${SHA:0:12}"
RUN_DIR="$CHECK_DIR/runs/$RUN_ID"
mkdir -p "$RUN_DIR"
rm -f "$MARKER" # a new run replaces any earlier result for this commit
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
want() { case ",$DEVICES," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

# ---------------------------------------------------------------- cleanup
TRACKED_RESTORE=()
DIST_BACKUP=""
NATIVE_BACKUP=""
BOOTED_SIMS=()
EMULATOR_PID=""
cleanup() {
  set +e
  if [ -n "$DIST_BACKUP" ]; then rm -rf dist; [ -d "$DIST_BACKUP/dist" ] && mv "$DIST_BACKUP/dist" dist; fi
  if [ -n "$NATIVE_BACKUP" ] && [ -f "$NATIVE_BACKUP" ]; then
    rm -rf ios/App/App/public android/app/src/main/assets/public
    tar -xzf "$NATIVE_BACKUP" 2>/dev/null
  fi
  for f in "${TRACKED_RESTORE[@]:-}"; do [ -n "$f" ] && git checkout -q -- "$f"; done
  [ -n "$KEEP_DEVICES" ] && return 0
  for udid in "${BOOTED_SIMS[@]:-}"; do [ -n "$udid" ] && xcrun simctl shutdown "$udid" >/dev/null 2>&1; done
  if [ -n "$EMULATOR_PID" ]; then
    adb -s "$ANDROID_SERIAL_ID" emu kill >/dev/null 2>&1
    sleep 2; kill "$EMULATOR_PID" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------- devices
sim_udid() { xcrun simctl list devices -j | node -e '
  const name = process.argv[1]; const d = JSON.parse(require("fs").readFileSync(0, "utf8")).devices;
  for (const [rt, list] of Object.entries(d)) for (const x of list) if (x.name === name && x.isAvailable) { console.log(x.udid); process.exit(0); }' "$1"; }

ensure_sim() { # name type -> udid
  local udid; udid="$(sim_udid "$1")"
  [ -n "$udid" ] || udid="$(xcrun simctl create "$1" "$2" "$IOS_RUNTIME")"
  echo "$udid"
}

boot_sim() {
  xcrun simctl boot "$1" >/dev/null 2>&1 || true
  BOOTED_SIMS+=("$1")
}

ensure_avd() {
  if ! emulator -list-avds | grep -qx "$AVD_NAME"; then
    [ -n "$AVDMANAGER" ] || { echo "avdmanager not found (Android cmdline-tools)." >&2; exit 1; }
    echo no | "$AVDMANAGER" create avd -n "$AVD_NAME" -k "$AVD_IMAGE" -d pixel_7 >/dev/null
  fi
  local cfg="$HOME/.android/avd/$AVD_NAME.avd/config.ini"
  # Typing needs a hardware keyboard; the on-screen one still shows.
  sed -i '' -e 's/^hw\.keyboard *=.*/hw.keyboard=yes/' -e 's/^hw\.ramSize *=.*/hw.ramSize=3072/' "$cfg"
  grep -q '^hw.keyboard=yes' "$cfg" || echo 'hw.keyboard=yes' >>"$cfg"
}

boot_avd() {
  if adb devices | grep -q "^$ANDROID_SERIAL_ID"; then
    local running; running="$(adb -s "$ANDROID_SERIAL_ID" emu avd name 2>/dev/null | head -1 | tr -d '\r')"
    [ "$running" = "$AVD_NAME" ] || { echo "Port $AVD_PORT is used by another emulator ($running): not touching it." >&2; exit 1; }
  else
    # The Mac's GPU, not SwiftShader: with software rendering and the two
    # iOS simulators running alongside, the WebView's main thread skipped
    # frames for seconds at a time while typing and Android raised "BandWith
    # isn't responding" (Input dispatching timed out), so a keyboard flow's
    # probe never answered (1.0.6 gate, keyboard-create-account). Headless
    # host rendering works (emulator 37); BW_AVD_GPU overrides it.
    emulator -avd "$AVD_NAME" -port "$AVD_PORT" -no-window -no-audio -no-boot-anim -no-snapshot-save \
      -gpu "${BW_AVD_GPU:-host}" >"$RUN_DIR/emulator.log" 2>&1 &
    EMULATOR_PID=$!
  fi
}

wait_avd() {
  adb -s "$ANDROID_SERIAL_ID" wait-for-device
  for _ in $(seq 1 180); do
    if [ "$(adb -s "$ANDROID_SERIAL_ID" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then
      # The on-screen keyboard shows next to the hardware one (Maestro types
      # with the latter; the keyboard flow needs the former up).
      adb -s "$ANDROID_SERIAL_ID" shell settings put secure show_ime_with_hard_keyboard 1 >/dev/null 2>&1 || true
      return 0
    fi
    sleep 2
  done
  echo "The Android emulator did not finish booting." >&2
  return 1
}

# Boot early: the devices start while the apps build.
IPHONE=""; IPAD=""
if want iphone; then IPHONE="$(ensure_sim "$IPHONE_NAME" "$IPHONE_TYPE")"; boot_sim "$IPHONE"; fi
if want ipad; then IPAD="$(ensure_sim "$IPAD_NAME" "$IPAD_TYPE")"; boot_sim "$IPAD"; fi
if want android; then ensure_avd; boot_avd; fi
log "Devices booting: ${IPHONE:+$IPHONE_NAME ($IPHONE) }${IPAD:+$IPAD_NAME ($IPAD) }$(want android && echo "$AVD_NAME ($ANDROID_SERIAL_ID)")"

# ---------------------------------------------------------------- builds
APP="$BUILD_DIR/App.app"
APK="$BUILD_DIR/app-debug.apk"
if [ -n "$REUSE_BUILD" ] && [ "$(cat "$BUILD_DIR/sha" 2>/dev/null)" = "$SHA" ] && [ -d "$APP" ] && [ -f "$APK" ]; then
  log "Reusing the builds of ${SHA:0:12}"
else
  rm -rf "$BUILD_DIR" && mkdir -p "$BUILD_DIR"
  log "Demo web bundle of ${SHA:0:12}"
  NODE_ENV=development VITE_DEMO_MODE=true npx vite build --mode development --outDir "$BUILD_DIR/web" --emptyOutDir --logLevel error >"$BUILD_DIR/web.log" 2>&1 \
    || { cat "$BUILD_DIR/web.log" >&2; exit 1; }
  cp maestro/setup/bw-maestro-setup.js "$BUILD_DIR/web/"
  node -e '
    const fs = require("fs"); const f = process.argv[1]; const html = fs.readFileSync(f, "utf8");
    if (!html.includes("<head>")) process.exit(1);
    fs.writeFileSync(f, html.replace("<head>", "<head>\n    <script src=\"/bw-maestro-setup.js\"></script>"));
  ' "$BUILD_DIR/web/index.html"

  # Native projects get the demo bundle through Capacitor (webDir = dist).
  # Everything it touches is put back afterwards: dist/, the native public/
  # folders and tracked files that were clean (Podfile.lock,
  # capacitor.settings.gradle).
  for f in ios/App/Podfile.lock android/capacitor.settings.gradle android/app/capacitor.build.gradle ios/App/App.xcodeproj/project.pbxproj; do
    git diff --quiet -- "$f" 2>/dev/null && TRACKED_RESTORE+=("$f")
  done
  DIST_BACKUP="$BUILD_DIR/dist-backup"; mkdir -p "$DIST_BACKUP"
  [ -d dist ] && mv dist "$DIST_BACKUP/dist"
  NATIVE_BACKUP="$BUILD_DIR/native-web-backup.tgz"
  tar -czf "$NATIVE_BACKUP" $(ls -d ios/App/App/public ios/App/App/capacitor.config.json ios/App/App/config.xml \
    android/app/src/main/assets/public android/app/src/main/assets/capacitor.config.json \
    android/app/src/main/assets/capacitor.plugins.json 2>/dev/null) 2>/dev/null || tar -czf "$NATIVE_BACKUP" -T /dev/null
  cp -R "$BUILD_DIR/web" dist
  CAP_DEBUG=true npx cap copy ios >"$BUILD_DIR/cap-ios.log" 2>&1 || { cat "$BUILD_DIR/cap-ios.log" >&2; exit 1; }
  CAP_DEBUG=true npx cap sync android >"$BUILD_DIR/cap-android.log" 2>&1 || { cat "$BUILD_DIR/cap-android.log" >&2; exit 1; }

  log "Building the iOS simulator app and the Android debug APK"
  (
    cd ios/App && pod install >"$BUILD_DIR/pod.log" 2>&1 && cd "$ROOT" &&
      xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator \
        -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DERIVED" \
        ENABLE_MODULE_VERIFIER=NO IPHONEOS_DEPLOYMENT_TARGET=17.0 CODE_SIGNING_ALLOWED=NO -quiet build \
        >"$BUILD_DIR/xcodebuild.log" 2>&1
  ) &
  IOS_BUILD=$!
  (cd android && ./gradlew assembleDebug -q >"$BUILD_DIR/gradle.log" 2>&1) &
  ANDROID_BUILD=$!
  wait "$IOS_BUILD" || { tail -30 "$BUILD_DIR/xcodebuild.log" "$BUILD_DIR/pod.log" >&2; echo "iOS build failed." >&2; exit 1; }
  wait "$ANDROID_BUILD" || { tail -30 "$BUILD_DIR/gradle.log" >&2; echo "Android build failed." >&2; exit 1; }
  rm -rf "$APP" && cp -R "$DERIVED/Build/Products/Debug-iphonesimulator/App.app" "$APP"
  # Simulator builds are unsigned (CODE_SIGNING_ALLOWED=NO): sign this fresh
  # build ad hoc so WebKit's processes start.
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1
  cp android/app/build/outputs/apk/debug/app-debug.apk "$APK"
  grep -q bw-maestro-setup "$APP/public/index.html" || { echo "The iOS app has no Maestro setup script." >&2; exit 1; }
  echo "$SHA" >"$BUILD_DIR/sha"
  # Put the repo back now (the trap does it too on failure).
  rm -rf dist; [ -d "$DIST_BACKUP/dist" ] && mv "$DIST_BACKUP/dist" dist; DIST_BACKUP=""
  rm -rf ios/App/App/public android/app/src/main/assets/public; tar -xzf "$NATIVE_BACKUP" 2>/dev/null || true; NATIVE_BACKUP=""
  for f in "${TRACKED_RESTORE[@]:-}"; do [ -n "$f" ] && git checkout -q -- "$f"; done; TRACKED_RESTORE=()
fi

# ---------------------------------------------------------------- install
for udid in $IPHONE $IPAD; do
  xcrun simctl bootstatus "$udid" -b >/dev/null
  # Maestro types with XCTest's synthetic hardware keyboard. With automatic
  # minimization on (the default), the iPad then takes a hardware keyboard to
  # be attached and from then on shows only its 68 px shortcut bar, even
  # across reboots: the keyboard flows saw no keyboard. Off, every focus
  # brings up the full on-screen keyboard, as for a person without one.
  xcrun simctl spawn "$udid" defaults write com.apple.keyboard.preferences AutomaticMinimizationEnabled -bool false
done
for udid in $IPHONE $IPAD; do
  xcrun simctl uninstall "$udid" "$IOS_APP_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$APP"
done
if want android; then
  wait_avd
  adb -s "$ANDROID_SERIAL_ID" uninstall "$ANDROID_APP_ID" >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL_ID" install -r "$APK" >/dev/null
fi
log "Apps installed"

# ---------------------------------------------------------------- flows
FLOW_PATHS=(maestro/flows)
if [ -n "$FLOWS" ]; then
  FLOW_PATHS=()
  for f in ${FLOWS//,/ }; do FLOW_PATHS+=("maestro/flows/$f.yaml"); done
fi
run_device() { # id device-id app-id form tags...
  local id="$1" dev="$2" app="$3" form="$4"; shift 4
  maestro --device "$dev" test "${FLOW_PATHS[@]}" \
    --test-output-dir "$RUN_DIR/$id" --format junit --output "$RUN_DIR/$id.xml" \
    -e APP_ID="$app" -e FORM="$form" -e SETUP= -e ROLE= "$@" >"$RUN_DIR/$id.log" 2>&1
}
PIDS=()
want iphone && { run_device iphone "$IPHONE" "$IOS_APP_ID" phone --include-tags ios & PIDS+=($!); }
want ipad && { run_device ipad "$IPAD" "$IOS_APP_ID" tablet --include-tags ios --exclude-tags phone-only & PIDS+=($!); }
want android && { run_device android "$ANDROID_SERIAL_ID" "$ANDROID_APP_ID" phone --include-tags android & PIDS+=($!); }
log "Running the Maestro flows (logs: $RUN_DIR/<device>.log)"
for p in "${PIDS[@]}"; do wait "$p" || true; done

# Screenshots of every device in one folder.
SHOTS="$RUN_DIR/screenshots"
mkdir -p "$SHOTS"
for id in iphone ipad android; do
  [ -d "$RUN_DIR/$id" ] || continue
  find "$RUN_DIR/$id" -name '*.png' | while read -r f; do
    flow="$(echo "$f" | sed -E "s#^$RUN_DIR/$id/[^/]+/([^/]+)/.*#\1#")"
    cp "$f" "$SHOTS/$id--$flow--$(basename "$f")"
  done
done

END_TS=$(date +%s)
DEVICE_JSON="$(node -e '
  const [iphone, ipad, android, avd] = process.argv.slice(1);
  const d = [];
  if (iphone) d.push({ id: "iphone", name: "BW Check iPhone", platform: "ios", model: "iPhone 17 Pro Max", os: "iOS 27.0", udid: iphone });
  if (ipad) d.push({ id: "ipad", name: "BW Check iPad", platform: "ios", model: "iPad Pro 11-inch (M5)", os: "iOS 27.0", udid: ipad });
  if (android) d.push({ id: "android", name: avd, platform: "android", model: "Pixel 7 (AVD)", os: "Android 16 (API 36)", serial: android });
  console.log(JSON.stringify(d));
' "$IPHONE" "$IPAD" "$(want android && echo "$ANDROID_SERIAL_ID")" "$AVD_NAME")"

BW_FLOWS_SUBSET="$FLOWS" node - "$RUN_DIR" "$SHA" "$MAESTRO_VERSION" "$DEVICE_JSON" "$START_TS" "$END_TS" "$SHOTS" "$DEVICES" <<'NODE' >"$RUN_DIR/result.json"
const fs = require('fs');
const [runDir, sha, maestro, devicesJson, start, end, shots, wanted] = process.argv.slice(2);
const devices = JSON.parse(devicesJson);
const flows = [];
for (const d of devices) {
  const xml = fs.existsSync(`${runDir}/${d.id}.xml`) ? fs.readFileSync(`${runDir}/${d.id}.xml`, 'utf8') : '';
  const cases = [...xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)];
  if (!cases.length) flows.push({ device: d.id, flow: '(maestro run)', status: 'failed', message: `no results, see ${d.id}.log` });
  for (const c of cases) {
    const attr = (k) => (c[1].match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1];
    const body = c[3] || '';
    const fail = body.match(/<(failure|error)\b[^>]*?(?:message="([^"]*)")?[^>]*>([\s\S]*?)<\/\1>|<(failure|error)\b[^>]*?message="([^"]*)"[^>]*\/>/);
    const skipped = /<skipped\b/.test(body);
    flows.push({
      device: d.id,
      flow: attr('name') || attr('id'),
      status: fail ? 'failed' : skipped ? 'skipped' : 'passed',
      seconds: Number(attr('time')) || undefined,
      message: fail ? (fail[2] || fail[3] || fail[5] || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim().slice(0, 300) : undefined,
    });
  }
}
const all = wanted.split(',').sort().join(',') === 'android,ipad,iphone' && !process.env.BW_FLOWS_SUBSET;
const passed = flows.length > 0 && flows.every((f) => f.status === 'passed');
console.log(JSON.stringify({
  sha,
  date: new Date(Number(end) * 1000).toISOString(),
  status: passed && all ? 'passed' : passed ? 'partial' : 'failed',
  durationSeconds: Number(end) - Number(start),
  maestro,
  devices,
  flows,
  screenshots: shots,
  runDir,
  duo: { ok: false, checklist: 'pending: check the Duo postures, then scripts/emulator-check.sh --duo-ok' },
}, null, 2));
NODE
cp "$RUN_DIR/result.json" "$CHECK_DIR/last-run.json"

STATUS="$(node -p 'require(process.argv[1]).status' "$RUN_DIR/result.json")"
echo
node -e '
  const r = require(process.argv[1]);
  const by = {};
  for (const f of r.flows) (by[f.device] ||= []).push(f);
  for (const [d, fs] of Object.entries(by)) {
    const ok = fs.filter((f) => f.status === "passed").length;
    console.log(`${d}: ${ok}/${fs.length} flows passed`);
    for (const f of fs) if (f.status !== "passed") console.log(`  FAILED: ${f.flow} on ${d}${f.message ? ` — ${f.message.split("\n")[0]}` : ""}`);
  }
  console.log(`Time: ${Math.floor(r.durationSeconds / 60)} min ${r.durationSeconds % 60} s. Screenshots: ${r.screenshots}`);
' "$RUN_DIR/result.json"

if [ "$STATUS" = passed ]; then
  cp "$RUN_DIR/result.json" "$MARKER"
  publish_marker
  echo
  echo "PASSED on ${SHA:0:12}: $MARKER"
  echo
  echo "$DUO_CHECKLIST"
  exit 0
elif [ "$STATUS" = partial ]; then
  echo "All flows passed on $DEVICES, but not every device ran: no release marker written."
  exit 0
fi
echo "Emulator check FAILED on ${SHA:0:12} (details: $RUN_DIR)." >&2
exit 1
