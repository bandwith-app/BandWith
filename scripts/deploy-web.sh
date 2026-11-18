#!/usr/bin/env bash
# Deploys the web app to production on Vercel (app.bandwith.fun, also
# served at the old bandwith-beryl.vercel.app):
#   npx vercel@latest deploy --prod --yes
# Every production deploy goes through this script, from a clean checkout of
# the commit to ship (e.g. the vercel-prod worktree on origin/main).
#
#   scripts/deploy-web.sh
#   scripts/deploy-web.sh --skip-emulator-check "<reason>"   # emergencies only
#   scripts/deploy-web.sh --dry-run                           # print, don't deploy
#
# It refuses a commit without a passing emulator check (scripts/emulator-check.sh
# plus `--duo-ok`, see maestro/README.md), and uncommitted app changes: the
# Vercel CLI uploads the working tree, so it must be exactly the checked commit.
# --skip-emulator-check deploys anyway, with a warning, and records the reason
# in the deployment's metadata (emulatorCheckSkipped).
set -euo pipefail
cd "$(dirname "$0")/.."

DRY_RUN=""
SKIP_EMULATOR_REASON=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-emulator-check)
      SKIP_EMULATOR_REASON="${2:-}"
      [ -n "$SKIP_EMULATOR_REASON" ] && [ "${SKIP_EMULATOR_REASON#--}" = "$SKIP_EMULATOR_REASON" ] \
        || { echo "--skip-emulator-check needs a reason: --skip-emulator-check \"<why>\"" >&2; exit 1; }
      shift ;;
    *) echo "usage: scripts/deploy-web.sh [--dry-run] [--skip-emulator-check \"<reason>\"]" >&2; exit 1 ;;
  esac
  shift
done

SHA="$(git rev-parse HEAD)"
if [ -n "$(git status --porcelain --untracked-files=no -- src academy public index.html '*.html' vite.config.ts package.json pnpm-lock.yaml vercel.json 2>/dev/null)" ]; then
  echo "Uncommitted app changes: deploy from a clean checkout of the checked commit." >&2
  exit 1
fi

CMD=(npx vercel@latest deploy --prod --yes)
if [ -n "$SKIP_EMULATOR_REASON" ]; then
  echo "WARNING: deploying ${SHA:0:12} to production WITHOUT an emulator check: $SKIP_EMULATOR_REASON" >&2
  CMD+=(--meta "emulatorCheckSkipped=$SKIP_EMULATOR_REASON")
else
  node scripts/emulator-gate.mjs >&2 || { echo "Not deploying ${SHA:0:12}." >&2; exit 1; }
fi

if [ -n "$DRY_RUN" ]; then
  echo "Would run: ${CMD[*]}"
  exit 0
fi
"${CMD[@]}"
