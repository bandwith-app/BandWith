#!/usr/bin/env bash
# Prints the Android versionCode of a release: it encodes the version, so the
# code always follows the version order.
#
#   40000000 + major·1000000 + minor·10000 + patch·100 + build
#   1.0.14 → 41001400   1.0.13.1 → 41001301   2.3.4.5 → 42030405
#
# - A hotfix of an older line published later (1.0.13.1 after 1.0.14) still
#   has a LOWER code than the newer release, so phones on 1.0.14 never see a
#   "newer" 1.0.13.1, and 1.0.14 can be promoted after it (review #278 round 6).
# - minor, patch and build go up to 99, major up to 2059 (Google's limit is
#   2100000000). A version outside that is refused, never wrapped.
# - Above every code published before: those were minute-based (30000000 +
#   minutes since 2026-01-01, highest 30467513 for 1.0.13), which stays below
#   40000000 until 2045.
#
#   scripts/android-version-code.sh 1.0.14
#   scripts/android-version-code.sh --minute-based 1795000000
#     the old code at that Unix time, for releases published before this scheme
#     (scripts/android-promote-check.sh)
set -euo pipefail

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
[[ "$VERSION" =~ ^([0-9]{1,4})\.([0-9]{1,2})(\.([0-9]{1,2}))?(\.([0-9]{1,2}))?$ ]] \
  || { echo "Can't encode '$VERSION' as a versionCode: major.minor[.patch[.build]], each part after major 0–99." >&2; exit 1; }
MAJOR=$((10#${BASH_REMATCH[1]}))
MINOR=$((10#${BASH_REMATCH[2]}))
PATCH=$((10#${BASH_REMATCH[4]:-0}))
BUILD=$((10#${BASH_REMATCH[6]:-0}))
[ "$MAJOR" -le 2059 ] || { echo "Major $MAJOR is above 2059: the code would pass Google's limit." >&2; exit 1; }
echo $((40000000 + MAJOR * 1000000 + MINOR * 10000 + PATCH * 100 + BUILD))
