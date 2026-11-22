// Calendar subscription for a deputy (no BandWith account).
//
// GET /functions/v1/deputy-calendar?t=<calendar token>&l=<language>
// The subscription: the deputy's confirmed gigs with that band as an .ics
// feed (bw_deputy_calendar_feed, migration 182). Calendars poll it, so
// changes to times or venue and cancellations reach the deputy's own
// calendar by themselves.
//
// GET /functions/v1/deputy-calendar?g=<gig calendar token>&l=<language>
// "Add to calendar": the file of that one gig (bw_deputy_gig_calendar). Its
// own key, so a forwarded file link opens that gig only, not the
// subscription.
//
// t=<token>&one=1: the file as links before 182 asked for it (still served).
// Public by design: the 64-character token is the only key. Since 182 it is
// the request's read-only calendar token, not its reply token: the reply
// token (/deputy.html) shows the fee and changes the answer, and a calendar
// is shared too easily. Subscriptions made before 182 carry the reply token:
// they keep working, and no entry carries a reply link any more.
// Uses the publishable key; the RPC returns only what the deputy may see.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { deputyFeedCalendar, type DeputyFeedGig } from "../_shared/deputy-calendar.ts";

function publishableKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    if (typeof keys?.default === "string") return keys.default;
  } catch { /* fall through */ }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

const rpc = (name: string, token: string) =>
  fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: publishableKey() },
    body: JSON.stringify({ p_token: token }),
  });

serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const url = new URL(req.url);
  const gigToken = (url.searchParams.get("g") ?? "").toLowerCase();
  const token = gigToken || (url.searchParams.get("t") ?? "").toLowerCase();
  const lang = (url.searchParams.get("l") ?? "en").slice(0, 2).toLowerCase();
  const one = !!gigToken || url.searchParams.get("one") === "1";
  if (!/^[0-9a-f]{64}$/.test(token)) return new Response("Not found", { status: 404 });

  let res = await rpc(gigToken ? "bw_deputy_gig_calendar" : "bw_deputy_calendar_feed", token);
  // Before migration 182 (the function deployed first): the 084 feed. Its
  // reply tokens are never written into the calendar.
  if (res.status === 404 && !gigToken) res = await rpc("bw_deputy_feed", token);
  if (!res.ok) return new Response("Unavailable", { status: 503 });
  const feed = await res.json() as { band_name?: string; gigs?: DeputyFeedGig[] } | null;
  if (!feed) return new Response("Not found", { status: 404 });

  const body = deputyFeedCalendar(feed, { token, lang, one });
  return new Response(req.method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": one ? 'attachment; filename="gig.ics"' : 'inline; filename="bandwith-deputy.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
});
