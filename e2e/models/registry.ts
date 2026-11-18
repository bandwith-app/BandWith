/** Every model with its Playwright steps (used by e2e/specs/xstate-lifecycles.spec.ts). */
import type { Lifecycle } from './lifecycle.ts';
import type { ModelSteps } from './steps.ts';
import { rsvpGigSteps, rsvpRehearsalSteps } from './rsvp.steps.ts';
import { cardEditSteps, setlistDraftSteps } from './card-edit.steps.ts';
import { pollSteps } from './poll.steps.ts';
import { proposalSteps } from './proposal.steps.ts';
import { quoteSteps } from './quote.steps.ts';
import { deputySteps } from './deputy.steps.ts';
import { authSteps } from './auth.steps.ts';
import { rehearsalLiveSteps } from './rehearsal-live.steps.ts';

export const MODEL_STEPS = [rsvpGigSteps, rsvpRehearsalSteps, proposalSteps, pollSteps, cardEditSteps, setlistDraftSteps, quoteSteps, deputySteps, authSteps, rehearsalLiveSteps] as unknown as ModelSteps<Lifecycle>[];
