import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'devices',
  title: 'Every device',
  description: 'BandWith runs on iPhone, Android, iPad, dual-screen phones and in a web browser, with the same data and the same rules. The layout changes to fit the screen, and what you last loaded stays there offline.',
  ogTitle: 'Every device · Same band. Any screen.',
  hero: {
    heading: { lines: ['Same band.', 'Any screen.'], em: 'screen.' },
    lead: 'BandWith is the same app everywhere, with the same data and the same rules. What changes is the layout: one screen on a phone, two panes on an iPad, two pages on an open dual-screen phone.',
    chips: [
      { icon: 'smartphone', label: 'iPhone & Android' },
      { icon: 'monitor', label: 'iPad, two panes' },
      { icon: 'book-open', label: 'Dual-screen' },
      { icon: 'globe', label: 'Any browser' },
    ],
    shot: 'calendar-month',
    region: [0.58, 1],
    alt: 'The calendar on a phone: November 2026 with the tab bar at the bottom',
  },
  flow: {
    heading: { lines: ['One account.', 'Every pocket.'] },
    steps: [
      { title: 'Sign in anywhere', body: 'Use the same account on your phone, an iPad or a browser. Your bands, gigs, setlists and settings are the same everywhere, and so is who sees what.', shot: 'basics-home-admin', region: [0, 0.32], badge: 'Same data' },
      { title: 'One screen at a time', body: 'On iPhone and Android you see one screen, with the tab bar at the bottom. Sheets slide up and swipe down. Turn the phone sideways and it keeps the phone layout.', shot: 'calendar-month', region: [0.6, 1], badge: 'Phone layout' },
      { title: 'No signal, still there', body: 'Offline, the app shows what it last loaded: bands, gigs and setlists. Create or edit a gig or rehearsal and it says Saved offline • Will sync when connected. It syncs on its own when you’re back.', shot: 'music-stage', region: [0.42, 0.9], badge: 'Cached' },
      { title: 'Gig day on the phone', body: 'The phone apps add what the hardware gives: push, Face ID or fingerprint, app lock, and Bluetooth in Stage mode when the venue has no signal. Stage mode keeps the screen awake.', shot: 'music-stage', region: [0, 0.4], badge: 'Screen awake' },
    ],
  },
  demo: {
    kind: 'devices',
    heading: { lines: ['Open it.', 'Fold it.'] },
    lead: 'One calendar, every shape. Pick a phone, an iPad, a browser or a Duo closed, open like a book or half folded like a laptop, and watch the same screen move.',
  },
  roles: {
    heading: { lines: ['Same rules.', 'Every screen.'] },
    lead: 'Roles don’t change with the device: an admin is an admin on a phone, an iPad or the web. What changes is the hardware, and that is the same for everyone. The one gap: deputies have no Stage mode anywhere.',
    rows: [
      { what: 'Same bands, gigs and rights on every device', admin: true, member: true, deputy: true },
      { what: 'Shows what it last loaded when offline', admin: true, member: true, deputy: true },
      { what: 'Push notifications', admin: 'In the apps', member: 'In the apps', deputy: 'In the apps' },
      { what: 'Face ID or fingerprint sign-in, app lock', admin: 'In the apps', member: 'In the apps', deputy: 'In the apps' },
      { what: 'Two panes on iPad and on an open Duo', admin: true, member: true, deputy: true },
      { what: 'Bluetooth sync in Stage mode', admin: 'In the apps', member: 'In the apps', deputy: { dash: 'No Stage mode' } },
    ],
  },
  devices: {
    shot: 'calendar-month',
    heading: { lines: ['One calendar.', 'Six shapes.'] },
    lead: 'Every screen fits every posture. On an iPad the list and the detail sit side by side. A dual-screen phone puts the rail in its system column, opens like a book, or stands half folded with things to read on top and every control below.',
    tabs: [
      { dev: 'phone', cap: 'Phone · one screen at a time, the tab bar at the bottom.', alt: 'The calendar on a phone' },
      { dev: 'tablet', cap: 'iPad · the calendar in the list column, the event you open beside it, a floating tab pill with labels.', alt: 'The calendar on an iPad' },
      { dev: 'web', cap: 'Web · the phone layout in a narrow window, the wide layout from 744 px. No push, no Bluetooth.', alt: 'The calendar in a web browser' },
      { dev: 'duoClosed', cap: 'Duo closed · one page; the tabs, Back, Search and your profile live in the side rail.', alt: 'The calendar on a closed Surface Duo' },
      { dev: 'duoBook', cap: 'Duo book · the calendar on the left page, the event you open on the right.', alt: 'The calendar on a Surface Duo open like a book' },
      { dev: 'duoLaptop', cap: 'Duo laptop · the Planner: the month and its counts on top, the day’s agenda and + Gig / + Rehearsal below.', alt: 'The calendar on a Surface Duo folded like a laptop' },
    ],
  },
  details: {
    heading: { lines: ['Built for', 'where you are.'] },
    items: [
      { icon: 'wifi-off', title: 'Works without a connection', body: 'Bands, gigs and setlists stay on the device. Gig and rehearsal changes made offline wait in a strip that counts them, and sync when the connection comes back. Quotes, chat messages and invites need a connection.', wide: true },
      { icon: 'monitor', title: 'One-screen composers', body: 'On an iPad, a new gig, rehearsal or quote is one screen of numbered cards with a live preview beside them.' },
      { icon: 'book-open', title: 'Laptop pose', body: 'Half folded on a table: read on the top half, touch on the bottom. Band desk, Planner, Find a date, Floor wedge, Quote desk.' },
      { icon: 'smartphone', title: 'Android, from an APK', body: 'Installed from the release page, not a store. A new version shows up in the app: Update, then Install.' },
      { icon: 'globe', title: 'In any browser', body: 'Sign in with the same account. No push, no Face ID or fingerprint, no app lock, no Bluetooth in Stage mode.' },
      { icon: 'arrow-left', title: 'Back does what you expect', body: 'Android’s Back and back gesture close the top layer first; on Home, Tap again to exit. On the web, Escape and the browser’s Back close the top layer, and never anything outside the app.', wide: true },
    ],
  },
  learn: [
    { id: 'device-differences', title: 'On every device', line: 'Layout and features, device by device.' },
    { id: 'ipad-layout', title: 'On an iPad', line: 'Two panes, centred sheets, one-screen composers.' },
    { id: 'duo-laptop-pose', title: 'Laptop pose', line: 'Read on the top half, touch on the bottom.' },
    { id: 'using-the-web-app', title: 'In a web browser', line: 'What works on the web, and what needs the app.' },
    { id: 'android-app', title: 'On Android', line: 'Install the APK, update, Back and exit.' },
    { id: 'offline-mode', title: 'Offline', line: 'What works without a connection, and how it syncs.' },
  ],
};
