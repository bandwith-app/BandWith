/**
 * Where the device's audio comes out (stage manager mode, the Regia):
 * ios/App/App/AudioOutputPlugin.swift and the Android twin. Most tablets
 * and phones have no headphone jack any more, so the Regia reaches the
 * mixer through USB-C; if the cable comes out, the sound moves to the
 * built-in speaker. The Regia's bar shows the output (and warns) so that is
 * seen at once. In a browser the output can't be read: null.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type AudioOutputKind = 'usb' | 'wired' | 'hdmi' | 'airplay' | 'bluetooth' | 'speaker' | 'other';

export interface AudioOutput {
  kind: AudioOutputKind;
  /** The device's own name for it ("USB-C to 3.5mm adapter", "Scarlett 2i2"). */
  name: string;
}

interface AudioOutputPlugin {
  current(): Promise<AudioOutput>;
  setPlayback(opts: { on: boolean }): Promise<AudioOutput>;
  addListener(event: 'change', fn: (o: AudioOutput) => void): Promise<PluginListenerHandle>;
}

const BwAudioOutput = registerPlugin<AudioOutputPlugin>('BwAudioOutput');

const KINDS: AudioOutputKind[] = ['usb', 'wired', 'hdmi', 'airplay', 'bluetooth', 'speaker', 'other'];
const clean = (o: unknown): AudioOutput | null => {
  const p = (o ?? {}) as Record<string, unknown>;
  const kind = KINDS.includes(p.kind as AudioOutputKind) ? (p.kind as AudioOutputKind) : 'other';
  return { kind, name: typeof p.name === 'string' ? p.name.slice(0, 80) : '' };
};

/** True when the native shell has the plugin (older app builds don't). */
const native = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BwAudioOutput');

export async function currentAudioOutput(): Promise<AudioOutput | null> {
  if (!native()) return null;
  try {
    return clean(await BwAudioOutput.current());
  } catch {
    return null;
  }
}

/** Follows output changes (a cable plugged in or pulled out). Returns the unsubscribe. */
export function onAudioOutputChange(fn: (o: AudioOutput) => void): () => void {
  if (!native()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let gone = false;
  void BwAudioOutput.addListener('change', (o) => {
    const c = clean(o);
    if (c) fn(c);
  }).then((h) => {
    if (gone) void h.remove();
    else handle = h;
  });
  return () => {
    gone = true;
    void handle?.remove();
  };
}

/** iOS: the "playback" audio session while the Regia is on (silent switch, screen lock). */
export async function setPlaybackSession(on: boolean): Promise<void> {
  if (!native()) return;
  try {
    await BwAudioOutput.setPlayback({ on });
  } catch {
    /* the <audio> element still plays as media */
  }
}

/** The output can't be trusted for a gig: the built-in speaker, or Bluetooth (late, can drop out). */
export const outputWarning = (o: AudioOutput | null): 'speaker' | 'bluetooth' | null =>
  o?.kind === 'speaker' ? 'speaker' : o?.kind === 'bluetooth' || o?.kind === 'airplay' ? 'bluetooth' : null;
