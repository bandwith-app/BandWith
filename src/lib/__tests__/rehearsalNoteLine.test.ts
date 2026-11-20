import { describe, it, expect } from 'vitest';
import { fromNoteRow, sectionLines, toNoteRow, type RehearsalNote } from '../rehearsalNotes';
import { noteHeadline } from '@/app/components/dashboard/RehearsalNotes';

// A rehearsal note on a precise point (D, migration 167): a section and,
// optionally, one of its lines.

const base: RehearsalNote = {
  id: 'n1', bandId: 'b', eventId: 'e', date: '2026-11-20', sessionId: null,
  songId: 's1', songTitle: 'Paper Boats', preset: 'tempo', section: 'Chorus', body: null,
  scope: 'band', status: 'open', markedAtS: null, createdBy: 'u', okBy: null, okAt: null,
  createdAt: '2026-11-20T20:00:00Z', assignees: [],
};
const t = (s: string, v?: Record<string, unknown>) => (v ? s.replace(/\{(\w+)\}/g, (_, k) => String(v[k])) : s);

describe('rehearsal notes on a line', () => {
  it('writes and reads the line', () => {
    const row = toNoteRow({ ...base, line: 'Lanterns in the rain' });
    expect(row.line).toBe('Lanterns in the rain');
    expect(fromNoteRow({ ...row, created_by: 'u', created_at: base.createdAt })?.line).toBe('Lanterns in the rain');
  });

  it('keeps the line short and leaves it out when there is none', () => {
    expect(toNoteRow({ ...base, line: 'x'.repeat(300) }).line).toHaveLength(200);
    expect('line' in toNoteRow({ ...base, line: null })).toBe(false);
  });

  it('shows where: preset, section and line', () => {
    expect(noteHeadline({ ...base, line: 'Lanterns in the rain' }, t as never)).toBe('Tempo · Chorus · “Lanterns in the rain”');
    expect(noteHeadline({ ...base, preset: null, body: 'Too fast', line: 'Lanterns in the rain' }, t as never)).toBe(
      'Chorus · “Lanterns in the rain”: Too fast',
    );
  });

  it('lists the lines of a section, without chords', () => {
    const lyrics = '# Verse 1\nPaper [C]boats on the water\n# Chorus\nLan[Am]terns in the rain\nHold on\n# Chorus\nLanterns in the rain';
    expect(sectionLines(lyrics, 'Chorus')).toEqual(['Lanterns in the rain', 'Hold on']);
    expect(sectionLines(lyrics, 'Bridge')).toEqual([]);
  });
});
