#!/usr/bin/env bash
# Tells Bing, Yandex, Seznam, Naver and the other IndexNow engines that the
# product site changed: every URL in the live https://bandwith.fun/sitemap.xml.
# Run it after a production deploy of the site (scripts/deploy-site.sh --prod),
# on the user's go, like the deploy itself. Google doesn't use IndexNow: it reads
# the sitemap submitted in Search Console.
#
# The key is public by design: the engines check it at https://bandwith.fun/<key>.txt
# (site/public/<key>.txt).
set -euo pipefail

KEY="d35b19f98f99081da49e72443242515d"
HOST="bandwith.fun"

URLS=$(curl -fsS "https://$HOST/sitemap.xml" | grep -o '<loc>[^<]*</loc>' | sed -e 's#<loc>##' -e 's#</loc>##')
[ -n "$URLS" ] || { echo "No URLs in the live sitemap: deploy first." >&2; exit 1; }
curl -fsS "https://$HOST/$KEY.txt" | grep -qx "$KEY" || { echo "Key file not live yet: deploy first." >&2; exit 1; }

BODY=$(printf '%s\n' "$URLS" | python3 -c '
import json, sys
urls = [u.strip() for u in sys.stdin if u.strip()]
print(json.dumps({"host": sys.argv[1], "key": sys.argv[2], "keyLocation": f"https://{sys.argv[1]}/{sys.argv[2]}.txt", "urlList": urls}))
' "$HOST" "$KEY")

echo "Submitting $(printf '%s\n' "$URLS" | wc -l | tr -d ' ') URLs to IndexNow…"
CODE=$(curl -sS -o /dev/stderr -w '%{http_code}' -X POST "https://api.indexnow.org/indexnow"   -H 'Content-Type: application/json; charset=utf-8' --data "$BODY")
echo "IndexNow answered HTTP $CODE (200 or 202 = accepted)."
