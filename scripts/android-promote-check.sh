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
# counts with the code it would have had when it was published: that is never
# below its real code (the APK was built before), so the check stays on the
# safe side. The candidate itself needs its real code: from its notes, or
# --code (aapt dump badging BandWith.apk | grep versionCode).
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
# One line per release: tag, prerelease, draft, published (Unix time), recorded code.
JQ='.[] | select(.tag_name | startswith("android-v")) | [.tag_name, (.prerelease|tostring), (.draft|tostring), ((.published_at // .created_at) | fromdateiso8601 | floor | tostring), (((.body // "") | capture("versionCode: (?<c>[0-9]+)") | .c) // "")] | @tsv'
if ! LINES="$("${GH:-gh}" api --paginate "repos/bandwith-app/BandWith/releases?per_page=100" --jq "$JQ" 2>"$ERR")"; then
  echo "Could not read the releases (not promoting on a guess): $(cat "$ERR")" >&2
  exit 1
fi

CAND_CODE=""
FOUND=""
TOP_CODE=0
TOP_TAG=""
while IFS=$'\t' read -r tag pre draft published code; do
  [ -n "$tag" ] || continue
  [[ "$published" =~ ^[0-9]+$ ]] || { echo "Unexpected answer for $tag: '$published'" >&2; exit 1; }
  if [ "$tag" = "$TAG" ]; then
    FOUND=1
    [ "$pre" = "true" ] || { echo "$TAG is not a prerelease (already promoted?)." >&2; exit 1; }
    CAND_CODE="$code"
    continue
  fi
  [ "$pre" = "false" ] && [ "$draft" = "false" ] || continue
  [ -n "$code" ] || code="$("$HERE/android-version-code.sh" "$published")"
  if [ "$code" -gt "$TOP_CODE" ]; then
    TOP_CODE="$code"
    TOP_TAG="$tag"
  fi
done <<<"$LINES"

[ -n "$FOUND" ] || { echo "$TAG not found among the releases." >&2; exit 1; }
[ -z "$CODE_ARG" ] || CAND_CODE="$CODE_ARG"
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
