/**
 * Calendar entries for deputies (no BandWith account): the .ics behind
 * "Add to calendar" on /deputy.html, the Google Calendar link, and the
 * subscription feed served by the deputy-calendar edge function.
 * Plain TypeScript with no imports: the web app (src/lib/deputyCalendar.ts)
 * and Deno share this file. Times are floating (no time zone): the gig
 * happens at local time.
 */

export interface DeputyGig {
  title: string;
  bandName: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM[:SS]; the entry starts at load-in when there is one. */
  loadIn?: string | null;
  soundcheck?: string | null;
  start?: string | null;
  end?: string | null;
  venue?: string | null;
  city?: string | null;
  address?: string | null;
  role?: string | null;
  /** A page without any credential in it (the app), so the entry leads back to it. */
  url?: string | null;
  /** A rehearsal reads "Rehearsal 19:00–22:00" instead of "Show …". */
  kind?: 'gig' | 'rehearsal';
}

export interface GigLabels {
  loadIn: string;
  soundcheck: string;
  show: string;
  role: string;
  /** Title of a gig without a name (the feed). */
  gig?: string;
  /** Rehearsal times, and the title of one without a name. */
  rehearsal?: string;
}

/** For the feed, which has no app translations at hand. */
export const GIG_LABELS: Record<string, GigLabels> = {
  en: { loadIn: 'Load-in', soundcheck: 'Soundcheck', show: 'Show', role: 'Role', gig: 'Gig', rehearsal: 'Rehearsal' },
  it: { loadIn: 'Carico', soundcheck: 'Soundcheck', show: 'Show', role: 'Ruolo', gig: 'Gig', rehearsal: 'Prova' },
  es: { loadIn: 'Montaje', soundcheck: 'Prueba de sonido', show: 'Show', role: 'Rol', gig: 'Concierto', rehearsal: 'Ensayo' },
  fr: { loadIn: 'Installation', soundcheck: 'Balances', show: 'Concert', role: 'Rôle', gig: 'Concert', rehearsal: 'Répétition' },
  de: { loadIn: 'Aufbau', soundcheck: 'Soundcheck', show: 'Show', role: 'Rolle', gig: 'Gig', rehearsal: 'Probe' },
  pt: { loadIn: 'Montagem', soundcheck: 'Passagem de som', show: 'Show', role: 'Função', gig: 'Show', rehearsal: 'Ensaio' },
};

const hm = (v?: string | null): [number, number] | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(v || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const stamp = (d: Date) => `${ymd(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const nextDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

/** Start and end of the entry; no times means an all-day entry. */
export function gigWindow(g: DeputyGig): { allDay: true; day: Date } | { allDay: false; start: Date; end: Date } {
  const [y, mo, d] = g.date.split('-').map(Number);
  const first = hm(g.loadIn) || hm(g.soundcheck) || hm(g.start);
  if (!first) return { allDay: true, day: new Date(y, mo - 1, d) };
  const start = new Date(y, mo - 1, d, first[0], first[1]);
  const showStart = hm(g.start);
  const endHm = hm(g.end);
  let end: Date;
  if (endHm) {
    end = new Date(y, mo - 1, d, endHm[0], endHm[1]);
    // Past midnight: the show ends the next day.
    if (end <= start) end.setDate(end.getDate() + 1);
  } else {
    const base = showStart ? new Date(y, mo - 1, d, showStart[0], showStart[1]) : start;
    if (base < start) base.setDate(base.getDate() + 1);
    end = new Date(base.getTime() + 3 * 3600 * 1000);
  }
  return { allDay: false, start, end };
}

/** Venue, address and city without repeated parts ("Via Roma 1, Como, Como"). */
const location = (g: DeputyGig) => {
  const seen = new Set<string>();
  return [g.venue, g.address, g.city]
    .flatMap((x) => (x || '').split(','))
    .map((x) => x.trim())
    .filter((x) => x && !seen.has(x.toLocaleLowerCase()) && seen.add(x.toLocaleLowerCase()))
    .join(', ');
};

const details = (g: DeputyGig, l: GigLabels) =>
  [
    g.role ? `${l.role}: ${g.role}` : null,
    g.loadIn ? `${l.loadIn} ${g.loadIn.slice(0, 5)}` : null,
    g.soundcheck ? `${l.soundcheck} ${g.soundcheck.slice(0, 5)}` : null,
    g.start ? `${g.kind === 'rehearsal' ? l.rehearsal || l.show : l.show} ${g.start.slice(0, 5)}${g.end ? `–${g.end.slice(0, 5)}` : ''}` : null,
    g.url || null,
  ]
    .filter(Boolean)
    .join('\n');

/** "Title · Band", or just the title (personal gigs have no band). */
const summary = (g: DeputyGig) => (g.bandName ? `${g.title} · ${g.bandName}` : g.title);

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** RFC 5545 lines folded at 75 octets. */
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (bytes(rest) > 75) {
    let cut = 75;
    while (bytes(rest.slice(0, cut)) > 75) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
};

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * One VEVENT. The UID stays the same for a request, and SEQUENCE grows with
 * the gig's last change, so calendars update the entry instead of adding one.
 */
export function gigEvent(
  g: DeputyGig,
  labels: GigLabels,
  uid: string,
  opts: { now?: Date; updatedAt?: string | null; cancelled?: boolean; rrule?: string | null; exdates?: string[] } = {},
): string[] {
  const w = gigWindow(g);
  const when = w.allDay
    ? [`DTSTART;VALUE=DATE:${ymd(w.day)}`, `DTEND;VALUE=DATE:${ymd(nextDay(w.day))}`]
    : [`DTSTART:${stamp(w.start)}`, `DTEND:${stamp(w.end)}`];
  // Dates deleted from the series: the same value type as DTSTART, at the
  // entry's own start time (RFC 5545 matches EXDATE to an instance's start).
  const exdates = opts.rrule
    ? (opts.exdates ?? []).map((d) => {
        const x = gigWindow({ ...g, date: d });
        return x.allDay ? `EXDATE;VALUE=DATE:${ymd(x.day)}` : `EXDATE:${stamp(x.start)}`;
      })
    : [];
  const changed = opts.updatedAt ? new Date(opts.updatedAt) : null;
  // Minutes since 2026 fit an integer for centuries.
  const sequence = changed && !Number.isNaN(changed.getTime())
    ? Math.max(0, Math.floor((changed.getTime() - Date.UTC(2026, 0, 1)) / 60000))
    : 0;
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@bandwith`,
    `DTSTAMP:${utcStamp(opts.now ?? new Date())}`,
    `SEQUENCE:${sequence}`,
    ...when,
    opts.rrule ? `RRULE:${opts.rrule}` : '',
    ...exdates,
    `SUMMARY:${icsText(summary(g))}`,
    location(g) ? `LOCATION:${icsText(location(g))}` : '',
    `DESCRIPTION:${icsText(details(g, labels))}`,
    g.url ? `URL:${g.url}` : '',
    `STATUS:${opts.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
  ].filter(Boolean);
}

/**
 * A repeating rehearsal (events.recurrence_rule, as the app expands it in
 * src/lib/recurrence.ts: weekly / biweekly / monthly, interval, until,
 * count) as an RRULE, so the calendar repeats it by itself. Unknown rules:
 * null (the first date only).
 *
 * Monthly from the 29th-31st (`start`): the app takes the last day of a
 * month without that day (Jan 31 -> Feb 28 -> Mar 31; Jan 30 -> Feb 28 ->
 * Mar 30), where a plain FREQ=MONTHLY skips that month. BYMONTHDAY=28..day
 * with BYSETPOS=-1 is the latest of those days the month has: the day itself,
 * else the month's last day.
 *
 * UNTIL takes DTSTART's value type (RFC 5545 3.3.10; Claude review of #285,
 * round 4): a date for an all-day series, else a local date-time (these
 * files are floating, no TZID) at the end of the last day.
 */
export function recurrenceRule(rule: unknown, start?: string | null, opts: { timed?: boolean } = {}): string | null {
  if (!rule || typeof rule !== 'object') return null;
  const r = rule as { freq?: unknown; frequency?: unknown; interval?: unknown; until?: unknown; count?: unknown };
  const freq = String(r.freq ?? r.frequency ?? '').toLowerCase();
  const n = Number(r.interval);
  const every = Number.isInteger(n) && n >= 1 && n <= 52 ? n : 1;
  const parts =
    freq === 'weekly' ? ['FREQ=WEEKLY', `INTERVAL=${every}`]
    : freq === 'biweekly' ? ['FREQ=WEEKLY', 'INTERVAL=2']
    : freq === 'monthly' ? ['FREQ=MONTHLY', `INTERVAL=${every}`]
    : null;
  if (!parts) return null;
  const day = Number(/^\d{4}-\d{2}-(\d{2})/.exec(start ?? '')?.[1]);
  if (freq === 'monthly' && day >= 29 && day <= 31) {
    parts.push(`BYMONTHDAY=${Array.from({ length: day - 27 }, (_, i) => 28 + i).join(',')}`, 'BYSETPOS=-1');
  }
  const until = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof r.until === 'string' ? r.until : '');
  const count = Number(r.count);
  if (until) parts.push(`UNTIL=${until[1]}${until[2]}${until[3]}${opts.timed ? 'T235959' : ''}`);
  else if (Number.isInteger(count) && count >= 1 && count <= 1000) parts.push(`COUNT=${count + 1}`);
  return parts.join(';');
}

export function calendarFile(events: string[][], name?: string, prodId = 'Deputy'): string {
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//BandWith//${prodId}//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      ...(name ? [`X-WR-CALNAME:${icsText(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'] : []),
      ...events.flat(),
      'END:VCALENDAR',
    ]
      .map(fold)
      .join('\r\n') + '\r\n'
  );
}

export function gigIcs(
  g: DeputyGig,
  labels: GigLabels,
  uid: string,
  opts: { now?: Date; updatedAt?: string | null } = {},
): string {
  return calendarFile([gigEvent(g, labels, uid, opts)]);
}

export function googleCalendarUrl(g: DeputyGig, labels: GigLabels): string {
  const w = gigWindow(g);
  const dates = w.allDay ? `${ymd(w.day)}/${ymd(nextDay(w.day))}` : `${stamp(w.start)}/${stamp(w.end)}`;
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: summary(g),
    dates,
    details: details(g, labels),
    location: location(g),
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

// ------------------------------------------------------------- the feeds --
// What the edge functions deputy-calendar and member-calendar serve, built
// here so the tests can read it.

/**
 * One gig of the deputy's calendar (bw_deputy_calendar_feed, 182). `mine`:
 * the request of the link. Older servers (bw_deputy_feed, 084) sent each
 * request's reply token instead; it is never written into an entry.
 */
export interface DeputyFeedGig {
  id: string;
  mine?: boolean | null;
  token?: string | null;
  cancelled: boolean;
  role: string | null;
  event_title: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  load_in_time: string | null;
  soundcheck_time: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_address: string | null;
  updated_at: string | null;
}

/**
 * The deputy's calendar (one = only the gig of the link). Entries carry no
 * link to the reply page: whoever sees a calendar entry (a shared or
 * family calendar, a forwarded invite) must not get the fee or the power to
 * change the answer. The page is reached from the message the band sent.
 */
export function deputyFeedCalendar(
  feed: { band_name?: string | null; gigs?: DeputyFeedGig[] | null },
  opts: { token: string; lang: string; one: boolean; site?: string; now?: Date },
): string {
  const labels = GIG_LABELS[opts.lang] ?? GIG_LABELS.en;
  const band = feed.band_name || "BandWith";
  const mine = (g: DeputyFeedGig) => g.mine ?? (!!g.token && g.token === opts.token);
  const events = (feed.gigs ?? [])
    .filter((g) => g.event_date && (!opts.one || mine(g)))
    .map((g) =>
      gigEvent(
        {
          title: g.event_title || labels.gig || "Gig",
          bandName: band,
          date: g.event_date as string,
          loadIn: g.load_in_time,
          soundcheck: g.soundcheck_time,
          start: g.start_time,
          end: g.end_time,
          venue: g.venue_name,
          city: g.venue_city,
          address: g.venue_address,
          role: g.role,
        },
        labels,
        `deputy-${g.id}`,
        { updatedAt: g.updated_at, cancelled: g.cancelled, now: opts.now },
      )
    );
  return calendarFile(events, `${band} · BandWith`);
}

/** One event of bw_member_calendar_feed (165). */
export interface MemberFeedEvent {
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

const ymdStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The dates deleted from a series (recurrence_rule.skip_dates, #297): valid YYYY-MM-DD only. */
export function skipDates(rule: unknown): string[] {
  const list = rule && typeof rule === "object" ? (rule as { skip_dates?: unknown }).skip_dates : null;
  return Array.isArray(list) ? [...new Set(list.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort() : [];
}

/**
 * Whether `date` (YYYY-MM-DD) is one of the dates of a repeating rehearsal
 * that starts on `start`, stepped the way the app's calendar steps it
 * (src/lib/recurrence.ts: weekly / biweekly / monthly by interval, counted
 * from the first date, a short month taking its last day; until; count =
 * repeats after the first date). A deleted date (skip_dates) is none.
 */
export function isOccurrence(rule: unknown, start: string, date: string): boolean {
  if (!rule || typeof rule !== "object") return false;
  const r = rule as { freq?: unknown; frequency?: unknown; interval?: unknown; until?: unknown; count?: unknown };
  const freq = String(r.freq ?? r.frequency ?? "").toLowerCase();
  if (!["weekly", "biweekly", "monthly"].includes(freq)) return false;
  const s = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (skipDates(rule).includes(date)) return false;
  if (date === `${s[1]}-${s[2]}-${s[3]}`) return true;
  const n = Number(r.interval);
  const every = Number.isInteger(n) && n >= 1 && n <= 52 ? n : 1;
  const until = /^(\d{4}-\d{2}-\d{2})/.exec(typeof r.until === "string" ? r.until : "")?.[1] ?? null;
  const c = Number(r.count);
  const count = Number.isInteger(c) && c >= 1 && c <= 1000 ? c : 1000;
  const [y, m, day] = [Number(s[1]), Number(s[2]) - 1, Number(s[3])];
  for (let i = 1; i <= count; i++) {
    let cursor: Date;
    if (freq === "weekly") cursor = new Date(y, m, day + 7 * every * i, 12, 0, 0);
    else if (freq === "biweekly") cursor = new Date(y, m, day + 14 * i, 12, 0, 0);
    else {
      const target = m + every * i;
      const last = new Date(y, target + 1, 0, 12, 0, 0).getDate();
      cursor = new Date(y, target, Math.min(day, last), 12, 0, 0);
    }
    const d = ymdStr(cursor);
    if (until && d > until) return false;
    if (d === date) return true;
    if (d > date) return false;
  }
  return false;
}

/**
 * The member's calendar, or one event as a file to import once (`one` =
 * its id). One date of a repeating rehearsal (`occurrence`) is that date
 * alone, without the series rule, under its own UID (also when the server
 * already resolved it: bw_member_event_calendar sends that date without
 * the rule). Null when that event (or that date of it) is not in the feed.
 */
export function memberFeedCalendar(
  feedEvents: MemberFeedEvent[],
  opts: { lang: string; site: string; one?: string | null; occurrence?: string | null; now?: Date },
): string | null {
  const labels = GIG_LABELS[opts.lang] ?? GIG_LABELS.en;
  const one = opts.one || null;
  const chosen = feedEvents.filter((e) => e.event_date && (!one || e.id === one));
  if (one && chosen.length === 0) return null;
  const events: string[][] = [];
  for (const e of chosen) {
    const timed = !gigWindow({ title: '', bandName: '', date: e.event_date as string, loadIn: e.load_in_time, soundcheck: e.soundcheck_time, start: e.start_time, end: e.end_time }).allDay;
    const rrule = recurrenceRule(e.recurrence, e.event_date, { timed });
    let occ = one && opts.occurrence ? opts.occurrence : null;
    if (occ && rrule) {
      if (!isOccurrence(e.recurrence, e.event_date as string, occ)) return null;
    } else if (occ && occ !== e.event_date) {
      // A one-off: a date that is not its own is ignored. (The server sends
      // an occurrence already resolved to the event's date, rule removed.)
      occ = null;
    }
    events.push(gigEvent(
      {
        title: e.title || (e.type === "rehearsal" ? labels.rehearsal : labels.gig) || "Gig",
        bandName: e.band_name ?? "",
        kind: e.type === "rehearsal" ? "rehearsal" : "gig",
        date: occ ?? (e.event_date as string),
        loadIn: e.load_in_time,
        soundcheck: e.soundcheck_time,
        start: e.start_time,
        end: e.end_time,
        venue: e.venue_name,
        city: e.venue_city,
        address: e.venue_address,
        role: e.role,
        url: opts.site,
      },
      labels,
      occ ? `event-${e.id}-${occ.replace(/-/g, "")}` : `event-${e.id}`,
      { updatedAt: e.updated_at, rrule: occ ? null : rrule, exdates: occ ? [] : skipDates(e.recurrence), now: opts.now },
    ));
  }
  return calendarFile(events, one ? undefined : "BandWith", "Member");
}
