/**
 * Short, quotable answers for people, search engines and AI assistants (AEO/GEO).
 *
 * - DEFINITION: what BandWith is, in one paragraph (home page, llms.txt, JSON-LD).
 * - HOME_ANSWERS: the home page FAQ. ANSWERS[slug]: the Q&A under each channel page.
 * - The /faq/ page gathers all of them; each page's FAQPage JSON-LD is built from
 *   the Q&A it shows (tools/seo.ts), so markup and page never disagree.
 *
 * Rules: the question as people ask it, ending in "?"; the answer stands alone
 * (names BandWith or the feature, no "see above"), 15–80 words, plain text,
 * facts the channel page and the Academy already state. No plan prices.
 * Every string needs its IT and ES key (src/i18n/dict), like the rest of the copy.
 */
export type QA = { q: string; a: string };

export const DEFINITION =
  'BandWith is a band-management app for working bands, their musicians and the deputies who cover for them. ' +
  'It keeps gigs, rehearsals, quotes, contracts, setlists, fees and chat in one shared place, shows each person only their part, ' +
  'and runs the show itself in Stage mode. It works on iPhone, iPad, Android and the web.';

export const HOME_ANSWERS: QA[] = [
  {
    q: 'Who is BandWith for?',
    a: 'Working bands that play gigs: wedding, function, cover and original bands, with one or more admins who run the band. Members see the gigs they play and their own fee. Deputies, the musicians who cover for a member, get only the requests sent to them.',
  },
  {
    q: 'Is BandWith free?',
    a: 'Yes. BandWith is free while it’s in private beta, on the web, on Android and on iPhone and iPad through TestFlight. Beta spots are limited: when they’re full, you can join the waitlist.',
  },
  {
    q: 'Which devices does BandWith run on?',
    a: 'BandWith runs on iPhone, iPad, Android phones and tablets, dual-screen phones like the Surface Duo, and in any web browser. It’s the same account and the same data everywhere; only the layout changes with the screen.',
  },
  {
    q: 'How does a band share one calendar?',
    a: 'In BandWith, gigs, rehearsals and quotes share one month calendar for the whole band. An admin books a gig in three steps, and every musician on the lineup gets the date, the venue, the call times and their own fee.',
  },
  {
    q: 'Can band members see each other’s fees?',
    a: 'No. In BandWith each member sees only their own fee, and whether it was paid. The client, the band fee and other people’s fees stay with the admins, and the server enforces it: a member’s phone never receives them.',
  },
  {
    q: 'Does BandWith work without internet at the venue?',
    a: 'Yes. BandWith keeps the bands, gigs and setlists you last loaded on the device. In Stage mode the leader’s phone keeps the whole band on the same song over Bluetooth, with no pairing, when the venue has no signal.',
  },
  {
    q: 'Which languages is BandWith in?',
    a: 'The BandWith app and the BandWith Academy guide are in English, Italian, Spanish, French, German and Portuguese. Quotes, contracts and the client’s page can be sent in the client’s language.',
  },
];

export const ANSWERS: Record<string, QA[]> = {
  'calendar-gigs': [
    {
      q: 'How do I book a gig for the whole band?',
      a: 'In BandWith, tap Create, then New gig. Step 1 picks the lineup and each musician’s fee, step 2 the date and the venue, step 3 reviews it. Tap Create gig and every musician gets an invitation with the date, the call times and their own fee.',
    },
    {
      q: 'How do I find a date when every member is free?',
      a: 'When you pick a date for a gig or a rehearsal, BandWith tints each day by how many members are free, from all their calendars. It shows counts only: never who is busy, or why.',
    },
    {
      q: 'What happens when a gig’s date or venue changes?',
      a: 'The lineup gets one Gig updated notice for a new date, time, call time or venue. A changed fee reaches only that musician. Everyone’s calendar in BandWith shows the change at once.',
    },
  ],
  'quotes-contracts': [
    {
      q: 'How do I send a quote for a gig?',
      a: 'In BandWith, tap Create, then New quote: client and event type, the lineup from your pricing sheet, then date and venue. Save & share builds the PDF and sends a personal link by WhatsApp, text message or email.',
    },
    {
      q: 'Does the client need an account to accept a quote?',
      a: 'No. The client opens a personal link in any browser and accepts with their name, declines, or writes to you. BandWith notifies you of each answer, and an accepted quote becomes the gig with one tap.',
    },
    {
      q: 'Does the client see what each musician earns?',
      a: 'No. On the quote the client sees the lineup as one line and the total, never each musician’s fee. Quotes and contracts stay with the band’s admins in BandWith.',
    },
  ],
  money: [
    {
      q: 'How do I keep track of what the band owes each musician?',
      a: 'Every musician has a fee on every gig in BandWith, or Fee to be discussed until it’s set. After the show, Home lists the payouts due, and the admin ticks each musician off as paid.',
    },
    {
      q: 'Can a gig be confirmed before the fee is agreed?',
      a: 'Yes. Tick Fee to be discussed (TBD) in the gig wizard: the date is confirmed now and the money later. Invitations say the fee is to be discussed until an admin sets it.',
    },
    {
      q: 'Which currencies does BandWith support?',
      a: 'BandWith works in euros, US dollars, British pounds and Swiss francs, with your country’s VAT rate. Each quote keeps the currency it was made in.',
    },
  ],
  'rehearsals-polls': [
    {
      q: 'How do I schedule a band rehearsal everyone can make?',
      a: 'In BandWith, send an availability poll with a few dates and a vote-by time. Everyone taps the dates they can make, votes update live, and an admin locks in the top pick: the rehearsal is created and the poll closes.',
    },
    {
      q: 'How is the rehearsal room cost split?',
      a: 'Enter the room cost on the rehearsal or the poll and BandWith works out each person’s share. Members see only their share; the total stays with the admins.',
    },
    {
      q: 'Can rehearsals repeat every week?',
      a: 'Yes. A BandWith rehearsal can repeat weekly, every two weeks or monthly, with one roster and one answer for the whole series, shown in the calendar about four months ahead.',
    },
  ],
  chat: [
    {
      q: 'Is there a separate chat for each gig?',
      a: 'Yes. Every gig and rehearsal in BandWith has its own chat with the lineup and the admins. The day, the load-in or start time and the place stay pinned on top, one tap from the event.',
    },
    {
      q: 'Who can message whom in the band chat?',
      a: 'In BandWith, admins can message anyone in their bands. Members message the admins directly and talk to each other in the band chat or the gig chat. Deputies are in no chat.',
    },
    {
      q: 'Does the gig chat show fees?',
      a: 'No. The strip on top of a BandWith event chat shows the times, the place and the status of the gig, never the fee or the client.',
    },
  ],
  songs: [
    {
      q: 'How do I build a setlist for a gig?',
      a: 'In BandWith, open Setlists and tap Add songs from library, filter by genre, tap songs in, drag them into order and save. Load the setlist into a gig and the gig gets its own copy, which admins can change on the night.',
    },
    {
      q: 'Can each musician transpose a song for themselves?',
      a: 'Yes. In BandWith each player moves the key with − and + on their own screen. Only that screen changes: the band’s copy of the song stays in its key.',
    },
    {
      q: 'Can I import chord charts from iReal Pro?',
      a: 'Yes. Tap a song or a playlist on the iReal Pro forum and BandWith imports the chords, form, key, style and tempo. ChordPro and MusicXML files work too. Melodies and lyrics are not imported.',
    },
    {
      q: 'Where do the band’s lyrics and chords live?',
      a: 'In the BandWith repertoire: one library with each song’s key, tempo, lyrics with chords and recordings. Every active member can read it, and changes to the band’s songs go through the admins.',
    },
  ],
  stage: [
    {
      q: 'What is Stage mode?',
      a: 'Stage mode is the BandWith gig-day screen: the run of show, the setlist and each song’s lyrics, chords or structure on every phone in the band. The leader moves to the next song and every phone follows.',
    },
    {
      q: 'Does Stage mode work without internet?',
      a: 'Yes. Open the gig once while online and the setlist and charts stay on the phone. With no signal, the leader’s phone keeps the band on the same song over Bluetooth, with no pairing. The visual click needs the internet.',
    },
    {
      q: 'Is the Stage mode click an audible metronome?',
      a: 'No. The BandWith click is visual only: a glow flashes around the edge of every phone on the beat, brighter on one, for a count-in and a tempo reference. It isn’t meant for in-ear monitors.',
    },
  ],
  'stage-plot-rider': [
    {
      q: 'How do I make a stage plot on my phone?',
      a: 'In BandWith, open the gig, then Rider & stage, and tap Edit under Stage plot. Add the musicians and the gear, hold an item and drag it into place. The input list fills itself in from the plot, in desk order.',
    },
    {
      q: 'How do I send our rider to the venue?',
      a: 'Tap Share link with the venue, or PDF for a file. The venue opens the rider in a browser with no account: the gig’s times, the stage plot, the input list and who brings what, never the client or any fee.',
    },
    {
      q: 'What if the rider changes after we sent it?',
      a: 'Tap New version: the rider goes back to Draft as the next version. Share it again and the venue’s link shows the new one. Show readiness in BandWith notes which version was sent.',
    },
  ],
  people: [
    {
      q: 'How do I find a deputy when a member can’t play?',
      a: 'When a member declines a gig, open the lineup in BandWith and tap Find a deputy. Deputies on the same instrument come first. Ask in the app, or by WhatsApp, SMS or email with a reply link.',
    },
    {
      q: 'Does a deputy need to install the app?',
      a: 'No. A deputy can answer Yes, Not sure yet or No on a web page with no account, or in Deputy gigs if they use BandWith. The street address reaches them only after a yes.',
    },
    {
      q: 'How do I invite musicians to the band?',
      a: 'In BandWith, open Band members and tap Invite member, then type a name or an email. Anyone not on BandWith gets an email, a link and a code, valid for seven days. Nobody joins without saying yes.',
    },
    {
      q: 'Can BandWith track the band’s gear?',
      a: 'Yes. Each piece of gear in BandWith has an owner, a status (Available, In use, Maintenance or Lost) and who has it. Bundle items into kits, then pick a kit on the gig.',
    },
  ],
  privacy: [
    {
      q: 'What can a band member see in BandWith?',
      a: 'A member sees the gig’s times, the venue and address, the lineup, the setlist and rider to read, and their own fee. Never the client, the band fee, quote totals or anyone else’s fee.',
    },
    {
      q: 'What does a deputy see?',
      a: 'A BandWith deputy sees only the request: date, times, venue, city, role and the fee offered. The street address arrives after they say yes. Nothing else of the band.',
    },
    {
      q: 'Can I export or delete my data?',
      a: 'Yes. In Privacy & account, Export my data saves a JSON copy of your profile, bands, personal gigs and gig answers, and Delete account removes your profile, personal gigs and messages for good.',
    },
  ],
  devices: [
    {
      q: 'Is there a BandWith app for iPhone and Android?',
      a: 'Yes. BandWith has apps for iPhone and iPad, through TestFlight during the beta, and for Android, installed from an APK. The same account also works in any web browser.',
    },
    {
      q: 'Does BandWith work on iPad and dual-screen phones?',
      a: 'Yes. On an iPad BandWith shows two panes side by side. On a dual-screen phone like the Surface Duo it fits every posture: closed, open like a book, and half folded like a laptop.',
    },
    {
      q: 'What can the phone apps do that the web can’t?',
      a: 'The BandWith phone apps add push notifications, Face ID or fingerprint, app lock and Bluetooth sync in Stage mode. The web app has the same data and roles, without those.',
    },
  ],
};

/** Every Q&A on the site, in /faq/ order: the home questions, then each channel's. */
export const ALL_ANSWERS = (): QA[] => [...HOME_ANSWERS, ...Object.values(ANSWERS).flat()];
