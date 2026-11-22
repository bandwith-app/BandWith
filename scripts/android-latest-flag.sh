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
#   → after a stable release went out, or after a rollback: if "latest" is not
#     on the highest stable version that is not withdrawn (its BandWith.apk
#     asset is there), moves it there. Two publishers may have read the same
#     latest before either published; a rollback makes the bad release a
#     prerelease and removes its APK. Prints the tag that is latest afterwards.
#     Fails closed.
set -euo pipefail
if [ "${1:-}" = "--fix-latest" ]; then
  REPO=bandwith-app/BandWith
  ERR="$(mktemp)"
  trap 'rm -f "$ERR"' EXIT
  # One line per release: tag, prerelease, draft, has a BandWith.apk asset.
  JQ='.[] | select(.tag_name | startswith("android-v")) | [.tag_name, (.prerelease|tostring), (.draft|tostring), ([.assets[]?.name] | index("BandWith.apk") != null | tostring)] | @tsv'
  if ! ROWS="$("${GH:-gh}" api --paginate "repos/$REPO/releases?per_page=100" --jq "$JQ" 2>"$ERR")"; then
    echo "Could not read the releases (not moving latest on a guess): $(cat "$ERR")" >&2
    exit 1
  fi
  # The highest stable release that is not withdrawn (its BandWith.apk is there).
  TOP="$(printf '%s\n' "$ROWS" | awk -F '\t' '$2 == "false" && $3 == "false" && $4 == "true" { print $1 }' \
    | grep -E '^android-v[0-9]+(\.[0-9]+){1,3}$' | sed 's/^android-v//' | sort -V | tail -1 || true)"
  [ -n "$TOP" ] || { echo "No stable Android release with its BandWith.apk found." >&2; exit 1; }
  TOP="android-v$TOP"
  if CUR="$("${GH:-gh}" release view --repo "$REPO" --json tagName -q .tagName 2>"$ERR")"; then
    :
  elif grep -qi 'release not found' "$ERR"; then
    CUR="" # no latest at all (the last one was made a prerelease)
  else
    echo "Could not read the current latest release (not moving latest on a guess): $(cat "$ERR")" >&2
    exit 1
  fi
  if [ "$CUR" != "$TOP" ]; then
    "${GH:-gh}" release edit "$TOP" --repo "$REPO" --latest >/dev/null
    echo "Latest moved from ${CUR:-none} to $TOP." >&2
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
