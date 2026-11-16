import { defineLifecycle } from './lifecycle.ts';

/**
 * (e) Quote → gig → contract.
 *
 * From the code:
 * - Quote statuses (src/lib/services/quotes.ts QuoteStatus): draft, sent,
 *   viewed, negotiating, accepted, declined, expired, archived.
 * - QuoteDetailModal.tsx: "Mark as sent" only on a Draft ("Records it as
 *   sent; doesn't send anything."); "Client answered by phone or in person?"
 *   Declined / Accepted only on Sent, Viewed or Discussing — so a quote is
 *   declined once, and a declined quote offers no answer buttons.
 *   (QuotesExpanded.tsx handleSetOutcome; 105 bw_quote_link_set_outcome.)
 * - QuoteClientLink.tsx: an accepted quote offers "Create gig from quote"
 *   and "Prepare contract" (ContractsView form "Create contract",
 *   "Performance agreement · {event}").
 * - convertQuoteToEvent / gigFromAcceptedQuote (quotes.ts): the gig is
 *   created confirmed and the quote keeps converted_to_event_id.
 * - EventDetail.tsx: an upcoming band gig has REVERT TO QUOTE → "Revert to
 *   quote?" (Revert to quote / Keep the gig); rehearsals, personal gigs and
 *   past gigs don't (canRevertToQuote, isPast branch). A quote event has
 *   CONFIRM AS GIG; AuthenticatedApp.tsx handleConfirmQuote toasts "Quote
 *   confirmed as Gig!" with UNDO; handleRevertQuote sets the event back to
 *   tentative and the quote to Viewed / Sent / Draft.
 * - Academy: business.ts "Quotes" (Mark as sent first; Accepted confirms the
 *   gig; CONFIRM AS GIG + UNDO for 8 seconds; no REVERT TO QUOTE on
 *   rehearsals and personal gigs).
 */
export const quote = defineLifecycle({
  id: 'quote',
  title: 'Quote to gig',
  summary: 'Draft → sent → client accepts (demo: the admin records it) or declines once → gig → contract / rider; revert to quote where allowed.',
  role: 'admin',
  initial: 'home',
  states: {
    home: {
      see: 'Home.',
      on: { OPEN_DRAFT_QUOTE: 'draft', OPEN_TENTATIVE: 'tentativeQuote', OPEN_PAST_GIG: 'noRevert', OPEN_REHEARSAL: 'noRevert' },
    },
    draft: {
      see: 'Q-2026-0012 "40th birthday party": Draft, "Mark as sent", and no Accepted / Declined.',
      on: { MARK_SENT: 'sent' },
    },
    sent: {
      see: 'Sent, "Client answered by phone or in person?" with Declined and Accepted; saved as sent.',
      on: { CLIENT_DECLINES: 'declined', CLIENT_ACCEPTS: 'accepted' },
    },
    declined: {
      see: 'Declined, and no Accepted / Declined buttons any more; saved as declined.',
    },
    accepted: {
      see: '"Create gig from quote" and "Prepare contract"; saved as accepted.',
      on: { CREATE_GIG: 'gig', PREPARE_CONTRACT: 'contractForm' },
    },
    contractForm: {
      see: '"Create contract" with the title "Performance agreement · 40th birthday party".',
      on: { CREATE_CONTRACT: 'contract' },
    },
    contract: {
      see: 'Contracts & docs lists the new contract as a draft for 40th birthday party.',
    },
    gig: {
      see: '"Gig created from the quote"; the gig "40th birthday party" is open, confirmed, with REVERT TO QUOTE; the quote points to it.',
      on: { REVERT: 'revertPrompt', OPEN_RIDER: 'rider' },
    },
    rider: {
      see: 'Rider & stage of the new gig: CREATE RIDER.',
    },
    revertPrompt: {
      see: '"Revert to quote?" with Revert to quote and Keep the gig.',
      on: { KEEP_GIG: 'gig', CONFIRM_REVERT: 'quoteAgain' },
    },
    quoteAgain: {
      see: 'A quote again: CONFIRM AS GIG, no REVERT TO QUOTE; event tentative, quote back to sent.',
      on: { CONFIRM_AS_GIG: 'confirmed' },
    },
    tentativeQuote: {
      see: 'Jazz Club Night is a quote: CONFIRM AS GIG, no REVERT TO QUOTE.',
      on: { CONFIRM_AS_GIG: 'confirmed' },
    },
    confirmed: {
      see: '"Quote confirmed as Gig!" with UNDO; the event is confirmed.',
      on: { UNDO: 'undone' },
    },
    undone: {
      see: 'UNDO: the event is a quote (tentative) again.',
    },
    noRevert: {
      see: 'A past gig (Summer Fest Opening) or a rehearsal: no REVERT TO QUOTE.',
      source: 'EventDetail.tsx canRevertToQuote / isPast',
    },
  },
  events: {
    OPEN_DRAFT_QUOTE: { do: 'Home → Drafts → the quote draft → Quotes → "40th birthday party".' },
    MARK_SENT: { do: 'Tap Mark as sent (the quote closes to the list), open it again.' },
    CLIENT_DECLINES: { do: 'The client says no by phone: tap Declined ("Quote marked as declined"), open the quote again.' },
    CLIENT_ACCEPTS: { do: 'The client says yes by phone: tap Accepted ("Quote accepted. Open it to create the gig."), open the quote again.' },
    CREATE_GIG: { do: 'Tap Create gig from quote.' },
    PREPARE_CONTRACT: { do: 'Tap Prepare contract.' },
    CREATE_CONTRACT: { do: 'Tap Create contract.' },
    OPEN_RIDER: { do: 'Open Rider & stage from the gig.' },
    REVERT: { do: 'Tap REVERT TO QUOTE.' },
    KEEP_GIG: { do: 'Tap Keep the gig.' },
    CONFIRM_REVERT: { do: 'Tap Revert to quote.' },
    CONFIRM_AS_GIG: { do: 'Tap CONFIRM AS GIG.' },
    UNDO: { do: 'Tap UNDO on the toast.' },
    OPEN_TENTATIVE: { do: 'Open Jazz Club Night (a tentative gig: a quote) from the calendar.' },
    OPEN_PAST_GIG: { do: 'Open Summer Fest Opening (past) from the calendar\'s search.' },
    OPEN_REHEARSAL: { do: 'Open Weekly rehearsal from the calendar.' },
  },
  wide: ['OPEN_TENTATIVE CONFIRM_AS_GIG UNDO'],
  knownBugs: [],
  manual: [
    'The client\'s own answer on /quote.html (bw_quote_link_respond, 120): the demo client has no quote page backend, so the admin records the answer ("Client answered by phone or in person?"), as the Academy describes for answers outside the link.',
    'A client who declined and accepts later on the page (120 allows it): needs the real quote page.',
    'Sending the quote (share sheet, WhatsApp / email) and the PDF: native sharing.',
  ],
});
