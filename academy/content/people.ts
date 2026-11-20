import type { AreaModule } from './types';

/**
 * Members, deputies & gear. Derived from BandMembersView, components/band/**,
 * components/deputy/**, deputyClaim.ts, deputy.html, InventoryView,
 * components/gear/**, gearKits.ts, assetStatus.ts, permissions.ts and the
 * row-level security in supabase/migrations (073 baseline and later).
 */
const people: AreaModule = {
  area: {
    id: 'people',
    title: 'Members, deputies & gear',
    intro: 'Who is in the band, who stands in when someone can’t play, the gear you take to gigs, and who can see what.',
    icon: 'people',
  },

  articles: [
    // ── Members ──────────────────────────────────────────────────────────
    {
      id: 'band-members',
      title: 'The Band members screen',
      summary: 'Everyone in the band, their role and instrument, with the invite button and the deputies list for admins.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['members', 'lineup', 'roster', 'band list', 'people'],
      related: ['invite-members', 'member-detail', 'member-roles', 'deputies', 'who-sees-what'],
      body: [
        { type: 'p', text: "**Band members** lists everyone in the band you have selected. The band's name sits above the title." },
        {
          type: 'steps',
          title: 'Open it',
          items: [
            'On Home, under **Quick Actions**, tap **Members**.',
            'Or tap your avatar at the top right to open the Account Hub, then tap **Members** in the current band card.',
          ],
        },
        {
          type: 'list',
          title: 'What you see',
          items: [
            'Three counters: **Total**, **Admins** and **Members**.',
            'One row per person: photo or initials, name (the stage name when one is set), instrument and role (**Admin** or **Member**). A **Pro** tag marks people on a paid plan.',
            'Tap a row to open that person’s page. See [[member-detail]].',
            'Tap **⋯** (**Actions for {name}**) on a row for a short menu: **Email**; on your own row **Leave band**; for admins, on other people’s rows, **Make admin** or **Make member** and **Remove from band**.',
            'Admins also see the **Invite member** button (top right and at the bottom) and, under the list, the **Deputies** section. See [[deputies]].',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Sees everyone, invites people, changes roles, removes members and manages deputies.' },
            { role: 'member', text: 'Sees everyone and their contact details, and can email them. No invite button, no role changes, no deputies list.' },
          ],
        },
        { type: 'shot', id: 'people-band-members', caption: 'Band members as an admin: counters, the lineup and the Invite member button.' },
        {
          type: 'devices',
          rows: [
            { devices: ['duoLaptop'], text: 'The three counters sit on the top half; the list of people is on the bottom half.' },
            { devices: ['duoBook', 'duoLand', 'tablet'], text: 'A person’s page opens beside the list instead of covering it.' },
            { devices: ['android'], text: 'The Back gesture closes a person’s page first, then Band members.' },
          ],
        },
        { type: 'note', tone: 'tip', text: 'An empty band shows **No members yet** and, for admins, **Invite first member**.' },
      ],
    },
    {
      id: 'invite-members',
      title: 'Invite someone to the band',
      summary: 'Find a BandWith user by name or email, or invite a new person by email, link or code.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['invite', 'add member', 'invite code', 'invite link', 'join'],
      related: ['accept-an-invite', 'member-roles', 'band-members'],
      body: [
        { type: 'p', text: 'Nobody is added to a band without saying yes. You send an invitation; the person accepts it.' },
        {
          type: 'steps',
          items: [
            'On **Band members**, tap **Invite member** (the + at the top right or the button at the bottom).',
            'Type at least 3 characters of a name or an email address in the search field.',
            'If the person is already on BandWith, they appear under **Found in BandWith**. Tap **Invite** next to them.',
            'If nobody is found, type their full email address and tap **Invite {email}**.',
            'Before you send, pick the role under **Role**: **Member** (“Can view band content”) or **Admin** (“Manage members, events & settings”). Member is selected by default.',
            'For someone new to BandWith, the sheet then shows the **Invite code**. Tap **Share invite** to send the link and code through any app, or **Copy code**.',
          ],
        },
        {
          type: 'list',
          title: 'What happens next',
          items: [
            'Existing user: they get a notification and a **Band invite** card the next time they open BandWith. You see “Invite sent to {name}”.',
            'New person: BandWith emails the invite when it can. You see “Invite emailed to {name}” or, without an email, “Invite created for {name}. Share it so they can join.”',
            'An invite is valid for 7 days. When 2 days or less are left, the invited address gets one reminder email. If it runs out, you get an email.',
            'Inviting the same address again renews the invite for another 7 days.',
            'When they join, everyone in the band gets “{name} joined {band}”.',
          ],
        },
        {
          type: 'list',
          title: 'See who hasn’t joined yet',
          items: [
            'Admins see open invites on **Band members** under **Invited**: the email, the role and **Not accepted yet**, **Expired** or **Declined**.',
            'Tap the ⋯ next to an invite, then **Send again**: the invite gets 7 more days and goes out again. For an expired or declined invite the button is **Invite again**.',
            '**Copy link** copies the invite link, so you can send it yourself to someone new to BandWith.',
            '**Cancel invite**, then **Yes, cancel it**: the link and the code stop working.',
          ],
        },
        { type: 'note', tone: 'privacy', text: 'Search results show emails partly hidden (for example gi•••@…) unless you type the exact address. People already in the band don’t appear.' },
        { type: 'shot', id: 'people-invite', caption: 'The Invite member sheet with search, results and the role choice.' },
        { type: 'note', tone: 'tip', text: 'The invite is tied to the email address. The person must sign in with that address to join.' },
      ],
    },
    {
      id: 'accept-an-invite',
      title: 'Join a band from an invite',
      summary: 'Accept an invitation in the app, from the invite link, or by pasting the invite code.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['join band', 'accept invite', 'invite code', 'decline invite'],
      related: ['invite-members', 'member-roles'],
      body: [
        {
          type: 'steps',
          title: 'You already use BandWith',
          items: [
            'Open BandWith. A **Band invite** card shows who invited you, the band, its size and your role (**as member** or **as admin**).',
            'Tap **Join band**. You see “You joined {band}” and the band appears in your band switcher.',
            'Or tap **Decline**. To decide later, tap the X (**Decide later**); the card comes back next time.',
          ],
        },
        {
          type: 'steps',
          title: 'You are new to BandWith',
          items: [
            'Open the invite link from the message or email. Or, on the welcome screen, tap **I have an invite code**, paste the code or link in **Invite code or link** and tap **Join**.',
            'Check the band card and tap **Accept & continue** (or **Decline invitation**).',
            'Create your account or sign in with the email address the invite was sent to. You are in the band as soon as the account is ready.',
          ],
        },
        {
          type: 'list',
          title: 'If it doesn’t work',
          items: [
            '“This invite was sent to a different email” means you are signed in with another address. Sign out and use the invited one.',
            '“This invite has expired” or “isn’t valid any more”: ask an admin to invite you again.',
            '“That doesn’t look like an invite code”: paste the full code or the whole link.',
          ],
        },
      ],
    },
    {
      id: 'member-roles',
      title: 'Admin and member roles',
      summary: 'What an admin can do that a member can’t, and the rule that every band keeps at least one admin.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['admin', 'member', 'permissions', 'role', 'co-manage', 'owner'],
      related: ['make-admin', 'who-sees-what', 'remove-a-member'],
      body: [
        { type: 'p', text: 'Every person in a band is either an **Admin** or a **Member**. A band can have several admins. The person who creates a band is its first admin.' },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Creates and edits gigs, rehearsals and quotes; sets fees and marks payouts; edits setlists, songs, contracts, to-do lists and gear kits; invites and removes people; changes roles; manages deputies; edits the band details and pricing; sees the band’s finances and analytics.' },
            { role: 'member', text: 'Sees the band’s gigs and logistics, answers invitations to play, reads setlists and songs, suggests songs and changes, keeps private song notes, chats, adds and edits their own personal gear, and sees only their own fee.' },
          ],
        },
        { type: 'note', tone: 'warning', text: 'A band needs at least one admin. The app won’t let you remove the last admin or turn them into a member: “A band needs at least one admin. Make someone else admin first.” The same rule blocks deleting your account while you are the only admin of a band.' },
        { type: 'p', text: 'Co-managing a band (being one of several admins) is a paid-plan feature. During the beta everyone can be made admin. Outside the beta, **Make admin** shows “Requires a Pro account to co-manage” for people on the free plan.' },
        { type: 'p', text: 'For the full list of data each role can read, see [[who-sees-what]].' },
      ],
    },
    {
      id: 'make-admin',
      title: 'Make someone admin, or turn an admin back into a member',
      summary: 'Change a person’s role from the Band members list or their page.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['make admin', 'remove admin', 'demote', 'promote', 'change role'],
      related: ['member-roles', 'band-members'],
      body: [
        {
          type: 'steps',
          items: [
            'On **Band members**, tap **⋯** on the person’s row. Or tap the row to open their page.',
            'Tap **Make admin** to give them admin rights, or **Make member** to take them away.',
          ],
        },
        { type: 'p', text: 'The change is saved at once; there is no confirmation. The person sees their new role the next time their band list loads. Their phone then drops the band data it kept for offline use and loads it again for the new role: a new admin sees the client and prices, a former admin no longer keeps them on the phone.' },
        { type: 'note', tone: 'warning', text: 'You can’t turn the last admin into a member. Make someone else admin first.' },
        { type: 'note', tone: 'tip', text: 'You can’t change your own role: your page and the **⋯** menu on your own row show no role buttons. Ask another admin to make you a member.' },
      ],
    },
    {
      id: 'remove-a-member',
      title: 'Remove a member from the band',
      summary: 'Take someone out of the band; they lose access to its events, chats and repertoire.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['remove member', 'kick', 'delete member'],
      related: ['leave-a-band', 'invite-members', 'member-roles'],
      body: [
        {
          type: 'steps',
          items: [
            'On **Band members**, tap **⋯** on the person’s row and tap **Remove from band**. Or open their page and tap **Remove from band** at the bottom.',
            'Read the sheet **Remove from band?** and tap **Remove**. Tap **Cancel** to keep them.',
          ],
        },
        {
          type: 'list',
          title: 'What happens',
          items: [
            'They lose access to the band’s events, chats and repertoire right away.',
            'They get a notification “Removed from {band}”. The rest of the band gets “{name} left {band}”.',
            'Their past gigs, answers and payouts stay in the band’s records.',
            'You can invite them again later.',
          ],
        },
        { type: 'note', tone: 'warning', text: 'There is no undo. To bring the person back, send a new invite and wait for them to accept it.' },
      ],
    },
    {
      id: 'leave-a-band',
      title: 'Leave a band',
      summary: 'How leaving works for admins and for members.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['leave band', 'quit band', 'exit band'],
      related: ['remove-a-member', 'member-roles'],
      body: [
        {
          type: 'roles',
          rows: [
            { role: 'member', text: 'You can leave any band you are in, whenever you want.' },
            { role: 'admin', text: 'You can leave while the band has another admin. If you are the only one, the app asks you to make someone else admin first ([[make-admin]]).' },
          ],
        },
        {
          type: 'steps',
          items: [
            'Open **Band members** for that band.',
            'Tap **⋯** on your own row and tap **Leave band**. (You can also tap your row and use **Leave band** at the bottom.)',
            'The sheet asks “Leave {band}?”: you lose access to the band’s events, chats and repertoire. Tap **Leave band** to confirm, or **Cancel**.',
          ],
        },
        { type: 'p', text: 'When you leave, the others get “{name} left {band}”. The app moves you to your other band, or to the start screen if you have none. You can join again only with a new invite.' },
        { type: 'note', tone: 'warning', text: 'Deleting your account (Settings, **Delete account**) also takes you out of every band. If you are the only admin of a band, make someone else admin first.' },
      ],
    },
    {
      id: 'member-detail',
      title: 'A member’s page',
      summary: 'Who they are, this year’s gigs and pay, their next events, their contacts and the role buttons.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['member profile', 'member stats', 'paid this year', 'contact', 'phone', 'email'],
      related: ['band-members', 'who-sees-what', 'make-admin'],
      body: [
        { type: 'p', text: 'Tap a person on **Band members** to open their page.' },
        {
          type: 'list',
          items: [
            'At the top: photo, name, instrument and role.',
            '**Gigs this year**: gigs played plus gigs coming up, with a dot meter. **Paid · {year}**: what they were paid, and how much is still owed.',
            '**Next for {name}**: their upcoming events in this band, each with their answer (confirmed, pending, declined).',
            '**Contacts**: email and phone, each with a copy button. Tap one to write or call.',
            '**Message** opens a direct chat. **Make admin** / **Make member** and **Remove from band** are for admins.',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Sees the gigs and pay counters for everyone, and every action except on their own page.' },
            { role: 'member', text: 'Sees the gigs and pay counters only on their own page. On someone else’s page: name, instrument, next events and contacts. **Message** appears only on an admin’s page, because members can start a direct chat only with admins.' },
          ],
        },
        { type: 'note', tone: 'privacy', text: 'A member never sees what another member is paid. The counters come from a server function that returns all members to admins and only your own row to you.' },
        {
          type: 'devices',
          rows: [
            { devices: ['phone', 'duoClosed'], text: 'Opens full screen.' },
            { devices: ['duoBook', 'duoLand'], text: 'Opens on the second screen, next to the list.' },
            { devices: ['tablet'], text: 'Opens in the detail column beside the list.' },
          ],
        },
      ],
    },
    {
      id: 'default-fees-and-instruments',
      title: 'Default fees and instruments',
      summary: 'Where a member’s instrument and pre-filled fee come from, and where you change them.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['default fee', 'usual fee', 'rate', 'instrument', 'role', 'pay'],
      related: ['who-sees-what', 'deputies', 'gig-workspace'],
      body: [
        { type: 'p', text: 'Each person in a band can have a default fee. When an admin adds them to a new gig or quote, their fee is pre-filled with it (rehearsals carry no fee); without one, the band’s member rate from **Pricing, fees & services** is used. The admin can change the fee on each gig.' },
        {
          type: 'steps',
          title: 'Admins: change a member’s instrument or default fee',
          items: [
            'On **Band members**, tap the person’s row.',
            'Under **In the band**, type the **Instrument in this band** (empty: their profile instrument is shown) and the **Default fee** (optional, a number like 150).',
            'Tap **Save**. The default fee is used for new gigs.',
          ],
        },
        { type: 'p', text: 'A member who opens their own row sees “Your default fee in this band: {fee}” when they have one.' },
        { type: 'p', text: 'Your own primary instrument is on your profile: tap your avatar, then **Edit** on your profile card, and pick it under **Primary instrument / role**. It shows on your Account Hub card.' },
        { type: 'p', text: 'The instrument next to each name on **Band members** is the one stored for that person in this band. The deputies’ **Who covers what** card groups the band by these instruments.' },
        { type: 'note', tone: 'privacy', text: 'Default fees follow the money rule: admins see everyone’s, a member sees only their own.' },
      ],
    },
    {
      id: 'band-details',
      title: 'Change the band’s name, logo, city and bio',
      summary: 'Edit the band card in the Account Hub; the logo also goes on quote PDFs.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['band name', 'logo', 'band photo', 'home base', 'city', 'tagline', 'bio', 'rename band'],
      related: ['member-roles', 'band-members'],
      body: [
        {
          type: 'steps',
          items: [
            'Tap your avatar at the top right to open the Account Hub.',
            'In the current band card, tap **Edit**.',
            'Under **Band logo**, tap **Upload** (or **Change**) and pick an image. Tap the bin (**Remove logo**) to take it off.',
            'Change **Band name**, **Home base city** (pick one of the **Suggested places** so travel fees can use its location) and **Band bio / tagline (optional)**.',
            'Tap **Save details**. Tap **Cancel** or **Close** to leave without saving.',
          ],
        },
        { type: 'p', text: 'The logo shows on the band card, in the band switcher and on quote PDFs. The home base city also becomes the starting point for travel fees in your pricing.' },
        { type: 'p', text: '**Band settings** under the band card opens the band’s branding and pricing (bank account, musician rates, quote services). See [[pricing-sheet]].' },
        { type: 'note', tone: 'privacy', text: 'Members see the band’s name, logo, city and bio, never its bank, tax or pricing details.' },
      ],
    },

    // ── Deputies ─────────────────────────────────────────────────────────
    {
      id: 'deputies',
      title: 'Deputies: stand-in musicians',
      summary: 'The band’s list of session players, how requests reach them, and what they can and can’t see.',
      roles: ['admin', 'deputy'],
      kind: 'reference',
      keywords: ['deputy', 'dep', 'sub', 'substitute', 'stand-in', 'session musician', 'replacement'],
      related: ['add-a-deputy', 'ask-a-deputy', 'deputy-reply-page', 'deputy-gigs', 'unlink-a-deputy', 'deputy-notifications', 'who-sees-what'],
      body: [
        { type: 'p', text: 'A deputy is a musician outside the band who plays when a member can’t. The band keeps a list of deputies with their instrument, contacts and usual fee. Deputies don’t need a BandWith account.' },
        {
          type: 'list',
          title: 'How it works',
          items: [
            'An admin adds deputies on **Band members**, under **Deputies** ([[add-a-deputy]]).',
            'When a member declines a gig, the admin taps **Find a deputy** in the gig’s lineup and sends a request by WhatsApp, SMS or email ([[ask-a-deputy]]).',
            'The message carries a private link to a reply page. The deputy answers there in one tap, without an account ([[deputy-reply-page]]).',
            'The admins get a notification with the answer.',
            'If the deputy opens BandWith from that link and signs in, their account is linked to the band’s entry. From then on the band can **Ask in the app** and the deputy answers in **Deputy gigs** ([[deputy-gigs]]).',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Adds, edits and deletes deputies; sees their phone, email, usual fee and notes; sends, follows and cancels requests; unlinks a deputy’s account.' },
            { role: 'member', text: 'Doesn’t see the deputies list or the requests. A member who opens a deputy link of their own band is told “You’re already in {band}”.' },
            { role: 'deputy', text: 'Sees only their own requests: band name, gig title, date, load-in, soundcheck and show times, venue and city, the role and the fee offered. The street address appears only after they say yes.' },
          ],
        },
        { type: 'note', tone: 'privacy', text: 'A deputy never sees the client, the gig price, the other musicians’ fees, the setlist, the chat or anything else in the band.' },
        { type: 'note', tone: 'tip', text: 'A deputy who says yes is not added to the gig’s lineup. The admins follow them under **Deputies asked** in the lineup sheet.' },
      ],
    },
    {
      id: 'add-a-deputy',
      title: 'Add, edit or delete a deputy',
      summary: 'Keep the band’s list of stand-ins, and see which instruments still have nobody.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['add deputy', 'new deputy', 'who covers what', 'session player'],
      related: ['deputies', 'ask-a-deputy', 'unlink-a-deputy'],
      body: [
        {
          type: 'steps',
          items: [
            'On **Band members**, scroll down to **Deputies**.',
            'Tap **Add deputy** (the + next to the title). In **Who covers what**, the + next to an instrument with “No deputy yet” opens the form with that instrument filled in.',
            'Fill in **Name** (required), **Instrument**, **Phone (WhatsApp)**, **Email**, **Usual fee** and **Notes** (for example “Reads charts, has own gear”).',
            'Tap **Add deputy**.',
          ],
        },
        {
          type: 'steps',
          title: 'Edit or delete',
          items: [
            'Tap the deputy in the list.',
            'Change the fields and tap **Save**.',
            'To delete, tap **Delete deputy**, then **Delete** on “Delete deputy?”.',
          ],
        },
        {
          type: 'list',
          title: 'Who covers what',
          items: [
            'Lists each instrument the band plays, the members who play it and its deputies.',
            'The line above says “Every instrument in the band has a deputy.” or how many have none.',
          ],
        },
        { type: 'p', text: 'A deputy with a BandWith account shows the **On BandWith** tag, and their sheet says they answer in the app.' },
        { type: 'note', tone: 'warning', text: 'Deleting a deputy removes them from the band’s list. Past requests keep their name and answer. You can add them again later.' },
        { type: 'note', tone: 'privacy', text: 'Only admins see this list (“Only admins see this list.”).' },
        { type: 'devices', rows: [{ devices: ['tablet', 'duoLand'], text: 'Deputies are shown in two columns when the screen is wide.' }] },
      ],
    },
    {
      id: 'ask-a-deputy',
      title: 'Ask a deputy to cover a gig',
      summary: 'From the gig’s lineup, send a request by message or in the app and follow the answer.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['find a deputy', 'ask deputy', 'replace member', 'cover gig', 'sub', 'WhatsApp'],
      related: ['deputies', 'deputy-reply-page', 'deputy-notifications', 'gig-workspace'],
      body: [
        { type: 'p', text: 'You can ask a deputy when a member has declined an upcoming band gig. Rehearsals, personal gigs and past gigs don’t offer it.' },
        {
          type: 'steps',
          items: [
            'Open the gig and, in the **LINEUP** section, tap the list of names (not **EDIT**) to open the **Lineup** sheet.',
            'Next to the member who declined, tap **Find a deputy**. The sheet shows “Replacing {name}” and the band’s deputies, those who play the same instrument first.',
            'For a deputy on BandWith, tap **Ask in the app**. They get a notification.',
            'Otherwise tap **WhatsApp**, **SMS** or **Email**. Your messaging app opens with the gig details and the reply link filled in. Send it from your phone.',
            'Come back to BandWith. The deputy’s answer appears under their name: **Asked · no answer yet**, **Available**, **Will confirm later** or **Can’t make it**, with their note.',
          ],
        },
        {
          type: 'list',
          title: 'After the answer',
          items: [
            'After a yes, the buttons send the recap instead (**Send recap**, **Recap in the app**) with the full address and the calendar link.',
            'If you change the date, times or venue after they answered, the deputy is flagged “The gig changed after their answer: send them the update.” The buttons send the update (**Send update**, **Update in the app**).',
            '**Copy link** copies the reply link. **Cancel request** withdraws it; a linked deputy gets a notification.',
            'The lineup sheet lists every open request under **Deputies asked**.',
          ],
        },
        {
          type: 'list',
          title: 'What the request says',
          items: [
            'Band name, gig title, date and time, venue and city, the role, and the fee.',
            'The fee is the replaced member’s fee on this gig, or the deputy’s usual fee when none is set.',
            'The street address goes only into the recap and the update, after a yes.',
          ],
        },
        { type: 'shot', id: 'people-find-deputy', caption: 'Find a deputy, replacing a member who declined: each deputy with Ask in the app, WhatsApp, SMS and Email.' },
        { type: 'note', tone: 'tip', text: '“Already sent a moment ago.” means you tapped twice: the same in-app request goes out at most once every 2 minutes.' },
        { type: 'note', tone: 'tip', text: 'No deputies yet? The sheet offers **Add deputies**, which takes you to the list.' },
      ],
    },
    {
      id: 'deputy-reply-page',
      title: 'The deputy reply page',
      summary: 'What a deputy sees when they open the link in a request, and how they answer without an account.',
      roles: ['deputy', 'admin'],
      kind: 'reference',
      keywords: ['deputy link', 'reply link', 'deputy.html', 'answer request', 'no account'],
      related: ['ask-a-deputy', 'deputy-gigs', 'deputies'],
      body: [
        { type: 'p', text: 'The link in a request opens a small web page in the deputy’s browser. No app or account is needed. It shows in the deputy’s language when available.' },
        {
          type: 'list',
          title: 'What the deputy sees',
          items: [
            '“{band} is looking for a deputy for this gig.” with the date, load-in, soundcheck, show times, venue, city, role and fee offered.',
            'Three answers: **Yes, I\'m available**, **Not sure yet, I\'ll confirm later**, **No, I can\'t**, and **Message to the band (optional)**.',
            'After a yes: the address, **Open in Maps** and **Add to your calendar** (**Apple Calendar · Outlook**, **Google Calendar**, or **Subscribe · updates by itself**).',
            '**Change your answer** stays available until the gig.',
            'If the band changes the gig after the answer: **Something changed** with the old and new values, and **Still OK** or **I can\'t anymore**.',
            '**Get BandWith** opens the app and links the account. See [[deputy-gigs]].',
          ],
        },
        {
          type: 'list',
          title: 'When the link stops working',
          items: [
            '“This request is closed.” The band withdrew the request.',
            '“The gig was cancelled.”',
            '“This gig is over.” from the day after the gig.',
            '“This link doesn’t work.” The band unlinked the deputy or the link is wrong. Ask the band to send the request again.',
          ],
        },
        { type: 'note', tone: 'privacy', text: 'The link is the key: anyone who has it can answer. If it reached the wrong person, an admin can unlink the deputy, which replaces every link ([[unlink-a-deputy]]).' },
      ],
    },
    {
      id: 'deputy-in-the-app',
      title: 'Answer deputy requests in the app',
      summary: 'Link your BandWith account to a band’s deputy list from the reply link, then answer in Deputy gigs.',
      roles: ['deputy'],
      kind: 'task',
      keywords: ['deputy account', 'claim', 'link account', 'get BandWith', 'deputy app'],
      related: ['deputy-gigs', 'deputy-reply-page', 'unlink-a-deputy'],
      body: [
        {
          type: 'steps',
          items: [
            'Open the reply link a band sent you and tap **Get BandWith**.',
            'In the app, create an account or sign in. The welcome screen says “{band} calls you as a deputy.”',
            'Wait for “Linking your account to the band…”. Then you see “You’re on {band}’s deputy list”.',
            'Tap **OK**. Your requests from that band are listed in **Deputy gigs**.',
          ],
        },
        {
          type: 'list',
          title: 'Other messages',
          items: [
            '“This link belongs to another account”: the band linked it to someone else. Ask them for a new request.',
            '“You’re already in {band}”: you are a member of that band, so you can’t be its deputy.',
            '“Couldn’t link your account to the band. Check your connection.”: tap **Try again**. The app also retries when you are back online.',
          ],
        },
        { type: 'p', text: 'From then on the band’s admins can ask you in the app and you get notifications. They are told “{deputy} is on BandWith”.' },
        { type: 'note', tone: 'tip', text: 'The link waits for you even if you need to sign up first or the app restarts.' },
      ],
    },
    {
      id: 'deputy-gigs',
      title: 'Deputy gigs',
      summary: 'Every request bands sent you as a deputy, with your answers, the address after a yes and calendar links.',
      roles: ['deputy'],
      kind: 'reference',
      keywords: ['deputy gigs', 'my deputy requests', 'calendar feed', 'subscribe', 'webcal'],
      related: ['deputy-in-the-app', 'deputy-notifications', 'deputy-reply-page'],
      body: [
        {
          type: 'list',
          title: 'Where to find it',
          items: [
            'No band of your own: **Deputy gigs** is your home screen. **Playing in a band too?** offers **Set up your band** and **Sign out**.',
            'With a band: tap your avatar, then **Deputy gigs** (“Requests from {count} bands”) at the top of the Account Hub.',
            'Tapping a deputy notification opens it at that request.',
          ],
        },
        {
          type: 'list',
          title: 'Each request',
          items: [
            'The gig title and band, with a status: **Waiting for your answer**, **You said yes**, **You\'ll confirm later**, **You said you can\'t**, **Request withdrawn**, **Gig cancelled** or **Gig over**.',
            'Date, load-in, soundcheck, show, venue, city, role and **Fee offered**. The address appears after a yes.',
            'To answer: **Yes**, **Not sure yet** or **No, I can\'t**, with an optional message. Later, **Change your answer**.',
            'If the gig changed: **Something changed**, then **Still OK** or **I can\'t anymore**.',
            'After a yes: **Open in Maps**, **Add to calendar**, **Google Calendar** and **Subscribe to my gigs**.',
          ],
        },
        { type: 'p', text: 'Open requests come first; closed ones are under **Past and closed**. Requests show from 30 days ago on. The line at the top lists “Bands that call you as a deputy”.' },
        { type: 'p', text: '**Subscribe to my gigs** adds a calendar feed of your confirmed gigs with that band. It follows every change and marks cancelled gigs, so your calendar stays right without opening BandWith.' },
        { type: 'shot', id: 'people-deputy-gigs', caption: 'Deputy gigs: a request from another band waiting for an answer.' },
        {
          type: 'devices',
          rows: [
            { devices: ['duoBook', 'duoLand'], text: 'As a home screen, the BandWith brand page sits on the first screen and your gigs on the second, like sign-in.' },
            { devices: ['duoLaptop'], text: 'As a home screen in Laptop pose, the header stays on the upper half and your requests on the lower half. While you type a message, the box stays in sight, above the keyboard or just above the fold.' },
          ],
        },
      ],
    },
    {
      id: 'unlink-a-deputy',
      title: 'Unlink a deputy’s BandWith account',
      summary: 'When the wrong person opened the link, or the deputy changed account.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['unlink', 'wrong account', 'forwarded link', 'new link', 'rotate'],
      related: ['deputies', 'deputy-in-the-app', 'ask-a-deputy'],
      body: [
        {
          type: 'steps',
          items: [
            'On **Band members**, under **Deputies**, tap the deputy with the **On BandWith** tag.',
            'In the **On BandWith** box, tap **Unlink account**.',
            'Read “Unlink BandWith account?” and tap **Unlink**.',
          ],
        },
        {
          type: 'list',
          title: 'What happens',
          items: [
            'That account stops getting requests in the app and no longer sees this band’s gigs in **Deputy gigs**.',
            'Every link already sent to this deputy gets replaced. Old reply pages, calendar feeds and app links stop working.',
            'Their answers stay as they were.',
            'Send the next request by message. Opening its new link from the app links the right account again.',
          ],
        },
        { type: 'note', tone: 'warning', text: 'This can’t be undone: the old links never work again.' },
      ],
    },
    {
      id: 'deputy-notifications',
      title: 'Deputy notifications',
      summary: 'Which notifications admins and deputies get during a request.',
      roles: ['admin', 'deputy'],
      kind: 'reference',
      keywords: ['deputy push', 'deputy notification', 'deputy answered'],
      related: ['ask-a-deputy', 'deputy-gigs', 'notifications-inbox'],
      body: [
        {
          type: 'table',
          head: ['When', 'Who', 'Notification'],
          rows: [
            ['The deputy answers or changes the answer', 'All active admins', '“{deputy} is available”, “will confirm later” or “can’t make it”, with the gig and their note'],
            ['The deputy confirms after a change', 'All active admins', '“{deputy} is OK with the changes”'],
            ['A deputy links their account', 'All active admins', '“{deputy} is on BandWith”'],
            ['A new request, or **Ask in the app** again', 'Linked deputy', '“{band}: can you play?”'],
            ['**Recap in the app** after a yes', 'Linked deputy', '“You’re confirmed: {gig}”'],
            ['Date, times or venue change after they answered', 'Linked deputy', '“{gig} has changed”, with what changed and “Still OK?”'],
            ['The gig is cancelled', 'Linked deputy', '“{gig} is cancelled”'],
            ['The admin cancels the request', 'Linked deputy', '“{band} no longer needs you”'],
          ],
        },
        { type: 'p', text: 'Admin notifications open the gig. Deputy notifications open **Deputy gigs** at that request. A deputy without the app gets nothing automatically: send the update from **Find a deputy**.' },
        { type: 'note', tone: 'tip', text: 'Bursts are merged: the same request, recap or change notice reaches a deputy at most once every 2 minutes.' },
      ],
    },

    // ── Gear ─────────────────────────────────────────────────────────────
    {
      id: 'gear-inventory',
      title: 'Gear & inventory',
      summary: 'The band’s equipment list with categories, status, location and who owns each item.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['gear', 'inventory', 'equipment', 'backline', 'PA', 'gear list'],
      related: ['add-gear', 'gear-status', 'gear-kits', 'kit-for-a-gig'],
      body: [
        {
          type: 'steps',
          title: 'Open it',
          items: [
            'Admins: on Home, under **Quick Actions**, tap **Gear list**.',
            'Everyone: tap your avatar, then the **Gear & inventory** tile under **Band assets & workflows**.',
          ],
        },
        {
          type: 'list',
          title: 'What you see',
          items: [
            'Two tabs: **Items** and **Kits** ([[gear-kits]]).',
            'A search field (**Search equipment, mics, cables…**) and category chips with counts: **All**, **Instruments**, **Cables**, **Microphones**, **Speakers**, **Stands**, **Lighting**, **Cases**, the band’s own categories, then **Other**.',
            'Each item: name, status dot, and a line with “Personal · {name}” for someone’s own gear, the category, “qty {count}” and the location.',
            'Items you may change have an edit and a delete button. Items you can’t change show a lock instead, and a note under the list says who can change them.',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Adds, edits and deletes any item, the band’s and the members’ personal gear, and manages kits.' },
            { role: 'member', text: 'Sees all the band’s gear and kits. Adds their own gear with **Add my gear** and changes or deletes only that.' },
          ],
        },
        { type: 'p', text: 'The Account Hub tile shows the item count and a status line: “{count} in repair”, “{count} missing” or “All in order”.' },
        { type: 'shot', id: 'people-gear', caption: 'Gear & kits on a tablet: the kits strip above the item list.' },
        {
          type: 'devices',
          rows: [
            { devices: ['tablet'], text: 'The screen is called **Gear & kits**. Kits are a strip of tiles above the items, with no Items/Kits tabs.' },
            { devices: ['duoBook', 'duoLand'], text: 'A kit opens on the second screen.' },
          ],
        },
      ],
    },
    {
      id: 'add-gear',
      title: 'Add, edit or delete an item of gear',
      summary: 'Add equipment as the band’s or as your own, and keep its details up to date.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['add equipment', 'add my gear', 'personal gear', 'edit item', 'delete item', 'serial number'],
      related: ['gear-inventory', 'gear-status', 'who-sees-what'],
      body: [
        {
          type: 'steps',
          items: [
            'On **Gear & inventory**, tap **Add equipment** (admins) or **Add my gear** (members), or the + at the top right.',
            'Type the **Item name**, for example “Shure SM58”.',
            'Admins: under **Belongs to**, pick **The band** or **Me (personal)**. Members’ items are always theirs.',
            'Pick a **Category** and a **Status**, set the **Quantity**, and fill in **Location / who has it**.',
            'No category fits? Tap **Custom** and type a **Category name** (up to 40 characters). It then shows as a chip for the whole band.',
            'Optionally add **Serial number**, **Purchase date**, **Purchase price** and **Notes**.',
            'Tap **Save item**.',
          ],
        },
        {
          type: 'steps',
          title: 'Edit or delete',
          items: [
            'Tap the item (**Edit {name}**), change it and tap **Save changes**.',
            'To delete, tap **Delete item** in the sheet, or the bin on the item’s row.',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Can edit every item, change who it belongs to, and delete anything.' },
            { role: 'member', text: 'Can edit and delete only items marked as theirs. The sheet says “Personal gear: the band sees it, only you and the admins can change it.” Other items show a lock instead of the buttons.' },
          ],
        },
        { type: 'note', tone: 'warning', text: 'The bin on a row, or **Delete item** in the sheet, asks “Delete {name}?” first. Deleting an item also takes it out of every kit.' },
        { type: 'note', tone: 'privacy', text: 'Everyone in the band sees every item, its status and where it is. The **Serial number**, **Purchase date** and **Purchase price** are shown only to admins, and to the owner of personal gear.' },
      ],
    },
    {
      id: 'gear-status',
      title: 'Gear status and location',
      summary: 'What Available, In use, Maintenance and Lost mean, and how they feed the kit and hub counters.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['status', 'in repair', 'maintenance', 'lost', 'missing', 'location', 'who has it'],
      related: ['gear-inventory', 'gear-kits'],
      body: [
        {
          type: 'table',
          head: ['Status', 'Meaning', 'Ready for a gig?'],
          rows: [
            ['**Available**', 'In its place, free to take', 'Yes'],
            ['**In use**', 'Out with someone', 'Yes'],
            ['**Maintenance**', 'Being repaired', 'No: counted as “repair”'],
            ['**Lost**', 'Missing', 'No: counted as “missing”'],
          ],
        },
        { type: 'p', text: 'You pick **Available**, **In use**, **Maintenance** or **Lost** when you edit an item.' },
        { type: 'p', text: '**Location / who has it** is free text: a room, a case, a van or a person’s name. Use it to find gear before a gig.' },
        { type: 'p', text: 'Kits count their ready items (“{ready}/{total} ready”) and warn about the rest (“{count} items need a look · check it before {gig}.”).' },
      ],
    },
    {
      id: 'gear-kits',
      title: 'Create and edit a gear kit',
      summary: 'Bundle the gear you take to one kind of gig, like a club PA or an acoustic duo set.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['kit', 'gear kit', 'bundle', 'packing list', 'PA kit'],
      related: ['kit-for-a-gig', 'gear-inventory', 'gear-status'],
      body: [
        {
          type: 'steps',
          items: [
            'On **Gear & inventory**, open the **Kits** tab and tap **New kit**.',
            'Type the **Kit name** (up to 80 characters) and, if you like, **Notes** such as how it packs.',
            'Under **Items from your inventory**, tick the items. Search when the list is long.',
            'Tap **Create kit**.',
          ],
        },
        {
          type: 'steps',
          title: 'Edit or delete',
          items: [
            'Tap the kit to open it, then tap **Edit**.',
            'Change the name, notes or items and tap **Save changes**.',
            'To delete, tap **Delete kit**, then tap again (**Tap again to delete the kit**). The items stay in the inventory.',
          ],
        },
        {
          type: 'list',
          title: 'The kit page',
          items: [
            'Counters: **Items**, **Cases** and **Ready**.',
            '**Next gig with this kit**, and a warning when items are in maintenance or lost.',
            'The list of items with their status.',
            '**Use for a gig** ([[kit-for-a-gig]]).',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Creates, edits, deletes and uses kits.' },
            { role: 'member', text: 'Sees the kits, their items and readiness, without edit buttons.' },
          ],
        },
      ],
    },
    {
      id: 'kit-for-a-gig',
      title: 'Use a kit for a gig',
      summary: 'Attach a kit to a gig so the band knows what goes on the van.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['assign gear', 'gear for gig', 'kit for gig', 'pick a kit'],
      related: ['gear-kits', 'gig-workspace', 'gear-status'],
      body: [
        {
          type: 'steps',
          title: 'From the gig',
          items: [
            'Open the gig. In the **GEAR KIT** section, tap **PICK A KIT** (or **CHANGE** if one is set).',
            'In **Kit for this gig**, tap **Add kit** next to each kit you need. Tap **Kit added** to take one off.',
            'Tap **Done**.',
          ],
        },
        {
          type: 'steps',
          title: 'From the kit',
          items: [
            'Open the kit and tap **Use for a gig**.',
            'Tap **Add kit** next to each upcoming gig. Tap **Done**.',
          ],
        },
        { type: 'p', text: 'The gig then shows the kit with its items and “All ready” or how many need a look. The kit shows its next gig.' },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Picks and changes the kits on upcoming band gigs.' },
            { role: 'member', text: 'Sees the gig’s kit and its readiness, without the PICK A KIT button.' },
          ],
        },
        { type: 'note', tone: 'tip', text: 'Kits are for band gigs: rehearsals, quotes and personal gigs have no GEAR KIT section. Using a kit doesn’t change the items’ status.' },
        { type: 'devices', rows: [{ devices: ['tablet'], text: 'The GEAR KIT section is in the gig’s rider tab.' }] },
      ],
    },

    // ── Privacy reference ────────────────────────────────────────────────
    {
      id: 'who-sees-what',
      title: 'Who sees what',
      summary: 'Every kind of band data, and what admins, members and deputies can read or change.',
      roles: ['admin', 'member', 'deputy'],
      kind: 'reference',
      keywords: ['privacy', 'permissions', 'visibility', 'fees', 'who can see', 'roles'],
      related: ['member-roles', 'deputies', 'member-detail', 'add-gear'],
      body: [
        { type: 'p', text: 'Money, quote prices, contracts and other people’s fees are protected by the server, not only hidden in the app: a member’s phone never receives them.' },
        {
          type: 'table',
          head: ['Data', 'Admin', 'Member'],
          rows: [
            ['Gig details (date, times, venue, address, dress code, notes, rider and stage plan)', 'Everything, plus client, gig price, deposit, payment status, internal notes and contract', 'The logistics of the gigs they play and haven’t declined. Never the client, price, deposit, internal notes or contract'],
            ['Gig lineup and answers', 'Everyone, with fees and payouts', 'Who plays and their answers, without fees'],
            ['Own fee', 'Yes', 'Yes: their fee per gig, paid or not, their default fee, and their own **Paid · {year}**'],
            ['Other people’s fees', 'Yes, for every member and deputy', 'No'],
            ['Quotes and quote totals', 'Yes: create, send and see all', 'No. A quote’s availability check shows only the date'],
            ['Band finances, payments and analytics', 'Yes', 'No. Only their own earnings'],
            ['Pricing, bank and tax details', 'Yes', 'No'],
            ['Setlists', 'Create, edit, attach to gigs', 'Read only'],
            ['Repertoire (songs, lyrics, chords)', 'Add, edit, delete, import', 'Read; suggest songs and changes; private notes and files only they see'],
            ['Contracts and riders', 'Yes', 'No contracts. The gig shows the rider’s version and the stage plan'],
            ['Chat', 'Band chat, gig chats, direct chats with anyone in the band', 'Band chat, chats of gigs they play, direct chats only with admins'],
            ['Gear and kits', 'See and change everything', 'See every item, its status and location; serial number, purchase date and price only on their own personal gear; change only their own personal gear'],
            ['Member contact details', 'Email and phone of everyone in the band', 'Email and phone of everyone in the band'],
            ['Deputy list and requests', 'Yes: contacts, usual fees, notes, answers', 'No'],
            ['Personal gigs and private song notes', 'Only their own', 'Only their own'],
          ],
        },
        {
          type: 'table',
          head: ['Data', 'Deputy'],
          rows: [
            ['Gig details', 'Only for gigs they were asked to play: band name, title, date, load-in, soundcheck and show times, venue and city. The street address only after a yes'],
            ['Own fee', 'The fee offered in each request'],
            ['Other fees, quotes, finances, pricing', 'No'],
            ['Lineup, setlists, repertoire, contracts, chat, gear', 'No'],
            ['Member contact details', 'No'],
            ['Deputy info', 'Their own requests and the name the band saved for them'],
          ],
        },
        { type: 'note', tone: 'privacy', text: 'Members and deputies see only their own fee and the logistics. They never see other people’s fees, quote totals or the band’s finances.' },
        { type: 'note', tone: 'tip', text: 'A member’s personal gigs (the ones outside any band) are private: only they can see them. Bands never see their title, venue or time.' },
      ],
    },
  ],

  faq: [
    { q: 'Can members see what the others are paid?', a: 'No. A member sees only their own fee on each gig and their own yearly totals. Admins see everyone’s.' },
    { q: 'How do I leave a band?', a: 'On **Band members**, tap **⋯** on your own row, then **Leave band**. An admin can leave while the band has another admin. See [[leave-a-band]].', roles: ['admin', 'member'] },
    { q: 'Why can’t I remove the last admin?', a: 'Every band needs at least one admin. Make someone else admin first, then change or remove the first one.', roles: ['admin'] },
    { q: 'How long is an invite valid?', a: '7 days. The invited address gets a reminder when 2 days are left. Inviting the same address again renews it.', roles: ['admin'] },
    { q: 'The person I invited says the invite doesn’t work.', a: 'They must sign in with the exact email address you invited. If it expired, invite them again.', roles: ['admin'] },
    { q: 'Does a deputy need the app?', a: 'No. The request link opens a web page where they answer in one tap. With the app they get notifications and see all their requests in Deputy gigs.' },
    { q: 'Can a deputy see the gig price or the client?', a: 'No. A deputy sees only the logistics, their role and the fee offered to them. The street address appears after they say yes.' },
    { q: 'The wrong person opened a deputy link. What do I do?', a: 'Open the deputy on Band members, tap Unlink account and confirm. All old links stop working; send the next request by message.', roles: ['admin'] },
    { q: 'Can members add gear?', a: 'Yes, their own personal gear with Add my gear. They can change or delete only that. The band’s gear is managed by admins.', roles: ['member'] },
    { q: 'Do members see deputies?', a: 'No. The deputies list and the requests are admin-only.' },
    { q: 'Where do I change the band logo?', a: 'Account Hub, current band card, Edit, Band logo. It also goes on your quote PDFs.', roles: ['admin'] },
    { q: 'Where do I set a member’s default fee?', a: 'On **Band members**, tap the person, then **In the band**: **Default fee** and **Save**. It is used for new gigs.', roles: ['admin'] },
  ],

  glossary: [
    { term: 'Admin', definition: 'A person who manages the band: gigs, money, setlists, members and settings. A band can have several and needs at least one.', see: 'member-roles' },
    { term: 'Member', definition: 'A person in the band who sees its gigs and logistics and their own fee, but doesn’t manage it.', see: 'member-roles' },
    { term: 'Invite code', definition: 'The code in a band invitation. Paste it, or open the invite link, to join the band.', see: 'accept-an-invite' },
    { term: 'Deputy', definition: 'A musician outside the band who stands in when a member can’t play. Also called a dep or sub.', see: 'deputies' },
    { term: 'Reply link', definition: 'The private link in a deputy request. It opens a web page where the deputy answers without an account.', see: 'deputy-reply-page' },
    { term: 'On BandWith', definition: 'A deputy whose BandWith account is linked to the band’s entry. The band can ask them in the app.', see: 'deputy-in-the-app' },
    { term: 'Deputy gigs', definition: 'The screen where a deputy sees and answers every request from the bands that call them.', see: 'deputy-gigs' },
    { term: 'Unlink', definition: 'Clearing a deputy’s linked account. All their old links stop working.', see: 'unlink-a-deputy' },
    { term: 'Who covers what', definition: 'The card on the deputies list that shows, for each instrument, the members and deputies who play it.', see: 'add-a-deputy' },
    { term: 'Personal gear', definition: 'Equipment a member adds as their own. The whole band sees it; only the owner and admins change it.', see: 'add-gear' },
    { term: 'Kit', definition: 'A named set of inventory items you take to a kind of gig, like a club PA.', see: 'gear-kits' },
    { term: 'Ready', definition: 'A kit item that can go to a gig: available or in use, not in maintenance or lost.', see: 'gear-status' },
  ],

  shots: [
    {
      id: 'people-band-members',
      how: 'Enter demo. On Home, scroll to Quick Actions and tap Members.',
      role: 'admin',
      viewport: 'phone',
    },
    {
      id: 'people-invite',
      how: 'Enter demo. Home → Quick Actions → Members → tap Invite member at the bottom. Type "ma" plus one more letter in the search field.',
      role: 'admin',
      viewport: 'phone',
    },
    {
      id: 'people-find-deputy',
      how: 'Enter demo. Tap Calendar, open the gig "Jazz Club Night", tap the names in the LINEUP section, then Find a deputy next to Lena P. (declined).',
      role: 'admin',
      viewport: 'phone',
    },
    {
      id: 'people-gear',
      how: 'Enter demo. On Home, under Quick Actions, tap Gear list.',
      role: 'admin',
      viewport: 'tablet',
    },
    {
      id: 'people-deputy-gigs',
      how: 'Enter demo. Tap the avatar at the top right to open the Account Hub, then tap Deputy gigs (the request from The Late Shift).',
      role: 'admin',
      viewport: 'phone',
    },
  ],
};

export default people;
