#!/usr/bin/env bash
# Builds the signed Android release APK for testers and, with --publish, puts
# it on a GitHub release. The newest release is always at the same link:
#   https://github.com/bandwith-app/BandWith/releases/latest/download/BandWith.apk
#
#   scripts/release-android.sh 1.0.1            # build dist-android/BandWith.apk
#   scripts/release-android.sh 1.0.1 --publish  # build + GitHub release android-v1.0.1
#
# --publish refuses a version whose android-v<version> release or tag exists,
# and a commit without a passing emulator check: scripts/emulator-check.sh
# (Maestro flows on the iOS simulators and the Android emulator) plus the Duo
# postures signed off with `scripts/emulator-check.sh --duo-ok`. Only in an
# emergency: --skip-emulator-check "<reason>" publishes anyway, with a warning
# and the reason in the release notes.
#
# Needs (none of it in the repo):
# - android/app/google-services.json (Firebase, for push);
# - the release keystore, ~/Developer/BandWith-keys/bandwith-release.jks
#   (or BW_ANDROID_KEYSTORE), password in the macOS Keychain under
#   "BandWith Android release key". Losing it means testers must uninstall
#   before the next update installs, so keep a backup;
# - openjdk 21, the Android SDK, and gh signed in for --publish.
# Run it from a clean checkout of the commit to release.
set -euo pipefail
cd "$(dirname "$0")/.."

USAGE='usage: scripts/release-android.sh <version, e.g. 1.0.1> [--publish] [--skip-emulator-check "<reason>"]'
VERSION="${1:?$USAGE}"
shift
PUBLISH=""
SKIP_EMULATOR_REASON=""
while [ $# -gt 0 ]; do
  case "$1" in
    --publish) PUBLISH="--publish" ;;
    --skip-emulator-check)
      SKIP_EMULATOR_REASON="${2:-}"
      [ -n "$SKIP_EMULATOR_REASON" ] && [ "${SKIP_EMULATOR_REASON#--}" = "$SKIP_EMULATOR_REASON" ] \
        || { echo "--skip-emulator-check needs a reason: --skip-emulator-check \"<why>\"" >&2; exit 1; }
      shift ;;
    *) echo "$USAGE" >&2; exit 1 ;;
  esac
  shift
done
KEYSTORE="${BW_ANDROID_KEYSTORE:-$HOME/Developer/BandWith-keys/bandwith-release.jks}"
TAG="android-v$VERSION"
NOTES_FILE=scripts/android-release-notes.md

[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+){1,3}$ ]] || { echo "Version must look like 1.0.3: $VERSION" >&2; exit 1; }
if [ "$PUBLISH" = "--publish" ]; then
  # Nothing ships before a passing emulator run on this exact commit
  # (scripts/emulator-check.sh, maestro/README.md).
  if [ -n "$SKIP_EMULATOR_REASON" ]; then
    echo "WARNING: publishing $TAG WITHOUT an emulator check: $SKIP_EMULATOR_REASON" >&2
    mkdir -p dist-android
    { cat "$NOTES_FILE"; printf '\n\n> Released without an emulator check: %s\n' "$SKIP_EMULATOR_REASON"; } > dist-android/release-notes.md
    NOTES_FILE=dist-android/release-notes.md
  else
    node scripts/emulator-gate.mjs >&2 || { echo "Not publishing $TAG." >&2; exit 1; }
  fi
fi

[ -f android/app/google-services.json ] || { echo "android/app/google-services.json is missing: push would be off." >&2; exit 1; }
[ -f "$KEYSTORE" ] || { echo "Release keystore not found: $KEYSTORE" >&2; exit 1; }
if [ "$PUBLISH" = "--publish" ]; then
  # Every release needs its own version: the app compares names to offer updates.
  if gh release view "$TAG" --repo bandwith-app/BandWith >/dev/null 2>&1 \
    || [ -n "$(git ls-remote --tags origin "refs/tags/$TAG")" ]; then
    echo "$TAG is already published: pick a new version." >&2
    exit 1
  fi
fi
if [ "$PUBLISH" = "--publish" ] && [ -n "$(git status --porcelain --untracked-files=no -- src academy android/app/src android/app/build.gradle)" ]; then
  echo "Uncommitted changes in the app: release from a clean checkout." >&2
  exit 1
fi

BW_ANDROID_KEYSTORE_PASSWORD="$(security find-generic-password -s 'BandWith Android release key' -w)"
export BW_ANDROID_KEYSTORE="$KEYSTORE" BW_ANDROID_KEYSTORE_PASSWORD
export BW_ANDROID_VERSION_NAME="$VERSION"
# Minute-based (scripts/android-version-code.sh): every later release has a
# higher code, also two in the same hour. BW_ANDROID_VERSION_CODE overrides it.
export BW_ANDROID_VERSION_CODE="${BW_ANDROID_VERSION_CODE:-$(scripts/android-version-code.sh)}"
case "$BW_ANDROID_VERSION_CODE" in '' | *[!0-9]*) echo "BW_ANDROID_VERSION_CODE must be a number." >&2; exit 1 ;; esac
[ "$BW_ANDROID_VERSION_CODE" -lt 2100000000 ] || { echo "BW_ANDROID_VERSION_CODE must be below 2100000000." >&2; exit 1; }
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

npx vite build >/dev/null
npx vite build --config academy/vite.config.ts >/dev/null
npx cap sync android >/dev/null
(cd android && ./gradlew assembleRelease -q)

APK=android/app/build/outputs/apk/release/app-release.apk
BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
"$BUILD_TOOLS/apksigner" verify --print-certs "$APK" | grep -q "CN=BandWith" || { echo "The APK is not signed with the release key." >&2; exit 1; }
if "$BUILD_TOOLS/aapt" dump badging "$APK" | grep -q "application-debuggable"; then
  echo "The APK is debuggable: not a release build." >&2
  exit 1
fi

mkdir -p dist-android
cp "$APK" dist-android/BandWith.apk
echo "Built dist-android/BandWith.apk: version $VERSION (code $BW_ANDROID_VERSION_CODE)"

if [ "$PUBLISH" = "--publish" ]; then
  gh release create "$TAG" dist-android/BandWith.apk \
    --repo bandwith-app/BandWith \
    --target "$(git rev-parse HEAD)" \
    --title "BandWith for Android $VERSION" \
    --notes-file "$NOTES_FILE"
fi
