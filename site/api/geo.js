/**
 * GET /api/geo → { "country": "ES", "region": "MD" }
 *
 * Vercel edge function (copied into the site build by site/vite.config.ts).
 * The country and its subdivision come from Vercel's own request headers
 * (x-vercel-ip-country, x-vercel-ip-country-region): no third-party lookup,
 * nothing stored, no IP returned. The site uses it once per visit to suggest
 * a language (site/src/ui/langSuggest.ts).
 */
export const config = { runtime: 'edge' };

const code = (v, re) => (v && re.test(v) ? v.toUpperCase() : null);

export default function geo(request) {
  const h = request.headers;
  const body = {
    country: code(h.get('x-vercel-ip-country'), /^[A-Za-z]{2}$/),
    region: code(h.get('x-vercel-ip-country-region'), /^[A-Za-z0-9]{1,3}$/) ?? '',
  };
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Per visitor: never cached by the CDN or shared.
      'cache-control': 'private, no-store',
    },
  });
}
