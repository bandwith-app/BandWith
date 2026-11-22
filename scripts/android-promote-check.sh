#!/usr/bin/env bash
# Before promoting an Android prerelease to everyone (docs/release-checklist.md):
# its APK must have a versionCode above every published stable release.
# Android won't install a lower code over a higher one, and the in-app updater
# needs a strictly higher one. Example: a hotfix 1.0.13.1 published during
# the 1.0.14 pilot was built later, so its code is higher; promoting the
# 1.0.14 APK then fails on every phone that took the hotfix. Rebuild instead.
#
#   scripts/android-promote-check.sh <version> [--code <versionCode>]
#   → exit 0 and "OK …", or exit 1 and why
#
# Codes come from the "<!-- versionCode: N -->" line release-android.sh puts in
# the release notes. A published release without it (before that line existed)
# counts with the minute-based code it would have had when it was published
# (the scheme before version-encoded codes): never below its real code (the APK
# was built before), so the check stays on the safe side.
# The candidate needs its real code: from its notes, or, when its notes have
# none, --code (aapt dump badging BandWith.apk | grep versionCode). --code never
# overrides a recorded code: a different one is refused.
# Since codes encode the version (scripts/android-version-code.sh), a release
# built with them always passes against an older line; the check still guards
# the releases from before.
# A candidate without its BandWith.apk asset is refused: it was withdrawn (the
# rollback in docs/release-checklist.md deletes or renames the asset) or never
# uploaded, so the fixed link would have nothing to serve. A withdrawn stable
# release still counts for the code check: phones may have installed it.
# Fails closed: no answer from GitHub (network, auth) means no promotion.
set -euo pipefail
VERSION="${1:?usage: scripts/android-promote-check.sh <version> [--code <versionCode>]}"
VERSION="${VERSION#android-v}"
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+){1,3}$ ]] || { echo "Version must look like 1.0.14: $VERSION" >&2; exit 1; }
CODE_ARG=""
if [ "${2:-}" = "--code" ]; then
  CODE_ARG="${3:?--code needs a number}"
  case "$CODE_ARG" in *[!0-9]*) echo "--code must be a number: $CODE_ARG" >&2; exit 1 ;; esac
fi
TAG="android-v$VERSION"
HERE="$(cd "$(dirname "$0")" && pwd)"

ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT
# One line per release: tag, prerelease, draft, published (Unix time), has a
# BandWith.apk asset, recorded code (last: it can be empty, and read folds
# empty fields between tabs).
JQ='.[] | select(.tag_name | startswith("android-v")) | [.tag_name, (.prerelease|tostring), (.draft|tostring), ((.published_at // .created_at) | fromdateiso8601 | floor | tostring), ([.assets[]?.name] | index("BandWith.apk") != null | tostring), (((.body // "") | capture("versionCode: (?<c>[0-9]+)") | .c) // "")] | @tsv'
if ! LINES="$("${GH:-gh}" api --paginate "repos/bandwith-app/BandWith/releases?per_page=100" --jq "$JQ" 2>"$ERR")"; then
  echo "Could not read the releases (not promoting on a guess): $(cat "$ERR")" >&2
  exit 1
fi

CAND_CODE=""
CAND_APK=""
FOUND=""
TOP_CODE=0
TOP_TAG=""
while IFS=$'\t' read -r tag pre draft published apk code; do
  [ -n "$tag" ] || continue
  [[ "$published" =~ ^[0-9]+$ ]] || { echo "Unexpected answer for $tag: '$published'" >&2; exit 1; }
  if [ "$tag" = "$TAG" ]; then
    FOUND=1
    [ "$pre" = "true" ] || { echo "$TAG is not a prerelease (already promoted?)." >&2; exit 1; }
    CAND_CODE="$code"
    CAND_APK="$apk"
    continue
  fi
  [ "$pre" = "false" ] && [ "$draft" = "false" ] || continue
  [ -n "$code" ] || code="$("$HERE/android-version-code.sh" --minute-based "$published")"
  if [ "$code" -gt "$TOP_CODE" ]; then
    TOP_CODE="$code"
    TOP_TAG="$tag"
  fi
done <<<"$LINES"

[ -n "$FOUND" ] || { echo "$TAG not found among the releases." >&2; exit 1; }
[ "$CAND_APK" = "true" ] || {
  echo "Not promoting $TAG: it has no BandWith.apk asset (withdrawn, or never uploaded)." >&2
  exit 1
}
if [ -n "$CODE_ARG" ]; then
  # --code is for a prerelease without a recorded code. With one, it must be that
  # code: a different number is another build, not the APK on the release.
  if [ -n "$CAND_CODE" ] && [ "$CAND_CODE" != "$CODE_ARG" ]; then
    echo "--code $CODE_ARG differs from the code recorded for $TAG ($CAND_CODE): not that APK. Not promoting." >&2
    exit 1
  fi
  CAND_CODE="$CODE_ARG"
fi
[ -n "$CAND_CODE" ] || {
  echo "$TAG has no recorded versionCode: pass --code <n> (aapt dump badging BandWith.apk | grep versionCode)." >&2
  exit 1
}
if [ "$CAND_CODE" -le "$TOP_CODE" ]; then
  echo "Not promoting $TAG: its versionCode $CAND_CODE is not above $TOP_TAG ($TOP_CODE)." >&2
  echo "Phones on $TOP_TAG would refuse it. Rebuild $VERSION as a new version (scripts/release-android.sh) and pilot that." >&2
  exit 1
fi
echo "OK: $TAG (code $CAND_CODE) is above every published release${TOP_TAG:+ (highest $TOP_TAG, code $TOP_CODE)}."
