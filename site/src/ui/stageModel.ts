/**
 * The Stage mode demo's rules, kept apart from the DOM so they can be tested
 * (stageModel.test.ts). They follow the app's behaviour (src/app/components/
 * event/useStageLive.ts and useStageBle.ts):
 * - the leader (admin) moves the song for everyone who follows;
 * - a member who steps alone stops following until they tap Follow leader;
 * - songs struck off tonight are skipped by Prev / Next;
 * - without internet the phone apps keep following over Bluetooth, the web
 *   app can't (no Bluetooth there) and catches up when the internet is back;
 * - the band's click travels over Bluetooth too (PR #274): without internet
 *   it keeps flashing on the phone apps, not on the web app;
 * - the count-in travels over Bluetooth too (PR #311): without internet the
 *   phone apps show the same countdown on the same beat, the web app
 *   doesn't; a phone that gets it mid-count joins on the beat the others
 *   are on. It never starts the click by itself.
 */

export type Song = { title: string; key: string; dur: string; bpm: number };
export type Platform = 'iphone' | 'android' | 'web';
export type Member = { id: string; name: string; part: string; platform: Platform; following: boolean; song: number };
export type StageState = {
  online: boolean;
  leaderSong: number;
  struck: number[];
  click: boolean;
  /** A count-in is running (the leader tapped Count in). */
  count: boolean;
  members: Member[];
};

/** Demo setlist (titles, keys and lengths as in the Academy capture). */
export const SETLIST: Song[] = [
  { title: 'Superstition', key: 'Ebm', dur: '4:05', bpm: 100 },
  { title: 'September', key: 'Ab', dur: '3:35', bpm: 126 },
  { title: 'Valerie', key: 'Eb', dur: '3:53', bpm: 106 },
  { title: 'Uptown Funk', key: 'Dm', dur: '4:30', bpm: 115 },
  { title: 'Signed, Sealed, Delivered', key: 'F', dur: '2:40', bpm: 108 },
  { title: 'Ain’t No Mountain High Enough', key: 'Eb', dur: '2:32', bpm: 130 },
  { title: 'Get Lucky', key: 'Bm', dur: '4:08', bpm: 116 },
];

export function initialState(): StageState {
  return {
    online: true,
    leaderSong: 0,
    struck: [],
    click: false,
    count: false,
    members: [
      { id: 'sara', name: 'Sara', part: 'Vocals', platform: 'iphone', following: true, song: 0 },
      { id: 'nico', name: 'Nico', part: 'Drums', platform: 'android', following: true, song: 0 },
      { id: 'tom', name: 'Tom', part: 'Guitar', platform: 'web', following: true, song: 0 },
    ],
  };
}

/** Next playable song from `from` in direction `dir`, skipping struck ones; stays put at the ends. */
export function stepSong(from: number, dir: 1 | -1, struck: number[], n = SETLIST.length): number {
  for (let i = from + dir; i >= 0 && i < n; i += dir) if (!struck.includes(i)) return i;
  return from;
}

/** Can the leader's moves reach this member right now? */
export const reachable = (s: StageState, m: Member) => s.online || m.platform !== 'web';

const sync = (s: StageState): StageState => ({
  ...s,
  members: s.members.map((m) => (m.following && reachable(s, m) ? { ...m, song: s.leaderSong } : m)),
});

export function leaderGo(s: StageState, song: number): StageState {
  if (song < 0 || song >= SETLIST.length || song === s.leaderSong) return s;
  // Moving to another song hides the click for the song before, and ends its count-in.
  return sync({ ...s, leaderSong: song, click: false, count: false });
}

export const leaderStep = (s: StageState, dir: 1 | -1) => leaderGo(s, stepSong(s.leaderSong, dir, s.struck));

export function toggleStrike(s: StageState, song: number): StageState {
  if (song === s.leaderSong) return s; // the song on stage can't be struck off
  const struck = s.struck.includes(song) ? s.struck.filter((x) => x !== song) : [...s.struck, song].sort((a, b) => a - b);
  return { ...s, struck };
}

export function setOnline(s: StageState, online: boolean): StageState {
  // The click and a count-in under way keep running (Bluetooth carries them to the phone apps);
  // back online, everyone following catches up.
  return sync({ ...s, online });
}

export const toggleClick = (s: StageState): StageState => ({ ...s, click: !s.click });

/** The leader taps Count in (again: stops it). */
export const toggleCountIn = (s: StageState): StageState => ({ ...s, count: !s.count });
export const endCountIn = (s: StageState): StageState => (s.count ? { ...s, count: false } : s);

const patch = (s: StageState, id: string, f: (m: Member) => Member): StageState => ({
  ...s,
  members: s.members.map((m) => (m.id === id ? f(m) : m)),
});

/** A member looks ahead on their own: following stops. */
export const memberStep = (s: StageState, id: string, dir: 1 | -1) =>
  patch(s, id, (m) => ({ ...m, following: false, song: stepSong(m.song, dir, s.struck) }));

export const memberFollow = (s: StageState, id: string) =>
  patch(s, id, (m) => ({ ...m, following: true, song: reachable(s, m) ? s.leaderSong : m.song }));

export type Status = { label: string; tone: 'live' | 'bt' | 'off' };

export function leaderStatus(s: StageState): Status {
  return s.online ? { label: 'Live · BT', tone: 'live' } : { label: 'Bluetooth', tone: 'bt' };
}

export function memberStatus(s: StageState, m: Member): Status {
  if (!reachable(s, m)) return { label: 'Offline', tone: 'off' };
  if (!m.following) return { label: 'Follow leader', tone: 'off' };
  return s.online ? { label: 'Following leader', tone: 'live' } : { label: 'Following leader · BT', tone: 'bt' };
}

/** The band's click runs: it shows on the leader's phone and on every phone the leader reaches. */
export const clickOn = (s: StageState) => s.click;
/** The click on a member's phone: over the internet, or over Bluetooth in the phone apps. */
export const clickReaches = (s: StageState, m: Member) => s.click && reachable(s, m);

/** The count-in on a member's phone: over the internet, or over Bluetooth in the phone apps (like the click). */
export const countInReaches = (s: StageState, m: Member) => s.count && reachable(s, m);
/** How many of the band's phones show the count-in. */
export const countInSeen = (s: StageState) => s.members.filter((m) => countInReaches(s, m)).length;

export const inSync = (s: StageState) => s.members.filter((m) => m.song === s.leaderSong).length;
