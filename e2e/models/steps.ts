import type { App } from '../fixtures';
import type { Lifecycle } from './lifecycle.ts';

/**
 * What a model's states and events mean on the page. Every state of a model
 * has a check and every event has its Playwright steps; the compiler makes
 * sure none is missing.
 */
export interface Ctx {
  app: App;
  /** The variant this run is for (e.g. the overview card), if the model has variants. */
  variant: string;
  /** Scratch space shared by the steps of one run (ids, values typed…). */
  data: Record<string, unknown>;
}

type StateOf<M extends Lifecycle> = keyof M['states'] & string;
type EventOf<M extends Lifecycle> = keyof M['events'] & string;

export interface ModelSteps<M extends Lifecycle> {
  model: M;
  /** Opens the app for the initial state (default: Home, fresh demo data). */
  boot?: (c: Ctx) => Promise<void>;
  states: Record<StateOf<M>, (c: Ctx) => Promise<void>>;
  events: Record<EventOf<M>, (c: Ctx) => Promise<void>>;
}

export const stepsFor = <M extends Lifecycle>(model: M, s: Omit<ModelSteps<M>, 'model'>): ModelSteps<M> => ({ model, ...s });
