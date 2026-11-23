#!/usr/bin/env bash
# Builds the signed Android release APK for testers and, with --publish, puts
# it on a GitHub release. The newest release is always at the same link:
#   https://github.com/bandwith-app/BandWith/releases/latest/download/BandWith.apk
#
#   scripts/release-android.sh 1.0.1            # build dist-android/BandWith.apk
#   scripts/release-android.sh 1.0.1 --publish  # build + GitHub release android-v1.0.1
#   scripts/release-android.sh 1.0.1 --publish --prerelease
#       # a few testers first: a GitHub prerelease, which the in-app updater and
#       # the latest link skip. Send its own link; when it holds, promote it
#       # only if its versionCode is above every published release
#       # (scripts/android-promote-check.sh), --latest only if it is the highest
#       # version (scripts/android-latest-flag.sh); the script prints the command.
#       # (docs/release-checklist.md)
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

USAGE='usage: scripts/release-android.sh <version, e.g. 1.0.1> [--publish [--prerelease]] [--skip-emulator-check "<reason>"]'
VERSION="${1:?$USAGE}"
shift
PUBLISH=""
PRERELEASE=""
SKIP_EMULATOR_REASON=""
while [ $# -gt 0 ]; do
  case "$1" in
    --publish) PUBLISH="--publish" ;;
    --prerelease) PRERELEASE=1 ;;
    --skip-emulator-check)
      SKIP_EMULATOR_REASON="${2:-}"
      [ -n "$SKIP_EMULATOR_REASON" ] && [ "${SKIP_EMULATOR_REASON#--}" = "$SKIP_EMULATOR_REASON" ] \
        || { echo "--skip-emulator-check needs a reason: --skip-emulator-check \"<why>\"" >&2; exit 1; }
      shift ;;
    *) echo "$USAGE" >&2; exit 1 ;;
  esac
  shift
done
if [ -n "$PRERELEASE" ] && [ "$PUBLISH" != "--publish" ]; then
  echo "--prerelease needs --publish." >&2
  exit 1
fi
# A prerelease is never "latest": the updater and releases/latest/download skip it.
# A stable release is latest only above the current latest (a hotfix for an
# older line must not take the fixed link back): scripts/android-latest-flag.sh.
# The lookup fails closed (network, auth: no guess), after the emulator gate
# and before the build, and again right before publishing (another release may
# have gone out meanwhile).
GH="${GH:-gh}"
if [ -n "$PRERELEASE" ]; then
  RELEASE_FLAGS=(--prerelease --latest=false)
fi
KEYSTORE="${BW_ANDROID_KEYSTORE:-$HOME/Developer/BandWith-keys/bandwith-release.jks}"
# Canonical versions only (1.0.14, 1.0.14.1): the tag, the version name and
# the versionCode all come from this one spelling (scripts/android-version-code.sh).
# 1.0.14 or android-v1.0.14 alike; never android-vandroid-v… (Codex, #278).
TAG="$(scripts/android-version-code.sh --tag "$VERSION")" || exit 1
VERSION="${TAG#android-v}"
NOTES_FILE=scripts/android-release-notes.md

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
  if [ -z "$PRERELEASE" ]; then
    LATEST_FLAG="$(GH="$GH" scripts/android-latest-flag.sh --lookup "$VERSION")"
    RELEASE_FLAGS=("$LATEST_FLAG")
  fi
fi

[ -f android/app/google-services.json ] || { echo "android/app/google-services.json is missing: push would be off." >&2; exit 1; }
[ -f "$KEYSTORE" ] || { echo "Release keystore not found: $KEYSTORE" >&2; exit 1; }
if [ "$PUBLISH" = "--publish" ]; then
  # Every release needs its own version: the app compares names to offer updates.
  if "$GH" release view "$TAG" --repo bandwith-app/BandWith >/dev/null 2>&1 \
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
# The code encodes the version (scripts/android-version-code.sh), so it follows
# the version order: a hotfix 1.0.13.1 stays below 1.0.14 whenever it is built.
# No override: a code that doesn't match the version breaks that order.
export BW_ANDROID_VERSION_CODE="$(scripts/android-version-code.sh "$VERSION")"
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
  if [ -z "$PRERELEASE" ]; then
    LATEST_FLAG="$(GH="$GH" scripts/android-latest-flag.sh --lookup "$VERSION")"
    RELEASE_FLAGS=("$LATEST_FLAG")
  fi
  # The versionCode goes in the notes, hidden: scripts/android-promote-check.sh
  # reads it before a prerelease is promoted.
  { cat "$NOTES_FILE"; printf '\n\n<!-- versionCode: %s -->\n' "$BW_ANDROID_VERSION_CODE"; } > dist-android/release-notes.published.md
  NOTES_FILE=dist-android/release-notes.published.md
  "$GH" release create "$TAG" dist-android/BandWith.apk \
    --repo bandwith-app/BandWith \
    --target "$(git rev-parse HEAD)" \
    --title "BandWith for Android $VERSION" \
    --notes-file "$NOTES_FILE" \
    "${RELEASE_FLAGS[@]}"
  # Two publishers at once: both may have read the same "latest" before either
  # published. Re-check now that this one is out: the highest stable version
  # keeps "latest" (docs/release-checklist.md: one publisher at a time).
  if [ -z "$PRERELEASE" ]; then
    GH="$GH" scripts/android-latest-flag.sh --fix-latest \
      || echo "WARNING: could not re-check the latest release. Run: scripts/android-latest-flag.sh --fix-latest" >&2
  fi
  if [ -n "$PRERELEASE" ]; then
    echo "Prerelease $TAG: only testers with its link get it. Link:"
    echo "  https://github.com/bandwith-app/BandWith/releases/download/$TAG/BandWith.apk"
    echo "Everyone (in-app update + latest link; only with a versionCode above every published release, latest only if it is the highest version):"
    echo "  scripts/android-promote-check.sh $VERSION && gh release edit $TAG --repo bandwith-app/BandWith --prerelease=false \"\$(scripts/android-latest-flag.sh --lookup $VERSION)\" && scripts/android-latest-flag.sh --fix-latest"
  fi
fi
