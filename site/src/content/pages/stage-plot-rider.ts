import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'stage-plot-rider',
  title: 'Stage plot & rider',
  description: 'Draw the stage plot with a finger and the input list fills itself in. Share the rider with the venue as a link: no account, no client, no fees.',
  ogTitle: 'Stage plot & rider · The venue knows before you arrive.',
  hero: {
    heading: { lines: ['The venue knows', 'before you arrive.'], em: 'arrive.' },
    lead: 'Every band gig has a rider and a stage. Draw the plot with a finger, let the input list fill in, say who brings what. Then send it all to the venue as one link.',
    chips: [
      { icon: 'grip', label: 'Stage plot' },
      { icon: 'sliders', label: 'Input list' },
      { icon: 'users', label: 'Who brings what' },
      { icon: 'globe', label: 'Venue link' },
    ],
    shot: 'gig-workspace-admin',
    region: [0.47, 0.96],
    alt: 'Show readiness 5 of 6 on Client A — Wedding: setlist, lyrics and charts to do, Rider v3 sent to the venue, contract signed, lineup 5 of 5, deposit paid',
  },
  flow: {
    heading: { lines: ['Draw it once.', 'Send it everywhere.'] },
    steps: [
      { title: 'Draw the stage', body: 'Open the gig, tap OPEN next to RIDER & STAGE, then EDIT under Stage plot. Add Vocals, Guitar, Bass, Keys, Drums and the rest, plus wedges, speakers and DI boxes. Hold an item until it lifts, drag it, let go. Save, and the input list fills in.', shot: 'gig-workspace-admin', region: [0, 0.46], badge: 'Plot saved' },
      { title: 'Send it to the venue', body: 'Tap SHARE LINK WITH THE VENUE, or PDF for a file. The rider shows SENT TO THE VENUE with the date, and show readiness ticks the rider line.', shot: 'gig-workspace-admin', region: [0.58, 0.84], badge: 'Sent to the venue' },
      { title: 'File it with the contracts', body: 'Riders also live in Contracts & docs. Pick Rider as the document type and link it to the gig: it carries that gig’s stage plot, input list and who brings what.', shot: 'contracts-new-for-gig', region: [0.14, 0.4], badge: 'Rider' },
      { title: 'Changed? Send the next version', body: 'Tap ⋯ and New version. The rider goes back to Draft as the next version. Share it again and the venue sees the new one.', shot: 'contracts-list', region: [0.58, 0.82], badge: 'v3 · Sent' },
    ],
  },
  demo: {
    kind: 'stage-plot-rider',
    heading: { lines: ['Drag a drummer.', 'Get four channels.'], em: 'four' },
    lead: 'Put the band on stage and watch the input list fill in, in desk order. Take someone off and their channels go with them. Then see the page the venue opens.',
  },
  roles: {
    heading: { lines: ['Admins set it up.', 'The band reads it.'] },
    lead: 'Admins build the stage and send it. Members open it read-only and can share the PDF. The venue sees the times, the plot and the lists, never the client or a fee.',
    rows: [
      { what: 'Sees the rider, plot, input list and who brings what', admin: true, member: 'Read only', deputy: false },
      { what: 'Draws the stage plot, on any device', admin: true, member: false, deputy: false },
      { what: 'Edits the input list and who brings what', admin: true, member: false, deputy: false },
      { what: 'Shares the link with the venue', admin: true, member: false, deputy: false },
      { what: 'Shares the rider PDF', admin: true, member: true, deputy: false },
      { what: 'Keeps riders and new versions in Contracts & docs', admin: true, member: false, deputy: false },
    ],
  },
  details: {
    heading: { lines: ['Less to explain', 'at load-in.'] },
    items: [
      { icon: 'eye', title: 'What the venue sees', body: 'The venue opens the link in a browser, with no account: the rider, the gig’s times and venue, the stage plot, the input list and who brings what, in its own language when available. Never the client or any fee.', wide: true },
      { icon: 'grip', title: 'Hold to add, hold to move', body: 'Hold an empty spot to add a musician or gear right there. A quick swipe still scrolls the page.' },
      { icon: 'plus', title: 'More than one layout', body: 'Name each layout and set the stage width and depth in metres. + NEW LAYOUT adds another.' },
      { icon: 'sliders', title: 'Your channels stay', body: 'Fine-tune with EDIT LIST: source, mic or DI, who. Saving the plot again keeps your changes; a rebuild from the lineup asks first.' },
      { icon: 'check', title: 'Who brings what', body: 'BAND BRINGS and VENUE PROVIDES, one per line, suggested from the lineup. Tick The venue agreed to this when it’s settled.' },
      { icon: 'refresh', title: 'Sent means shared', body: 'Show readiness reads Rider v3 · sent to the venue once the link or the PDF is shared. Saving the PDF to the phone doesn’t count.', wide: true },
    ],
  },
  learn: [
    { id: 'rider-and-stage', title: 'Rider and stage plot', line: 'Draw the plot, build the input list, share it.' },
    { id: 'contract-riders', title: 'Riders in Contracts & docs', line: 'A web link for the venue, and new versions.' },
    { id: 'show-readiness', title: 'Show readiness', line: 'When the rider counts as sent.' },
    { id: 'contracts-and-docs', title: 'Contracts & docs', line: 'Where contracts and riders are kept.' },
    { id: 'create-a-gig-on-ipad', title: 'Create a gig on iPad', line: 'Prepare the rider before the gig exists.' },
    { id: 'gig-workspace', title: 'The gig workspace', line: 'Where RIDER & STAGE sits on a gig.' },
  ],
};
