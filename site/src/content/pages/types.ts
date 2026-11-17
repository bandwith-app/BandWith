/**
 * Channel pages (/features/<slug>/) are built from one content file each in
 * this folder. render.ts turns a ChannelPage into the page's <main>; the
 * page's index.html only holds the <head> and <!--@page:slug-->.
 *
 * Writing rules (all pages):
 * - English only, short sentences, the band's own words. Facts come from the
 *   Academy articles (academy/content/*.ts); on-screen labels are written as
 *   the English UI shows them.
 * - Demo data is the Academy's: band Velvet Static, gig "Client A — Wedding"
 *   at Villa Necchi, Via Mozart 14, Milan, Sat 21 Nov 2026 (load-in 15:00,
 *   soundcheck 16:30, show 20:30). Band: Leo M. (admin, bass), Sara (vocals),
 *   Nico (drums), Tom (guitar), Lena P. (keys). Deputies: Ivo M. (keys, covers
 *   Lena on the wedding), Luca T. (bass, usual fee €180).
 * - No prices of the product, no promises of features the app doesn't have.
 */
import type { ShotDevice } from '../site';

/** Icon ids from site/partials/sprite.html (without the "i-" prefix). */
export type Icon =
  | 'arrow-up-right' | 'arrow-right' | 'arrow-left' | 'x' | 'check' | 'chevron-left' | 'chevron-right' | 'chevron-down'
  | 'play' | 'wifi' | 'wifi-off' | 'mail' | 'download' | 'globe' | 'smartphone' | 'calendar' | 'music' | 'list-music'
  | 'users' | 'lock' | 'eye' | 'eye-off' | 'message-circle' | 'bell' | 'clock' | 'map-pin' | 'file-text' | 'wallet'
  | 'sliders' | 'book-open' | 'monitor' | 'refresh' | 'plus' | 'minus' | 'shield' | 'grip' | 'zap' | 'timer';

/** Two short lines; `em` (optional) is a word of line 2 painted lime. */
export type Heading = { lines: [string, string]; em?: string };

export type FlowStep = {
  title: string;
  body: string;
  /** Academy capture id; the phone capture is used (<shot>@phone.webp must exist). */
  shot: string;
  /** The part of the capture this step talks about: [top, bottom] as fractions of its height. */
  region: [number, number];
  /** Status shown under the screen, 1–3 words ("Sent", "3 of 5 voted"). */
  badge: string;
};

/** true = "Yes", false = "No", a string = a short yes-with-detail ("Their own"). `{ dash }` = n/a with a word. */
export type Cell = boolean | string | { dash: string };
export type RoleRow = { what: string; admin: Cell; member: Cell; deputy: Cell };

export type DeviceTab = { dev: ShotDevice; cap: string; alt: string };

export type Detail = { icon: Icon; title: string; body: string; wide?: boolean };

/** An Academy article: id (must exist), a short title and one line. */
export type Learn = { id: string; title: string; line: string };

export type ChannelPage = {
  slug: string;
  /** <title> is `${title} · BandWith`. */
  title: string;
  /** Meta description, 1–2 sentences. */
  description: string;
  ogTitle: string;
  hero: {
    heading: Heading;
    lead: string;
    /** 3–4 chips under the lead. */
    chips: { icon: Icon; label: string }[];
    /** The hero screen: phone capture + region. */
    shot: string;
    region: [number, number];
    alt: string;
  };
  flow: { heading: Heading; steps: FlowStep[] };
  /** Optional interactive demo (markup and script per kind, see render.ts / ui/demos). */
  demo?: { kind: string; heading: Heading; lead: string };
  roles: { heading: Heading; lead: string; rows: RoleRow[] };
  devices: { shot: string; heading: Heading; lead: string; tabs: DeviceTab[] };
  details: { heading: Heading; items: Detail[] };
  learn: Learn[];
};
