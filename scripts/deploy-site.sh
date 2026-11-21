#!/usr/bin/env bash
# Product site (site/) → its own Vercel project, bandwith-site.
#
#   scripts/deploy-site.sh          a preview (private *.vercel.app URL, printed at the end)
#   scripts/deploy-site.sh --prod   production https://bandwith.fun (manual release only)
#
# Builds site/dist from this checkout (it must be clean), copies it to a temp
# folder linked to the project and deploys that folder: no git link, the app's
# project and the root vercel.json are never touched. site/dist/api/geo.js is
# the edge function behind the language suggestion (x-vercel-ip-country).
set -euo pipefail
cd "$(dirname "$0")/.."

PROD=0
[ "${1:-}" = "--prod" ] && PROD=1

if [ -n "$(git status --porcelain --untracked-files=no -- site package.json pnpm-lock.yaml)" ]; then
  echo "site/ has uncommitted changes: deploy a committed state." >&2
  exit 1
fi

PNPM=(pnpm)
command -v pnpm >/dev/null || PNPM=(npx --yes pnpm@10)
"${PNPM[@]}" build:site

OUT="$(mktemp -d)/bandwith-site"
cp -R site/dist "$OUT"
mkdir -p "$OUT/.vercel"
cat > "$OUT/.vercel/project.json" <<JSON
{"projectId":"${BW_SITE_PROJECT_ID:-prj_EwNYSQ4eHF7xCnFWaoOMkzhqyBUB}","orgId":"${BW_SITE_ORG_ID:-team_M6xaMWJfK2rvNzXwTs3ng8Km}","projectName":"bandwith-site"}
JSON

cd "$OUT"
echo "Deploying $(git -C "$OLDPWD" rev-parse --short HEAD) from $OUT"
if [ "$PROD" = 1 ]; then
  npx --yes vercel@latest deploy --prod --yes
else
  npx --yes vercel@latest deploy --yes
fi
