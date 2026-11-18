import { describe, it, expect } from 'vitest';
import {
  NOTE_PRESETS,
  assigneesAllowed,
  canDeleteNote,
  canEditNote,
  canMarkOk,
  fromNoteRow,
  groupBySong,
  mergeOutbox,
  myNoteState,
  presetsFor,
  songSections,
  toNoteRow,
  validateNote,
  type RehearsalNote,
} from '../rehearsalNotes';

const ME = 'user-me';
const OTHER = 'user-other';
const base: RehearsalNote = {
  id: 'n1',
  bandId: 'band-1',
  eventId: 'event-1',
  date: '2026-11-19',
  sessionId: null,
  songId: 's1',
  songTitle: 'Paper Boats',
  preset: 'review',
  section: null,
  body: null,
  scope: 'band',
  status: 'open',
  markedAtS: null,
  createdBy: ME,
  okBy: null,
  okAt: null,
  createdAt: '2026-11-19T20:00:00.000Z',
  assignees: [],
};

describe('rehearsal notes: presets and sections', () => {
  const structured = '# Verse 1\nPaper boats\n# Chorus\nOn the river\n# Verse 3\nAgain';

  it('section names come from the structure headings, in order, once each', () => {
    expect(songSections(structured)).toEqual(['Verse 1', 'Chorus', 'Verse 3']);
    expect(songSections('# Chorus\na\n# Chorus\nb')).toEqual(['Chorus']);
    expect(songSections('just words\nno headings')).toEqual([]);
    expect(songSections(null)).toEqual([]);
  });

  it('"Repeat a section" is offered only when the song has structure', () => {
    expect(presetsFor(structured)).toContain('repeat_section');
    expect(presetsFor('no headings')).not.toContain('repeat_section');
    expect(presetsFor(null)).toEqual(NOTE_PRESETS.filter((p) => p !== 'repeat_section'));
  });
});

describe('rehearsal notes: what a note needs', () => {
  it('a mark needs nothing else; a note needs a preset or text', () => {
    expect(validateNote({ status: 'marked', preset: null, body: null, section: null })).toBeNull();
    expect(validateNote({ status: 'open', preset: null, body: '  ', section: null })).toBe('empty');
    expect(validateNote({ status: 'open', preset: 'tempo', body: null, section: null })).toBeNull();
    expect(validateNote({ status: 'open', preset: null, body: 'Bridge too fast', section: null })).toBeNull();
  });

  it('text up to 1000 characters; "Repeat a section" needs the section', () => {
    expect(validateNote({ status: 'open', preset: null, body: 'x'.repeat(1001), section: null })).toBe('too_long');
    expect(validateNote({ status: 'open', preset: 'repeat_section', body: null, section: null })).toBe('section');
    expect(validateNote({ status: 'open', preset: 'repeat_section', body: null, section: 'Verse 3' })).toBeNull();
  });
});

describe('rehearsal notes: who does what (plan §5 Q-A1, Q-A4)', () => {
  it('admins assign to anyone; members only to themselves', () => {
    expect(assigneesAllowed(true, ME, [ME, OTHER])).toBe(true);
    expect(assigneesAllowed(false, ME, [ME])).toBe(true);
    expect(assigneesAllowed(false, ME, [])).toBe(true);
    expect(assigneesAllowed(false, ME, [OTHER])).toBe(false);
  });

  it('the author or an admin edits and deletes', () => {
    expect(canEditNote(base, ME, false)).toBe(true);
    expect(canEditNote({ ...base, createdBy: OTHER }, ME, false)).toBe(false);
    expect(canEditNote({ ...base, createdBy: OTHER }, ME, true)).toBe(true);
    expect(canDeleteNote({ ...base, createdBy: OTHER }, ME, false)).toBe(false);
  });

  it('OK: an admin always; the author only for a note to members; never a mark', () => {
    expect(canMarkOk(base, OTHER, true)).toBe(true);
    expect(canMarkOk(base, ME, false)).toBe(false); // band note, author not admin
    expect(canMarkOk({ ...base, scope: 'members' }, ME, false)).toBe(true);
    expect(canMarkOk({ ...base, scope: 'members' }, OTHER, false)).toBe(false);
    expect(canMarkOk({ ...base, status: 'marked' }, OTHER, true)).toBe(false);
  });

  it('my state: a mark, open, practised by me, or OK', () => {
    expect(myNoteState({ ...base, status: 'marked' }, ME)).toBe('marked');
    expect(myNoteState(base, ME)).toBe('open');
    expect(myNoteState({ ...base, assignees: [{ userId: ME, practisedAt: '2026-11-20T10:00:00Z' }] }, ME)).toBe('practised');
    expect(myNoteState({ ...base, assignees: [{ userId: OTHER, practisedAt: '2026-11-20T10:00:00Z' }] }, ME)).toBe('open');
    expect(myNoteState({ ...base, status: 'ok' }, ME)).toBe('ok');
  });
});

describe('rehearsal notes: lists', () => {
  it('grouped by song in setlist order, then other songs, then general notes', () => {
    const n = (id: string, songId: string | null, title: string | null, createdAt: string): RehearsalNote => ({
      ...base,
      id,
      songId,
      songTitle: title,
      createdAt,
    });
    const groups = groupBySong(
      [
        n('a', 's2', 'Harbor Lights', '2026-11-19T20:10:00Z'),
        n('b', null, null, '2026-11-19T20:05:00Z'),
        n('c', 's1', 'Paper Boats', '2026-11-19T20:20:00Z'),
        n('d', 's9', 'Off the list', '2026-11-19T20:01:00Z'),
        n('e', 's1', 'Paper Boats', '2026-11-19T20:02:00Z'),
      ],
      ['s1', 's2', 's3'],
    );
    expect(groups.map((g) => [g.songId, g.notes.map((x) => x.id)])).toEqual([
      ['s1', ['e', 'c']],
      ['s2', ['a']],
      ['s9', ['d']],
      [null, ['b']],
    ]);
  });

  it('notes waiting on this device show over the saved ones (offline)', () => {
    const saved = [base, { ...base, id: 'n2' }];
    const pending = [{ ...base, body: 'edited offline' }, { ...base, id: 'n3' }];
    const merged = mergeOutbox(saved, pending, []);
    expect(merged.map((x) => x.id).sort()).toEqual(['n1', 'n2', 'n3']);
    expect(merged.find((x) => x.id === 'n1')?.body).toBe('edited offline');
    // Deleted offline: gone already.
    expect(mergeOutbox(saved, [], ['n2']).map((x) => x.id)).toEqual(['n1']);
  });

  it('round-trips through the row', () => {
    const note: RehearsalNote = { ...base, status: 'marked', preset: null, markedAtS: 754, assignees: [{ userId: OTHER, practisedAt: null }] };
    const row = toNoteRow(note);
    expect(row).toMatchObject({ id: 'n1', band_id: 'band-1', occurrence_date: '2026-11-19', marked_at_s: 754, status: 'marked', scope: 'band' });
    expect(row).not.toHaveProperty('assignees');
    expect(fromNoteRow({ ...row, created_by: ME, created_at: base.createdAt, ok_by: null, ok_at: null, rehearsal_note_assignees: [{ user_id: OTHER, practised_at: null }] })).toEqual(note);
    expect(fromNoteRow({ id: 'x' })).toBeNull();
  });
});
