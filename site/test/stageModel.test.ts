import { describe, expect, it } from 'vitest';
import {
  initialState, stepSong, leaderStep, leaderGo, toggleStrike, setOnline, toggleClick, toggleCountIn, endCountIn,
  memberStep, memberFollow, memberStatus, leaderStatus, clickOn, clickReaches, countInReaches, countInSeen, inSync,
} from '../src/ui/stageModel';
import { page as stage } from '../src/content/pages/stage';
import { ANSWERS, HOME_ANSWERS } from '../src/content/answers';
import { readFileSync } from 'fs';
import path from 'path';

const m = (s: ReturnType<typeof initialState>, id: string) => s.members.find((x) => x.id === id)!;

describe('Stage demo rules', () => {
  it('Next and Prev skip songs struck off tonight and stop at the ends', () => {
    expect(stepSong(0, 1, [1, 2])).toBe(3);
    expect(stepSong(3, -1, [1, 2])).toBe(0);
    expect(stepSong(6, 1, [])).toBe(6);
    expect(stepSong(0, -1, [])).toBe(0);
  });

  it('every following phone moves with the leader', () => {
    const s = leaderStep(initialState(), 1);
    expect(s.leaderSong).toBe(1);
    expect(inSync(s)).toBe(3);
  });

  it('the song on stage cannot be struck off; others toggle', () => {
    let s = initialState();
    expect(toggleStrike(s, 0).struck).toEqual([]);
    s = toggleStrike(s, 2);
    expect(s.struck).toEqual([2]);
    expect(leaderStep(leaderStep(s, 1), 1).leaderSong).toBe(3);
    expect(toggleStrike(s, 2).struck).toEqual([]);
  });

  it('without internet the apps follow over Bluetooth, the web app stays behind and catches up later', () => {
    let s = setOnline(initialState(), false);
    expect(leaderStatus(s).label).toBe('Bluetooth');
    s = leaderGo(s, 4);
    expect(m(s, 'sara').song).toBe(4);
    expect(memberStatus(s, m(s, 'sara')).label).toBe('Following leader · BT');
    expect(m(s, 'tom').song).toBe(0);
    expect(memberStatus(s, m(s, 'tom')).label).toBe('Offline');
    s = setOnline(s, true);
    expect(m(s, 'tom').song).toBe(4);
    expect(memberStatus(s, m(s, 'tom')).label).toBe('Following leader');
  });

  it('a member stepping alone stops following until Follow leader', () => {
    let s = memberStep(initialState(), 'nico', 1);
    expect(memberStatus(s, m(s, 'nico')).label).toBe('Follow leader');
    s = leaderGo(s, 5);
    expect(m(s, 'nico').song).toBe(1);
    s = memberFollow(s, 'nico');
    expect(m(s, 'nico').song).toBe(5);
  });

  // The app sends the click over Bluetooth too (PR #274, useStageLive: blePublishLive(CLICK_EVENT)).
  it('the band click keeps going without internet on the phone apps, and stops when the song changes', () => {
    let s = toggleClick(initialState());
    expect(clickOn(s)).toBe(true);
    s = setOnline(s, false);
    expect(clickOn(s)).toBe(true);
    expect(clickReaches(s, m(s, 'sara'))).toBe(true); // iPhone app, over Bluetooth
    expect(clickReaches(s, m(s, 'nico'))).toBe(true); // Android app, over Bluetooth
    expect(clickReaches(s, m(s, 'tom'))).toBe(false); // the web app has no Bluetooth
    // It can be started with no internet too.
    const off = setOnline(initialState(), false);
    expect(toggleClick(off).click).toBe(true);
    s = setOnline(s, true);
    expect(clickReaches(s, m(s, 'tom'))).toBe(true);
    expect(leaderStep(s, 1).click).toBe(false);
  });

  // The count-in goes over the internet only (useStageLive: setCountIn sends on the channel, never blePublishLive).
  it('the count-in shows on every phone with a connection, only on the leader’s without one', () => {
    let s = toggleCountIn(initialState());
    expect(s.count).toBe(true);
    expect(countInReaches(s)).toBe(true);
    expect(countInSeen(s)).toBe(3);
    s = toggleCountIn(setOnline(initialState(), false));
    expect(s.count).toBe(true); // the leader's own phone counts
    expect(countInReaches(s)).toBe(false);
    expect(countInSeen(s)).toBe(0);
  });

  it('a count-in ends at Go, on Count in again, with another song and when the connection changes', () => {
    const s = toggleCountIn(initialState());
    expect(endCountIn(s).count).toBe(false);
    expect(toggleCountIn(s).count).toBe(false);
    expect(leaderStep(s, 1).count).toBe(false);
    expect(setOnline(s, false).count).toBe(false);
    const idle = initialState();
    expect(endCountIn(idle)).toBe(idle);
  });
});

describe('what the site says about the click and the count-in', () => {
  const SITE = path.resolve(__dirname, '..');
  const copy = [
    JSON.stringify(stage), JSON.stringify(ANSWERS), JSON.stringify(HOME_ANSWERS),
    readFileSync(path.join(SITE, 'src/ui/stageDemo.ts'), 'utf8'),
    readFileSync(path.join(SITE, 'src/i18n/dict/it.json'), 'utf8'),
    readFileSync(path.join(SITE, 'src/i18n/dict/es.json'), 'utf8'),
  ].join('\n');

  it('never says the click needs the internet or isn’t sent over Bluetooth', () => {
    expect(copy).not.toMatch(/click needs the internet|needs the internet: it isn’t sent|isn’t sent over Bluetooth|on every online phone/i);
    expect(copy).not.toMatch(/click (della band |visivo )?ha bisogno di internet|non viene inviato via Bluetooth|clic (de la banda |visual )?necesita internet|no se envía por Bluetooth/i);
  });

  it('says the click reaches nearby phones over Bluetooth, and that the count-in needs a connection', () => {
    const text = JSON.stringify(stage);
    expect(text).toMatch(/With no internet it reaches the phone apps nearby over Bluetooth/);
    expect(text).toMatch(/same click over Bluetooth/);
    expect(text).toMatch(/With no connection only the leader’s phone shows the countdown/);
    const faq = ANSWERS.stage.map((x) => x.a).join(' ');
    expect(faq).toMatch(/same visual click over Bluetooth/);
    expect(faq).toMatch(/with no signal only the leader’s phone shows it/);
  });
});
