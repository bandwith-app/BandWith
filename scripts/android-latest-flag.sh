#!/usr/bin/env bash
# Which "latest" flag a stable Android release gets (scripts/release-android.sh):
# the fixed link releases/latest/download/BandWith.apk and the in-app updater
# follow GitHub's "latest" release, so a release becomes latest only when its
# version is higher than the current latest one. A hotfix for an older line
# (1.0.13.1 after 1.0.14) must not send everyone back.
#
#   scripts/android-latest-flag.sh <version> [<current latest version>]
#   scripts/android-latest-flag.sh --lookup <version>
#   → prints --latest or --latest=false
# No current latest (the first release): --latest.
# --lookup asks GitHub for the current latest release (gh, or $GH). It fails
# closed: any answer other than a tag or "release not found" (network, auth,
# rate limit) stops with an error instead of guessing.
#   scripts/android-latest-flag.sh --fix-latest
#   → after a stable release went out: if "latest" is not on the highest stable
#     version (two publishers read the same latest before either published),
#     moves it there. Prints the tag that is latest afterwards. Fails closed.
set -euo pipefail
if [ "${1:-}" = "--fix-latest" ]; then
  REPO=bandwith-app/BandWith
  TAGS="$("${GH:-gh}" release list --repo "$REPO" --exclude-pre-releases --exclude-drafts --limit 1000 --json tagName -q '.[].tagName')"
  TOP="$(printf '%s\n' "$TAGS" | grep -E '^android-v[0-9]+(\.[0-9]+){1,3}$' | sed 's/^android-v//' | sort -V | tail -1)"
  [ -n "$TOP" ] || { echo "No stable Android release found." >&2; exit 1; }
  TOP="android-v$TOP"
  CUR="$("${GH:-gh}" release view --repo "$REPO" --json tagName -q .tagName)"
  if [ "$CUR" != "$TOP" ]; then
    "${GH:-gh}" release edit "$TOP" --repo "$REPO" --latest >/dev/null
    echo "Latest moved from $CUR to $TOP." >&2
  fi
  echo "$TOP"
  exit 0
fi
if [ "${1:-}" = "--lookup" ]; then
  NEW="${2:?usage: scripts/android-latest-flag.sh --lookup <version>}"
  ERR="$(mktemp)"
  trap 'rm -f "$ERR"' EXIT
  if OUT="$("${GH:-gh}" release view --repo bandwith-app/BandWith --json tagName -q .tagName 2>"$ERR")"; then
    if ! [[ "$OUT" =~ ^android-v[0-9]+(\.[0-9]+){1,3}$ ]]; then
      echo "Unexpected answer for the current latest release: '$OUT'" >&2
      exit 1
    fi
    CUR="$OUT"
  elif grep -qi 'release not found' "$ERR"; then
    CUR=""
  else
    echo "Could not read the current latest release (not publishing on a guess): $(cat "$ERR")" >&2
    exit 1
  fi
  "$0" "$NEW" "$CUR"
  exit 0
fi
NEW="${1:?usage: scripts/android-latest-flag.sh <version> [<current latest>]}"
CUR="${2:-}"
CUR="${CUR#android-v}"
if [ -z "$CUR" ] || [ "$NEW" = "$CUR" ]; then
  [ -z "$CUR" ] && echo "--latest" || echo "--latest=false"
  exit 0
fi
TOP="$(printf '%s\n%s\n' "$NEW" "$CUR" | sort -V | tail -1)"
[ "$TOP" = "$NEW" ] && echo "--latest" || echo "--latest=false"
