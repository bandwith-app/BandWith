import { supabase } from '@/lib/supabase';
import { dataUrlToBlob, resizeImageToDataUrl } from '@/lib/imageResize';

/** Side of the square profile photo: sharp at 80 px on a 3x screen, ~20–30 KB. */
export const AVATAR_SIZE = 256;

/** A week: the URL carries ?t=<upload time>, so a new photo is a new URL anyway. */
const AVATAR_CACHE_SECONDS = String(7 * 24 * 3600);

/**
 * Makes the square JPEG thumbnail and uploads that, never the original photo
 * (several MB, downloaded by every list that shows the avatar). Returns the
 * public URL with a version, or the inline thumbnail when Storage can't be
 * reached (offline, demo), as before.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const thumb = await resizeImageToDataUrl(file, AVATAR_SIZE);
  const blob = dataUrlToBlob(thumb);
  if (!blob) return thumb;
  try {
    const path = `${userId}/avatar.jpg`;
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: AVATAR_CACHE_SECONDS });
    if (error) {
      console.warn('[avatar] Storage upload failed, keeping the inline thumbnail:', error.message);
      return thumb;
    }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    return data?.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : thumb;
  } catch (err) {
    console.warn('[avatar] Storage unavailable, keeping the inline thumbnail:', err);
    return thumb;
  }
}
