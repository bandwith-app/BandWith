// Calendar sync for an account (Settings → Calendar sync).
//
// GET /functions/v1/member-calendar?t=<link token>[&l=<language>][&e=<event id>]
// Returns the user's gigs, rehearsals and personal gigs as an .ics feed
// (bw_member_calendar_feed, migration 165): the same events the app's
// calendar shows them, logistics only (no fees, no client). Calendars poll
// it, so changes and cancellations reach the user's calendar by themselves.
// e=<event id>: only that event, as a file to import once ("Add to calendar"
// on the event).
// Public by design: the 64-character token is the only key, as for
// deputy-calendar. Uses the publishable key; the RPC returns only what the
// owner of the link may see. Deploy with --no-verify-jwt.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { calendarFile, gigEvent, GIG_LABELS, recurrenceRule } from "../_shared/deputy-calendar.ts";

const SITE = "https://app.bandwith.fun"; // = src/lib/appUrl.ts

function publishableKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    if (typeof keys?.default === "string") return keys.default;
  } catch { /* fall through */ }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

interface FeedEvent {
  id: string;
  type: "gig" | "rehearsal" | "personal";
  title: string | null;
  band_name: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  load_in_time: string | null;
  soundcheck_time: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_address: string | null;
  role: string | null;
  recurrence: unknown;
  updated_at: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const url = new URL(req.url);
  const token = (url.searchParams.get("t") ?? "").toLowerCase();
  const one = (url.searchParams.get("e") ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(token)) return new Response("Not found", { status: 404 });
  if (one && !UUID.test(one)) return new Response("Not found", { status: 404 });

  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/bw_member_calendar_feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: publishableKey() },
    body: JSON.stringify({ p_token: token }),
  });
  if (!res.ok) return new Response("Unavailable", { status: 503 });
  const feed = await res.json() as { language?: string | null; events?: FeedEvent[] } | null;
  if (!feed) return new Response("Not found", { status: 404 });

  // The link's language, else the account's app language.
  const lang = (url.searchParams.get("l") ?? feed.language ?? "en").slice(0, 2).toLowerCase();
  const labels = GIG_LABELS[lang] ?? GIG_LABELS.en;
  const chosen = (feed.events ?? []).filter((e) => e.event_date && (!one || e.id === one));
  if (one && chosen.length === 0) return new Response("Not found", { status: 404 });

  const events = chosen.map((e) =>
    gigEvent(
      {
        title: e.title || (e.type === "rehearsal" ? labels.rehearsal : labels.gig) || "Gig",
        bandName: e.band_name ?? "",
        kind: e.type === "rehearsal" ? "rehearsal" : "gig",
        date: e.event_date as string,
        loadIn: e.load_in_time,
        soundcheck: e.soundcheck_time,
        start: e.start_time,
        end: e.end_time,
        venue: e.venue_name,
        city: e.venue_city,
        address: e.venue_address,
        role: e.role,
        url: SITE,
      },
      labels,
      `event-${e.id}`,
      { updatedAt: e.updated_at, rrule: recurrenceRule(e.recurrence) },
    )
  );

  const body = calendarFile(events, one ? undefined : "BandWith", "Member");
  return new Response(req.method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": one ? 'attachment; filename="bandwith-event.ics"' : 'inline; filename="bandwith.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
});
