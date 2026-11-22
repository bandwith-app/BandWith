#!/usr/bin/env bash
# Prints the Android versionCode of a release: it encodes the version, so the
# code always follows the version order.
#
#   40000000 + major·1000000 + minor·10000 + patch·100 + build
#   1.0.14 → 41001400   1.0.14.1 → 41001401   2.3.4.5 → 42030405
#
# - A hotfix of an older line published later (1.0.14.1 after 1.0.15) still
#   has a LOWER code than the newer release, so phones on 1.0.15 never see a
#   "newer" 1.0.14.1, and 1.0.15 can be promoted after it (review #278 round 6).
# - Nothing below 1.0.14, the first version of this scheme: a fix for 1.0.13
#   ships as 1.0.14, never as 1.0.12.x or 1.0.13.x (those lines are minute-based
#   and already published).
# - minor and patch go up to 99, build 1–99, major up to 2059 (Google's limit is
#   2100000000). A version outside that is refused, never wrapped.
# - Above every code published before: those were minute-based (30000000 +
#   minutes since 2026-01-01, highest 30467513 for 1.0.13), which stays below
#   40000000 until 2045.
#
#   scripts/android-version-code.sh 1.0.14
#   scripts/android-version-code.sh --tag android-v1.0.14   → android-v1.0.14
#   scripts/android-version-code.sh --minute-based 1795000000
#     the old code at that Unix time, for releases published before this scheme
#     (scripts/android-promote-check.sh)
set -euo pipefail

# --tag <version or tag>: the release tag, android-v<canonical version>. One
# leading android-v is taken off; a second (android-vandroid-v…) or anything
# not canonical is refused, so a tag is never doubled (Codex, #278).
if [ "${1:-}" = "--tag" ]; then
  V="${2:-}"
  V="${V#android-v}"
  [[ "$V" =~ ^[0-9] ]] || { echo "Not a version: '${2:-}'. Use 1.0.14 (or android-v1.0.14)." >&2; exit 1; }
  "$0" "$V" >/dev/null || exit 1
  echo "android-v$V"
  exit 0
fi

if [ "${1:-}" = "--minute-based" ]; then
  BASE=30000000
  EPOCH_2026=1767225600 # 2026-01-01T00:00:00Z
  NOW="${2:-}"
  case "$NOW" in '' | *[!0-9]*) echo "Not a Unix time: $NOW" >&2; exit 1 ;; esac
  [ "$NOW" -ge "$EPOCH_2026" ] || { echo "Before 2026: $NOW" >&2; exit 1; }
  echo $((BASE + (NOW - EPOCH_2026) / 60))
  exit 0
fi

VERSION="${1:-}"
VERSION="${VERSION#android-v}"
# Canonical form only, so one version has one spelling, one tag and one code:
# major.minor.patch, or major.minor.patch.build with build 1–99; no leading
# zeros (1.00.14), no ".0" build (1.0.14.0 is 1.0.14), no short form (1.1 is 1.1.0).
P='(0|[1-9][0-9]?)'
[[ "$VERSION" =~ ^(0|[1-9][0-9]{0,3})\.$P\.$P(\.([1-9][0-9]?))?$ ]] \
  || { echo "Not a canonical version: '$VERSION'. Use major.minor.patch[.build] (1.0.14, 1.0.14.1): parts after major 0–99, build 1–99, no leading zeros." >&2; exit 1; }
MAJOR=${BASH_REMATCH[1]}
MINOR=${BASH_REMATCH[2]}
PATCH=${BASH_REMATCH[3]}
BUILD=${BASH_REMATCH[5]:-0}
[ "$MAJOR" -le 2059 ] || { echo "Major $MAJOR is above 2059: the code would pass Google's limit." >&2; exit 1; }
CODE=$((40000000 + MAJOR * 1000000 + MINOR * 10000 + PATCH * 100 + BUILD))
FLOOR=41001400 # 1.0.14
[ "$CODE" -ge "$FLOOR" ] || { echo "Below 1.0.14: $VERSION. A fix for 1.0.13 ships as 1.0.14 (never 1.0.12.x or 1.0.13.x)." >&2; exit 1; }
echo "$CODE"
