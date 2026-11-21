import type { useT } from '@/lib/i18n';
import type { PlayFailure } from './useStageRegia';

/** Why a song file can't be played or downloaded, and what to do about it. */
export const audioReasonText = (reason: PlayFailure, t: ReturnType<typeof useT>) =>
  reason === 'pending'
    ? t('It’s still downloading: wait a moment, then press Play again.')
    : reason === 'link'
    ? t('The link doesn’t give an audio file. On Google Drive, share it as “Anyone with the link”, or upload the file to the song.')
    : reason === 'offline'
      ? t('No internet, and it isn’t on this device yet. It downloads once you’re back online.')
      : reason === 'format'
        ? t('This device can’t play this file. Use MP3, M4A or WAV.')
        : t('The download stopped. Try again.');
