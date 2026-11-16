#!/usr/bin/env bash
# Prints the Android versionCode for a release built now (or at the given
# Unix time): 30000000 + whole minutes since 2026-01-01 00:00 UTC.
#
# - Strictly increasing per minute, so two releases in the same hour get
#   different codes (the old hour-based yymmddhh code gave 1.0.1 and 1.0.2
#   both 26111520).
# - Always above every code published before (the highest is 26111520).
# - Stays under Google's limit of 2100000000 for thousands of years.
#
#   scripts/android-version-code.sh             # now
#   scripts/android-version-code.sh 1795000000  # at that Unix time
set -euo pipefail

BASE=30000000
EPOCH_2026=1767225600 # 2026-01-01T00:00:00Z
NOW="${1:-$(date -u +%s)}"
case "$NOW" in '' | *[!0-9]*) echo "Not a Unix time: $NOW" >&2; exit 1 ;; esac
[ "$NOW" -ge "$EPOCH_2026" ] || { echo "The clock is before 2026: $NOW" >&2; exit 1; }

echo $((BASE + (NOW - EPOCH_2026) / 60))
