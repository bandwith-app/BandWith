/**
 * A touch outside the field being typed in closes the on-screen keyboard,
 * but only once its tap is over.
 *
 * Found by the emulator check (Pixel 7, API 36): Rooftop Session → Edit venue,
 * keyboard up, a 120 ms press on CANCEL. The keyboard closed on touchstart,
 * the web view grew from 520 to 815 px before the finger lifted, CANCEL moved
 * from y 448 to 743, and the click went to the form behind it: no "Save your
 * changes?", only the keyboard closing. An instant tap still worked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyboardDismissOnTouch } from '../keyboardDismiss';

let uninstall: () => void;
let hide: ReturnType<typeof vi.fn<() => void>>;
let input: HTMLInputElement;
let other: HTMLInputElement;
let cancel: HTMLButtonElement;
let text: HTMLParagraphElement;
let chat: HTMLDivElement;
const log: string[] = [];

const touch = (type: string, el: Element, opts: { prevent?: boolean } = {}) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  if (opts.prevent) el.addEventListener(type, (ev) => ev.preventDefault(), { once: true });
  el.dispatchEvent(e);
};

function setup(platform: string) {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <form>
      <input id="address" />
      <input id="other" />
      <p id="text">Venue</p>
      <div data-keep-keyboard id="chat"><span>messages</span></div>
      <button type="button" id="cancel">Cancel</button>
    </form>`;
  input = document.getElementById('address') as HTMLInputElement;
  other = document.getElementById('other') as HTMLInputElement;
  cancel = document.getElementById('cancel') as HTMLButtonElement;
  text = document.getElementById('text') as HTMLParagraphElement;
  chat = document.getElementById('chat') as HTMLDivElement;
  log.length = 0;
  hide = vi.fn<() => void>(() => { log.push('hide'); });
  cancel.addEventListener('click', () => log.push('cancel clicked'));
  uninstall = installKeyboardDismissOnTouch({ hide, platform });
  input.focus();
}

afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

describe('iOS (the field keeps focus after a tap elsewhere)', () => {
  beforeEach(() => setup('ios'));

  it('a press on CANCEL: the keyboard stays up until the click has reached the button', () => {
    touch('touchstart', cancel);
    expect(hide).not.toHaveBeenCalled(); // the finger is still down: nothing moves under it
    vi.advanceTimersByTime(120);
    touch('touchend', cancel);
    expect(hide).not.toHaveBeenCalled();
    cancel.click();
    vi.advanceTimersByTime(0);
    expect(log).toEqual(['cancel clicked', 'hide']);
  });

  it('a tap on text outside the field closes it once the tap is over', () => {
    touch('touchstart', text);
    touch('touchend', text);
    text.click();
    vi.advanceTimersByTime(0);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('a touch that turns into a scroll closes it at once', () => {
    touch('touchstart', text);
    touch('touchcancel', text);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('a touch with no click after it (a handler took it on touchend) closes it then', () => {
    touch('touchstart', cancel);
    touch('touchend', cancel, { prevent: true });
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('a touch whose click never comes closes it shortly after', () => {
    touch('touchstart', text);
    touch('touchend', text);
    vi.advanceTimersByTime(399);
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('a tap that moves focus to another field keeps the keyboard for it', () => {
    touch('touchstart', text);
    touch('touchend', text);
    other.focus();
    text.click();
    vi.advanceTimersByTime(500);
    expect(hide).not.toHaveBeenCalled();
  });

  it('touching the field itself, or a data-keep-keyboard area, keeps it', () => {
    touch('touchstart', input);
    touch('touchend', input);
    touch('touchstart', chat.firstElementChild!);
    touch('touchend', chat.firstElementChild!);
    vi.advanceTimersByTime(500);
    expect(hide).not.toHaveBeenCalled();
  });

  it('nothing happens when no field is being typed in', () => {
    input.blur();
    touch('touchstart', cancel);
    touch('touchend', cancel);
    cancel.click();
    vi.advanceTimersByTime(500);
    expect(hide).not.toHaveBeenCalled();
  });
});

describe('Android (the tap moves focus to the button; the WebView closes the keyboard itself)', () => {
  beforeEach(() => setup('android'));

  it('a 120 ms press on CANCEL: no early close, the click lands on CANCEL', () => {
    touch('touchstart', cancel);
    vi.advanceTimersByTime(120);
    expect(hide).not.toHaveBeenCalled();
    touch('touchend', cancel);
    cancel.focus(); // Chromium focuses the button on the tap
    cancel.click();
    vi.advanceTimersByTime(500);
    expect(log).toEqual(['cancel clicked']);
  });

  it('data-keep-keyboard="android" keeps it up on Android only', () => {
    chat.setAttribute('data-keep-keyboard', 'android');
    touch('touchstart', chat.firstElementChild!);
    touch('touchcancel', chat.firstElementChild!);
    expect(hide).not.toHaveBeenCalled();
  });
});
