import { describe, it, expect, vi } from 'vitest';

// Round 2 (Claude MINOR, audit 09 #7): an import longer than the lyrics
// limit was cut at 20,000 characters without a word. Now the whole text
// reaches the song form, which says it is too long before saving.
// Made-up songs (New York).

vi.mock('../musicxml', () => ({
  parseMusicXmlSong: vi.fn(async () => ({ lyrics: `# Verse 1\n${'Uptown lights over the river\n'.repeat(800)}The very last line` })),
}));

import { pastedLyrics, readSongFile, textToLyrics } from '../songImport';

const NAMES = { verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge' };
const medley = `Verse 1\n${'Uptown lights over the river\n'.repeat(800)}The very last line`;

describe('song import: long lyrics are never cut', () => {
  it('pasted text keeps its ending', () => {
    expect(medley.length).toBeGreaterThan(20000);
    expect(textToLyrics(medley).endsWith('The very last line')).toBe(true);
    expect(pastedLyrics(medley, NAMES).lyrics?.endsWith('The very last line')).toBe(true);
  });

  it('a ChordPro file keeps its ending', async () => {
    const cho = `{title: Hudson Medley}\n${'[C]Uptown lights over the river\n'.repeat(800)}The very last line`;
    const song = await readSongFile(new TextEncoder().encode(cho), 'medley.cho', NAMES);
    expect(song.lyrics?.endsWith('The very last line')).toBe(true);
  });

  it('a MusicXML score keeps its ending', async () => {
    const song = await readSongFile(new TextEncoder().encode('<score-partwise/>'), 'medley.musicxml', NAMES);
    expect(song.lyrics?.endsWith('The very last line')).toBe(true);
  });
});
