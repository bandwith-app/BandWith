import { describe, it, expect, vi, beforeEach } from 'vitest';

const upload = vi.hoisted(() => vi.fn());
const move = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: vi.fn(() => ({ upload, move })) } } }));

import { adoptSuggestionFiles, SONG_FILE_MIME_TYPES, uploadSongScore } from '../songFiles';
import { SCORE_MIME_MXL, SCORE_MIME_XML } from '@/lib/score';

const score = (name: string, size = 2048, type = '') => new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  upload.mockReset();
  upload.mockResolvedValue({ data: { path: 'x' }, error: null });
});

describe('uploadSongScore', () => {
  it("keeps a band's score under <band>/score/ with the MusicXML type", async () => {
    const res = await uploadSongScore('band-1', score('Night Ferry.mxl'));
    expect(res.error).toBeNull();
    const [path, , opts] = upload.mock.calls[0];
    expect(path).toMatch(/^band-1\/score\/[\w-]+-Night-Ferry\.mxl$/);
    expect(opts).toMatchObject({ contentType: SCORE_MIME_MXL, upsert: false });
    expect(res.ref).toBe(`sb://song-files/${path}`);
  });

  it('sends .musicxml and .xml as uncompressed MusicXML, whatever the OS called them', async () => {
    await uploadSongScore('band-1', score('tune.xml', 100, 'text/xml'));
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: SCORE_MIME_XML });
  });

  it("puts a member's score for a suggested song in their own folder (108)", async () => {
    await uploadSongScore('band-1', score('tune.musicxml'), { suggestedBy: 'user-9' });
    expect(upload.mock.calls[0][0]).toMatch(/^band-1\/suggestions\/user-9\/score\//);
  });

  it('refuses a file that is not a score, before uploading', async () => {
    const res = await uploadSongScore('band-1', score('chart.pdf'));
    expect(res.error?.message).toMatch(/MusicXML/);
    expect(upload).not.toHaveBeenCalled();
  });

  it('the bucket types listed in the app include both MusicXML types (migration 170)', () => {
    expect(SONG_FILE_MIME_TYPES).toEqual(expect.arrayContaining([SCORE_MIME_XML, SCORE_MIME_MXL]));
  });
});

describe('an accepted suggested song keeps its score', () => {
  it("moves the member's score into the band's score folder", async () => {
    const moved = await adoptSuggestionFiles({ score_path: 'sb://song-files/band-1/suggestions/user-9/score/s-tune.mxl' });
    expect(move).toHaveBeenCalledWith('band-1/suggestions/user-9/score/s-tune.mxl', 'band-1/score/s-tune.mxl');
    expect(moved).toEqual({ score_path: 'sb://song-files/band-1/score/s-tune.mxl' });
  });
});
