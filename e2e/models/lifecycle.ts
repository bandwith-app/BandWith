/**
 * Lifecycle test models: the shared core.
 *
 * Each model in this folder describes one multi-step lifecycle of the app as
 * a state machine (XState), written from the code, the migrations and the
 * Academy articles, never from guesses. The app itself does not use XState:
 * these machines exist only to generate tests.
 *
 * - A state says what the user must see there (`see`), and where that rule
 *   comes from (`source`). The Playwright check lives in the model's
 *   `*.steps.ts` file under the same name.
 * - An event says what the user does (`do`); its Playwright steps live in the
 *   same steps file.
 * - `generatePaths` walks the machine with @xstate/graph and returns one path
 *   per transition (the shortest way to reach its source state, then the
 *   transition), with paths that are the prefix of a longer one dropped. Every
 *   path becomes one Playwright test (e2e/specs/lifecycles.spec.ts).
 * - `knownBugs` lists paths that fail because the APP is wrong. They are not
 *   run (the suite must stay green) and the coverage report prints them.
 *
 * This file and the `*.model.ts` files are plain TypeScript with no
 * Playwright import, so `node` runs the coverage report and the Mermaid
 * export directly (type stripping, Node 22.18+ / 24).
 */
import { createMachine, type AnyStateMachine } from 'xstate';
import { adjacencyMapToArray, getAdjacencyMap, getShortestPaths } from '@xstate/graph';

/** Device profiles of e2e/support/devices.ts a model path can run on. */
export type ProfileName =
  | 'phone-portrait'
  | 'phone-landscape'
  | 'android'
  | 'ipad-landscape'
  | 'ipad-portrait'
  | 'duo-closed'
  | 'duo-closed-landscape'
  | 'duo-book'
  | 'duo-laptop'
  | 'duo-open';

export interface StateSpec<E extends string, S extends string> {
  /** What the user must see in this state (the assertion, in words). */
  see: string;
  /** Where the rule comes from: file:line, migration or Academy article. */
  source?: string;
  /** Transitions: event → target state. No `on` means a final state. */
  on?: Partial<Record<E, S>>;
}

export interface EventSpec {
  /** What the user does (the Playwright steps, in words). */
  do: string;
  source?: string;
  /**
   * Profiles where a user can do this at all (default: every profile). A
   * path runs only on profiles every one of its events allows.
   */
  only?: ProfileName[];
}

/** A path the app gets wrong today: not run, printed by the coverage report. */
export interface KnownBug {
  /** The path's event sequence, e.g. "OLD_MAYBE GOING" (or a prefix of it). */
  path: string;
  /** Only for one variant of a model that runs per variant (card type…). */
  variant?: string;
  role: 'admin' | 'member' | 'deputy' | 'signed out';
  profile: ProfileName;
  /** What happens instead. */
  actual: string;
  /** What should happen, and the code / migration / Academy text that says so. */
  expected: string;
  /** Trace or screenshot of the failing run (e2e/.results/…). */
  evidence: string;
}

export interface LifecycleSpec<S extends string, E extends string> {
  /** Short id, also the docs file name ("rsvp-gig"). */
  id: string;
  /** Test title prefix ("RSVP (gig)"). */
  title: string;
  /** One line: what this lifecycle is. */
  summary: string;
  /** Role the test starts as (the fixture's `role` option). */
  role: 'admin' | 'member';
  initial: S;
  states: Record<S, StateSpec<E, S>>;
  events: Record<E, EventSpec>;
  /**
   * Variants a path is run for, one after the other in the same test (e.g.
   * every overview card). Default: one run.
   */
  variants?: readonly string[];
  /**
   * With variants: each path runs for one variant, taken in turn (so all of
   * them are covered across the paths), except the `everyVariant` paths,
   * which run for all. Without it every path runs for every variant.
   */
  rotateVariants?: boolean;
  everyVariant?: string[];
  /** Longest path generated (events). Longer ones are reported as not covered. */
  maxDepth?: number;
  /**
   * Paths (event sequences) that also run on ipad-landscape and duo-laptop.
   * Keep it small: the full set runs on phone-portrait.
   */
  wide?: string[];
  knownBugs: KnownBug[];
  /** What the demo can't represent, and why (printed in the docs). */
  manual?: string[];
}

export interface Lifecycle<S extends string = string, E extends string = string> extends LifecycleSpec<S, E> {
  machine: AnyStateMachine;
}

/** Builds the XState machine of a lifecycle spec. */
export function defineLifecycle<const S extends string, const E extends string>(
  spec: LifecycleSpec<S, E>,
): Lifecycle<S, E> {
  const states: Record<string, object> = {};
  for (const [name, st] of Object.entries(spec.states) as [S, StateSpec<E, S>][]) {
    const on = st.on ?? {};
    states[name] = Object.keys(on).length
      ? { description: st.see, on }
      : { description: st.see, type: 'final' };
  }
  const machine = createMachine({ id: spec.id, initial: spec.initial, states } as never);
  return { ...spec, machine };
}

export interface ModelStep {
  event: string;
  from: string;
  to: string;
}

export interface ModelPath {
  /** "INVITE ACCEPT REOPEN" */
  key: string;
  /** "<lifecycle>: <event → event>", the test title. */
  name: string;
  steps: ModelStep[];
  /** Profiles this path runs on. */
  profiles: ProfileName[];
  /** Variants this path runs for ([''] when the model has none). */
  variants: string[];
  /** Variants excluded as known bugs (all of them when the whole path is). */
  bugs: KnownBug[];
}

const stateName = (value: unknown) => String(value);

/** Every transition of the machine: from --event--> to. */
export function transitionsOf(model: Lifecycle): ModelStep[] {
  const out: ModelStep[] = [];
  for (const [from, st] of Object.entries(model.states) as [string, StateSpec<string, string>][]) {
    for (const [event, to] of Object.entries(st.on ?? {})) out.push({ event, from, to: String(to) });
  }
  return out;
}

const DEFAULT_PROFILES: ProfileName[] = ['phone-portrait'];
const WIDE_PROFILES: ProfileName[] = ['ipad-landscape', 'duo-laptop'];

/** Profiles a path runs on: phone-portrait (+ the wide pair for `wide`), narrowed by its events' `only`. */
function profilesFor(model: Lifecycle, events: string[], key: string): ProfileName[] {
  const restricted = events
    .map((e) => (model.events as Record<string, EventSpec>)[e]?.only)
    .filter((o): o is ProfileName[] => !!o);
  if (restricted.length) {
    // A path with a pane-only gesture runs where it can be done, nowhere else.
    return restricted.reduce((acc, o) => acc.filter((p) => o.includes(p)));
  }
  const wide = (model.wide ?? []).includes(key);
  return wide ? [...DEFAULT_PROFILES, ...WIDE_PROFILES] : DEFAULT_PROFILES;
}

/**
 * One path per transition: the shortest path to its source state, then the
 * transition. Paths that are a prefix of another path, or longer than
 * `maxDepth`, are dropped (the longer path covers the shorter one).
 */
export function generatePaths(model: Lifecycle): { paths: ModelPath[]; tooDeep: ModelStep[] } {
  const machine = model.machine;
  // Only the events a state handles: an event with no transition there is
  // not something the user can do in that state.
  const events = (snapshot: { value: unknown }) =>
    Object.keys((model.states as Record<string, StateSpec<string, string>>)[stateName(snapshot.value)]?.on ?? {}).map(
      (type) => ({ type }),
    );
  const shortest = getShortestPaths(machine, { events });
  const toState = new Map<string, ModelStep[]>();
  for (const p of shortest) {
    const steps: ModelStep[] = [];
    let prev = model.initial as string;
    for (const s of p.steps) {
      if (s.event.type.startsWith('xstate.')) continue;
      const to = stateName(s.state.value);
      steps.push({ event: s.event.type, from: prev, to });
      prev = to;
    }
    toState.set(stateName(p.state.value), steps);
  }

  const edges = adjacencyMapToArray(getAdjacencyMap(machine, { events }));
  const candidates: ModelStep[][] = [];
  const tooDeep: ModelStep[] = [];
  for (const e of edges) {
    const from = stateName((e.state as { value: unknown }).value);
    const to = stateName((e.nextState as { value: unknown }).value);
    const prefix = toState.get(from);
    if (!prefix) continue;
    const path = [...prefix, { event: e.event.type, from, to }];
    if (model.maxDepth && path.length > model.maxDepth) {
      tooDeep.push({ event: e.event.type, from, to });
      continue;
    }
    candidates.push(path);
  }

  const keyOf = (steps: ModelStep[]) => steps.map((s) => s.event).join(' ');
  const unique = new Map<string, ModelStep[]>();
  for (const c of candidates) unique.set(keyOf(c), c);
  const keys = [...unique.keys()];
  const bugsOf = (key: string) => model.knownBugs.filter((b) => key === b.path || key.startsWith(`${b.path} `));
  // A path a known bug takes out entirely covers nothing: its prefixes stay.
  const runs = (key: string) => !bugsOf(key).some((b) => !b.variant);
  const kept = keys.filter((k) => !keys.some((other) => other !== k && runs(other) && other.startsWith(`${k} `)));

  const all = model.variants?.length ? [...model.variants] : [''];
  let turn = 0;
  const paths = kept
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const steps = unique.get(key)!;
      const variants =
        model.rotateVariants && !(model.everyVariant ?? []).includes(key) ? [all[turn++ % all.length]] : all;
      const bugs = bugsOf(key);
      return {
        key,
        name: `${model.title}: ${steps.map((s) => s.event).join(' → ')}`,
        steps,
        profiles: profilesFor(model, steps.map((s) => s.event), key),
        variants,
        bugs,
      };
    });
  return { paths, tooDeep };
}

/** True when a known bug takes the whole path (or this variant of it) out of the run. */
export function excluded(path: ModelPath, variant?: string): KnownBug | undefined {
  return path.bugs.find((b) => !b.variant || b.variant === variant);
}
