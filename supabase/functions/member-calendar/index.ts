// Calendar sync for an account (Settings → Calendar sync), and "Add to
// calendar" on one event.
//
// GET /functions/v1/member-calendar?t=<feed token>[&l=<language>]
// Returns the user's gigs, rehearsals and personal gigs as an .ics feed
// (bw_member_calendar_feed, migration 165): the same events the app's
// calendar shows them, logistics only (no fees, no client). Calendars poll
// it, so changes and cancellations reach the user's calendar by themselves.
//
// GET /functions/v1/member-calendar?o=<event link token>[&l=<language>]
// One event as a file to import once ("Add to calendar" on the event,
// bw_member_event_calendar, migration 182). The token is bound to that
// event (and, for a repeating rehearsal, to the date the user opened), so a
// forwarded link shows that event only, never the rest of the calendar.
// That date comes alone, without the series rule.
//
// t=<feed token>&e=<event id>: how app builds before 182 asked for one
// event. Still answered so they keep working.
//
// Public by design: the 64-character tokens are the only key, as for
// deputy-calendar. Uses the publishable key; the RPCs return only what the
// owner of the link may see. Deploy with --no-verify-jwt.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { memberFeedCalendar, type MemberFeedEvent } from "../_shared/deputy-calendar.ts";

const SITE = "https://app.bandwith.fun"; // = src/lib/appUrl.ts

function publishableKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    if (typeof keys?.default === "string") return keys.default;
  } catch { /* fall through */ }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[0-9a-f]{64}$/;

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
  const eventToken = (url.searchParams.get("o") ?? "").toLowerCase();
  const token = (url.searchParams.get("t") ?? "").toLowerCase();
  const legacyOne = (url.searchParams.get("e") ?? "").toLowerCase();

  let language: string | null | undefined;
  let feedEvents: MemberFeedEvent[];
  let one: string | null = null;
  let occurrence: string | null = null;

  if (eventToken) {
    if (!TOKEN.test(eventToken)) return new Response("Not found", { status: 404 });
    const res = await rpc("bw_member_event_calendar", eventToken);
    if (!res.ok) return new Response("Unavailable", { status: 503 });
    const link = await res.json() as { language?: string | null; occurrence?: string | null; event?: MemberFeedEvent | null } | null;
    if (!link?.event) return new Response("Not found", { status: 404 });
    language = link.language;
    feedEvents = [link.event];
    one = link.event.id;
    occurrence = link.occurrence ?? null;
  } else {
    if (!TOKEN.test(token)) return new Response("Not found", { status: 404 });
    if (legacyOne && !UUID.test(legacyOne)) return new Response("Not found", { status: 404 });
    const res = await rpc("bw_member_calendar_feed", token);
    if (!res.ok) return new Response("Unavailable", { status: 503 });
    const feed = await res.json() as { language?: string | null; events?: MemberFeedEvent[] } | null;
    if (!feed) return new Response("Not found", { status: 404 });
    language = feed.language;
    feedEvents = feed.events ?? [];
    one = legacyOne || null;
  }

  // The link's language, else the account's app language.
  const lang = (url.searchParams.get("l") ?? language ?? "en").slice(0, 2).toLowerCase();
  const body = memberFeedCalendar(feedEvents, { lang, site: SITE, one, occurrence });
  if (body === null) return new Response("Not found", { status: 404 });

  return new Response(req.method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": one ? 'attachment; filename="bandwith-event.ics"' : 'inline; filename="bandwith.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
});
