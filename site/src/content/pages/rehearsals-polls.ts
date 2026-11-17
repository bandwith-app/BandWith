import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'rehearsals-polls',
  title: 'Rehearsals & polls',
  description: 'Schedule a rehearsal directly, or send the band a few dates to vote on. Lock in the winning date and the rehearsal is created, with its room, cost, focus songs and prep tasks.',
  ogTitle: 'Rehearsals & polls · Find the date in one round.',
  hero: {
    heading: { lines: ['Find the date', 'in one round.'], em: 'round.' },
    lead: 'Offer the band a few dates. Everyone taps the ones they can make, an admin locks in the winner, and the rehearsal is in the calendar with the room, the cost and the songs to work on.',
    chips: [
      { icon: 'calendar', label: 'Schedule directly' },
      { icon: 'users', label: 'Who votes' },
      { icon: 'clock', label: 'Vote by' },
      { icon: 'list-music', label: 'Focus songs' },
    ],
    shot: 'shot-poll-card',
    region: [0.13, 0.44],
    alt: 'An active availability poll on Home: Extra rehearsal next week, three dates to vote on, 3 of 5 answered',
  },
  flow: {
    heading: { lines: ['From a question', 'to a date.'] },
    steps: [
      { title: 'Schedule it, or ask first', body: 'Tap Create, then New rehearsal. If you know the date, stay on Schedule directly: session type, roster, room, time. If you don’t, switch Scheduling mode to Poll availability.', shot: 'shot-rehearsal-wizard', region: [0.1, 0.42], badge: 'Scheduling mode' },
      { title: 'Offer a few dates', body: 'Leave out anyone who isn’t needed under Who votes. Add the room, its cost and the focus songs, then the dates: each day shows how many members are free. Set a vote-by time and tap Publish poll.', shot: 'shot-poll-builder', region: [0.42, 0.86], badge: '5 of 5 vote' },
      { title: 'The band votes', body: 'Everyone asked gets a push. The poll sits on Home and at the top of the Calendar. Tap each date you can make, tap it again to take it back, or None work if nothing fits. Votes update live.', shot: 'calendar-month', region: [0.19, 0.56], badge: '3 of 5 answered' },
      { title: 'Lock it in', body: 'Details · Lock in lists every date with who can make it, and the Top pick. Tap Lock in, check the place, then Confirm & create event. The rehearsal is created and the poll closes.', shot: 'shot-poll-card', region: [0.52, 0.86], badge: 'Top pick' },
    ],
  },
  demo: {
    kind: 'rehearsals-polls',
    heading: { lines: ['Three dates.', 'One rehearsal.'], em: 'rehearsal.' },
    lead: 'Leo wants an extra rehearsal before the wedding. Tap the dates you can make, then take Leo’s phone and lock in the top pick.',
  },
  roles: {
    heading: { lines: ['Admins schedule.', 'Members answer.'] },
    lead: 'Members propose, vote and answer each rehearsal. Deputies are asked for gigs, not rehearsals, so band rehearsals and polls stay with the band.',
    rows: [
      { what: 'Creates, edits and deletes rehearsals', admin: true, member: false, deputy: false },
      { what: 'Proposes a rehearsal to the admins', admin: { dash: 'Creates it' }, member: 'Once a week', deputy: false },
      { what: 'Publishes a poll and locks in a date', admin: true, member: false, deputy: false },
      { what: 'Votes in a poll', admin: true, member: 'When invited', deputy: false },
      { what: 'Answers GOING or CAN’T, drops out', admin: { dash: 'Marked going' }, member: true, deputy: false },
      { what: 'Chooses the focus songs', admin: true, member: false, deputy: false },
      { what: 'Sees the room cost', admin: 'The total', member: 'Their share, in a poll', deputy: false },
    ],
  },
  devices: {
    shot: 'shot-poll-card',
    heading: { lines: ['Vote on a phone.', 'Lock in anywhere.'] },
    lead: 'The poll card follows you: on Home, in the Calendar, beside an open gig on an iPad. Fold a Duo like a laptop and the vote sheet splits into a grid on top and your pads below.',
    tabs: [
      { dev: 'phone', cap: 'Phone · the poll in the Action center: date pads, then every date with Lock in.', alt: 'An availability poll on a phone' },
      { dev: 'tablet', cap: 'iPad · the Action center beside the open gig; the poll sits under Rehearsal scheduling.', alt: 'An availability poll on an iPad' },
      { dev: 'web', cap: 'Web · the same two columns, with Delete poll under the dates.', alt: 'An availability poll in a web browser' },
      { dev: 'duoClosed', cap: 'Duo closed · one column, with Create and the bell in the side rail.', alt: 'An availability poll on a closed Surface Duo' },
      { dev: 'duoBook', cap: 'Duo book · the poll on one pane, the gig you had open on the other.', alt: 'An availability poll on a Surface Duo open like a book' },
      { dev: 'duoLaptop', cap: 'Duo laptop · members and days on top, your pads and the Lock button below.', alt: 'The vote sheet on a Surface Duo folded like a laptop' },
    ],
  },
  details: {
    heading: { lines: ['Less back', 'and forth.'] },
    items: [
      { icon: 'users', title: 'Members propose, admins decide', body: 'A member taps Propose rehearsal with a topic and the days that suit them, once a week per band. An admin turns it into a poll with Build poll, or declines it with a reason.', wide: true },
      { icon: 'eye', title: 'Free counts, not reasons', body: 'Each day in the builder shows how many members are free, from their calendars. Never who is busy, or why.' },
      { icon: 'wallet', title: 'The room, split', body: 'Enter the room cost and each person’s share is worked out. In a poll members see only their share; the total stays with the admins.' },
      { icon: 'list-music', title: 'Songs and prep tasks', body: 'Pick focus songs from the repertoire or a saved setlist. Add tasks like Bring chord charts, ticked off on the rehearsal page.' },
      { icon: 'refresh', title: 'Weekly, biweekly, monthly', body: 'One rehearsal with a repeat rule, shown in the calendar about four months ahead. One roster and one answer for the series.' },
      { icon: 'clock', title: 'A vote-by time', body: 'Pick a day before the first date and a time. Then voting closes, the poll shows Voting closed, and an admin locks in a date.', wide: true },
    ],
  },
  learn: [
    { id: 'create-a-rehearsal-poll', title: 'Create a poll', line: 'Offer a few dates and publish them to the band.' },
    { id: 'vote-in-a-rehearsal-poll', title: 'Vote', line: 'Tap the dates that work, or say none do.' },
    { id: 'lock-in-a-poll-date', title: 'Lock in a date', line: 'Pick the winner and create the rehearsal.' },
    { id: 'create-a-rehearsal', title: 'Create a rehearsal', line: 'Schedule it directly when you know the date.' },
    { id: 'propose-a-rehearsal', title: 'Propose a rehearsal', line: 'Ask the admins for one, with the days that suit you.' },
    { id: 'the-rehearsal-page', title: 'The rehearsal page', line: 'Attendance, focus songs, tasks and the room.' },
  ],
};
