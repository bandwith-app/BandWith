import type { AreaModule } from './types';

/**
 * Area "together": rehearsals, rehearsal proposals and availability polls,
 * band / event / direct chat, and the notifications they send.
 * Source of truth: src/app/components/rehearsal/**, src/lib/services/rehearsalPolls.ts,
 * src/app/views/ChatView.tsx, src/app/components/chat/**, src/lib/services/chats.ts,
 * supabase/migrations 038, 058, 068, 073, 097, 098, 102, 104.
 */
const together: AreaModule = {
  area: {
    id: 'together',
    title: 'Rehearsals, polls & chat',
    intro: 'Schedule rehearsals, find a date the whole band can make, and talk to each other in band, event and direct chats.',
    icon: 'chat',
  },

  articles: [
    // ───────────────────────────── Rehearsals ─────────────────────────────
    {
      id: 'create-a-rehearsal',
      title: 'Create a rehearsal',
      summary: 'Schedule a rehearsal directly: who comes, when, where, what it costs and what to work on.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['new rehearsal', 'schedule rehearsal', 'practice', 'band practice', 'session'],
      related: ['rehearsal-songs-and-prep-tasks', 'create-a-rehearsal-poll', 'propose-a-rehearsal', 'recurring-rehearsals', 'rehearsal-drafts'],
      body: [
        {
          type: 'p',
          text: 'Admins schedule a rehearsal directly when they already know the date. If you first want to find out when people are free, run an availability poll instead: see [[create-a-rehearsal-poll]].',
        },
        {
          type: 'steps',
          title: 'On a phone',
          items: [
            'Tap **Create** (the + button in the bottom bar) and choose **New rehearsal**. You can also open the **Calendar**, tap an empty day and choose **Rehearsal**.',
            'Leave **Scheduling mode** on **Schedule directly**.',
            'Optionally type a **Rehearsal title (optional)**. Without one, the rehearsal is named after its session type, for example "Full Band Rehearsal".',
            'Pick a **Session type**: **Full Band**, **Vocals**, **Rhythm**, **Acoustic** or **Other**. Vocals, Rhythm and Acoustic preselect the members whose instrument matches; Other opens the full roster.',
            'Check the **Band roster**. Tap a member to add or remove them, or tap **Select all**. Tap **Next**.',
            'Under **Search venue or studio…** type the place, or tap a quick choice such as **Band HQ**, **Studio A**, **Home Studio** or **TBD**.',
            'Set the **Rehearsal date**, **Start time** and **End time**.',
            'Choose a **Recurrence**: **One time**, **Weekly**, **Biweekly** or **Monthly**.',
            'Under **Venue cost** choose **Free** or **Paid**. For a paid room, enter the **Total studio cost**: the card shows the amount **Per person**. Tap **Next**.',
            'On **REVIEW & CONFIRM**, check the summary. Tap **Session & roster** or **Date & studio** to go back and change something.',
            'Optionally add songs and prep tasks (see [[rehearsal-songs-and-prep-tasks]]).',
            'Tap **Create rehearsal**.',
          ],
        },
        {
          type: 'note',
          tone: 'tip',
          text: '**Next** on the second step stays disabled until the rehearsal has a place and a date. Pick **TBD** if you have not booked a room yet.',
        },
        {
          type: 'note',
          tone: 'tip',
          text: 'Without a connection the rehearsal is kept on your device ("Saved offline • Will sync when connected") and sent when you are back online.',
        },
        {
          type: 'p',
          text: 'Every member on the roster gets a "New Rehearsal" notification and a push, and the rehearsal appears in their calendar with an **Are you coming?** card (see [[answer-a-rehearsal-invite]]). You are marked as going.',
        },
        {
          type: 'devices',
          rows: [
            {
              devices: ['tablet'],
              text: 'On an iPad the wizard is one screen with four cards: **Session**, **Date & time**, **Place & cost** and **Focus, note & tasks**, plus a **Live preview** "As the band sees it". The date strip shows **Next 7 days** with how many members are free each day **From band calendars**. You can also write a **Goal / notes (optional)** for the band. Tap **Schedule rehearsal** when the card counter is complete.',
            },
            {
              devices: ['duoClosed', 'duoBook', 'duoLaptop', 'duoLand'],
              text: 'On iPhone Duo the phone wizard is used. Close and back controls move to the side rail when the rail is shown.',
            },
          ],
        },
        { type: 'shot', id: 'shot-rehearsal-wizard', caption: 'The rehearsal wizard, step 1: session type and roster.' },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Creates, edits and deletes rehearsals.' },
            { role: 'member', text: 'Cannot create a rehearsal. The same **Create** menu shows **Propose rehearsal** instead: see [[propose-a-rehearsal]].' },
            { role: 'deputy', text: 'Deputies are not band members and never see the rehearsal wizard.' },
          ],
        },
      ],
    },
    {
      id: 'rehearsal-songs-and-prep-tasks',
      title: 'Add songs and prep tasks to a rehearsal',
      summary: 'Pick the songs to work on and the things people should prepare before the rehearsal.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['focus songs', 'rehearsal setlist', 'tasks', 'to do', 'prepare', 'bring'],
      related: ['create-a-rehearsal', 'edit-a-rehearsal', 'the-rehearsal-page', 'todo-and-task-templates'],
      body: [
        {
          type: 'p',
          text: 'Songs and tasks are added on the last wizard step (**REVIEW & CONFIRM**) or later from [[edit-a-rehearsal]]. The songs become the rehearsal setlist, which members see as **FOCUS SONGS** on the rehearsal page.',
        },
        {
          type: 'steps',
          title: 'Songs',
          items: [
            'In the **Setlist** card, tap **Add songs** and pick songs from your repertoire.',
            'Or tap **Setlist template** to start from one of the band\'s saved setlists. In the setlist editor you can search the library, add a song by hand (**Manual**: **Song title \*** and **Artist**), then tap **Done**.',
            'To remove a song, tap the X next to it under **Selected songs**.',
          ],
        },
        {
          type: 'steps',
          title: 'Prep tasks',
          items: [
            'In the **Prep tasks** card, tap a **Quick add** suggestion such as **Bring chord charts** or **Record audio**.',
            'Or type your own task under **New task** and tap **Add**.',
            'Remove a task with the X next to it under **Band tasks**.',
          ],
        },
        {
          type: 'p',
          text: 'When you edit a rehearsal, the **Gear & tasks** section also has **Add task** and **Load template**, which adds every task of a saved to-do list template. See [[todo-and-task-templates]].',
        },
        {
          type: 'note',
          tone: 'privacy',
          text: 'Only admins choose and change the rehearsal setlist. Members can open it from **FOCUS SONGS** but cannot edit it.',
        },
      ],
    },
    {
      id: 'edit-a-rehearsal',
      title: 'Edit a rehearsal',
      summary: 'Change the date, room, roster, cost, setlist or tasks of a rehearsal that is already scheduled.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['change rehearsal', 'move rehearsal', 'reschedule', 'update rehearsal'],
      related: ['create-a-rehearsal', 'delete-a-rehearsal', 'rehearsal-and-chat-notifications'],
      body: [
        {
          type: 'steps',
          items: [
            'Open the rehearsal from the **Calendar** or from Home.',
            'At the bottom of the rehearsal, tap **EDIT**.',
            'Open the section you want to change: **Session & recurrence**, **Date, time & studio**, **Studio cost**, **Band roster**, **Setlist** or **Gear & tasks**. A banner at the top says which fields need attention.',
            'Tap **Save rehearsal**. It stays disabled while the rehearsal has no place.',
          ],
        },
        {
          type: 'p',
          text: 'If you tap **Cancel** with unsaved changes, BandWith asks **Save your changes?** and lets you save, discard or keep editing.',
        },
        {
          type: 'list',
          title: 'Who is told',
          items: [
            'A new date, new times or a new place sends a "Rehearsal updated" notification and push to the people on the rehearsal.',
            'Members you add to the roster get the "New Rehearsal" invite.',
          ],
        },
        {
          type: 'note',
          tone: 'tip',
          text: 'Editing always uses the step-by-step editor, also on an iPad.',
        },
      ],
    },
    {
      id: 'delete-a-rehearsal',
      title: 'Delete (cancel) a rehearsal',
      summary: 'Remove a rehearsal from the calendar; everyone on it is told.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['cancel rehearsal', 'remove rehearsal'],
      related: ['edit-a-rehearsal', 'recurring-rehearsals'],
      body: [
        {
          type: 'steps',
          items: [
            'Open the rehearsal.',
            'Tap **DELETE** under **EDIT** and **REHEARSAL CHAT**.',
            'Tap **Confirm delete**, or **CANCEL** to keep it.',
          ],
        },
        {
          type: 'note',
          tone: 'warning',
          text: 'Deleting cannot be undone. A recurring rehearsal is one event, so deleting it removes every date of the series.',
        },
        {
          type: 'p',
          text: 'Members on the rehearsal get a "Rehearsal cancelled" notification and push. If they open it from an old notification, they see **Rehearsal cancelled** and a note that an admin removed it.',
        },
      ],
    },
    {
      id: 'rehearsal-drafts',
      title: 'Save a rehearsal as a draft',
      summary: 'Leave the wizard halfway and finish the rehearsal later.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['draft', 'unfinished', 'save for later'],
      related: ['create-a-rehearsal'],
      body: [
        {
          type: 'steps',
          items: [
            'In the wizard, tap **Cancel** or the close button after you have typed something.',
            'In **Save this rehearsal as a draft?**, tap **Save draft**. **Discard** throws it away, **Keep editing** goes back.',
            'To finish it, open the draft from Drafts on the Home screen, or from its day in the calendar.',
            'To throw away a draft you reopened, close the wizard and tap **Delete draft**.',
          ],
        },
        {
          type: 'note',
          tone: 'privacy',
          text: 'Only you can see your drafts. Members get nothing until you create the rehearsal.',
        },
        {
          type: 'p',
          text: 'If saving fails, the wizard stays open and the rehearsal is also kept as a draft, so nothing you typed is lost.',
        },
        {
          type: 'devices',
          rows: [{ devices: ['tablet'], text: 'On an iPad the one-screen composer has its own save-as-draft button in the header.' }],
        },
      ],
    },
    {
      id: 'recurring-rehearsals',
      title: 'Recurring rehearsals',
      summary: 'How weekly, biweekly and monthly rehearsals appear and behave.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['weekly rehearsal', 'repeat', 'every week', 'series', 'biweekly', 'monthly'],
      related: ['create-a-rehearsal', 'delete-a-rehearsal', 'answer-a-rehearsal-invite'],
      body: [
        {
          type: 'p',
          text: 'When you set a **Recurrence** other than **One time**, BandWith saves one rehearsal with a repeat rule. The next dates are shown in the calendar about four months ahead, up to 24 dates.',
        },
        {
          type: 'table',
          head: ['Recurrence', 'Shown on the rehearsal'],
          rows: [
            ['One time', 'ONCE'],
            ['Weekly', 'EVERY {day}, for example EVERY TUESDAY'],
            ['Biweekly', 'EVERY OTHER {day}'],
            ['Monthly', 'MONTHLY'],
          ],
        },
        {
          type: 'note',
          tone: 'warning',
          text: 'All dates of a series share the same rehearsal: one roster, one answer per member, one setlist. Editing or deleting it changes every date.',
        },
      ],
    },
    {
      id: 'the-rehearsal-page',
      title: 'The rehearsal page',
      summary: 'What a rehearsal shows to admins and to members.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['rehearsal detail', 'attendance', 'studio cost', 'focus songs'],
      related: ['answer-a-rehearsal-invite', 'edit-a-rehearsal', 'event-and-rehearsal-chats', 'rehearsal-songs-and-prep-tasks'],
      body: [
        {
          type: 'p',
          text: 'Open a rehearsal from the **Calendar** or Home. Its page is blue, the rehearsal colour, and has these parts:',
        },
        {
          type: 'list',
          items: [
            '**Are you coming?**: the answer card for invited members (see [[answer-a-rehearsal-invite]]).',
            'Time tiles: **START**, **END** and **ROOM**.',
            '**ATTENDANCE**: who is invited and what they answered.',
            '**FOCUS SONGS**: up to eight songs, with **+ {count} MORE** and **SETLIST** to see the whole list.',
            '**NOTES**: the rehearsal note, when there is one.',
            '**TASKS**: the prep tasks and how many are done. Tap a task to tick it.',
            '**STUDIO COST**: the room, the hours, the total and **Split between {count} going**, with the amount **EACH**.',
            'Buttons at the bottom: **EDIT**, **REHEARSAL CHAT** and **DELETE** for admins; **REHEARSAL CHAT** for members who answered going or maybe.',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Sees everything above, including **STUDIO COST**, and can edit or delete the rehearsal.' },
            { role: 'member', text: 'Sees the rehearsal only when the admin put them on the roster. Sees times, room, attendance, focus songs, notes and tasks. The studio cost section is not shown to members. Leaving is in the **More options** menu.' },
            { role: 'deputy', text: 'Deputies are asked for gigs, not rehearsals, and do not see band rehearsals.' },
          ],
        },
        {
          type: 'note',
          tone: 'privacy',
          text: 'The room\'s total cost is band money and stays with admins. During a poll, members see only their share ("€12 each").',
        },
      ],
    },
    {
      id: 'answer-a-rehearsal-invite',
      title: 'Answer a rehearsal invite or drop out',
      summary: 'Tell the admin whether you are coming, change your answer, or drop out later.',
      roles: ['member'],
      kind: 'task',
      keywords: ['rsvp', 'going', 'maybe', "can't", 'decline rehearsal', 'drop out'],
      related: ['the-rehearsal-page', 'rehearsal-and-chat-notifications'],
      body: [
        {
          type: 'steps',
          title: 'Answer',
          items: [
            'Open the rehearsal from the "New Rehearsal" notification or from the **Calendar**.',
            'On the **Are you coming?** card, tap **GOING**, **MAYBE** or **CAN\'T**. The card says by when to answer ("Answer by … so the admin can confirm the room.").',
            'To change it later, tap **Change** on the **Your RSVP** card and pick again.',
          ],
        },
        {
          type: 'steps',
          title: 'Drop out',
          items: [
            'Open the rehearsal and tap **More options** (the … button at the top).',
            'In **Rehearsal options**, tap **Drop out of this rehearsal**.',
            'Confirm with **DROP OUT**. The admin is notified.',
          ],
        },
        {
          type: 'note',
          tone: 'warning',
          text: 'After you answer **CAN\'T** or drop out, the rehearsal leaves your calendar. Ask an admin if you want to be added back.',
        },
        {
          type: 'devices',
          rows: [{ devices: ['duoClosed', 'duoBook', 'duoLand'], text: 'On iPhone Duo, **More options** sits in the side rail with the other header actions.' }],
        },
      ],
    },
    {
      id: 'propose-a-rehearsal',
      title: 'Propose a rehearsal (members)',
      summary: 'Ask the admin for a rehearsal on a topic, with the days that suit you.',
      roles: ['member'],
      kind: 'task',
      keywords: ['request rehearsal', 'suggest rehearsal', 'member proposal', 'ask for rehearsal'],
      related: ['handle-a-rehearsal-proposal', 'rehearsal-polls-explained'],
      body: [
        {
          type: 'steps',
          items: [
            'Tap **Create** (the + in the bottom bar) and choose **Propose rehearsal**. In an empty **Calendar** you can also tap **Propose rehearsal**.',
            'If you are in several bands, pick the band in **Choose band**.',
            'Type a **Topic**, for example "Practice new setlist transitions". It is required.',
            'Optionally tap the **Preferred days (optional)** that suit you.',
            'Optionally add **Notes or songs (optional)**.',
            'Tap **Submit to admin**.',
          ],
        },
        {
          type: 'p',
          text: 'The band admins get a "New Rehearsal Proposal" notification and push. On your Home screen and in the **Calendar**, the proposal shows as **Your rehearsal proposal** with **Pending admin** until an admin turns it into a poll or dismisses it.',
        },
        {
          type: 'note',
          tone: 'warning',
          text: 'You can send one proposal every 7 days per band. When you have used it, the screen shows **Weekly limit reached** and the **Next available proposal** date. The limit is also checked by the server.',
        },
        {
          type: 'list',
          title: 'Edge cases',
          items: [
            'Not in a band yet: you see **Band required**, with **Create a band**.',
            'An admin who dismisses your proposal does not send you a notification: it just leaves your list.',
            'There is no button to withdraw a proposal yourself.',
          ],
        },
        { type: 'roles', rows: [{ role: 'admin', text: 'Admins do not propose: they create the rehearsal or a poll directly. See [[create-a-rehearsal]].' }] },
      ],
    },
    {
      id: 'handle-a-rehearsal-proposal',
      title: 'Handle a member\'s rehearsal proposal',
      summary: 'Turn a member\'s proposal into an availability poll, or dismiss it.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['proposal', 'build poll', 'dismiss proposal', 'member request'],
      related: ['propose-a-rehearsal', 'create-a-rehearsal-poll'],
      body: [
        {
          type: 'steps',
          items: [
            'Find the proposal under **Rehearsal scheduling** in the Home Action center or in the **Calendar**. It shows **Member rehearsal proposal**, **Proposed by**, the **Preferred days** and the note. You can also open it from the "New Rehearsal Proposal" notification.',
            'Tap **Build poll** (in the notification sheet: **Build poll from proposal**). The poll builder opens with the topic as title, the note, and the preferred days preselected.',
            'Add date slots and publish as in [[create-a-rehearsal-poll]].',
            'Or tap **Dismiss** to close the proposal without a poll.',
          ],
        },
        {
          type: 'note',
          tone: 'tip',
          text: 'A member proposal carries no songs, place or cost. Add them in the builder before you publish.',
        },
      ],
    },

    // ───────────────────────────── Polls ─────────────────────────────
    {
      id: 'create-a-rehearsal-poll',
      title: 'Create an availability poll',
      summary: 'Offer the band a few dates and let members vote on the ones that work.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['poll', 'vote', 'availability', 'find a date', 'doodle', 'date poll'],
      related: ['poll-who-votes-and-deadline', 'vote-in-a-rehearsal-poll', 'lock-in-a-poll-date', 'rehearsal-polls-explained'],
      body: [
        {
          type: 'steps',
          title: 'On a phone',
          items: [
            'Tap **Create** and choose **New rehearsal**, then switch **Scheduling mode** to **Poll availability**. The **Availability poll** builder opens.',
            'Type a **Poll title** and, if you like, a **Goal / notes (optional)**.',
            'Under **Who votes**, tap a member to leave them out. You always vote.',
            'Under **Place, cost & songs**, fill in **Location / studio**, the **Room cost** (the **Split** shows each person\'s share) and the **Focus songs** (tap **Add**).',
            'Add dates. With **Whole week preset**, choose **This week** or **Next week**, tap the **Include days**, set **Start** and **End**, and tap **Add selected days to poll**. Each day shows how many members are free. With **Custom date / time**, pick a **Candidate date**, **Start** and **End**, and tap **Add slot to poll**.',
            'Check the **Candidate slots**. Remove one with **Remove slot**, or tap **Clear all**.',
            'Optionally set **Vote by**: a day and a time (see [[poll-who-votes-and-deadline]]).',
            'Tap **Publish poll**.',
          ],
        },
        {
          type: 'p',
          text: 'Every member asked to vote gets a "Vote on Rehearsal Times" notification and push. The poll appears as **Poll · Active** on Home and in the **Calendar** under **Rehearsal scheduling**.',
        },
        {
          type: 'list',
          title: 'What stops publishing',
          items: [
            'No title: "Please give your poll a title."',
            'No slot: "Add at least one candidate time slot for members to vote on."',
            'A vote-by day after the first slot: "Pick a day before the first slot".',
            'Adding the same day and start time twice: "This slot is already added."',
          ],
        },
        {
          type: 'devices',
          rows: [
            {
              devices: ['tablet'],
              text: 'On an iPad the poll is a one-screen composer, **New rehearsal** with "Poll · members vote on dates". Cards: **Session & roster**, **Candidate slots** (a week strip coloured by how many members are free; tap a day to add it with the chosen times), **Place, cost & songs** and **Vote deadline & note**. A **Live preview** shows the slots "As members vote", with the **Top pick**.',
            },
          ],
        },
        { type: 'shot', id: 'shot-poll-builder', caption: 'The availability poll builder on a phone.' },
        {
          type: 'note',
          tone: 'privacy',
          text: 'The free counts come from everyone\'s calendars, but only the number is shown ("4 of 5 free"), never who is busy or why.',
        },
      ],
    },
    {
      id: 'poll-who-votes-and-deadline',
      title: 'Who votes and the vote-by deadline',
      summary: 'Limit a poll to some members and tell them when to answer.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['invite list', 'invitees', 'deadline', 'vote by', 'who votes'],
      related: ['create-a-rehearsal-poll', 'vote-in-a-rehearsal-poll'],
      body: [
        {
          type: 'p',
          text: 'By default every active member is asked to vote. When you leave someone out under **Who votes**, the poll has an invite list.',
        },
        {
          type: 'list',
          items: [
            'Only invited members get the poll notification, see the poll and can vote. The server refuses votes from anyone else.',
            'Admins of the band always see the poll. The admin who publishes it is always on the list.',
            'When you lock in a date, only the invited members (and you) are put on the rehearsal.',
            'The share of the room cost is divided by the number of people asked to vote.',
          ],
        },
        {
          type: 'p',
          text: '**Vote by** is a day between today and the first candidate slot, plus a time (18:00 unless you change it). Members see "Vote by Fri 11 Dec, 18:00" in the poll.',
        },
        {
          type: 'note',
          tone: 'warning',
          text: 'The deadline is a reminder for people, not a lock. Nothing closes the poll at that time: members can still vote until an admin locks in a date.',
        },
      ],
    },
    {
      id: 'vote-in-a-rehearsal-poll',
      title: 'Vote in an availability poll',
      summary: 'Tap the dates that work for you, or say that none do.',
      roles: ['member', 'admin'],
      kind: 'task',
      keywords: ['vote', 'availability', 'pick dates', 'none of these work', 'poll'],
      related: ['poll-who-votes-and-deadline', 'lock-in-a-poll-date', 'rehearsal-polls-explained'],
      body: [
        {
          type: 'steps',
          title: 'From the poll card',
          items: [
            'On Home (Action center) or in the **Calendar**, find the **Poll · Active** card. A badge says **Vote now**, **Voted** or **None work**.',
            'Tap each date pad that works for you. Tap it again to take the vote back. You can pick several dates.',
            'Tap **Details** to see every date with "{count}/{total} available", the **Top pick** and who voted. After you vote, the details close by themselves ("Closing in …s"); tap **Keep open** to stop that.',
            'If you voted and no date works after all, tap **None work** in the details.',
          ],
        },
        {
          type: 'steps',
          title: 'From the notification',
          items: [
            'Tap the "Vote on Rehearsal Times" push, or the notification in the bell, and tap **Vote now**.',
            'In **Rehearsal availability**, under **Select the dates that work for you**, tap the dates you can make.',
            'Tap **Done**. If none of the dates work, tap **None work** instead.',
          ],
        },
        {
          type: 'p',
          text: '**None work** clears your votes and tells the admin that no date suits you: admins see "No date works for …". Voting for a date later replaces that answer.',
        },
        {
          type: 'list',
          title: 'What you see while voting',
          items: [
            'Place and your share of the room ("Blackbox Studios · €12 each") and the focus songs.',
            '"{answered} of {total} answered", and the vote-by date when there is one.',
            'Under **Responses**, who voted for which date, once someone has voted.',
          ],
        },
        {
          type: 'note',
          tone: 'tip',
          text: 'Votes update live for everyone. Without a connection the vote is not saved and you see "Failed to register vote. Please try again."',
        },
        { type: 'shot', id: 'shot-poll-card', caption: 'An active poll on Home with its date pads and details.' },
        {
          type: 'devices',
          rows: [
            {
              devices: ['duoLaptop'],
              text: 'In Laptop pose the vote sheet puts members and days on the top screen, and your day pads with **Lock in** and **Done** on the bottom screen.',
            },
          ],
        },
      ],
    },
    {
      id: 'lock-in-a-poll-date',
      title: 'Lock in a date and create the rehearsal',
      summary: 'Pick the winning date of a poll; BandWith creates the rehearsal and tells the band.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['finalize poll', 'confirm date', 'close poll', 'lock in', 'winner'],
      related: ['vote-in-a-rehearsal-poll', 'the-rehearsal-page', 'answer-a-rehearsal-invite'],
      body: [
        {
          type: 'steps',
          items: [
            'On the poll card, tap **Details · Lock in**. In the notification sheet, look under **Responses · Lock in a date**.',
            'Next to the date you want (often the **Top pick**), tap **Lock in**.',
            'Check the **Rehearsal location**. It starts with the place set in the poll, or "Band Practice Space".',
            'Tap **Confirm & create event**.',
          ],
        },
        {
          type: 'list',
          title: 'What happens',
          items: [
            'A confirmed rehearsal is created on that date and time, with the poll title, place and note.',
            'The room cost becomes the rehearsal\'s studio cost, and the focus songs become its setlist.',
            'The invited members are put on the rehearsal and answer it as usual ([[answer-a-rehearsal-invite]]). You are marked as going.',
            'The poll is closed and leaves the Action center. Members get a "Rehearsal Confirmed!" notification in the bell (no push).',
          ],
        },
        {
          type: 'note',
          tone: 'tip',
          text: 'If another admin locked the poll in a moment before you, you see "This poll was already locked in or closed." and no second rehearsal is created.',
        },
      ],
    },
    {
      id: 'delete-a-rehearsal-poll',
      title: 'Delete a poll',
      summary: 'Remove a poll and all its dates and votes.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['remove poll', 'cancel poll'],
      related: ['create-a-rehearsal-poll', 'handle-a-rehearsal-proposal'],
      body: [
        {
          type: 'steps',
          items: [
            'Open the poll\'s **Details · Lock in**, or open it from its notification.',
            'Tap **Delete poll**.',
            'In **Delete rehearsal poll?**, tap **Delete poll** again, or **Cancel**.',
          ],
        },
        {
          type: 'note',
          tone: 'warning',
          text: 'All proposed dates and member votes are deleted for good. This cannot be undone, and members are not notified.',
        },
        {
          type: 'p',
          text: 'To close a member\'s proposal that has no poll yet, use **Dismiss** instead (see [[handle-a-rehearsal-proposal]]).',
        },
      ],
    },
    {
      id: 'rehearsal-polls-explained',
      title: 'How proposals and polls work',
      summary: 'The life of a rehearsal request, from a member\'s idea to a date in the calendar.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['poll status', 'proposal status', 'rehearsal scheduling', 'action center'],
      related: ['propose-a-rehearsal', 'create-a-rehearsal-poll', 'vote-in-a-rehearsal-poll', 'lock-in-a-poll-date'],
      body: [
        {
          type: 'table',
          head: ['Stage', 'What it means', 'Who sees it'],
          rows: [
            ['Proposal (**Pending admin**)', 'A member asked for a rehearsal.', 'The member who proposed it and the admins.'],
            ['Poll (**Poll · Active**)', 'An admin published dates to vote on.', 'Invited members and the admins.'],
            ['Confirmed (**Rehearsal · Confirmed**)', 'A date was locked in; the rehearsal is in the calendar.', 'Everyone on the rehearsal.'],
            ['Dismissed or deleted', 'Closed without a rehearsal.', 'Nobody: it leaves the lists.'],
          ],
        },
        {
          type: 'p',
          text: 'Open proposals and polls appear on Home in the **Action center** and at the top of the **Calendar** under **Rehearsal scheduling ({count})**. In the **Calendar** they follow the band filter.',
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Publishes polls, turns proposals into polls, locks in dates, dismisses and deletes. Any admin of the band can do it, not only the one who published.' },
            { role: 'member', text: 'Proposes (one per week), votes, answers **None work**, and sees who voted for what.' },
            { role: 'deputy', text: 'Not part of band polls.' },
          ],
        },
        {
          type: 'devices',
          rows: [
            {
              devices: ['duoLaptop'],
              text: 'In Laptop pose, the Home "Band desk" lists polls you have not voted on and proposals waiting for a poll; tap one to open it.',
            },
          ],
        },
      ],
    },

    // ───────────────────────────── Chat ─────────────────────────────
    {
      id: 'the-chat-inbox',
      title: 'The chat inbox',
      summary: 'All your band, event and direct chats in one list.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['messages', 'inbox', 'chat list', 'unread', 'search messages'],
      related: ['start-a-chat', 'send-and-reply-to-messages', 'delete-a-chat', 'who-can-message-whom'],
      body: [
        {
          type: 'p',
          text: 'Tap **Chat** in the bottom bar. The badge on the tab counts unread messages.',
        },
        {
          type: 'list',
          items: [
            'Filter with **ALL**, **DIRECT**, **BANDS** or **EVENTS**. Each filter shows its own unread count.',
            'Chats with unread messages come first. A row shows the name (" · Band" for the band chat), the time, the last message, and either the unread count or the ticks of your own last message.',
            'If you are in two or more bands, a row also shows which band it belongs to.',
            'A green dot on a direct chat means that person is online.',
            'Type at least two letters in **Search chats…** to find chats, people and words in messages: results are grouped as **CHATS**, **PEOPLE** and **MESSAGES**. Tap **Clear search** to go back.',
            'Swipe a chat to the left to delete it ([[delete-a-chat]]).',
            'Start a new chat with the + (**New chat**) at the top ([[start-a-chat]]).',
          ],
        },
        { type: 'shot', id: 'shot-chat-inbox', caption: 'The chat inbox with the type filters.' },
        {
          type: 'devices',
          rows: [
            { devices: ['tablet', 'duoBook', 'duoLand'], text: 'The list and the open conversation sit side by side; the open chat is highlighted in the list.' },
            { devices: ['duoClosed', 'duoBook', 'duoLand'], text: 'On iPhone Duo the search field lives in the side rail.' },
          ],
        },
        {
          type: 'note',
          tone: 'tip',
          text: 'In solo mode (no band) there is no chat: the **Chat** tab opens the calendar.',
        },
      ],
    },
    {
      id: 'start-a-chat',
      title: 'Start a chat',
      summary: 'Open the band chat, an event chat, or a direct message.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['new chat', 'message someone', 'dm', 'direct message', 'band chat'],
      related: ['who-can-message-whom', 'event-and-rehearsal-chats', 'the-chat-inbox'],
      body: [
        {
          type: 'steps',
          items: [
            'In **Chat**, tap the + (**New chat**) at the top.',
            'Pick the **Chat type**: **DIRECT**, **BAND** or **EVENT**.',
            'Search and select a person (**Search admins…** or **Search members…**), a band (**Search bands…**) or an event (**Search events…**).',
            'Tap the button at the bottom: **Message {name}** or **Open {name} chat**.',
          ],
        },
        {
          type: 'p',
          text: 'If the chat already exists, BandWith opens it instead of making a second one. A band has one band chat with every active member; an event has one chat with its lineup.',
        },
        {
          type: 'p',
          text: 'You can also message someone from the band\'s member list: open the member and tap the message button. It appears only when one of you is an admin.',
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: '**DIRECT** lists every member of your bands. **EVENT** lists every event of the bands you run.' },
            { role: 'member', text: '**DIRECT** lists only the band **Admins** ("Direct messages are limited to band admins."). **EVENT** lists only the events you are on and did not decline.' },
          ],
        },
      ],
    },
    {
      id: 'send-and-reply-to-messages',
      title: 'Send, reply and mention',
      summary: 'Write messages, answer a specific message, mention someone, and read older messages.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['send message', 'reply', 'quote', 'mention', '@', 'older messages', 'offline'],
      related: ['message-receipts-and-online-status', 'the-chat-inbox'],
      body: [
        {
          type: 'steps',
          title: 'Send',
          items: [
            'Open a chat and tap **Write a message…** at the bottom.',
            'Type your message and tap **Send message** (or press Enter on a keyboard).',
          ],
        },
        {
          type: 'steps',
          title: 'Reply to one message',
          items: [
            'On a phone or tablet, swipe the message to the right. With a mouse, hover over it and click **Reply to message**.',
            'The composer shows **Replying to {name}**. Type and send. Tap **Cancel reply** to stop.',
          ],
        },
        {
          type: 'steps',
          title: 'Mention someone',
          items: [
            'Type @ and the start of a name.',
            'Tap the person in the suggestions (Enter picks the first one). Mentions are shown in bold.',
          ],
        },
        {
          type: 'list',
          title: 'Good to know',
          items: [
            'In band and event chats each message shows the sender\'s name, with " · Admin" for admins.',
            'The chat loads the latest 50 messages. Scroll up and tap **Load earlier messages** for more.',
            'Messages are plain text: there are no attachments, reactions, editing or deleting single messages.',
            'Without a connection, the message is not sent and goes back into the composer with "Message not sent. Check your connection and try again." Send it again when you are online.',
            'A mention is highlighted for everyone but does not send an extra notification: everyone in the chat is notified of each message anyway.',
          ],
        },
        {
          type: 'devices',
          rows: [{ devices: ['duoLaptop'], text: 'In Laptop pose the messages fill the top screen and the composer opens on the bottom screen.' }],
        },
      ],
    },
    {
      id: 'event-and-rehearsal-chats',
      title: 'Event and rehearsal chats',
      summary: 'A chat for the people on one gig or rehearsal, with its times pinned at the top.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['event chat', 'gig chat', 'rehearsal chat', 'lineup chat', 'event strip'],
      related: ['start-a-chat', 'gig-workspace', 'the-rehearsal-page'],
      body: [
        {
          type: 'steps',
          title: 'Open it',
          items: [
            'Open the gig or rehearsal.',
            'Tap **EVENT CHAT** (on a gig) or **REHEARSAL CHAT** (on a rehearsal).',
          ],
        },
        {
          type: 'p',
          text: 'The chat includes the event\'s lineup (everyone who did not decline) and the band admins. People added to the lineup later join it when the next message is sent.',
        },
        {
          type: 'p',
          text: 'A strip at the top shows the event: title, **Today** / **Tomorrow** or the date, **Load-in {time}** (or **Start {time}**) and the place, plus **Cancelled** or **Past event** when that applies. Tap it to open the event.',
        },
        {
          type: 'note',
          tone: 'privacy',
          text: 'The strip and the side pane show logistics only: times, place and status. Never the fee or the client.',
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Can open the chat of any event of the band.' },
            { role: 'member', text: 'Sees the chat button only after answering going (or maybe, on rehearsals). Members who decline lose access: "You can only message in events you are participating in."' },
          ],
        },
        {
          type: 'devices',
          rows: [
            {
              devices: ['tablet', 'duoBook', 'duoLand'],
              text: 'With two panes (an iPad in landscape, or iPhone Duo open), a context pane beside the thread shows the times (**Load in**, **Soundcheck**, **Show**, **Out**), the place, the status, **In this chat · Lineup {count}/{total}** and who is online, with **Open gig**.',
            },
          ],
        },
        { type: 'shot', id: 'shot-event-chat', caption: 'An event chat on iPad with the event strip and the context pane.' },
        {
          type: 'note',
          tone: 'tip',
          text: 'Personal gigs have no chat: "Event chats are available for band events."',
        },
      ],
    },
    {
      id: 'who-can-message-whom',
      title: 'Who can message whom',
      summary: 'The chat rules for admins, members and deputies.',
      roles: ['admin', 'member', 'deputy'],
      kind: 'reference',
      keywords: ['chat rules', 'permissions', 'messaging restricted', 'cannot message'],
      related: ['start-a-chat', 'event-and-rehearsal-chats'],
      body: [
        {
          type: 'table',
          head: ['Chat', 'Admin', 'Member'],
          rows: [
            ['Band chat', 'Yes, in bands you are active in', 'Yes, in bands you are active in'],
            ['Event chat', 'Any event of your band', 'Only events you are on and did not decline'],
            ['Direct message', 'Anyone in your bands', 'Only admins of a band you share'],
          ],
        },
        {
          type: 'p',
          text: 'Two members cannot message each other directly; they talk in the band or event chat. The rules are checked when you start a chat and each time you send.',
        },
        {
          type: 'p',
          text: 'When a rule stops you, the composer is replaced by a lock with the reason, for example "Direct messaging is only available with band admins." or "You no longer have access to this chat." (after you left the band or were taken off the gig).',
        },
        {
          type: 'roles',
          rows: [
            { role: 'deputy', text: 'Deputies are not band members, so they are in no band, event or direct chat. The band reaches them through deputy requests ("Ask in the app"), and they answer in Deputy gigs. See [[deputy-in-the-app]].' },
          ],
        },
        {
          type: 'note',
          tone: 'privacy',
          text: 'A direct chat stays between its two people. BandWith never reuses it for a conversation with someone else, so nobody else can read that history.',
        },
      ],
    },
    {
      id: 'message-receipts-and-online-status',
      title: 'Ticks, read receipts and online status',
      summary: 'What the clock, single tick and double ticks mean.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['ticks', 'read receipt', 'delivered', 'seen', 'online'],
      related: ['send-and-reply-to-messages', 'the-chat-inbox'],
      body: [
        {
          type: 'table',
          head: ['Mark', 'Meaning'],
          rows: [
            ['Clock (**Sending**)', 'Your message is on its way.'],
            ['One tick (**Sent**)', 'Saved on the server.'],
            ['Two grey ticks (**Delivered**)', 'It reached the other people\'s phones.'],
            ['Two coloured ticks (**Read**)', 'They opened the chat after your message.'],
          ],
        },
        {
          type: 'p',
          text: 'In band and event chats the ticks change only when everyone has received or read the message. People who joined after it was sent do not count.',
        },
        {
          type: 'p',
          text: 'The header of a direct chat shows **Online** or **Offline**. Group chats show "{count} members · {count} online".',
        },
      ],
    },
    {
      id: 'delete-a-chat',
      title: 'Delete a chat',
      summary: 'Remove a chat from your list and erase messages for good.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['delete conversation', 'clear chat', 'remove chat', 'erase messages'],
      related: ['the-chat-inbox'],
      body: [
        {
          type: 'steps',
          items: [
            'In the chat list, swipe the chat to the left and tap the delete button. Or open the chat and tap **Delete chat** (the bin) at the top right.',
            'Confirm with **Delete**, or tap **Cancel**.',
          ],
        },
        {
          type: 'table',
          head: ['Chat', 'What is deleted'],
          rows: [
            ['Direct chat', 'Every message, for both of you.'],
            ['Band or event chat', 'Only your own messages, for everyone. The others keep the rest of the conversation.'],
          ],
        },
        {
          type: 'note',
          tone: 'warning',
          text: 'This cannot be undone. The chat leaves your list until a new message arrives; then it comes back with only the new messages.',
        },
      ],
    },
    {
      id: 'rehearsal-and-chat-notifications',
      title: 'Notifications for rehearsals, polls and chat',
      summary: 'Which actions notify whom, and which ones also send a push.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['push', 'notification', 'alerts', 'bell', 'badge'],
      related: ['answer-a-rehearsal-invite', 'vote-in-a-rehearsal-poll', 'send-and-reply-to-messages'],
      body: [
        {
          type: 'table',
          head: ['When', 'Who is told', 'Push'],
          rows: [
            ['A member proposes a rehearsal', 'The band admins', 'Yes'],
            ['An admin publishes a poll', 'The members asked to vote', 'Yes'],
            ['A date is locked in', 'The people put on the rehearsal', 'No, bell only'],
            ['A rehearsal is created, or you are added to one', 'The invited members', 'Yes'],
            ['Date, time or place changes', 'The people on the rehearsal', 'Yes'],
            ['A rehearsal is deleted', 'The people on the rehearsal', 'Yes'],
            ['A member drops out or answers', 'The admin who created it', 'Yes for dropping out'],
            ['A new chat message', 'Everyone else in the chat', 'Yes'],
          ],
        },
        {
          type: 'list',
          items: [
            'Tapping a poll notification opens the vote sheet; a rehearsal notification opens the rehearsal; a chat notification opens the chat.',
            'When you open the app with an unread poll or proposal, BandWith shows it once in a small pop-up.',
            'No push arrives for a chat you have open on screen. Opening a chat marks its notifications as read.',
            'If the notification belongs to another of your bands, the app asks whether to switch band first.',
            'Turn all pushes off in **Settings** with **Push notifications** ("Gig invites, polls, chat messages"). The bell keeps every notification.',
          ],
        },
      ],
    },
  ],

  faq: [
    {
      q: 'Can a member create a rehearsal?',
      a: 'No. Members tap **Propose rehearsal** and the admins decide. Admins schedule it directly or run a poll.',
      roles: ['member'],
    },
    {
      q: 'Why can I send only one rehearsal proposal a week?',
      a: 'To keep band scheduling focused, each member can propose once every 7 days per band. The screen shows the next date you can propose.',
      roles: ['member'],
    },
    {
      q: 'I am not seeing a poll other members talk about.',
      a: 'The admin probably left you out under **Who votes**. Only invited members see a poll and can vote on it.',
      roles: ['member'],
    },
    {
      q: 'Does the poll close at the vote-by time?',
      a: 'No. The deadline is only shown to members. The poll stays open until an admin locks in a date or deletes it.',
    },
    {
      q: 'Can members see what the rehearsal room costs?',
      a: 'During a poll they see only their share ("€12 each"). The total studio cost on the rehearsal page is shown to admins only.',
    },
    {
      q: 'Can I message another member directly?',
      a: 'Only if one of you is an admin of a band you share. Otherwise use the band chat or the event chat.',
      roles: ['member'],
    },
    {
      q: 'Why can I not open the rehearsal chat?',
      a: 'Members see **REHEARSAL CHAT** after answering **GOING** or **MAYBE**. If you declined, you no longer have access.',
      roles: ['member'],
    },
    {
      q: 'Can I edit or delete one message, or send a photo?',
      a: 'No. Chat messages are text only. You can reply to a message or delete the whole chat.',
    },
    {
      q: 'If I delete a band chat, does the band lose the conversation?',
      a: 'No. Only your own messages are erased. In a direct chat, every message is erased for both people.',
    },
    {
      q: 'What happens to messages I send without a connection?',
      a: 'They are not sent. The text goes back into the composer so you can send it again once you are online.',
    },
    {
      q: 'Can deputies use the chat?',
      a: 'No. Deputies are not band members. The band contacts them through deputy requests in the app.',
      roles: ['deputy'],
    },
  ],

  glossary: [
    { term: 'Rehearsal proposal', definition: 'A member\'s request for a rehearsal, with a topic and preferred days. It waits for an admin.', see: 'propose-a-rehearsal' },
    { term: 'Availability poll', definition: 'A list of candidate dates the band votes on before an admin picks one.', see: 'create-a-rehearsal-poll' },
    { term: 'Candidate slot', definition: 'One date with a start and end time offered in a poll.', see: 'create-a-rehearsal-poll' },
    { term: 'Scheduling mode', definition: 'The switch between **Schedule directly** and **Poll availability** when an admin starts a new rehearsal.', see: 'create-a-rehearsal' },
    { term: 'Who votes', definition: 'The members asked to vote on a poll. Leaving someone out makes an invite list.', see: 'poll-who-votes-and-deadline' },
    { term: 'Vote by', definition: 'The day and time members should answer a poll by. It is shown, not enforced.', see: 'poll-who-votes-and-deadline' },
    { term: 'Top pick', definition: 'The poll date with the most votes so far.', see: 'vote-in-a-rehearsal-poll' },
    { term: 'None work', definition: 'A poll answer meaning no offered date suits you. It clears your votes and tells the admin.', see: 'vote-in-a-rehearsal-poll' },
    { term: 'Lock in', definition: 'Choosing the winning date of a poll, which creates the rehearsal.', see: 'lock-in-a-poll-date' },
    { term: 'Free count', definition: 'How many members have nothing else in their calendars at a time, for example "4 of 5 free". Only the number is shown.', see: 'create-a-rehearsal-poll' },
    { term: 'Focus songs', definition: 'The songs to work on at a rehearsal. They become the rehearsal setlist.', see: 'rehearsal-songs-and-prep-tasks' },
    { term: 'Session type', definition: 'Full Band, Vocals, Rhythm, Acoustic or Other: it names the rehearsal and preselects the roster.', see: 'create-a-rehearsal' },
    { term: 'Band chat', definition: 'The one chat every active member of a band is in.', see: 'start-a-chat' },
    { term: 'Event chat', definition: 'The chat of one gig or rehearsal, for its lineup and the admins.', see: 'event-and-rehearsal-chats' },
    { term: 'Event strip', definition: 'The bar at the top of an event chat with the date, load-in or start time and the place.', see: 'event-and-rehearsal-chats' },
    { term: 'Receipt ticks', definition: 'The marks next to your messages: sending, sent, delivered, read.', see: 'message-receipts-and-online-status' },
  ],

  shots: [
    {
      id: 'shot-rehearsal-wizard',
      how: 'Home. Tap Create (the + in the bottom bar), then New rehearsal. Stay on step 1 (SESSION & ROSTER) with Full Band selected.',
      role: 'admin',
      viewport: 'phone',
    },
    {
      id: 'shot-poll-builder',
      how: 'Home. Tap Create (the + in the bottom bar), then New rehearsal. In Scheduling mode tap Poll availability. In Whole week preset tap Add selected days to poll, then scroll so Candidate slots is visible.',
      role: 'admin',
      viewport: 'phone',
    },
    {
      id: 'shot-poll-card',
      how: 'Home. Scroll to the Action center and the poll "Extra rehearsal next week". Tap Details · Lock in to expand the dates.',
      role: 'admin',
      viewport: 'phone',
    },
    {
      id: 'shot-chat-inbox',
      how: 'Tap Chat in the bottom bar. Leave the ALL filter on.',
      role: 'admin',
      viewport: 'phone',
    },
    {
      id: 'shot-event-chat',
      how: 'Tap Chat, then the event chat "Rooftop Session". Landscape 1180x820 so the context pane shows beside the thread.',
      role: 'admin',
      viewport: 'tablet',
    },
  ],
};

export default together;
