#!/usr/bin/env bash
# Which "latest" flag a stable Android release gets (scripts/release-android.sh):
# the fixed link releases/latest/download/BandWith.apk and the in-app updater
# follow GitHub's "latest" release, so a release becomes latest only when its
# version is higher than the current latest one. A hotfix for an older line
# (1.0.13.1 after 1.0.14) must not send everyone back.
#
#   scripts/android-latest-flag.sh <version> [<current latest version>]
#   → prints --latest or --latest=false
# No current latest (first release, or gh can't tell): --latest.
set -euo pipefail
NEW="${1:?usage: scripts/android-latest-flag.sh <version> [<current latest>]}"
CUR="${2:-}"
CUR="${CUR#android-v}"
if [ -z "$CUR" ] || [ "$NEW" = "$CUR" ]; then
  [ -z "$CUR" ] && echo "--latest" || echo "--latest=false"
  exit 0
fi
TOP="$(printf '%s\n%s\n' "$NEW" "$CUR" | sort -V | tail -1)"
[ "$TOP" = "$NEW" ] && echo "--latest" || echo "--latest=false"
