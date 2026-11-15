import type { AreaModule } from './types';

/**
 * BandWith Academy · Calendar & gigs.
 * Source of truth: src/app/views/EventsView.tsx, PastEventsView.tsx,
 * src/app/components/dashboard/CreateEventModal.tsx, EventDetail.tsx,
 * src/app/components/event/**, src/lib/{bandFilter,bandAvailability,freeSlots,
 * eventConflicts,gigTiming,readiness,payoutsDue,lineupSoFar,openEventSync,
 * homeAutoDetail,memberNext,wizardDrafts}.ts, AuthenticatedApp.tsx and
 * supabase/migrations 046, 068, 071, 072, 078, 081, 086, 092, 093, 095, 107.
 */
const gigs: AreaModule = {
  area: {
    id: 'gigs',
    title: 'Calendar & gigs',
    intro: 'See every gig, rehearsal and personal date in one calendar, create gigs, and run each one from its workspace.',
    icon: 'calendar',
  },

  articles: [
    // ───────────────────────────── Calendar ─────────────────────────────
    {
      id: 'calendar-overview',
      title: 'The calendar',
      summary: 'What the Calendar tab shows: filters, the month grid, the legend, upcoming cards and the past archive.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['calendar', 'schedule', 'month', 'events', 'agenda', 'upcoming'],
      related: ['filter-the-calendar', 'search-events', 'add-from-a-free-day', 'past-events', 'calendar-on-tablet-and-duo'],
      body: [
        { type: 'p', text: 'Tap **Calendar** in the bottom bar. The screen has four parts, from top to bottom: the filter rows, open rehearsal polls, the month grid with its legend, and the list of **Upcoming** events.' },
        { type: 'shot', id: 'calendar-month', caption: 'The Calendar tab: type filters, the month grid and the first upcoming cards.' },
        {
          type: 'list',
          title: 'What you find on the screen',
          items: [
            'The type filter: **ALL**, **GIGS**, **REHEARSALS**, **QUOTES** and **DRAFTS**. The selected filter shows how many events it holds. See [[filter-the-calendar]].',
            'The band filter, above the type filter, only when you are in two or more bands: **All bands**, one pill per band, and **Personal**.',
            '**Rehearsal scheduling ({count})**: rehearsal polls that are open for votes, and proposals waiting for an admin. See [[rehearsal-polls-explained]].',
            'The month grid. Use **Previous month** and **Next month** (the arrows at the top left), or swipe the grid sideways. **Today** appears at the top right when you are on another month.',
            'Each day with events takes the colour of its event. A small number on a day means it has several events. Today has a ring.',
            'The legend under the grid: **gig**, **rehearsal**, **quote** (admins only) and **personal**. Admins with saved drafts also see **draft · only you** (a dashed, faded square).',
            '**Upcoming**: one card per event, soonest first. Recurring rehearsals show each of their next dates as a card.',
            'At the bottom, **{count} past events** with the **Past events archive** link. **See all** next to **Upcoming** opens the same archive.',
          ],
        },
        {
          type: 'list',
          title: 'What an event card shows',
          items: [
            'The event colour and type (**GIG**, **REHEARSAL**, **QUOTE**, **DRAFT** or **PERSONAL**), and a status chip such as **CONFIRMED**, **WEEKLY**, **SENT** or **DRAFT · ONLY YOU**.',
            'The band name, when you are in more than one band.',
            'Date, start time, venue and address.',
            'Two meters. Left: **LINEUP** (gigs and quotes) or **GOING** (rehearsals). Right: **FEE** for admins, **YOUR FEE** for members, **QUOTE** on quotes, or **LENGTH** on rehearsals.',
            'A warning button such as **2 details missing** when the venue, date or fee is missing. Tap it to see the list under **Missing info**, then **Edit** to open the event. Admins also see hints such as **No end time**, **No client info** or **No team assigned**.',
            '**Sync**, with a turning arrow, on an event saved offline that has not reached the server yet. See [[live-updates-and-offline]].',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Sees every event of the bands they manage, except gigs they declined themselves. Sees quotes and drafts, the **QUOTES** and **DRAFTS** filters, band fees on cards, and the create buttons.' },
            { role: 'member', text: 'Sees only the gigs and rehearsals where an admin added them and they have not declined, plus their own personal gigs. Never sees quotes or the admins’ drafts. Cards show **YOUR FEE**, never the band fee.' },
            { role: 'deputy', text: 'A deputy is not on the band calendar. Their gigs are in **Deputy gigs**. See [[deputies-on-a-gig]].' },
          ],
        },
        { type: 'p', text: 'When nothing is scheduled, the list shows **Nothing scheduled**. Admins get **Gig**, **Rehearsal** and **Quote** buttons there. Members get **Propose rehearsal**. With a filter on, **Show All Events** clears it.' },
      ],
    },
    {
      id: 'filter-the-calendar',
      title: 'Filter the calendar by type or band',
      summary: 'Show only gigs, rehearsals, quotes or drafts, and, if you play in several bands, only one band or your personal gigs.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['filter', 'band filter', 'only gigs', 'personal', 'multiple bands'],
      related: ['calendar-overview', 'personal-gigs'],
      body: [
        {
          type: 'steps',
          items: [
            'Open **Calendar** in the bottom bar.',
            'Tap a type pill under the header: **ALL**, **GIGS**, **REHEARSALS**, **QUOTES** or **DRAFTS**. The grid, the legend and the upcoming list follow the filter.',
            'If you are in two or more bands, tap a band pill in the row above: **All bands**, a band name, or **Personal**.',
            'Tap **ALL** and **All bands** to see everything again.',
          ],
        },
        { type: 'p', text: 'The two filters combine: **GIGS** with one band shows that band’s gigs only. The band filter only narrows what you can already see: picking a band never shows you more.' },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: '**QUOTES** and **DRAFTS** appear when the band shown is one you manage. When you pick a band where you are a member, those two filters disappear, fees are hidden and the create buttons go away, as for any member of that band.' },
            { role: 'member', text: 'You see **ALL**, **GIGS** and **REHEARSALS** only.' },
          ],
        },
        {
          type: 'list',
          title: 'Good to know',
          items: [
            '**Personal** appears only when you have personal gigs. Under **Personal** there are no band fees and no create buttons: add personal gigs from the **Create** menu.',
            'If you leave a band, or are down to one band, a band filter that no longer exists goes back to **All bands** on its own, so nothing stays hidden.',
            'With one band selected, a gig you create lands in that band.',
          ],
        },
      ],
    },
    {
      id: 'search-events',
      title: 'Search events',
      summary: 'Find any event by title, venue, city, client or notes.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['search', 'find gig', 'find event', 'venue search', 'client search'],
      related: ['calendar-overview', 'past-events'],
      body: [
        {
          type: 'steps',
          items: [
            'On **Calendar**, tap **Search events** (the magnifier at the top right of the header).',
            'Type in the field. It searches **title, venue, city, client** and notes.',
            'Narrow the results with the tabs: **ALL**, **GIGS**, **REHEARSALS**, **QUOTES** (admins only) and **PAST**.',
            'Tap a result to open it.',
            'Tap **Close search** (top left) or press Escape to go back. Closing clears the search.',
          ],
        },
        { type: 'p', text: 'Results show upcoming events first, soonest first, then past ones, most recent first. With no match you see **No matching events**.' },
        {
          type: 'devices',
          rows: [
            { devices: ['duoClosed', 'duoBook', 'duoLaptop', 'duoLand'], text: 'The header search is the rail’s **Search**. On an open device the search stays on the left page and the event you pick opens on the right page.' },
            { devices: ['tablet'], text: 'The event you pick opens beside the list and stays outlined in the results.' },
          ],
        },
      ],
    },
    {
      id: 'add-from-a-free-day',
      title: 'Open a day or add an event from the grid',
      summary: 'Tap a day to open its event, pick one of several events, or start a gig, rehearsal or quote on a free day.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['tap day', 'free day', 'add on date', 'day view', 'several events'],
      related: ['create-a-gig', 'create-a-rehearsal', 'create-a-quote', 'free-slots-and-conflicts'],
      body: [
        {
          type: 'steps',
          items: [
            'On **Calendar**, tap a day in the month grid.',
            'A day with one event opens that event.',
            'A day with several events opens a panel under the grid with **{count} events**. Tap the event you want, or **Close day** to close the panel.',
            'A day with nothing on it opens a **Free day** panel. Admins see **Nothing scheduled yet. Add something for the band:** and three tiles: **Gig**, **Rehearsal** and **Quote**. Tap one to start it on that date.',
            'Tap **Dismiss date selection** (the X) or the same day again to close the panel.',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'The tiles start the gig wizard ([[create-a-gig]]), the rehearsal wizard ([[create-a-rehearsal]]) or the quote wizard ([[create-a-quote]]) with the date already filled in.' },
            { role: 'member', text: 'A free day shows **Nothing scheduled on this day.** with no tiles. To add your own date, use **Create** and **Add personal gig** ([[personal-gigs]]).' },
          ],
        },
        { type: 'note', tone: 'tip', text: 'A dashed, faded day is one of your saved drafts. Tapping it opens the draft, not a new event. See [[gig-drafts]].' },
      ],
    },
    {
      id: 'free-slots-and-conflicts',
      title: 'Band availability and schedule conflicts',
      summary: 'How BandWith shows how many members are free on a day, warns about clashes, and keeps personal dates private.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['availability', 'free slots', 'heatmap', 'conflict', 'busy', 'double booking', 'who is free'],
      related: ['create-a-gig', 'answer-a-gig-invitation', 'personal-gigs'],
      body: [
        { type: 'p', text: 'When an admin picks a date in the gig wizard, the date picker counts how many active members of the band have nothing else on that day, in any of their calendars. It shows counts only: never who is busy or why.' },
        {
          type: 'list',
          title: 'In the date picker (**Event date**)',
          items: [
            'Days are tinted from grey to green: the greener, the more members are free. The legend reads **Free in band calendars · {n} members**.',
            'With a start and end time set, only that window counts, so a member busy in the morning is still free for an evening gig. A window that ends after midnight runs into the next day.',
            'Under the calendar, the chosen day reads **{free} of {total} free · no conflicts** when everyone is free, or **{free} of {total} free**.',
            'A day that already has one of the band’s events gets a grey dot. If you pick it, the sheet stays open and warns, for example **Dec 12 has a gig**, followed by the next free day: tap it to pick it instead.',
            'Shortcuts at the top: **Today**, **Tomorrow** and **Weekend**.',
          ],
        },
        {
          type: 'list',
          title: 'What counts as busy',
          items: [
            'Gigs and rehearsals the member has not declined, in any band, and their personal gigs.',
            'Cancelled events and quotes do not count.',
            'A commitment without an end time counts as three hours from its start.',
            'When you edit a gig, its own lineup does not count as busy.',
            'Bands with a single member get no counts, as there is nothing useful to compare.',
          ],
        },
        {
          type: 'list',
          title: 'Conflicts the app points out',
          items: [
            'Gig invitations: the invitation and the RSVP sheet show **No schedule conflicts in your calendar**, or the other event on that date (for example **You’re already booked**). See [[answer-a-gig-invitation]].',
            'Personal gigs: a personal gig on the same date as a band gig or rehearsal shows **SCHEDULE CONFLICT** with a button to tell that band’s admin. See [[personal-gigs]].',
          ],
        },
        { type: 'note', tone: 'privacy', text: 'Your personal gigs are private. Your bands only see you as busy on that date: never the title, venue or fee.' },
        {
          type: 'devices',
          rows: [
            { devices: ['tablet'], text: 'In the iPad composer the month is shown inline in card **Date & time**, with the same counts under it.' },
            { devices: ['duoLaptop'], text: 'The Planner shows **Free weekends** for the month on the top half. See [[calendar-on-tablet-and-duo]].' },
          ],
        },
      ],
    },

    // ───────────────────────────── Creating ─────────────────────────────
    {
      id: 'create-a-gig',
      title: 'Create a gig',
      summary: 'Use the three-step gig wizard: event and lineup, date and venue, then review and extras.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['new gig', 'add gig', 'book gig', 'gig wizard', 'schedule gig', 'create event'],
      related: ['gig-lineup-and-fees', 'gig-times-and-venue', 'gig-drafts', 'create-a-gig-on-ipad', 'gig-notifications', 'build-a-setlist'],
      body: [
        { type: 'p', text: 'Only band admins create gigs. Members log their own outside dates as personal gigs instead ([[personal-gigs]]).' },
        {
          type: 'steps',
          title: 'Start the wizard',
          items: [
            'Tap **Create** (the + button in the bottom bar) and pick **New gig**. You can also tap a free day in the calendar and choose **Gig**, or tap **Gig** on an empty calendar.',
            'The wizard opens on **Step 1 of 3 · Event & lineup**. The three segments at the top show where you are: tap a segment to jump to a step you have already reached.',
          ],
        },
        { type: 'shot', id: 'gig-wizard-step1', caption: 'Step 1 of the gig wizard: title, client, event type, lineup preset and roster.' },
        {
          type: 'steps',
          title: 'Step 1 · Event & lineup',
          items: [
            'Type an **Event title**, or leave it empty: the app builds one from the type and the client (for example "Wedding - Client A"), or "Club Gig" without a client.',
            'Type the **Client / promoter** (optional).',
            'Pick an **Event type**: **Wedding**, **Corporate**, **Private party**, **Festival**, **Club**, **Pub** or **Other**. You need a type to go on.',
            'Pick a **Lineup preset** (**Solo**, **Duo**, **Trio** or **Full band**) or tick musicians one by one in the roster card. Tap **Customize** to open the roster and **Done** to fold it.',
            'Check each musician’s fee next to their name, or turn on **Fee to be discussed (TBD)**. Add an **Extra band fee / services** if the band charges more than the musicians’ fees. See [[gig-lineup-and-fees]].',
            'Tap **Next**.',
          ],
        },
        {
          type: 'steps',
          title: 'Step 2 · Date & venue',
          items: [
            'Search the **Venue / location** and pick a result, or tap a quick chip: **TBD**, **Main Stage** or **Private Venue**.',
            'Pick the **Event date**. It is the only field this step needs. The picker shows how many members are free ([[free-slots-and-conflicts]]).',
            'Set **Start time** and **End time** (20:00 and 23:30 to start with). The length shows next to **End time**.',
            'Tap **Add** under **Load-in (optional)** and **Soundcheck (optional)** to set call times.',
            'Tap **Next**.',
          ],
        },
        {
          type: 'steps',
          title: 'Step 3 · Review & confirm',
          items: [
            'Check the summary card: title, date and times, venue and lineup. Tap **Edit lineup** or **Edit date & venue** to go back.',
            'Open **Setlist & songs** to add songs (optional). Load a saved setlist under **Load from templates**, or tap **Add songs** to pick from your library. **Add set** adds another set. See [[build-a-setlist]].',
            'Open **Logistics, guests & setting** (optional): **Setting** (**Indoor** or **Outdoor**), **Estimated guests** and **Performance duration**.',
            'Open **Tasks & band notes** (optional): load a list under **Load a to-do list**, type tasks and tap **Add**, and write **Band notes** for directions or details.',
            'Tap **Create gig**.',
          ],
        },
        {
          type: 'list',
          title: 'What happens when you tap Create gig',
          items: [
            'The gig is saved as confirmed and appears on the calendar of everyone in the lineup.',
            'You are on the lineup as confirmed. Every other musician is pending and gets an invitation with their own fee only. See [[gig-notifications]].',
            'You get an inbox note saying the gig is waiting for the others to confirm.',
            'If the save fails, the wizard stays open with what you typed, and the gig is also kept in your drafts.',
            'With no connection, the gig is saved on the device: **Saved offline • Will sync when connected**.',
          ],
        },
        { type: 'note', tone: 'tip', text: 'Closing the wizard after typing something asks **Save this gig as a draft?**. See [[gig-drafts]].' },
        {
          type: 'devices',
          rows: [
            { devices: ['tablet'], text: 'A new gig opens as a one-screen composer with a live preview instead of the three steps. See [[create-a-gig-on-ipad]].' },
            { devices: ['duoBook', 'duoLand'], text: 'On step 1 the left page shows the gig as the band will see it, filling in as you type. On steps 2 and 3 the calendar stays on the left page.' },
            { devices: ['duoClosed'], text: '**Close gig wizard** sits in the rail, under the clock.' },
            { devices: ['android'], text: 'The back gesture closes the open song picker first, then asks to save a draft.' },
          ],
        },
      ],
    },
    {
      id: 'gig-lineup-and-fees',
      title: 'Lineup and fees in the gig wizard',
      summary: 'How presets, the roster, each musician’s fee, Fee TBD and the extra band fee work.',
      roles: ['admin'],
      kind: 'reference',
      keywords: ['lineup', 'roster', 'musician fee', 'fee tbd', 'extra fee', 'services', 'band fee', 'preset'],
      related: ['create-a-gig', 'fee-and-payouts-on-a-gig', 'payouts-due', 'what-members-see-on-a-gig'],
      body: [
        {
          type: 'list',
          title: 'Choosing who plays',
          items: [
            '**Lineup preset** picks the first 1, 2 or 3 people of the roster, or everyone for **Full band**. You always stay in the lineup.',
            'The roster card reads **Roster · {count} of {total}**. Tick or untick each musician. Your own row says **You · {role}** and cannot be unticked.',
            'Each row shows the musician’s instrument from the band roster (or **Admin** / **Member** when no instrument is set).',
            'Folded, the card shows up to five avatars, the musician count and **{amount} est. total**.',
          ],
        },
        {
          type: 'list',
          title: 'How the fee of each musician is filled in',
          items: [
            'The musician’s own default fee from the band roster, when they have one.',
            'Otherwise the band’s pricing settings: the core-member rate for the first core members and the session-musician rate for the others. See [[payouts-due]].',
            'You can type any amount in the field next to the name (**Fee for {name}**).',
          ],
        },
        {
          type: 'list',
          title: 'Band money',
          items: [
            '**Extra band fee / services**: money the band charges on top of the musicians’ fees. Service chips such as **+ Sound (€300)** add the band’s active services from the pricing settings.',
            'The gig’s band fee is the musicians’ fees plus the extra band fee. Whatever is not paid out to musicians is the **Band fund**.',
            '**Fee to be discussed (TBD)**: the date is confirmed now and the money later. Fee fields hide, every fee is saved as 0, invitations say the fee is to be discussed, and the gig shows **To be discussed**.',
          ],
        },
        { type: 'note', tone: 'privacy', text: 'Each musician only ever sees their own fee: on the invitation, on the card and in the gig. Other fees, the extra band fee and the band total stay with admins.' },
        { type: 'note', tone: 'tip', text: 'Changing a musician’s fee later sends that musician (and nobody else) a fee change notification.' },
      ],
    },
    {
      id: 'gig-times-and-venue',
      title: 'Gig times, venue and logistics',
      summary: 'Start and end times, call times, shows that end after midnight, the venue search, forecast, setting and guests.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['load in', 'soundcheck', 'call time', 'after midnight', 'venue', 'address', 'weather', 'forecast', 'guests', 'indoor', 'outdoor'],
      related: ['create-a-gig', 'gig-workspace', 'free-slots-and-conflicts'],
      body: [
        {
          type: 'list',
          title: 'Times',
          items: [
            '**Start time** and **End time** frame the show. An end time earlier than the start means the show runs past midnight: 21:00 to 02:00 is one gig that ends the next morning.',
            'A gig stays upcoming until its day is over, or, past midnight, until the show really ends. Only then does it turn into a past gig.',
            '**Load-in (optional)** and **Soundcheck (optional)** are call times. They appear on the gig as **LOAD IN** and **SOUNDCHECK**, on the member’s Home card and in Stage mode. Nothing is invented: a time nobody set reads **TBD**.',
          ],
        },
        {
          type: 'list',
          title: 'Venue',
          items: [
            'Type in **Venue / location** and pick a suggestion. A named place fills in the venue and its street; a plain address becomes the venue itself. The city, region, postcode and country are filled in too.',
            'On the gig, the venue name is a link: tap it (or **MAP**) to open it in your maps app. **Logistics & notes** has **Copy** for the full address and **Maps**.',
            'Leave the venue empty or pick **TBD** when you don’t know it yet: the card then warns **Missing venue**.',
          ],
        },
        {
          type: 'list',
          title: 'Forecast and logistics',
          items: [
            'For a gig in the next seven days with a city, the wizard shows **Forecast: {temp}° {sky}** with the sunset time. The gig’s header shows the weather too, until the day has passed.',
            '**Setting**: **Indoor** or **Outdoor**. Editing a gig keeps the saved setting (also **HYBRID** from quotes) unless you change it.',
            '**Estimated guests**: use the minus and plus buttons (steps of 10) or the chips 50, 100, 150, 200 and **300+**.',
            '**Performance duration**: from 15 minutes to 6 hours.',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Sets and changes every field.' },
            { role: 'member', text: 'Sees the times, venue, address, setting, guests, dress code and band notes. Gets a notification when the date, times, call times or venue change.' },
            { role: 'deputy', text: 'Sees date, load-in, soundcheck, show times, venue, city and address of the gig they are asked for.' },
          ],
        },
      ],
    },
    {
      id: 'create-a-gig-on-ipad',
      title: 'Create a gig on iPad',
      summary: 'On a tablet, a new gig is one screen with five numbered cards, extra sheets and a live preview.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['ipad', 'tablet', 'composer', 'live preview', 'new gig ipad'],
      related: ['create-a-gig', 'rider-and-stage', 'gig-drafts'],
      body: [
        { type: 'p', text: 'On an iPad (or another wide window without the dual-screen rail), **New gig** opens the composer. It has the same fields and saves the same gig as the step wizard. Editing a gig still uses the edit view ([[edit-a-gig]]).' },
        { type: 'shot', id: 'ipad-gig-composer', caption: 'The iPad composer: numbered cards on the left, the live preview on the right.' },
        {
          type: 'steps',
          items: [
            'Tap **Create** and pick **New gig**.',
            'In card **1 Event**, pick the event type and fill in the title and client.',
            'In card **2 Date & time**, tap a day in the month and set **Start time** and **End time**. The free count shows under the month.',
            'In card **3 Venue**, search the venue.',
            'In card **4 Lineup**, pick a preset or tick musicians and check their fees.',
            'In card **5 Fee**, choose **Fixed** or **TBD**. The card shows **Musicians {amount}** and **Band {amount}**.',
            'Add extras with the buttons under the cards: **Setlist**, **Rider & stage**, **Logistics** (call times, setting, guests, duration) and **Tasks**. Each opens a sheet; tap **Done** to close it.',
            'Check the **Live preview** (**As the band sees it**) and the checklist under it.',
            'Tap **Create gig**, or **Save draft** to finish later.',
          ],
        },
        { type: 'p', text: '**Create gig** needs an event type and a date. In landscape the cards and the preview sit side by side.' },
        { type: 'note', tone: 'tip', text: '**Rider & stage** lets you prepare the stage plot and the rider before the gig exists. They are saved with the gig when you create it. See [[rider-and-stage]].' },
      ],
    },
    {
      id: 'gig-drafts',
      title: 'Save and continue a gig draft',
      summary: 'Keep an unfinished gig as a private draft, pick it up later on any device, or delete it.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['draft', 'unfinished', 'save for later', 'continue editing', 'delete draft'],
      related: ['create-a-gig', 'calendar-overview'],
      body: [
        {
          type: 'steps',
          title: 'Save a draft',
          items: [
            'In the gig wizard, close it with the X (**Close gig wizard**), **Cancel** or Back after typing something.',
            'In **Save this gig as a draft?**, tap **Save draft**. **Discard** throws away what you typed, **Keep editing** goes back.',
          ],
        },
        {
          type: 'steps',
          title: 'Continue or delete a draft',
          items: [
            'Open it from **Drafts** on Home, from its day in the calendar (dashed and faded), or from the **DRAFTS** filter.',
            'The sheet shows what the draft holds and **Still a draft: only you can see it.**',
            'Tap **Continue editing** to reopen the wizard where you left it.',
            'Or tap **Delete draft**, then **Delete** to confirm.',
          ],
        },
        { type: 'note', tone: 'privacy', text: 'Drafts are yours alone. Members are not notified and the gig is not on their calendar until you create it.' },
        {
          type: 'list',
          title: 'Good to know',
          items: [
            'Drafts are kept on the device (they work offline) and sync to your other devices.',
            'A draft without a date sits under **Drafts** on Home only.',
            'If a save fails, the gig is kept as a draft automatically. Once the gig is created, its draft is removed.',
            'Reopening a draft and choosing **Delete draft** in the leave sheet removes it from Drafts too.',
          ],
        },
        { type: 'note', tone: 'warning', text: 'Deleting a draft can’t be undone. Nothing was sent to the band, so nobody else is affected.' },
      ],
    },
    {
      id: 'edit-a-gig',
      title: 'Edit a gig',
      summary: 'Change the lineup, fees, times, venue, setlist, tasks or notes of a gig, and what the band is told.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['edit gig', 'change time', 'change venue', 'add musician', 'remove musician', 'update gig'],
      related: ['gig-workspace', 'gig-notifications', 'gig-setlist', 'delete-a-gig'],
      body: [
        {
          type: 'steps',
          items: [
            'Open the gig and tap **EDIT** under the content. You can also tap **EDIT** next to **LINEUP**, **ADD MUSICIAN**, or the venue when it reads **TBD**.',
            'The edit view shows **Editing** and four sections. Open the one you need: **01 Event basics & client**, **02 Date, time & venue**, **03 Band & compensation** or **04 Setlist, tasks & notes**.',
            'Make your changes. A section with a missing venue, date, fee or lineup shows **Needs attention** and opens on its own.',
            'Tap **Save changes**. It needs a date.',
          ],
        },
        {
          type: 'list',
          title: 'In each section',
          items: [
            '**Event basics & client**: event type, client, title, **Guests** and **Setting**.',
            '**Date, time & venue**: **Venue name**, date, times and call times.',
            '**Band & compensation**: presets, roster and fees, **Fee to be discussed (TBD)**, extra band fee, **Duration** and the **Total estimate**.',
            '**Setlist, tasks & notes**: **Pick songs**, reorder songs (long-press and drag), rename or delete tasks, and **Notes for the band**.',
          ],
        },
        {
          type: 'list',
          title: 'What the band is told',
          items: [
            'New musicians get an invitation. Everyone already on the lineup keeps their answer.',
            'A new date, time, call time or venue sends the lineup one **Gig updated** notification listing what changed.',
            'A changed fee notifies only that musician.',
            'Setlist changes send the lineup one notification with what moved, was added or removed.',
          ],
        },
        { type: 'note', tone: 'tip', text: 'Closing with unsaved changes asks **Save your changes?**. Save to keep them, or discard them.' },
        { type: 'p', text: 'A quote opens the quote editor instead. See [[create-a-quote]]. A personal gig opens its own form ([[personal-gigs]]).' },
      ],
    },
    {
      id: 'delete-a-gig',
      title: 'Delete a gig',
      summary: 'Remove a gig from everyone’s calendar, and what goes with it.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['delete gig', 'cancel gig', 'remove gig', 'remove from archive'],
      related: ['edit-a-gig', 'gig-notifications', 'past-events'],
      body: [
        {
          type: 'steps',
          items: [
            'Open the gig and scroll to the bottom.',
            'Tap **DELETE** (for a past gig: **REMOVE FROM ARCHIVE**).',
            'Tap **Confirm delete**, or **CANCEL** to keep it.',
          ],
        },
        {
          type: 'list',
          title: 'What happens',
          items: [
            'The gig leaves every calendar and you see **Event deleted**.',
            'Everyone on the lineup who had not declined gets a **Gig cancelled** notification. Deputies you asked are told too.',
            'The gig’s own setlist is deleted with it, unless another event uses it. Your songs stay in the library.',
            'A quote that became this gig stays in Quotes as a record, without the link to the gig.',
          ],
        },
        { type: 'note', tone: 'warning', text: 'Deleting a gig can’t be undone. There is no separate "cancel" status in the app: deleting is how you call off a gig.' },
        { type: 'note', tone: 'tip', text: 'If the gig goes back to negotiation instead, use **REVERT TO QUOTE**: it leaves the musicians’ calendars but keeps their answers. See [[create-a-quote]].' },
        { type: 'p', text: 'Without a connection the delete fails with **No connection. Try again when you are online.** and the gig stays open.' },
      ],
    },

    // ───────────────────────────── Workspace ─────────────────────────────
    {
      id: 'gig-workspace',
      title: 'The gig workspace',
      summary: 'Everything on a gig’s screen, from the coloured header to the actions at the bottom.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['gig detail', 'event detail', 'gig screen', 'workspace', 'overview'],
      related: ['show-readiness', 'gig-setlist', 'rider-and-stage', 'fee-and-payouts-on-a-gig', 'what-members-see-on-a-gig', 'stage-mode', 'event-and-rehearsal-chats'],
      body: [
        { type: 'p', text: 'Tap a gig anywhere (calendar, Home, search, a notification) to open its workspace. The top is in the gig colour; the content sits on a sheet below.' },
        { type: 'shot', id: 'gig-workspace-admin', caption: 'A gig as the admin sees it: header, call times, readiness and fee.' },
        {
          type: 'list',
          title: 'The header',
          items: [
            'Back at the top left. **Open stage mode** (the play button) at the top right on upcoming band gigs; on the gig day it is filled. See [[stage-mode]].',
            'Chips: **GIG** (or **PAST GIG**), **CONFIRMED**, **INVITE PENDING** while your answer is open, the event type (**WEDDING**, **CLUB**…) and the band name.',
            'The title, the day in large dots, and the month.',
            'The venue (tap it or **MAP** to open maps), the address, and the date with start and end time.',
            'The weather for the date; on a past gig, **ATTENDANCE** with the number of members.',
          ],
        },
        {
          type: 'list',
          title: 'The sections, in order',
          items: [
            'Your answer card, if your invitation is still open: **Your RSVP** · **Are you in?** with **ACCEPT** and **DECLINE**. See [[answer-a-gig-invitation]].',
            'Time tiles: **LOAD IN**, **SOUNDCHECK** and **SHOW**.',
            '**SHOW READINESS** on upcoming gigs. See [[show-readiness]].',
            '**GEAR KIT**: the inventory kit going to this gig. See [[gear-kits]].',
            'The fee card: **Band fee** with **FEE & PAYOUTS** for admins, **Your fee** with **PAYOUT DETAILS** for members. See [[fee-and-payouts-on-a-gig]].',
            '**LINEUP · {confirmed}/{total}**: who plays and their answers. Tap it or **DETAILS** for the full list.',
            '**RIDER & STAGE** with **OPEN**. See [[rider-and-stage]].',
            '**SETLIST** with the song count. See [[gig-setlist]].',
            '**TASKS** with **{done} of {total} done**: tap a task to tick it.',
            '**CLIENT & NOTES** (admins) or **NOTES**: tap it or **DETAILS** for **Logistics & notes** (venue, copy address, client contacts, dress code, setting, guests and notes).',
            'The actions. Admins: **EDIT**, **EVENT CHAT**, **REVERT TO QUOTE** and **DELETE**. Members: **DROP OUT** and **EVENT CHAT**. See [[event-and-rehearsal-chats]].',
          ],
        },
        {
          type: 'list',
          title: 'A past gig',
          items: [
            'The header turns grey with **PAST GIG** and **COMPLETED**.',
            'The actions become **VIEW SETLIST** and **EVENT CHAT** (admins, and members who accepted). Admins also get **EDIT DETAILS** and **REMOVE FROM ARCHIVE**.',
            'Stage mode, readiness and the find-a-deputy button are gone.',
          ],
        },
        {
          type: 'devices',
          rows: [
            { devices: ['tablet'], text: 'Band gigs get tabs under the time tiles: **OVERVIEW**, **SETLIST**, **RIDER & STAGE** and, for admins, **MONEY**. On a wide window the overview is laid out in two columns. The gig opens beside the calendar.' },
            { devices: ['duoClosed'], text: 'Back and **Open stage mode** move into the rail. On the gig day Stage mode is the rail’s main action.' },
            { devices: ['duoBook', 'duoLand'], text: 'The gig opens on the right page. A sheet such as **Fee & payouts** opens on the right page while the gig moves to the left.' },
            { devices: ['duoLaptop'], text: 'The title and time tiles sit on the top half, the rest on the bottom half. Stage mode turns into a floor wedge.' },
          ],
        },
      ],
    },
    {
      id: 'show-readiness',
      title: 'Show readiness',
      summary: 'The checklist that tells you what is settled for a gig and what is still to do.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['readiness', 'checklist', 'ready', 'to do', 'what is missing'],
      related: ['gig-workspace', 'gig-on-home'],
      body: [
        { type: 'p', text: 'Upcoming band gigs show **SHOW READINESS · {done}/{total}** with one line per check. The first open item is marked **To do**, by urgency: time, venue, lineup, setlist, contract, deposit, rider, lyrics, then tasks. Home shows the same count under the next gig.' },
        {
          type: 'table',
          head: ['Check', 'Done when'],
          rows: [
            ['**Start time set** / **No start time yet**', 'The gig has a real start time. Listed only while missing.'],
            ['**Venue set** / **No venue yet**', 'The gig has a venue other than TBD. Listed only while missing.'],
            ['**Lineup · {done} of {total} confirmed**', 'Everyone who has not declined has confirmed.'],
            ['**Setlist · {count} songs**', 'The gig has at least one song.'],
            ['**Lyrics & charts · {done} of {total} songs**', 'Every setlist song has lyrics or a chord chart.'],
            ['**Rider v{version} · seen by the venue**', 'The venue has opened the rider link.'],
            ['**Contract signed**', 'The gig’s contract is signed (admins only).'],
            ['**Deposit paid**', 'The deposit is paid, when one is due (admins only).'],
            ['**To-dos · {done} of {total} done**', 'Every task is ticked. Listed only when the gig has tasks.'],
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Sees every check, including **Contract signed** and **Deposit paid**. Tapping a line opens the lineup, the setlist or the rider.' },
            { role: 'member', text: 'Sees the same checks without the contract and the deposit, which are the band’s business.' },
          ],
        },
        { type: 'p', text: 'Readiness appears once the lineup and the setlist have loaded, so it never flashes a wrong "no setlist".' },
      ],
    },
    {
      id: 'gig-setlist',
      title: 'Edit a gig’s setlist from the gig',
      summary: 'Reorder, add and remove songs right in the gig, then save once and notify the lineup.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['setlist', 'song order', 'reorder songs', 'add songs to gig', 'set flow'],
      related: ['build-a-setlist', 'gig-workspace', 'stage-mode'],
      body: [
        {
          type: 'steps',
          items: [
            'Open an upcoming band gig and scroll to **SETLIST**.',
            'Long-press a song and drag it to a new place. Tap the X on a song to remove it.',
            'Tap **Add songs** to pick from the library. With several sets you choose the set first.',
            'A bar shows **Unsaved changes**. Tap **Save**, or **Cancel** to undo.',
          ],
        },
        { type: 'p', text: 'Saving sends the lineup one notification that says what changed, such as "2 songs moved, 1 added". Leaving the gig with unsaved changes asks **Save the setlist changes?**.' },
        {
          type: 'list',
          title: 'What the section shows',
          items: [
            'Numbers that run across sets (01, 02…), title, artist, key, length, and **LYRICS** when a song has lyrics or a chart.',
            '**SET FLOW · ENERGY**: a dot column per song, as tall as the song is long, from **OPENER → ENCORE** (2 to 24 songs).',
            '**{duration} TOTAL** for the whole set.',
            'Tap the song count to open **Setlist · {count}** in a sheet.',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Edits the setlist here or through **EDIT**. With no setlist the sheet shows **No setlist assigned** and **Assign setlist**.' },
            { role: 'member', text: 'Sees the setlist read-only. Without one: **The band admin has not attached a setlist yet.**' },
          ],
        },
        { type: 'note', tone: 'tip', text: 'The setlist is kept on the phone. In a venue with no signal Stage mode still has the songs. If it was never loaded, the section says so.' },
        { type: 'p', text: 'For building setlists from scratch, sets and templates, see [[build-a-setlist]].' },
      ],
    },
    {
      id: 'rider-and-stage',
      title: 'Rider and stage plot',
      summary: 'Prepare the technical rider, stage plot, input list and who brings what, and share them with the venue.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['rider', 'technical rider', 'stage plot', 'input list', 'channels', 'backline', 'venue link', 'who brings what'],
      related: ['gig-workspace', 'create-a-gig-on-ipad', 'show-readiness', 'contracts-and-docs'],
      body: [
        { type: 'p', text: 'Every band gig has a **RIDER & STAGE** section. Tap **OPEN** to see the rider, the stage plot, the input list and who brings what.' },
        {
          type: 'steps',
          title: 'Set it up (admins)',
          items: [
            'Open the gig and tap **OPEN** next to **RIDER & STAGE**.',
            'Under **Technical rider**, tap **CREATE RIDER** if the gig has none.',
            'Under **Stage plot**, tap **EDIT** to place musicians, wedges, speakers and DI boxes. Drag to move; tap an item to rename or remove it. Set **Layout name**, **Stage width (m)** and **Stage depth (m)**, then **SAVE PLOT**. **+ NEW LAYOUT** and **DELETE LAYOUT** manage several layouts.',
            'Under **Input list**, tap **EDIT LIST**. **ADD CHANNEL**, fill in **SOURCE**, **MIC / DI** and **Who**, drag to reorder, then **SAVE LIST**.',
            'Under **Who brings what**, check the list suggested from the lineup, write **BAND BRINGS** and **VENUE PROVIDES** (one per line), tick **The venue agreed to this** when it is settled, and tap **SAVE**.',
          ],
        },
        {
          type: 'steps',
          title: 'Send it to the venue',
          items: [
            'Tap **SHARE LINK WITH THE VENUE** (or **Share rider link**) and send it the usual way.',
            'Or tap **PDF** / **Share rider PDF** for a file.',
            'The rider shows **SENT TO THE VENUE {date}** and, once the venue opens the link, **OPENED {date}**. Readiness turns to **Rider v{version} · seen by the venue**.',
          ],
        },
        {
          type: 'list',
          title: 'The venue’s page',
          items: [
            'The venue opens the link in a browser, with no account.',
            'It shows the rider, the gig’s times and venue, the stage plot, the input list and who brings what, in the venue’s language when available.',
            'It never shows the client or any fee.',
            'Opening it marks the rider as seen for the band. The band checking its own link (preview) does not.',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Creates and edits everything and shares the link. Editing the stage plot itself is on iPad; on a phone the plot is shown and the screen says **STAGE PLOT EDITING IS ON IPAD**.' },
            { role: 'member', text: 'Sees the rider, plot, input list and who brings what read-only, and can **Share rider PDF**. Before anything is set up: **The band hasn’t set up the stage for this gig yet.**' },
          ],
        },
        {
          type: 'devices',
          rows: [
            { devices: ['tablet'], text: 'Rider & stage is its own tab in the gig, laid out as a board, and the stage plot can be edited there. In the composer it can be prepared before the gig is created.' },
          ],
        },
      ],
    },
    {
      id: 'fee-and-payouts-on-a-gig',
      title: 'Fee and payouts on a gig',
      summary: 'See the band fee and what each musician is owed, and mark musicians as paid after the show.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['payout', 'pay musicians', 'mark paid', 'band fund', 'deposit', 'my fee', 'payment'],
      related: ['payouts-due', 'gig-lineup-and-fees', 'gig-on-home', 'what-members-see-on-a-gig'],
      body: [
        {
          type: 'steps',
          title: 'Pay the musicians (admins)',
          items: [
            'Open the gig and tap **FEE & PAYOUTS** on the fee card. (On iPad, open the **MONEY** tab.)',
            'The sheet, marked **Admin only**, shows the **Band fee**, **PAYOUTS DUE · {count}** with the amount still owed, and **MUSICIANS · {paid} OF {total} PAID**.',
            'Tap the round switch next to a musician (**{name} paid**) to mark them paid or not paid.',
            'Or tap **MARK ALL AS PAID** to mark everyone at once.',
            'Tap the pencil (**Edit fee**) to change fees in the edit view.',
          ],
        },
        {
          type: 'list',
          title: 'What the fee card shows',
          items: [
            'Admins: the **Band fee**, **Musician payouts ({count})**, the **Band fund** (what stays with the band) and the **Deposit** with its share and **paid**. Tags: **DEPOSIT DUE** and **To be discussed** (Fee TBD).',
            'Members: **Your fee**, and **PAYOUT DETAILS**, which opens **Your assigned fee** with a paid or not paid badge.',
          ],
        },
        {
          type: 'list',
          title: 'Payouts due on Home',
          items: [
            'After a band gig that took place, every confirmed musician with a fee above zero and not marked paid is due. Pending and declined musicians are not owed anything.',
            'Shows that end after midnight count once they are really over.',
            'Admins see **Payouts due** on Home with **Review payouts**, which opens the gig on this sheet. Members see **Your payout** with **View payout**.',
          ],
        },
        { type: 'note', tone: 'privacy', text: 'A member only ever sees their own fee and payout. The band fee, other musicians’ fees, the band fund and the deposit are for admins.' },
        { type: 'note', tone: 'tip', text: 'Payouts are the band paying its musicians. The client paying the band, invoices and the ledger are in [[payouts-due]].' },
      ],
    },

    // ───────────────────────────── Members & deputies ─────────────────────────────
    {
      id: 'answer-a-gig-invitation',
      title: 'Answer a gig invitation',
      summary: 'Accept or decline a gig, see your fee and who else is playing, and check for clashes.',
      roles: ['member', 'admin'],
      kind: 'task',
      keywords: ['rsvp', 'accept gig', 'decline gig', 'invitation', 'are you in', 'maybe', 'availability'],
      related: ['drop-out-of-a-gig', 'gig-notifications', 'free-slots-and-conflicts', 'what-members-see-on-a-gig'],
      body: [
        { type: 'p', text: 'When an admin adds you to a gig you get a **Gig invitation** notification. You can answer from the inbox, from the RSVP sheet or from the gig itself.' },
        {
          type: 'steps',
          title: 'From the gig',
          items: [
            'Open the gig from the notification or the calendar. The header shows **INVITE PENDING**.',
            'In **Your RSVP** · **Are you in?**, tap **ACCEPT** or **DECLINE**.',
          ],
        },
        {
          type: 'steps',
          title: 'From the inbox',
          items: [
            'Open the bell and tap the **Gig invitation**.',
            'Check **Invitation details**: date, **Timings**, venue and **Allocated fee** (your own fee).',
            'Check **Schedule conflict**, or **No schedule conflicts in your calendar**.',
            'Tap **Accept event** or **Decline**. **Add to Google Calendar** adds the date to your calendar.',
          ],
        },
        {
          type: 'steps',
          title: 'From the RSVP sheet',
          items: [
            'In **Can you make it?**, check the date, time, **Timings**, venue and **Your fee**.',
            'Look at **Lineup so far · {count} of {total} in**: who else plays, with their instrument and answer.',
            'Choose **GOING**, **MAYBE — I’LL CONFIRM LATER** or **CAN’T MAKE IT**.',
            'Add a **Note for the band (optional)** and tap **Send RSVP**.',
          ],
        },
        {
          type: 'list',
          title: 'What happens',
          items: [
            'Accepting shows **You’re confirmed!** and tells the gig’s creator.',
            'Declining shows **You dropped out of this event.**, tells every admin of the band that a replacement is needed, and removes the gig from your calendar.',
            '**Maybe** keeps the gig on your calendar with your answer marked as maybe.',
          ],
        },
        { type: 'note', tone: 'privacy', text: 'The invitation shows only your own fee, or **to be discussed**. The lineup list shows names, instruments and answers, never anyone’s fee.' },
        { type: 'p', text: 'A quote can also ask you about a date: **Availability check** · **Are you free?** with **I’M FREE** and **NOT FREE**. Your answer is only about the date: you get the gig when the admin confirms it.' },
      ],
    },
    {
      id: 'drop-out-of-a-gig',
      title: 'Drop out of a gig',
      summary: 'Leave a gig you already accepted, and what the admins are told.',
      roles: ['member'],
      kind: 'task',
      keywords: ['drop out', 'cancel my spot', 'can’t make it', 'leave gig'],
      related: ['answer-a-gig-invitation', 'find-a-deputy'],
      body: [
        {
          type: 'steps',
          items: [
            'Open the gig.',
            'At the bottom, tap **DROP OUT**.',
            'At **Drop out?**, tap **Confirm drop**, or **CANCEL** to stay.',
          ],
        },
        { type: 'p', text: 'You see **You dropped out of this event.** The gig leaves your calendar. Every active admin of the band, and the gig’s creator, get a notification that you dropped out and a replacement is needed.' },
        { type: 'note', tone: 'warning', text: 'You can’t undo a drop out yourself. To play after all, ask an admin to add you to the lineup again.' },
        { type: 'p', text: '**DROP OUT** is greyed out until your own answer has loaded. On a weak connection you see **Could not load your answer. Check your connection.**' },
      ],
    },
    {
      id: 'find-a-deputy',
      title: 'Find a deputy for a gig',
      summary: 'Replace a musician who said no with one of the band’s deputies, and follow their answers.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['deputy', 'dep', 'substitute', 'replacement', 'sub', 'stand-in'],
      related: ['deputies-on-a-gig', 'deputies', 'drop-out-of-a-gig'],
      body: [
        {
          type: 'steps',
          items: [
            'Open the gig and tap **LINEUP** (or **DETAILS**) to open **Lineup · {count}**.',
            'Next to a musician marked declined, tap **Find a deputy**.',
            'The sheet **Replacing {name}** lists the band’s deputies, the same instrument first, with their usual fee.',
            'For a deputy on BandWith, tap **Ask in the app**: they get a notification.',
            'For anyone else, send the request by message (WhatsApp, Messages or Mail, with the details filled in) or **Copy link**. The deputy answers in one tap, with no app needed, and you get a notification.',
          ],
        },
        {
          type: 'list',
          title: 'Follow the answers',
          items: [
            'Under **Deputies asked** in the lineup sheet: each deputy, who they replace, and **Asked · no answer yet**, **Available**, **Will confirm later** or **Can’t make it**.',
            'If the gig changes after a deputy answered, the line says **Changed after their answer · send the update**. Open it and send **Send update** (or **Update in the app**).',
            'After a yes you can send a recap (**Send recap** / **Recap in the app**).',
            '**Cancel request** withdraws a request.',
          ],
        },
        { type: 'p', text: '**Find a deputy** is offered on upcoming band gigs only. With no deputies yet, the sheet says **No deputies yet. Add them in Band members → Deputies.** See [[deputies]].' },
      ],
    },
    {
      id: 'deputies-on-a-gig',
      title: 'What a deputy sees',
      summary: 'How a deputy gets asked, what they see about the gig, and how they answer.',
      roles: ['deputy', 'admin'],
      kind: 'reference',
      keywords: ['deputy view', 'deputy gigs', 'fee offered', 'subscribe calendar', 'webcal'],
      related: ['find-a-deputy', 'deputies', 'what-members-see-on-a-gig'],
      body: [
        { type: 'p', text: 'A deputy is not a band member. They never open the gig workspace. They see the request: from the link in a message, or in the app under **Deputy gigs** if their account is linked to the band.' },
        {
          type: 'list',
          title: 'What the request shows',
          items: [
            'The band and the gig title.',
            '**Date**, **Load-in**, **Soundcheck**, **Show** (start and end), **Venue**, **City** and **Address**.',
            'Their **Role** and the **Fee offered** to them.',
            'Buttons: **Open in Maps**, **Add to calendar**, **Google Calendar** and **Subscribe to my gigs** (a calendar feed of all their deputy gigs).',
          ],
        },
        {
          type: 'list',
          title: 'Answering',
          items: [
            'In **Can you make it?** the deputy taps **Yes**, **Not sure yet** or **No, I can’t**, with an optional **Message to the band**.',
            'The status then reads **You said yes**, **You’ll confirm later** or **You said you can’t**. **Change your answer** lets them change it.',
            'If the band changes the date, times or venue afterwards, the request shows **Something changed** with the old and new values, and asks **Still OK**.',
            'A deleted gig shows **Gig cancelled**; a withdrawn request **Request withdrawn**; a finished gig **Gig over**.',
          ],
        },
        { type: 'note', tone: 'privacy', text: 'A deputy sees only their own fee and the logistics. They never see the client, the band fee, other musicians’ fees or the band’s finances.' },
      ],
    },
    {
      id: 'what-members-see-on-a-gig',
      title: 'What admins, members and deputies see on a gig',
      summary: 'The privacy rules of a gig, field by field.',
      roles: ['admin', 'member', 'deputy'],
      kind: 'reference',
      keywords: ['privacy', 'permissions', 'who sees', 'fees private', 'member view', 'roles'],
      related: ['gig-workspace', 'fee-and-payouts-on-a-gig', 'deputies-on-a-gig', 'personal-gigs'],
      body: [
        { type: 'p', text: 'Members and deputies see only their own fee and the logistics. The rules are enforced by the server, not only hidden in the app: a member’s phone never receives the band fee, the client or other people’s fees.' },
        { type: 'shot', id: 'gig-workspace-member', caption: 'The same gig as a member sees it: Your fee, no client, no band money.' },
        {
          type: 'table',
          head: ['On a band gig', 'Admin', 'Member'],
          rows: [
            ['Title, date, times, call times, venue, address', 'Yes', 'Yes'],
            ['Band notes, dress code, setting, guests', 'Yes', 'Yes'],
            ['Client name, phone, email, company', 'Yes', 'No'],
            ['Band fee, extra band fee, band fund, deposit, payment status', 'Yes', 'No'],
            ['Each musician’s fee and paid status', 'Everyone’s', 'Own only'],
            ['Lineup names, instruments and answers', 'Yes', 'Yes'],
            ['Setlist', 'Edit', 'Read'],
            ['Rider, stage plot, input list, who brings what', 'Edit', 'Read'],
            ['Gear kit', 'Pick and change', 'Read'],
            ['Tasks', 'Add, rename, delete, tick', 'Tick'],
            ['Contract and deposit in readiness', 'Yes', 'No'],
            ['Find a deputy, deputies asked', 'Yes', 'No'],
            ['Edit, delete, revert to quote', 'Yes', 'No'],
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Sees every event of the band, and every field above. In a band where you are only a member, you see that band’s gigs as a member.' },
            { role: 'member', text: 'Sees only the gigs they are on and have not declined. Never sees quotes: a quote only reaches you as an availability check, and becomes a gig on your calendar when the admin confirms it.' },
            { role: 'deputy', text: 'Sees only their request: logistics, their role and the fee offered. See [[deputies-on-a-gig]].' },
          ],
        },
        { type: 'p', text: 'On a band member’s page, **Next for {name}** lists their next few events with the day, start, part and answer: logistics only, never a fee or client.' },
      ],
    },
    {
      id: 'personal-gigs',
      title: 'Log a personal gig',
      summary: 'Add an outside gig that only you can see, block the date for your bands and track what you earn.',
      roles: ['member', 'admin'],
      kind: 'task',
      keywords: ['personal gig', 'outside gig', 'solo gig', 'private event', 'earnings', 'side gig'],
      related: ['free-slots-and-conflicts', 'past-events', 'filter-the-calendar'],
      body: [
        {
          type: 'steps',
          items: [
            'Tap **Create** and pick **Add personal gig** (members) or **Log personal gig** (admins).',
            'Fill in **Gig title ***, **Date ***, **Start *** and **End ***.',
            'Optionally add **Venue / location (optional)**, **My personal fee (optional)** and **Personal notes (optional)**.',
            'Tap **Create personal gig**.',
          ],
        },
        { type: 'note', tone: 'privacy', text: 'Only you can see it. Your bands only see you as busy on that date, in the availability counts. The title, venue, fee and notes stay yours.' },
        {
          type: 'list',
          title: 'On the personal gig',
          items: [
            'Pink header with **PERSONAL** and **ONLY YOU**, and tiles **CALL**, **START** and **END**.',
            'If a band gig or rehearsal falls on the same date, **SCHEDULE CONFLICT** appears. Tap **NOTIFY {band} ADMIN** to warn that band’s admins; it then reads **ADMIN NOTIFIED**.',
            '**EARNINGS**: **My fee** and a **Paid** switch. Your fees count in **Earned** in the past events archive.',
            '**EDIT** and **DELETE** (then **Confirm delete**).',
          ],
        },
        { type: 'p', text: 'Personal gigs have no lineup, setlist, rider or chat. To play it with bandmates, the form offers **Create a free band**.' },
      ],
    },
    {
      id: 'past-events',
      title: 'Past events archive',
      summary: 'Look back at past gigs and rehearsals, what you played this year and what you earned.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['past gigs', 'archive', 'history', 'earned', 'played', 'unpaid'],
      related: ['calendar-overview', 'fee-and-payouts-on-a-gig', 'payouts-due'],
      body: [
        {
          type: 'steps',
          items: [
            'On **Calendar**, tap **Past events archive** at the bottom (or **See all** next to **Upcoming**).',
            'Read the two metrics at the top: **Played in {year}** and **Earned**.',
            'Filter with **All**, **Paid** or **Unpaid**.',
            'Tap an event to open it.',
          ],
        },
        { type: 'p', text: 'Events are grouped by month, most recent first. Each row shows the date, title, place and a status: for gigs **Client paid** or **Client unpaid** (admins) and **Paid to you** or **Not paid yet** (members); **Rehearsal**, **Quote** or **Draft** for the rest. The filters above the list use the same words.' },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: '**Earned** adds up the band fees of the year’s gigs. **Client paid** and **Client unpaid** follow whether the client has paid the band.' },
            { role: 'member', text: '**Earned** adds up your own fees. **Paid to you** and **Not paid yet** follow whether your own fee was marked paid. Quotes never appear.' },
          ],
        },
        { type: 'p', text: 'A gig becomes past when its day is over, or, for a show that ends after midnight, when the show ends.' },
      ],
    },
    {
      id: 'gig-on-home',
      title: 'Gigs on Home',
      summary: 'The next gig, readiness, Go live, payouts due and drafts on the Home screen.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['home', 'next gig', 'go live', 'payouts due', 'drafts', 'dashboard'],
      related: ['show-readiness', 'fee-and-payouts-on-a-gig', 'gig-drafts', 'stage-mode'],
      body: [
        {
          type: 'list',
          items: [
            'The next gig card shows its date, call times (load-in, soundcheck), venue, the setlist link and, for members, **Your fee**.',
            'Under it: **Show readiness · {done}/{total}** and **Go live**, which opens the gig straight in Stage mode.',
            '**Action center** lists **Payouts ({count})** for admins or **Your payouts ({count})** for members. See [[fee-and-payouts-on-a-gig]].',
            '**Drafts** (admins): your unfinished gigs, rehearsals and quotes. **Only you can see these.**',
          ],
        },
        {
          type: 'devices',
          rows: [
            { devices: ['tablet', 'duoBook', 'duoLand'], text: 'With two panes, Home opens the next upcoming event (not a draft or a quote) beside the dashboard, once per visit. If you close it, it stays closed until you leave Home and come back. Folding the device or switching apps does not reopen it.' },
          ],
        },
      ],
    },
    {
      id: 'gig-notifications',
      title: 'Notifications a gig sends',
      summary: 'Who is told what when a gig is created, answered, changed or deleted.',
      roles: ['admin', 'member', 'deputy'],
      kind: 'reference',
      keywords: ['notifications', 'push', 'alerts', 'who gets notified', 'invite', 'cancelled', 'updated'],
      related: ['create-a-gig', 'edit-a-gig', 'delete-a-gig', 'answer-a-gig-invitation', 'notifications-inbox'],
      body: [
        { type: 'p', text: 'Notifications land in the inbox (the bell) in each person’s own language. The ones that ask you to do something or change your plans also arrive as a push. You never get a notification for your own action.' },
        {
          type: 'table',
          head: ['When', 'Who gets it', 'What it says'],
          rows: [
            ['A gig is created', 'Each musician on the lineup', 'A gig invitation with date, time, venue and their own fee, or "fee to be discussed". Push.'],
            ['A gig is created', 'The admin who created it', 'The gig is waiting for {count} members to confirm. Inbox.'],
            ['A musician is added while editing', 'That musician', 'A gig invitation. Push.'],
            ['A musician accepts', 'The gig’s creator', 'Gig confirmed by that musician.'],
            ['A musician declines or drops out', 'Every active admin of the band and the creator', 'They dropped out; a replacement is needed. Push.'],
            ['Date, times, call times or venue change', 'Everyone on the lineup who has not declined', '"Gig updated" with what is new. Push.'],
            ['A musician’s fee changes', 'That musician only', 'Their fee changed. Push.'],
            ['The setlist is saved with changes', 'The gig’s lineup', 'One summary, such as "2 songs moved, 1 added".'],
            ['A quote is confirmed as a gig', 'The lineup', '"Gig confirmed". Inbox.'],
            ['The gig is deleted', 'Everyone on the lineup who has not declined, and deputies asked', '"Gig cancelled". Push.'],
            ['A personal gig clashes and you tap NOTIFY', 'The admins of that band', '"Schedule conflict": you are booked elsewhere.'],
          ],
        },
        { type: 'note', tone: 'privacy', text: 'Fees in notifications are always the recipient’s own. Drafts never notify anyone.' },
        { type: 'p', text: 'To choose which notifications reach you, see [[notifications-inbox]].' },
      ],
    },
    {
      id: 'live-updates-and-offline',
      title: 'Live updates and working offline',
      summary: 'How a gig stays up to date while it is open, and what works without a connection.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['offline', 'sync', 'no signal', 'live', 'refresh', 'realtime'],
      related: ['gig-workspace', 'gig-setlist', 'create-a-gig'],
      body: [
        {
          type: 'list',
          title: 'Live while open',
          items: [
            'When someone changes the lineup, the tasks or the setlist, the open gig reloads that part at once.',
            'When someone saves the gig itself, the open gig takes the new values. Your own unsaved setlist edits are kept.',
            'Payouts marked paid update Home straight away.',
          ],
        },
        {
          type: 'list',
          title: 'Offline',
          items: [
            'Creating or editing a gig offline saves it on the device with **Saved offline • Will sync when connected**. Its card shows **Sync** until it reaches the server, together with its setlist, tasks, lineup and rider.',
            'Gig drafts are kept on the device and work offline.',
            'The setlist of a gig you opened before is kept on the phone, so Stage mode works at a venue with no signal.',
            'Deleting a gig needs a connection.',
          ],
        },
      ],
    },
    {
      id: 'calendar-on-tablet-and-duo',
      title: 'The calendar on iPad and dual-screen devices',
      summary: 'Two panes on iPad, and the Planner, pages and rail on dual-screen phones.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['ipad', 'tablet', 'surface duo', 'dual screen', 'laptop pose', 'planner', 'rail', 'fold'],
      related: ['calendar-overview', 'gig-workspace', 'create-a-gig-on-ipad'],
      body: [
        {
          type: 'devices',
          rows: [
            { devices: ['tablet'], text: 'The calendar and the open event sit side by side; the open event is outlined in the list. Gigs get the **OVERVIEW / SETLIST / RIDER & STAGE / MONEY** tabs. **New gig** opens the composer.' },
            { devices: ['duoLaptop'], text: 'The calendar turns into the Planner. Top half: the month with a dot per kind of event and the counts **Gigs**, **Rehearsals**, **Fees** (admins only) and **Free weekends**. Bottom half: the filters, the selected day’s **Agenda** with **Previous day** and **Next day**, and **+ Gig** / **+ Rehearsal** for admins. Days with nothing read **Nothing on this day.**' },
            { devices: ['duoBook', 'duoLand'], text: 'The calendar is on the left page and the event you open on the right page. Search keeps its results on the left. In the gig wizard the left page shows a live preview on step 1.' },
            { devices: ['duoClosed'], text: 'Back, **Search**, **Close gig wizard**, **Open stage mode** and **More options** live in the side rail instead of each screen.' },
          ],
        },
        { type: 'note', tone: 'tip', text: 'Every screen fits every posture. If a sheet opens over a gig on an open device, the gig moves to the left page and the sheet takes the right page.' },
      ],
    },
  ],

  faq: [
    { q: 'Why can’t I create a gig?', a: 'Only band admins create gigs. As a member you can log a personal gig or propose a rehearsal from **Create**.', roles: ['member'] },
    { q: 'Can members see what the band is paid?', a: 'No. Members see only their own fee. The band fee, client, deposit and other musicians’ fees never reach their app.', roles: ['admin', 'member'] },
    { q: 'Why did a gig disappear from my calendar?', a: 'You declined it or dropped out, an admin removed you from the lineup, or the gig was deleted. A gig turned back into a quote also leaves members’ calendars.', roles: ['member'] },
    { q: 'My show ends at 2 am. Will it show as past at midnight?', a: 'No. A gig whose end time is earlier than its start runs past midnight and stays upcoming until the show ends.' },
    { q: 'How do I confirm the date before the fee is agreed?', a: 'Turn on **Fee to be discussed (TBD)** in the wizard. The gig is confirmed and invitations say the fee is to be discussed. Set the fees later with **EDIT**.', roles: ['admin'] },
    { q: 'Can I duplicate a gig?', a: 'Not at the moment. Create a new gig and load the same setlist from **Load from templates** and the same tasks from **Load a to-do list**.', roles: ['admin'] },
    { q: 'How do I cancel a gig?', a: 'Delete it: open the gig, tap **DELETE**, then **Confirm delete**. The lineup gets a cancellation. If it is going back to negotiation, use **REVERT TO QUOTE** instead.', roles: ['admin'] },
    { q: 'Does my band see my personal gigs?', a: 'No. They only see that you are busy that day in the availability counts.' },
    { q: 'Who sees my gig drafts?', a: 'Only you. Drafts follow you to your other devices but nobody else gets them until you create the gig.', roles: ['admin'] },
    { q: 'A musician said no. How do I replace them?', a: 'Open **LINEUP**, tap **Find a deputy** next to them and ask one of the band’s deputies.', roles: ['admin'] },
    { q: 'Can I add my band gigs to my phone calendar?', a: 'From a gig invitation tap **Add to Google Calendar**. Deputies can also **Subscribe to my gigs** for a live calendar feed.' },
    { q: 'Can I edit the stage plot on my phone?', a: 'No, stage plot editing is on iPad. On a phone you can see the plot and edit the input list and who brings what.', roles: ['admin'] },
  ],

  glossary: [
    { term: 'Gig workspace', definition: 'The screen of a single gig, with its times, readiness, lineup, setlist, rider, money and actions.', see: 'gig-workspace' },
    { term: 'Lineup', definition: 'The musicians an admin added to a gig, each with an answer: confirmed, maybe, pending or declined.', see: 'gig-lineup-and-fees' },
    { term: 'Band fee', definition: 'What the band charges for the gig: the musicians’ fees plus any extra band fee. Admins only.', see: 'gig-lineup-and-fees' },
    { term: 'Band fund', definition: 'The part of the band fee that is not paid out to musicians and stays with the band.', see: 'fee-and-payouts-on-a-gig' },
    { term: 'Payout', definition: 'What the band owes a musician for a gig. It is due once the gig is over, until an admin marks it paid.', see: 'fee-and-payouts-on-a-gig' },
    { term: 'Fee TBD', definition: 'A confirmed gig whose money is still being agreed. Fees are set later.', see: 'gig-lineup-and-fees' },
    { term: 'Call times', definition: 'Load-in and soundcheck: when the band has to be at the venue before the show.', see: 'gig-times-and-venue' },
    { term: 'Show readiness', definition: 'The checklist of what is settled for a gig and what is still to do.', see: 'show-readiness' },
    { term: 'Technical rider', definition: 'The document that tells the venue what the band needs on stage. Shared by link or PDF.', see: 'rider-and-stage' },
    { term: 'Stage plot', definition: 'A drawing of the stage with musicians, wedges, speakers and DI boxes.', see: 'rider-and-stage' },
    { term: 'Input list', definition: 'The numbered list of channels for the sound engineer: source, mic or DI, and who plays it.', see: 'rider-and-stage' },
    { term: 'Deputy', definition: 'A musician outside the band who can stand in for a member on a gig.', see: 'find-a-deputy' },
    { term: 'Personal gig', definition: 'An outside gig only you can see. It blocks the date for your bands without showing any details.', see: 'personal-gigs' },
    { term: 'Draft', definition: 'An unfinished gig saved from the wizard. Only its author sees it.', see: 'gig-drafts' },
    { term: 'Availability check', definition: 'A question about a date sent with a quote. Answering is not accepting a gig.', see: 'answer-a-gig-invitation' },
    { term: 'Free-slot counts', definition: 'How many band members have nothing else on a day or time, shown as a colour and "4 of 5 free".', see: 'free-slots-and-conflicts' },
    { term: 'Planner', definition: 'The calendar on a dual-screen device in laptop posture: the month on top, the day’s agenda below.', see: 'calendar-on-tablet-and-duo' },
  ],

  shots: [
    {
      id: 'calendar-month',
      how: 'Open the web demo. Tap **Calendar** in the bottom bar. Leave the filter on **ALL** and scroll so the type filters, the month grid, the legend and the first upcoming card (Rooftop Session) are in view.',
      role: 'admin',
      viewport: 'phone',
    },
    {
      id: 'gig-wizard-step1',
      how: 'Open the web demo. Tap **Create** (the + in the bottom bar), then **New gig**. Type "Client A" in **Client / promoter**, pick **Wedding**, tap **Full band**, and keep the roster open so the fees show.',
      role: 'admin',
      viewport: 'phone',
    },
    {
      id: 'gig-workspace-admin',
      how: 'Open the web demo. Tap **Calendar**, then the **Client A — Wedding** card under **Upcoming**. Capture the header, the time tiles, **SHOW READINESS** and the fee card.',
      role: 'admin',
      viewport: 'phone',
    },
    {
      id: 'gig-workspace-member',
      how: 'In src/lib/demo/seed.ts set Leo M.’s band member row (u: IDS.me) to role \'member\', then open the web demo. Tap **Calendar**, then **Client A — Wedding**. Capture the fee card (**Your fee**), the lineup and **NOTES**.',
      role: 'member',
      viewport: 'phone',
    },
    {
      id: 'ipad-gig-composer',
      how: 'Open the web demo at tablet size (1180×820, landscape). Tap **Create**, then **New gig**. Pick **Club**, tap a day next week in card **2 Date & time**, search a venue, tap **Full band**.',
      role: 'admin',
      viewport: 'tablet',
    },
  ],
};

export default gigs;
