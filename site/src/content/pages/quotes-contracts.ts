import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'quotes-contracts',
  title: 'Quotes & contracts',
  description: 'Price a show in three steps and send it by WhatsApp, text or email. The client accepts, declines or asks on a personal page, with no account. An accepted quote becomes the gig, and the contract follows.',
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
    lead: 'Quotes and contracts hold the client and the price, so they stay with admins, in the app and in the database. Members hear about a quote only when you ask the lineup.',
    rows: [
      { what: 'Creates, edits and sends quotes', admin: true, member: false, deputy: false },
      { what: 'Sees the client, the quote total and every fee', admin: true, member: false, deputy: false },
      { what: 'Gets an availability check before the client says yes', admin: { dash: 'Asks' }, member: 'With their own fee', deputy: false },
      { what: 'Sees the gig once it’s confirmed', admin: true, member: 'With their own fee', deputy: 'Their request only' },
      { what: 'Creates, sends and signs off contracts and riders', admin: true, member: false, deputy: false },
    ],
  },
  devices: {
    shot: 'quote-wizard-review',
    heading: { lines: ['Steps on a phone.', 'One screen on iPad.'] },
    lead: 'On a phone a quote is three steps. On an iPad the composer puts five cards beside a Live PDF, as the client sees it, in the client’s language. On a Duo the quote stays in sight while you type.',
    tabs: [
      { dev: 'phone', cap: 'Phone · three steps; the last one shows the summary, the breakdown and the Total estimate.', alt: 'Step 3 of a new quote on a phone' },
      { dev: 'tablet', cap: 'iPad · five cards beside the Live PDF, with Save draft, Share and Send quote.', alt: 'The quote composer on an iPad' },
      { dev: 'web', cap: 'Web · a wide window gets the same cards and Live PDF.', alt: 'The quote composer in a web browser' },
      { dev: 'duoClosed', cap: 'Duo closed · the steps on one screen; close the quote from the side rail.', alt: 'A new quote on a closed Surface Duo' },
      { dev: 'duoBook', cap: 'Duo book · the quote on one page; in steps 1 and 2 the live quote sits on the other while you type.', alt: 'A new quote on a Surface Duo open like a book' },
      { dev: 'duoLaptop', cap: 'Duo laptop · the quote preview on the top half, the form and its buttons below.', alt: 'A new quote on a Surface Duo folded like a laptop' },
    ],
  },
  details: {
    heading: { lines: ['The small print,', 'taken care of.'] },
    items: [
      { icon: 'globe', title: 'In the client’s language', body: 'EN, IT, ES, FR, DE or PT for the PDF, the message and the client’s page. Your app stays in yours, and the choice is remembered for that client on this device.', wide: true },
      { icon: 'calendar', title: 'The date is held', body: 'Saving a quote puts a tentative event on its date in the admins’ calendar while you wait.' },
      { icon: 'eye-off', title: 'Fees stay inside', body: 'The client sees the lineup as one line, never what each musician earns.' },
      { icon: 'users', title: 'Ask the lineup first', body: 'Turn on Ask the lineup now and each musician gets an availability check with their own fee.' },
      { icon: 'refresh', title: 'Edit after sending', body: 'The client’s page switches to the new version. Send the update tells them.' },
      { icon: 'lock', title: 'A yes, then a signature', body: 'Accepting records the typed name, the time and the version the client saw. It isn’t a legal signature: the contract PDF ends with two signature lines, and you tap Mark as signed when it comes back.', wide: true },
    ],
  },
  learn: [
    { id: 'create-a-quote', title: 'Create a quote', line: 'A priced proposal in three steps.' },
    { id: 'share-a-quote', title: 'Share a quote', line: 'A personal link or the PDF, by any channel.' },
    { id: 'client-quote-page', title: 'The client’s page', line: 'What the client sees, and how they answer.' },
    { id: 'client-confirmation', title: 'Follow up', line: 'Replies, reminders and the link’s history.' },
    { id: 'quote-to-gig', title: 'From quote to gig', line: 'Put the accepted date on everyone’s calendar.' },
    { id: 'create-a-contract', title: 'Create a contract', line: 'A performance agreement, filled in from the gig.' },
  ],
};
