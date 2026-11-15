import { describe, expect, it } from 'vitest';
import { ARTICLES, BY_ID } from '../../academy/content';
import { academyUrl } from './academy';

// Every "?" button and tour card links to an Academy article by id: a typo
// would open an empty guide, so check them all against academy/content.

const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.*', '!/src/**/__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const linkedIds = (): { file: string; id: string }[] => {
  const out: { file: string; id: string }[] = [];
  for (const [file, src] of Object.entries(SOURCES)) {
    // <AcademyHelpButton article="x" /> or article={cond ? 'x' : 'y'}
    for (const m of src.matchAll(/<AcademyHelpButton[^>]*?article=(\{[^}]*\}|"[^"]*")/gs)) {
      // (skip the compared values in conditions like viewMode === 'songs')
      for (const q of m[1].replace(/[!=]==?\s*['"][^'"]*['"]/g, '').matchAll(/['"]([a-z0-9-]+)['"]/g)) out.push({ file, id: q[1] });
    }
    // Tour cards and other targets: article: 'x'
    for (const m of src.matchAll(/\barticle:\s*'([a-z0-9-]+)'/g)) out.push({ file, id: m[1] });
  }
  return out;
};

describe('BandWith Academy links', () => {
  it('finds the app links', () => {
    expect(linkedIds().length).toBeGreaterThan(15);
  });

  it('every app link points to an existing article', () => {
    const missing = linkedIds().filter(({ id }) => !BY_ID.has(id));
    expect(missing).toEqual([]);
  });

  it('every related guide exists', () => {
    const missing = ARTICLES.flatMap((a) => (a.related ?? []).filter((id) => !BY_ID.has(id)).map((id) => `${a.id} → ${id}`));
    expect(missing).toEqual([]);
  });

  it('builds embed URLs', () => {
    expect(academyUrl({ article: 'create-a-gig' }, 'dark')).toMatch(/index\.html\?embed=1&theme=dark#\/a\/create-a-gig$/);
    expect(academyUrl({ role: 'member' }, 'light')).toMatch(/#\/role\/member$/);
    expect(academyUrl(null, 'light')).toMatch(/#\/$/);
  });
});
