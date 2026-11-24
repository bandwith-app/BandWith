import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'rehearsals-polls',
  title: 'Rehearsals & polls',
  description: 'Schedule a rehearsal, or send the band a few dates to vote on. Run it in Live mode with a shared timer and notes. Everyone leaves with songs to practise.',
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
      { what: 'Starts, pauses and ends the rehearsal timer', admin: true, member: 'Sees it', deputy: false },
      { what: 'Writes rehearsal notes', admin: 'For anyone', member: 'For the band or themselves', deputy: false },
    ],
  },
  details: {
    heading: { lines: ['Less back', 'and forth.'] },
    lead: 'Three things to know first. The other six are sorted from the first date to the last song.',
    featured: [
      {
        title: 'One clock for the band',
        tag: 'Admin starts it',
        body: 'Start rehearsal, Pause for the break, then End. The Rehearsal summary keeps the time played and every song you went through.',
        ui: { shot: 'music-rehearsal-live', region: [0, 0.3], alt: 'Live mode at a weekly rehearsal: Start rehearsal, then Mark and Notes' },
      },
      {
        title: 'Songs to practise',
        tag: 'When it ends',
        body: 'Each person gets one push with their songs. Home shows To practise, and the next rehearsal opens with FROM LAST TIME.',
        ui: { shot: 'home-to-practise', region: [0.3, 0.68], alt: 'Home, To practise: Harbor Lights, from the rehearsal of Nov 15, tempo 96, with Practised' },
      },
      {
        title: 'A vote-by time',
        tag: 'Admin sets it',
        body: 'Pick a day before the first date and a time. Then the poll shows Voting closed, and an admin locks in a date.',
        ui: { shot: 'shot-poll-card', region: [0.13, 0.47], alt: 'A rehearsal poll on Home: Extra rehearsal next week, 3 of 5 answered, three dates and Vote now' },
      },
    ],
    groups: [
      {
        label: 'Finding the date',
        items: [
          { title: 'Members propose, admins decide', line: 'A member taps Propose rehearsal with the days that suit them. An admin builds the poll, or declines.' },
          { title: 'Free counts, not reasons', line: 'Each day in the builder shows how many members are free. Never who is busy, or why.' },
        ],
      },
      {
        label: 'Setting it up',
        items: [
          { title: 'The room, split', line: 'Enter the room cost and each share is worked out. Members see only their share.' },
          { title: 'Weekly, biweekly, monthly', line: 'One rehearsal with a repeat rule. Later: Delete this date, or Delete the whole series.' },
        ],
      },
      {
        label: 'In the room',
        items: [
          { title: 'Songs and prep tasks', line: 'Pick focus songs from the repertoire or a setlist. Add tasks like Bring chord charts, ticked off on the page.' },
          { title: 'Mark now, write later', line: 'Tap Mark when something needs work and keep playing. At the pause, To write lists the marks to finish.' },
        ],
      },
    ],
  },
  learn: [
    { id: 'create-a-rehearsal-poll', title: 'Create a poll', line: 'Offer a few dates and publish them to the band.' },
    { id: 'vote-in-a-rehearsal-poll', title: 'Vote', line: 'Tap the dates that work, or say none do.' },
    { id: 'lock-in-a-poll-date', title: 'Lock in a date', line: 'Pick the winner and create the rehearsal.' },
    { id: 'create-a-rehearsal', title: 'Create a rehearsal', line: 'Schedule it directly when you know the date.' },
    { id: 'stage-mode', title: 'Live mode at a rehearsal', line: 'The timer, the marks, the notes and what to practise.' },
    { id: 'the-rehearsal-page', title: 'The rehearsal page', line: 'Attendance, focus songs, tasks and the room.' },
  ],
};
