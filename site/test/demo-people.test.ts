import { describe, expect, it } from 'vitest';
import { markup } from '../src/content/demos/people';
import {
  initialPeople, find, close, ask, answer, cancelRequest, addressShown, showAnswers, inAppLabel, stepOf, LEO_STATUS, IVO_STATUS,
} from '../src/ui/demos/people';

describe('people demo', () => {
  it('has both phones, a reset and a live log', () => {
    const html = markup();
    expect(html).toContain('data-pd-phone="leo"');
    expect(html).toContain('data-pd-phone="ivo"');
    expect(html).toContain('data-pd-reset');
    expect(html).toContain('aria-live="polite"');
  });

  it('walks find → ask → yes, and the address shows only after the yes', () => {
    let s = initialPeople();
    expect(stepOf(s)).toBe(1);
    s = find(s);
    expect(stepOf(s)).toBe(2);
    s = ask(s);
    expect(s.req).toBe('pending');
    expect(LEO_STATUS[s.req!]).toBe('Asked · no answer yet');
    expect(IVO_STATUS[s.req!]).toBe('Waiting for your answer');
    expect(addressShown(s)).toBe(false);
    expect(showAnswers(s)).toBe(true);
    s = answer(s, 'available', '  I can bring my own amp ');
    expect(addressShown(s)).toBe(true);
    expect(s.note).toBe('I can bring my own amp');
    expect(LEO_STATUS[s.req!]).toBe('Available');
    expect(IVO_STATUS[s.req!]).toBe('You said yes');
    expect(inAppLabel(s)).toBe('Recap in the app');
    expect(stepOf(close(s))).toBe(4);
  });

  it('a no keeps the address hidden; a second ask is throttled', () => {
    let s = ask(find(initialPeople()));
    expect(ask(s).sent).toBe('throttled');
    s = answer(s, 'unavailable');
    expect(LEO_STATUS[s.req!]).toBe('Can’t make it');
    expect(addressShown(s)).toBe(false);
    expect(showAnswers(s)).toBe(false);
  });

  it('cancelling withdraws the request; answers then do nothing', () => {
    const s = cancelRequest(ask(find(initialPeople())));
    expect(IVO_STATUS[s.req!]).toBe('Request withdrawn');
    expect(answer(s, 'available')).toBe(s);
    expect(ask(s).req).toBe('pending');
  });
});
