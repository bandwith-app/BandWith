import { describe, expect, it } from 'vitest';
import { keepVoiceParts, stripVoiceMarkers } from '../voiceParts';

// Plain text boxes (song form, a member's correction, the review) show the
// lyrics without the {bv}…{/bv} markers; the parts stay with their lines.
// Made-up lyrics (New York).
const SONG = ['# Chorus', '[C]Paper boats on the [G]river', '{bv}(ooh, [Am]yeah){/bv}', 'Lead and {v2}high{/v2}', '{all}All the way home{/all}', '# Verse 2', '{bv}(ooh, [Am]yeah){/bv}'].join('\n');
const shown = stripVoiceMarkers(SONG);

const edit = (fn: (lines: string[]) => void) => {
  const lines = shown.split('\n');
  fn(lines);
  return lines.join('\n');
};

describe('keepVoiceParts', () => {
  it('gives back the marked lyrics when nothing changed', () => {
    expect(shown).not.toMatch(/\{\/?(bv|v2|all|sp)\}/);
    expect(keepVoiceParts(SONG, shown)).toBe(SONG);
  });

  it('keeps every part when a lead line changes', () => {
    const out = keepVoiceParts(SONG, edit((l) => (l[1] = '[C]Paper boats on the [G]Hudson')));
    expect(out.split('\n')).toEqual(SONG.split('\n').map((x, i) => (i === 1 ? '[C]Paper boats on the [G]Hudson' : x)));
  });

  it('keeps the part of a line whose words are fixed', () => {
    const out = keepVoiceParts(SONG, edit((l) => (l[4] = 'All the way back home')));
    expect(out.split('\n')[4]).toBe('{all}All the way back home{/all}');
  });

  it('keeps the parts when lines are added or removed around them', () => {
    const added = keepVoiceParts(SONG, edit((l) => l.splice(2, 0, 'A new lead line')));
    expect(added.split('\n').slice(2, 4)).toEqual(['A new lead line', '{bv}(ooh, [Am]yeah){/bv}']);
    const removed = keepVoiceParts(SONG, edit((l) => l.splice(1, 1)));
    expect(removed.split('\n')).toEqual(SONG.split('\n').filter((_, i) => i !== 1));
  });

  it('a backing line split in two stays backing on both halves', () => {
    const out = keepVoiceParts(SONG, edit((l) => l.splice(4, 1, 'All the way', 'home')));
    expect(out.split('\n').slice(4, 6)).toEqual(['{all}All the way{/all}', '{all}home{/all}']);
  });

  it('never changes what was typed (spaces, chords), so the cursor stays put', () => {
    for (const typed of ['All the way ', '  [D]All the  way', 'All the way [G]']) {
      const out = keepVoiceParts(SONG, edit((l) => (l[4] = typed)));
      expect(stripVoiceMarkers(out).split('\n')[4]).toBe(typed);
      expect(out.split('\n')[4]).toContain('{all}');
    }
  });

  it('keeps markers typed by hand', () => {
    expect(keepVoiceParts(SONG, edit((l) => (l[1] = '{sp}Count it{/sp}'))).split('\n')[1]).toBe('{sp}Count it{/sp}');
  });

  it('works from empty lyrics', () => {
    expect(keepVoiceParts(null, 'Just words')).toBe('Just words');
    expect(keepVoiceParts(SONG, '')).toBe('');
  });
});
