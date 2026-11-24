import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'quotes-contracts',
  title: 'Quotes & contracts',
  description: 'Price a show in three steps and send it by WhatsApp, text or email. The client accepts on a personal page, with no account, and the quote becomes the gig.',
  ogTitle: 'Quotes & contracts · Quotes the client confirms with a tap.',
  hero: {
    heading: { lines: ['Send the quote.', 'Get a yes.'], em: 'yes.' },
    lead: 'Price the show in three steps, with your logo and terms. The client opens a personal link, no account and no app, and accepts, declines or asks. You get a notification for each answer, and the yes becomes the gig.',
    chips: [
      { icon: 'file-text', label: 'Priced in three steps' },
      { icon: 'message-circle', label: 'WhatsApp, text or email' },
      { icon: 'check', label: 'Accept on a link' },
      { icon: 'globe', label: 'Six languages' },
    ],
    shot: 'quote-client-confirmation',
    region: [0, 0.38],
    alt: 'Client confirmation on a quote: Sent, Viewed and Discussing lit, and the client asking for a DJ set after the band',
  },
  flow: {
    heading: { lines: ['From a price', 'to a booked date.'] },
    steps: [
      { title: 'Price it', body: 'Tap Create, then New quote. Client and event type, the lineup from your pricing sheet, then date and venue. Step 3 shows the breakdown, and the Total estimate updates as you type.', shot: 'quote-wizard-review', region: [0.44, 0.83], badge: 'Step 3 of 3' },
      { title: 'Send it your way', body: 'Save & share builds the PDF. Pick the client language, then WhatsApp, Text message, Email or Copy message & link. Each sends a personal link with the total and your name.', shot: 'quote-share', region: [0.17, 0.66], badge: 'Sent' },
      { title: 'The client answers', body: 'On their page they accept with their name, decline, or write to you. Client confirmation follows the link: Sent, Viewed, Discussing, then Accepted or Declined. You reply from the quote.', shot: 'quote-client-confirmation', region: [0.1, 0.6], badge: 'Discussing' },
      { title: 'Book it, sign it', body: 'Tap Create gig from quote and the date lands on the lineup’s calendars, each musician with their own fee. Prepare contract fills in the gig, client and date. Mark as signed when the copy comes back.', shot: 'contracts-list', region: [0.28, 0.6], badge: 'Signed' },
    ],
  },
  demo: {
    kind: 'quotes-contracts',
    heading: { lines: ['Be the client.', 'Tap yes.'] },
    lead: 'This is the page behind Leo’s link for Client A — Wedding. Ask a question, then accept with your name, and watch the quote on Leo’s phone move from Sent to Accepted.',
  },
  roles: {
    heading: { lines: ['Admins make the deal.', 'Members play it.'] },
    lead: 'Quotes and contracts hold the client and the price, so they stay with admins, in the app and in the database. While a gig is still a quote, members get only a hold on its date.',
    rows: [
      { what: 'Creates, edits and sends quotes', admin: true, member: false, deputy: false },
      { what: 'Sees the client, the quote total and every fee', admin: true, member: false, deputy: false },
      { what: 'Gets a hold on the date before the client says yes', admin: { dash: 'Sees who’s free' }, member: 'Day, time and place', deputy: false },
      { what: 'Sees the gig once it’s confirmed', admin: true, member: 'With their own fee', deputy: 'Their request only' },
      { what: 'Creates, sends and signs off contracts and riders', admin: true, member: false, deputy: false },
      { what: 'Asks for the final balance, marks it paid', admin: true, member: false, deputy: false },
    ],
  },
  details: {
    heading: { lines: ['The small print,', 'taken care of.'] },
    lead: 'Three things to know first. The other six are sorted by where the deal stands.',
    featured: [
      {
        title: 'In the client’s language',
        tag: 'PDF, message, page',
        body: 'EN, IT, ES, FR, DE or PT for the PDF, the message and the client’s page. Your app stays in yours.',
        ui: { shot: 'quote-share', region: [0.16, 0.5], alt: 'Sharing a quote: the client language set to EN among six, then WhatsApp and Text message' },
      },
      {
        title: 'The band keeps it free',
        tag: 'Every member',
        body: 'Each member gets a card, Possible gig – keep the date free, and answers I’m free or I can’t. No client, no fee.',
        ui: { shot: 'quote-hold-card', region: [0.12, 0.48], alt: 'A member’s Home: Possible gig – keep the date free, Mon Dec 7, 22:00–01:00 at The Blue Room, New York, with I’m free and I can’t' },
      },
      {
        title: 'A yes, then a signature',
        tag: 'The client, on a link',
        body: 'Accepting records the typed name, the time and the version seen. It isn’t a legal signature: the contract PDF ends with two signature lines.',
        ui: { shot: 'quote-client-confirmation', region: [0, 0.32], alt: 'Client confirmation: sent, viewed, discussing, accepted, and the conversation with the client' },
      },
    ],
    groups: [
      {
        label: 'While the client decides',
        items: [
          { title: 'The date is held', line: 'Saving a quote puts a tentative event on its date in the admins’ calendar while you wait.' },
          { title: 'Edit after sending', line: 'The client’s page switches to the new version. Send the update tells them.' },
        ],
      },
      {
        label: 'Getting paid',
        items: [
          { title: 'Then the final balance', line: 'FINAL BALANCE works out what’s left: the total, minus the deposit, minus other payments.' },
          { title: 'Deposit, then paid', line: 'Mark deposit received, then Mark as paid: payouts, show readiness and analytics follow.' },
        ],
      },
      {
        label: 'What stays with the band',
        items: [
          { title: 'Fees stay inside', line: 'The client sees the lineup as one line, never what each musician earns.' },
          { title: 'Straight to the band', line: 'Bank details, your own Stripe payment link, or cash. BandWith never takes the payment.' },
        ],
      },
    ],
  },
  learn: [
    { id: 'create-a-quote', title: 'Create a quote', line: 'A priced proposal in three steps.' },
    { id: 'share-a-quote', title: 'Share a quote', line: 'A personal link or the PDF, by any channel.' },
    { id: 'client-quote-page', title: 'The client’s page', line: 'What the client sees, and how they answer.' },
    { id: 'final-balance', title: 'Final balance', line: 'Ask for what’s left, then mark it paid.' },
    { id: 'quote-to-gig', title: 'From quote to gig', line: 'Put the accepted date on everyone’s calendar.' },
    { id: 'create-a-contract', title: 'Create a contract', line: 'A performance agreement, filled in from the gig.' },
  ],
};
