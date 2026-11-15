/**
 * BandWith Academy: content model.
 *
 * Every area of the app has one file in this folder (calendar.ts, songs.ts…)
 * that exports `area`, `articles`, `faq`, `glossary` and `shots`. The web
 * pages (and later the in-app Academy) are rendered from these files only.
 *
 * Inline text conventions (inside any string):
 *   **Label**        an exact on-screen label, as the English UI shows it
 *   [[article-id]]   a link to another article (any area)
 *   [[article-id|text]] the same, with custom link text
 *   `code`           a literal value the user types (rare)
 */

export type Role = 'admin' | 'member' | 'deputy';

/**
 * Device ids used in device notes.
 *  phone        iPhone / Android phone, portrait
 *  phoneLand    phone in landscape
 *  tablet       iPad (and wide Android tablets): the wide layout, data-bw-wide
 *  duoClosed    Surface Duo / dual-screen, closed (one screen, the "rail" outer display)
 *  duoBook      dual-screen opened like a book (two portrait halves)
 *  duoLaptop    dual-screen in laptop posture (top half content, bottom half controls)
 *  duoLand      dual-screen fully open in landscape
 *  android      Android-specific behaviour (back gesture, APK…)
 *  web          the browser version at bandwith-beryl.vercel.app
 */
export type Device =
  | 'phone'
  | 'phoneLand'
  | 'tablet'
  | 'duoClosed'
  | 'duoBook'
  | 'duoLaptop'
  | 'duoLand'
  | 'android'
  | 'web';

export type Block =
  /** A paragraph. */
  | { type: 'p'; text: string }
  /** Numbered steps. Each item starts with a verb ("Tap **New gig**."). */
  | { type: 'steps'; title?: string; items: string[] }
  /** Bullet list. */
  | { type: 'list'; title?: string; items: string[] }
  /** Callout. privacy = who can see it; warning = can't be undone / data loss. */
  | { type: 'note'; tone: 'tip' | 'privacy' | 'warning'; text: string }
  /** What each role sees or can do on this topic. */
  | { type: 'roles'; rows: { role: Role; text: string }[] }
  /** How it differs per device. Only rows where something really differs. */
  | { type: 'devices'; rows: { devices: Device[]; text: string }[] }
  /** A screenshot placeholder; `id` refers to an entry in `shots`. */
  | { type: 'shot'; id: string; caption: string }
  /** A small two-column table. */
  | { type: 'table'; head: string[]; rows: string[][] };

export interface Article {
  /** Unique across all areas, kebab-case: 'create-a-gig'. */
  id: string;
  title: string;
  /** One sentence shown in lists and search results. */
  summary: string;
  /** Roles that can do (or meaningfully use) this. */
  roles: Role[];
  /** Short tasks first ("how do I…"), then reference ("all about…"). */
  kind: 'task' | 'reference';
  body: Block[];
  /** Extra search words (synonyms people would type). */
  keywords?: string[];
  related?: string[];
}

export interface Area {
  id: string;
  title: string;
  /** One line under the title on the area page. */
  intro: string;
  /** Name of the line icon (see academy/src/icons.ts): calendar, guitar… */
  icon: string;
}

export interface Faq {
  q: string;
  a: string;
  roles?: Role[];
}

export interface GlossaryTerm {
  term: string;
  definition: string;
  see?: string; // article id
}

/** A screenshot to capture from the web demo (VITE_DEMO_MODE=true). */
export interface Shot {
  id: string;
  /** How to reach the screen in the demo, click by click. */
  how: string;
  role: 'admin' | 'member';
  /** Viewport: phone 390×844, tablet 1180×820. */
  viewport: 'phone' | 'tablet';
}

export interface AreaModule {
  area: Area;
  articles: Article[];
  faq: Faq[];
  glossary: GlossaryTerm[];
  shots: Shot[];
}
