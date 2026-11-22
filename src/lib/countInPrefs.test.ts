import { afterEach, describe, expect, it } from 'vitest';
import { COUNTIN_PREFS_KEY, __resetCountInPrefs, countInAudible, getCountInPrefs, parseCountInPrefs, setCountInPrefs } from './countInPrefs';

afterEach(() => {
  localStorage.clear();
  __resetCountInPrefs();
});

describe('count-in on this device', () => {
  it('is silent and still by default, and keeps the choices on the device', () => {
    expect(getCountInPrefs()).toEqual({ vibrate: false, sound: 'off', speaker: false });
    setCountInPrefs({ vibrate: true, sound: 'click' });
    __resetCountInPrefs();
    expect(getCountInPrefs()).toEqual({ vibrate: true, sound: 'click', speaker: false });
    expect(JSON.parse(localStorage.getItem(COUNTIN_PREFS_KEY)!)).toMatchObject({ vibrate: true });
    expect(parseCountInPrefs('{broken')).toEqual({ vibrate: false, sound: 'off', speaker: false });
    expect(parseCountInPrefs('{"sound":"loud"}').sound).toBe('off');
  });

  it('never through the phone’s speaker unless chosen', () => {
    const click = { vibrate: false, sound: 'click' as const, speaker: false };
    expect(countInAudible(click, { kind: 'wired' })).toBe(true);
    expect(countInAudible(click, { kind: 'usb' })).toBe(true);
    expect(countInAudible(click, { kind: 'speaker' })).toBe(false);
    // A browser can't tell: only when chosen.
    expect(countInAudible(click, null)).toBe(false);
    expect(countInAudible({ ...click, speaker: true }, { kind: 'speaker' })).toBe(true);
    expect(countInAudible({ ...click, sound: 'off', speaker: true }, { kind: 'wired' })).toBe(false);
  });
});
