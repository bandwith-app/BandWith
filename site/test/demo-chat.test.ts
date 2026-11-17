import { describe, expect, it } from 'vitest';
import { mentionQuery, mentionHtml, answerer, PEOPLE } from '../src/ui/demos/chat';
import { markup } from '../src/content/demos/chat';

describe('chat demo', () => {
  it('is the wedding chat: Leo M. (admin), Sara, Nico and Tom', () => {
    expect(Object.values(PEOPLE).map((p) => p.name)).toEqual(['Leo M.', 'Sara', 'Nico', 'Tom']);
    expect(Object.values(PEOPLE).filter((p) => p.admin).map((p) => p.name)).toEqual(['Leo M.']);
  });

  it('opens mentions after @ like the app, and bolds only names in the chat', () => {
    expect(mentionQuery('Ask @Ni', 7)).toEqual({ at: 4, q: 'Ni' });
    expect(mentionQuery('no mention', 10)).toBeNull();
    expect(mentionHtml('Ask @Nico now')).toContain('<b class="cm__at">@Nico</b>');
    expect(mentionHtml('mail me @home <x>')).not.toContain('<b');
    expect(mentionHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('has the person mentioned or replied to answer', () => {
    expect(answerer('hi @Nico', 'leo', 1)).toBe('nico');
    expect(answerer('ok', 'leo', 2)).toBe('leo');
    expect(['leo', 'tom']).toContain(answerer('ok', undefined, 3));
  });

  it('shows the member lock exactly as the Academy article words it', () => {
    expect(markup()).toContain('Direct messaging is only available with band admins.');
  });
});
