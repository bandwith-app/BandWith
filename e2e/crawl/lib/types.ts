import type { LayerInfo } from './dom';

/** Who is crawling. */
export type CrawlRole = 'admin' | 'member' | 'deputy' | 'noband' | 'signedout' | 'client';

export const ROLE_INFO: Record<CrawlRole, string> = {
  admin: 'Leo M., admin of the demo band Velvet Static',
  member: 'Leo M. as a member of Velvet Static (not admin)',
  deputy: 'Leo M. with no band of his own, deputy for another band (claimed deputy link): the "Deputy gigs" home',
  noband: 'Leo M. signed in with no band and no deputy gigs',
  signedout: 'Nobody signed in: the sign-in and sign-up screens',
  client: "The band's client on the public /quote.html page (demo token)",
};

/** Diagram areas (docs/screen-map). */
export type Area =
  | 'home'
  | 'calendar'
  | 'event'
  | 'create'
  | 'polls'
  | 'settings'
  | 'chat'
  | 'notifications'
  | 'auth'
  | 'deputy'
  | 'client';

export const AREA_TITLES: Record<Area, string> = {
  home: 'Home',
  calendar: 'Calendar',
  event: 'Event detail (gig / rehearsal / quote / personal)',
  create: 'Create',
  polls: 'Polls & proposals',
  settings: 'Settings & Account hub',
  chat: 'Chat',
  notifications: 'Notifications',
  auth: 'Auth & onboarding',
  deputy: 'Deputy gigs',
  client: 'Client quote page',
};

export type ActionKind =
  /** Leads to another state. */
  | 'navigate'
  /** Same state, the content changed (a filter, a toggle, a field revealed). */
  | 'inplace'
  /** Only a toast. */
  | 'toast'
  /** Only the demo database changed. */
  | 'db'
  /** Only the scroll position changed. */
  | 'scroll'
  /** Nothing happened at all. */
  | 'dead'
  /** Destructive or outward: recorded, not clicked (or swallowed). */
  | 'terminal'
  /** A text field / select: recorded, not clicked. */
  | 'field'
  /** One of many identical rows: a sibling was clicked instead. */
  | 'sampled'
  /** Not clicked: per-state cap or time budget. */
  | 'skipped'
  /** The click left the app page (another document). */
  | 'leaves'
  /** The click failed (covered, detached). */
  | 'error';

export interface Action {
  label: string;
  role: string;
  key: string;
  kind: ActionKind;
  /** Destination state id (navigate/inplace), or a description for terminal/leaves. */
  to: string | null;
  effects?: string[];
  toast?: string;
  note?: string;
  /** Not clicked here: the same tab-bar control was clicked elsewhere. */
  inferred?: boolean;
}

export interface BackResult {
  /** Destination state id, or null when nothing changed. */
  to: string | null;
  kind: 'navigate' | 'none' | 'leaves' | 'inplace';
  note?: string;
}

export interface Health {
  docOverflow: number;
  offscreen: string[];
  badText: string | null;
  rawKeys: string[];
  errors: string[];
  onFold: string[];
  empty: boolean;
}

export interface AxeSummary {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  violations: { id: string; impact: string; help: string; nodes: number; targets: string[] }[];
}

export interface StateRec {
  id: string;
  role: CrawlRole;
  profile: string;
  root: string;
  area: Area;
  depth: number;
  /** Control keys from the root, replayed to come back here. */
  path: string[];
  /** The same, as the labels a tester clicks. */
  steps: string[];
  sig: string;
  url: string;
  tab: string | null;
  layers: LayerInfo[];
  title: string;
  text: string;
  screenshot: string | null;
  actions: Action[];
  back: { escape?: BackResult; system?: BackResult; visible?: { label: string; to: string | null; kind: string } };
  health: Health | null;
  axe: AxeSummary | null;
  findings: string[];
  explored: boolean;
  /** Inside the signed-in app (its back chain handles the browser's Back). */
  inApp?: boolean;
  /** Fingerprints (not exported to map.json). */
  fp?: string;
  freshFp?: string;
  db?: string;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type FindingKind =
  | 'privacy'
  | 'js-error'
  | 'no-exit'
  | 'broken-state'
  | 'empty-state'
  | 'back-mismatch'
  | 'dead-control'
  | 'axe'
  | 'layout'
  | 'unreachable'
  | 'replay';

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  role: CrawlRole | '*';
  profile: string;
  state: string | null;
  title: string;
  detail: string;
  steps: string[];
  screenshot: string | null;
  control?: string;
  /** Set during triage (findings-triage.json): real bug or crawler false positive. */
  verdict?: 'real' | 'false-positive' | 'unverified';
  verdictNote?: string;
}

export interface RunResult {
  role: CrawlRole;
  profile: string;
  startedAt: string;
  elapsedMs: number;
  complete: boolean;
  budgetMs: number;
  maxDepth: number;
  states: StateRec[];
  findings: Finding[];
  /** Lazy chunks the app loaded (assets/<Name>-<hash>.js), for the unreachable check. */
  chunks: string[];
  /** Readable text per state id, for the coverage check. */
  texts: Record<string, string>;
  clicks: number;
  resets: number;
  queue: string[];
}
