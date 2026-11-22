import { describe, expect, it } from 'vitest';
import appSrc from '../AuthenticatedApp.tsx?raw';

/**
 * Audit 10 #1: Android Back closed "Edit quote" (an event edit) without
 * clearing the edit target, so the next "+ → New gig" opened with the old
 * event and Save updated it. The app shell is too large to mount here; these
 * checks pin the wiring that prevents it.
 */
const src = appSrc as string;

/** The code just before each place that opens the event form (back to the previous one at most). */
const openings = () => {
  const out: string[] = [];
  const re = /setIsCreateEventOpen\(true\)/g;
  let prev = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out.push(src.slice(Math.max(prev, m.index - 420), m.index));
    prev = m.index + m[0].length;
  }
  return out;
};

describe('the event form never inherits an old edit target', () => {
  it('Android Back closes the form through its own close, which clears the target', () => {
    const backBranch = src.match(/if \(s\.isCreateEventOpen\) \{([\s\S]*?)return true;/);
    expect(backBranch?.[1]).toContain('closeCreateEventRef.current()');
    const close = src.match(/closeCreateEventRef\.current = \(\) => \{([\s\S]*?)\n  \};/);
    expect(close?.[1]).toContain('setEditingEventData(null)');
  });

  it('closing the form by any path clears the edit target', () => {
    expect(src).toMatch(/useEffect\(\(\) => \{\s*if \(isCreateEventOpen\) return;[\s\S]{0,300}setEditingEventData\(null\);\s*\}, \[isCreateEventOpen\]\);/);
  });

  it('every way into the form sets the edit target first (null for a new event)', () => {
    const list = openings();
    expect(list.length).toBeGreaterThan(5);
    const missing = list.filter((before) => !/setEditingEventData\(/.test(before));
    expect(missing).toEqual([]);
  });
});
