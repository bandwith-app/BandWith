import { useCallback, useMemo, useRef, useState } from 'react';
import { cachedAudio, downloadAudio, type AudioFailure } from '@/lib/regiaAudio';

/** A song file on this device: waiting, coming down (0–1, null = size unknown), there, or not possible. */
export type SongAudio =
  | { state: 'queued' }
  | { state: 'downloading'; progress: number | null }
  | { state: 'ready' }
  | { state: 'failed'; reason: AudioFailure };

export interface AudioDownloadProgress {
  done: number;
  total: number;
  /** 0–1 over every file of this pass. */
  progress: number;
}

/**
 * The song files (songs.audio_url) of a setlist on this device, for the stage
 * manager: which are here, which are coming down and which can't be.
 *
 * - `check()` only looks at what is already on the device.
 * - `prepare()` also downloads the missing ones, one at a time (one pass at
 *   a time; a call during a pass runs again after it).
 *
 * Used by the Regia (Stage mode) and by the gig's "Audio on this device" card,
 * so the files can come down days before, with internet. downloadAudio shares
 * one download per file, so both at once don't fetch it twice.
 */
export function useAudioDownloads(refs: string[]) {
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState<AudioDownloadProgress | null>(null);
  const [audio, setAudio] = useState<Record<string, SongAudio>>({});
  const audioRef = useRef(audio);
  audioRef.current = audio;

  const unique = useMemo(() => [...new Set(refs.filter(Boolean))], [refs]);
  const key = unique.join('|');
  const refsRef = useRef(unique);
  refsRef.current = unique;

  const check = useCallback(async (): Promise<Set<string>> => {
    const have = await cachedAudio(refsRef.current);
    setCached(have);
    setAudio((a) => {
      const next = { ...a };
      for (const r of have) next[r] = { state: 'ready' };
      return next;
    });
    return have;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const preparing = useRef(false);
  const again = useRef(false);
  const prepare = useCallback(async (): Promise<void> => {
    if (preparing.current) {
      again.current = true;
      return;
    }
    preparing.current = true;
    try {
      const refs = refsRef.current;
      const have = await cachedAudio(refs);
      setCached(have);
      const todo = refs.filter((r) => !have.has(r));
      const states: Record<string, SongAudio> = {};
      for (const r of refs) states[r] = have.has(r) ? { state: 'ready' } : { state: 'queued' };
      setAudio(states);
      if (!todo.length) return;
      const total = todo.length;
      setDownloading({ done: 0, total, progress: 0 });
      let done = 0;
      for (const ref of todo) {
        const show = (p: number | null) => {
          // A few updates per percent at most (the bar moves; React isn't flooded).
          const progress = p == null ? null : Math.round(p * 100) / 100;
          setAudio((a) => {
            const cur = a[ref];
            return cur?.state === 'downloading' && cur.progress === progress ? a : { ...a, [ref]: { state: 'downloading', progress } };
          });
          setDownloading({ done, total, progress: (done + (progress ?? 0)) / total });
        };
        show(0);
        const result = await downloadAudio(ref, show);
        if (result.ok) {
          have.add(ref);
          setCached(new Set(have));
        }
        setAudio((a) => ({ ...a, [ref]: result.ok ? { state: 'ready' } : { state: 'failed', reason: result.reason } }));
        done += 1;
        setDownloading({ done, total, progress: done / total });
      }
      setDownloading(null);
    } finally {
      preparing.current = false;
      if (again.current) {
        again.current = false;
        void prepare();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /** Forget the per-file states (the files stay on the device). */
  const clear = useCallback(() => setAudio({}), []);

  return { audio, audioRef, cached, downloading, check, prepare, clear };
}
