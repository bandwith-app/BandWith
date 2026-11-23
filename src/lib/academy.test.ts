import { describe, expect, it } from 'vitest';
import { ARTICLES, BY_ID, SHOTS } from '../../academy/content';
import { SHOT_FILES } from '../../academy/content/shotFiles';
import { academyDevice, academyUrl } from './academy';

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

/** "?" buttons only: <AcademyHelpButton article=…>. */
const helpButtonIds = (): Set<string> => {
  const ids = new Set<string>();
  for (const src of Object.values(SOURCES)) {
    for (const m of src.matchAll(/<AcademyHelpButton[^>]*?article=(\{[^}]*\}|"[^"]*")/gs)) {
      for (const q of m[1].replace(/[!=]==?\s*['"][^'"]*['"]/g, '').matchAll(/['"]([a-z0-9-]+)['"]/g)) ids.add(q[1]);
    }
  }
  return ids;
};

/** The first-run tour's cards per role (RoleTourModal STEPS): role → article ids. */
const tourArticles = (): Record<string, string[]> => {
  const src = Object.entries(SOURCES).find(([f]) => f.endsWith('/RoleTourModal.tsx'))?.[1] ?? '';
  const out: Record<string, string[]> = {};
  let role = '';
  for (const line of src.split('\n')) {
    const r = line.match(/^  (admin|member|deputy): \[/);
    if (r) role = r[1];
    const a = line.match(/\barticle:\s*'([a-z0-9-]+)'/);
    if (a && role) (out[role] ??= []).push(a[1]);
  }
  return out;
};

// Live mode without signal and voice parts (plan §3 and §5): each guide opens
// from a "?" on its own screen, and the tour points admins and members to them.
// Count-in and Follow the tempo get theirs once those screens are final.
const LIVE_GUIDES = [
  'live-mode-offline',
  'offline-and-live-settings',
  'offline-members-ready',
  'changes-without-signal',
  'voice-parts',
  'mark-voice-parts',
  'who-sings-what',
  'highlight-my-part',
];

describe('BandWith Academy links', () => {
  it('every live and voice guide has a "?" on its screen', () => {
    const ids = helpButtonIds();
    expect(LIVE_GUIDES.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('the tour shows admins and members the live guides', () => {
    const tour = tourArticles();
    expect(tour.admin).toContain('live-mode-offline');
    expect(tour.member).toContain('live-mode-offline');
    expect(tour.deputy).not.toContain('live-mode-offline');
  });

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
    expect(academyUrl({ article: 'create-a-gig' }, 'dark')).toMatch(/index\.html\?embed=1&theme=dark&lang=en#\/a\/create-a-gig$/);
    expect(academyUrl({ role: 'member' }, 'light')).toMatch(/#\/role\/member$/);
    expect(academyUrl(null, 'light')).toMatch(/#\/$/);
    expect(academyUrl({ role: 'admin' }, 'dark', 'duoBook')).toMatch(/\?embed=1&theme=dark&device=duoBook&lang=en#\/role\/admin$/);
  });

  it('tells the guide which device it is on', () => {
    const base = { duo: false, laptop: false, twoPane: false, wide: false, native: true, finePointer: false };
    expect(academyDevice(base)).toBe('phone');
    expect(academyDevice({ ...base, wide: true })).toBe('tablet');
    expect(academyDevice({ ...base, wide: true, twoPane: true })).toBe('tablet');
    expect(academyDevice({ ...base, wide: true, native: false, finePointer: true })).toBe('web');
    expect(academyDevice({ ...base, native: false, finePointer: true })).toBe('phone');
    expect(academyDevice({ ...base, duo: true })).toBe('duoClosed');
    expect(academyDevice({ ...base, duo: true, wide: true, twoPane: true })).toBe('duoBook');
    expect(academyDevice({ ...base, duo: true, laptop: true })).toBe('duoLaptop');
  });

  it('every screenshot file belongs to a shot, and the index matches the files', () => {
    const files = Object.keys(import.meta.glob('/academy/public/shots/*'))
      .map((f) => f.split('/').pop()!)
      .sort();
    const listed = Object.entries(SHOT_FILES)
      .flatMap(([id, devices]) => devices.map((d) => `${id}@${d}.webp`))
      .sort();
    expect(files).toEqual(listed);
    expect(Object.keys(SHOT_FILES).filter((id) => !SHOTS.has(id))).toEqual([]);
  });

  it('every screenshot in a guide exists', () => {
    const missing = ARTICLES.flatMap((a) =>
      a.body.flatMap((b) =>
        b.type !== 'shot' ? [] : !SHOTS.has(b.id) || (b.device && !SHOT_FILES[b.id]?.includes(b.device)) ? [`${a.id} → ${b.id}${b.device ? `@${b.device}` : ''}`] : [],
      ),
    );
    expect(missing).toEqual([]);
  });
});
