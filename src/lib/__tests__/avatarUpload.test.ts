import { describe, it, expect, vi, beforeEach } from 'vitest';

// Egress: the profile photo was uploaded as the original file (up to 8 MB;
// one in production is 3.5 MB) although a 256 px JPEG was already made. Every
// list that shows the avatar downloaded the original. And originals over the
// bucket's 5 MB limit failed, leaving a 32 KB data URL inside profiles.
const up = vi.hoisted(() => ({ upload: vi.fn(), getPublicUrl: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: () => ({ upload: up.upload, getPublicUrl: up.getPublicUrl }) } },
}));
vi.mock('@/lib/imageResize', async (orig) => ({
  ...(await orig<typeof import('@/lib/imageResize')>()),
  resizeImageToDataUrl: async () => 'data:image/jpeg;base64,' + btoa('small-jpeg'),
}));

import { uploadAvatar, AVATAR_SIZE } from '@/lib/avatarUpload';

const original = new File([new Uint8Array(4 * 1024 * 1024)], 'IMG_0001.PNG', { type: 'image/png' });

beforeEach(() => {
  up.upload.mockReset().mockResolvedValue({ error: null });
  up.getPublicUrl.mockReset().mockReturnValue({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/avatars/me/avatar.jpg' } });
});

describe('uploadAvatar', () => {
  it('uploads the small JPEG thumbnail, never the original file', async () => {
    await uploadAvatar('me', original);
    const [path, body, opts] = up.upload.mock.calls[0];
    expect(path).toBe('me/avatar.jpg');
    expect(body).not.toBe(original);
    expect((body as Blob).size).toBeLessThan(1024);
    expect((body as Blob).type).toBe('image/jpeg');
    expect(opts).toMatchObject({ upsert: true, contentType: 'image/jpeg' });
    expect(Number(opts.cacheControl)).toBeGreaterThanOrEqual(86400);
  });

  it('returns the public URL with a version, so the new photo shows at once', async () => {
    const url = await uploadAvatar('me', original);
    expect(url).toMatch(/^https:\/\/x\.supabase\.co\/.*\/avatars\/me\/avatar\.jpg\?t=\d+$/);
  });

  it('keeps the small inline thumbnail when Storage is not reachable', async () => {
    up.upload.mockResolvedValue({ error: { message: 'offline' } });
    const url = await uploadAvatar('me', original);
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('makes thumbnails big enough for a sharp avatar on a 3x screen', () => {
    expect(AVATAR_SIZE).toBeGreaterThanOrEqual(192);
    expect(AVATAR_SIZE).toBeLessThanOrEqual(320);
  });
});
