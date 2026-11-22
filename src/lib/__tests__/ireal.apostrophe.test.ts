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

  it('drops a closing quote around a link written in single quotes', () => {
    expect(findIrealLink(`'${LINK}'`)).toBe(LINK);
  });
});
