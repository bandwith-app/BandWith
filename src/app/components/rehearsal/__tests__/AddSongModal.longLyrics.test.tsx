import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// Audit 09 #7: a long medley pasted in Lyrics was cut at 20,000 characters
// on save, with "saved" shown. Now nothing is cut: too long is said before
// saving and the whole text stays in the field. Made-up song (New York).

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/BandContext', () => ({ useBand: () => ({ isAdmin: true }) }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, profile: null }) }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/services/notifications', () => ({ notifySongAdded: vi.fn() }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySongUpdated: vi.fn() }));
const svc = vi.hoisted(() => ({
  updateSong: vi.fn(async (..._a: unknown[]) => ({ data: {}, error: null })),
  saveLyrics: vi.fn(async (..._a: unknown[]): Promise<{ error: null; conflict?: string | null }> => ({ error: null })),
  getSong: vi.fn(async (..._a: unknown[]): Promise<{ data: unknown; error: null }> => ({ data: null, error: null })),
}));
vi.mock('@/lib/services/songs', () => ({
  createSong: vi.fn(), updateSong: svc.updateSong, saveSongLyricsIfUnchanged: svc.saveLyrics, getSong: svc.getSong,
}));
vi.mock('@/lib/services/songFiles', () => ({
  uploadSongFile: vi.fn(), removeSongFiles: vi.fn(async () => {}), isStoredSongFile: () => false,
  classifySongFile: () => 'audio', validateSongFile: () => null, normalizeSongFile: async (f: File) => f,
  SONG_FILE_ACCEPT: '*/*', songFileName: () => '', openSongResource: vi.fn(),
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { AddSongModal } from '../AddSongModal';

beforeEach(() => {
  svc.updateSong.mockClear();
  svc.saveLyrics.mockClear();
});
afterEach(cleanup);

const song = { id: 's1', band_id: 'b1', title: 'Hudson Medley', artist: 'Hudson Line', lyrics: 'Short', status: 'ready' } as never;

describe('song form: long lyrics are never cut', () => {
  it('too long: says so, saves nothing, keeps every character in the field', { timeout: 60000 }, async () => {
    render(<AddSongModal isOpen onClose={() => {}} bandId="b1" song={song} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const field = (await screen.findByDisplayValue('Short')) as HTMLTextAreaElement;
    const medley = `# Verse 1\n${'Uptown lights over the river\n'.repeat(800)}# Outro\nThe very last line`;
    expect(medley.length).toBeGreaterThan(20000);
    fireEvent.change(field, { target: { value: medley } });
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));

    await waitFor(() => expect(screen.getAllByText(/lyrics are too long/i).length).toBeGreaterThan(0));
    expect(svc.updateSong).not.toHaveBeenCalled();
    expect((screen.getByDisplayValue(/The very last line/) as HTMLTextAreaElement).value).toBe(medley);
  });

  it('within the limit: saved whole', { timeout: 60000 }, async () => {
    render(<AddSongModal isOpen onClose={() => {}} bandId="b1" song={song} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const field = (await screen.findByDisplayValue('Short')) as HTMLTextAreaElement;
    const text = `Uptown lights\n${'la '.repeat(3000)}end`;
    fireEvent.change(field, { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));
    // Lyrics go through the save that checks nobody changed them (189).
    await waitFor(() => expect(svc.saveLyrics).toHaveBeenCalled());
    const [id, saved, expected] = svc.saveLyrics.mock.calls[0] as [string, string, string | null];
    expect(id).toBe('s1');
    expect(saved.endsWith('end')).toBe(true);
    expect(expected).toBe('Short');
  });
});

// Round 2 (Codex MINOR, Claude MINORs): the limit only matters when the
// lyrics are written, and lyrics are written only over what the form opened.
describe('song form: lyrics written only when changed, only over what was opened', () => {
  const longSong = {
    id: 's2', band_id: 'b1', title: 'Hudson Medley', artist: 'Hudson Line', status: 'ready',
    lyrics: `# Verse 1\n${'Uptown lights over the river\n'.repeat(800)}# Outro\nThe very last line`,
  } as never;

  it('a title change on a song whose stored lyrics are over the limit saves, without touching them', { timeout: 60000 }, async () => {
    render(<AddSongModal isOpen onClose={() => {}} bandId="b1" song={longSong} />);
    fireEvent.change(screen.getByDisplayValue('Hudson Medley'), { target: { value: 'Hudson Medley (live)' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));
    await waitFor(() => expect(svc.updateSong).toHaveBeenCalled());
    expect(svc.updateSong.mock.calls[0][1]).toEqual({ title: 'Hudson Medley (live)' });
    expect(svc.saveLyrics).not.toHaveBeenCalled();
    expect(screen.queryAllByText(/lyrics are too long/i)).toEqual([]);
  });

  it('a bandmate changed the lyrics meanwhile: nothing is saved, the text stays, the form says so', { timeout: 60000 }, async () => {
    svc.saveLyrics.mockImplementationOnce(async () => ({ error: null, conflict: 'Short\n\n# Verse 2\nTheir new verse' }));
    render(<AddSongModal isOpen onClose={() => {}} bandId="b1" song={song} />);
    fireEvent.change(screen.getByDisplayValue('Hudson Medley'), { target: { value: 'Hudson Medley (live)' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(await screen.findByDisplayValue('Short'), { target: { value: 'Short, and mine' } });
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));
    await waitFor(() => expect(screen.getAllByText(/someone else changed these lyrics/i).length).toBeGreaterThan(0));
    expect(svc.updateSong).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Short, and mine')).toBeTruthy();
  });
});

// Round 3 (Codex B3 + MINOR, Claude M3).
describe('song form: one write, a conflict that can be resolved, a quiet length warning', () => {
  const keyed = { id: 's3', band_id: 'b1', title: 'Hudson Line', artist: 'Hudson Line', status: 'ready', key: 'C', lyrics: '[C]Uptown lights' } as never;
  const toLyrics = async (s: never) => {
    render(<AddSongModal isOpen onClose={() => {}} bandId="b1" song={s} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
  };

  it('transposed (lyrics and key): saved in one request, never the lyrics without the key', { timeout: 60000 }, async () => {
    render(<AddSongModal isOpen onClose={() => {}} bandId="b1" song={keyed} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(await screen.findByDisplayValue('C'), { target: { value: 'D' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(await screen.findByDisplayValue('[C]Uptown lights'), { target: { value: '[D]Uptown lights' } });
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));
    await waitFor(() => expect(svc.saveLyrics).toHaveBeenCalledTimes(1));
    expect(svc.saveLyrics.mock.calls[0]).toEqual(['s3', '[D]Uptown lights', '[C]Uptown lights', { key: 'D' }]);
    expect(svc.updateSong).not.toHaveBeenCalled();
  });

  const theirs = '[C]Uptown lights\n\n# Verse 2\nTheir new verse';

  it('after a conflict, "Load the latest version" shows their text and a merge saves over it', { timeout: 60000 }, async () => {
    svc.saveLyrics.mockImplementationOnce(async () => ({ error: null, conflict: theirs }));
    svc.getSong.mockImplementationOnce(async () => ({ data: { ...(keyed as object), lyrics: theirs }, error: null }));
    await toLyrics(keyed);
    fireEvent.change(await screen.findByDisplayValue('[C]Uptown lights'), { target: { value: '[C]Uptown lights, mine' } });
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));
    fireEvent.click(await screen.findByRole('button', { name: /load the latest version/i }));
    const field = (await screen.findByDisplayValue(/Their new verse/)) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: `${theirs}\nAnd mine` } });
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));
    await waitFor(() => expect(svc.saveLyrics).toHaveBeenCalledTimes(2));
    expect(svc.saveLyrics.mock.calls[1].slice(1, 3)).toEqual([`${theirs}\nAnd mine`, theirs]);
  });

  it('after a conflict, "Save mine instead" saves the draft over their version', { timeout: 60000 }, async () => {
    svc.saveLyrics.mockImplementationOnce(async () => ({ error: null, conflict: theirs }));
    await toLyrics(keyed);
    fireEvent.change(await screen.findByDisplayValue('[C]Uptown lights'), { target: { value: '[C]Uptown lights, mine' } });
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));
    fireEvent.click(await screen.findByRole('button', { name: /save mine instead/i }));
    await waitFor(() => expect(svc.saveLyrics).toHaveBeenCalledTimes(2));
    expect(svc.saveLyrics.mock.calls[1].slice(1, 3)).toEqual(['[C]Uptown lights, mine', theirs]);
  });

  it('the too-long warning describes the field, outside its label, and is announced once', { timeout: 60000 }, async () => {
    await toLyrics(song);
    const field = (await screen.findByDisplayValue('Short')) as HTMLTextAreaElement;
    const long = `${'Uptown lights over the river\n'.repeat(800)}end`;
    fireEvent.change(field, { target: { value: long } });
    const warning = screen.getAllByText(/lyrics are too long/i).find((el) => !el.closest('[role="status"]') || true)!;
    expect(field.closest('label')?.contains(warning) ?? false).toBe(false);
    const described = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    expect(described.some((id) => document.getElementById(id)?.textContent?.match(/too long/i))).toBe(true);
    const live = () => [...document.querySelectorAll('[role="status"]')].map((n) => n.textContent).join('|');
    const once = live();
    fireEvent.change(field, { target: { value: `${long} and more` } });
    expect(live()).toBe(once);
  });
});

// Round 4 (Codex): after a conflict, the latest version is the whole song,
// never their lyrics with my transposed key and chart.
describe('song form: "Load the latest version" reloads the whole song', () => {
  const keyed = { id: 's4', band_id: 'b1', title: 'Hudson Line', artist: 'Hudson Line', status: 'ready', key: 'C', lyrics: '[C]Uptown lights' } as never;
  const theirs = '[C]Uptown lights\n\n# Verse 2\nTheir new verse';

  it('my transposed key goes too: a save then writes nothing of my version', { timeout: 60000 }, async () => {
    svc.saveLyrics.mockImplementationOnce(async () => ({ error: null, conflict: theirs }));
    svc.getSong.mockImplementationOnce(async () => ({ data: { ...(keyed as object), lyrics: theirs, key: 'C' }, error: null }));
    render(<AddSongModal isOpen onClose={() => {}} bandId="b1" song={keyed} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(await screen.findByDisplayValue('C'), { target: { value: 'D' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(await screen.findByDisplayValue('[C]Uptown lights'), { target: { value: '[D]Uptown lights' } });
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));
    fireEvent.click(await screen.findByRole('button', { name: /load the latest version/i }));
    await screen.findByDisplayValue(/Their new verse/);
    expect(svc.getSong).toHaveBeenCalledWith('s4');
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));
    // Nothing changed against the latest version: no write mixes the two.
    await waitFor(() => expect(screen.queryByRole('button', { name: /load the latest version/i })).toBeNull());
    expect(svc.saveLyrics).toHaveBeenCalledTimes(1);
    expect(svc.updateSong).not.toHaveBeenCalled();
  });

  it('a conflict left behind never shows in the next, new song', { timeout: 60000 }, async () => {
    svc.saveLyrics.mockImplementationOnce(async () => ({ error: null, conflict: theirs }));
    const view = render(<AddSongModal isOpen onClose={() => {}} bandId="b1" song={keyed} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(await screen.findByDisplayValue('[C]Uptown lights'), { target: { value: '[C]Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));
    await screen.findByRole('button', { name: /load the latest version/i });
    // Discarded: Close, then Discard in the sheet.
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^discard$/i }));
    view.rerender(<AddSongModal isOpen={false} onClose={() => {}} bandId="b1" song={keyed} />);
    view.rerender(<AddSongModal isOpen onClose={() => {}} bandId="b1" />);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Brand New Song' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // The step's content animates in: wait for the lyrics field.
    expect(await screen.findByText(/lyrics · text/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /load the latest version/i })).toBeNull();
    expect(screen.queryByText(/someone else changed these lyrics/i)).toBeNull();
  });
});
