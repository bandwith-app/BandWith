/**
 * Every lifecycle model, in report order. Pure: no Playwright import, so the
 * coverage report and the Mermaid export can load it with plain `node`.
 */
import type { Lifecycle } from './lifecycle.ts';
import { rsvpGig, rsvpRehearsal } from './rsvp.model.ts';
import { cardEdit, setlistDraft } from './card-edit.model.ts';
import { poll } from './poll.model.ts';
import { proposal } from './proposal.model.ts';
import { quote } from './quote.model.ts';
import { deputy } from './deputy.model.ts';
import { auth } from './auth.model.ts';
import { rehearsalLive } from './rehearsal-live.model.ts';

export const MODELS: Lifecycle[] = [rsvpGig, rsvpRehearsal, proposal, poll, cardEdit, setlistDraft, quote, deputy, auth, rehearsalLive];
