import { describe, expect, it } from 'vitest';
import {
  initialState, stepSong, leaderStep, leaderGo, toggleStrike, setOnline, toggleClick,
  memberStep, memberFollow, memberStatus, leaderStatus, clickOn, inSync,
} from '../src/ui/stageModel';

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

  it('the band click needs the internet and stops when the song changes', () => {
    let s = toggleClick(initialState());
    expect(clickOn(s)).toBe(true);
    s = setOnline(s, false);
    expect(clickOn(s)).toBe(false);
    expect(toggleClick(s).click).toBe(false);
    s = toggleClick(setOnline(s, true));
    expect(leaderStep(s, 1).click).toBe(false);
  });
});
