import { describe, expect, it } from 'vitest';
import { findIrealLink, parseIrealLink, scrambleMusic } from '../ireal';
import { irealLinkFrom } from '../irealForum';

// Audit 09 #11: encodeURIComponent keeps "'", so a title like "Don't Stop"
// arrives with a literal apostrophe; the extractor stopped at "Don".
const PLAIN = '{*AT44C^7 A-7 |D-7 G7 |C6 |x Z';
const part = ["Don't Stop", 'Doe Jane', '', 'Medium Swing', 'C', '', scrambleMusic(PLAIN), 'Jazz-Medium Swing', '120', '1'].join('=');
const LINK = `irealb://${encodeURIComponent(part)}`;
const data = (m: Record<string, string>) => ({ getData: (t: string) => m[t] ?? '' });

describe('iReal links with an apostrophe', () => {
  it('keeps the apostrophe the app’s own links carry', () => {
    expect(LINK).toContain("Don't");
    expect(findIrealLink(`Here it is: ${LINK} enjoy`)).toBe(LINK);
    expect(parseIrealLink(LINK).songs[0].title).toBe("Don't Stop");
  });

  it('reads it from a plain-text paste and a link list', () => {
    expect(irealLinkFrom(data({ 'text/plain': `look ${LINK}` }))).toBe(LINK);
    expect(irealLinkFrom(data({ 'text/uri-list': `# from the forum\r\n${LINK}\r\n` }))).toBe(LINK);
  });

  it('reads an HTML link from its href, entities decoded', () => {
    const escaped = LINK.replace(/'/g, '&#39;');
    expect(irealLinkFrom(data({ 'text/html': `<a href="${LINK}">Don't Stop</a>` }))).toBe(LINK);
    expect(irealLinkFrom(data({ 'text/html': `<a href='${escaped}'>Don&#39;t Stop</a>` }))).toBe(LINK);
    expect(irealLinkFrom(data({ 'text/html': `<a class="x" href="${LINK.replace(/'/g, '&apos;')}&amp;">x</a>` }))).toBe(`${LINK}&`);
  });

  it('reads an unquoted href too (PR #295 review)', () => {
    const plain = `irealb://${encodeURIComponent(part.replace("Don't", 'Do Not'))}`;
    expect(irealLinkFrom(data({ 'text/html': `<a href=${plain}>Do Not Stop</a>` }))).toBe(plain);
    expect(irealLinkFrom(data({ 'text/html': `<p><a class=x href=${plain} target=_blank>Do Not Stop</a></p>` }))).toBe(plain);
    expect(parseIrealLink(irealLinkFrom(data({ 'text/html': `<a href=${plain}>x</a>` }))!).songs[0].title).toBe('Do Not Stop');
  });

  it('reads an unquoted older irealbook:// link with its = separators (Codex review of #295)', () => {
    const old = 'irealbook://Blue%20Monk=Monk%20Thelonious=Medium%20Swing=F=n=T44*A{F7XyQ}';
    expect(irealLinkFrom(data({ 'text/html': `<a href=${old}>Blue Monk</a>` }))).toBe(old);
    expect(irealLinkFrom(data({ 'text/html': `<a class=x href=${old} target=_blank>Blue Monk</a>` }))).toBe(old);
    expect(parseIrealLink(irealLinkFrom(data({ 'text/html': `<a href=${old}>x</a>` }))!).songs[0].title).toBe('Blue Monk');
  });

  it('drops a closing quote around a link written in single quotes', () => {
    expect(findIrealLink(`'${LINK}'`)).toBe(LINK);
  });
});
