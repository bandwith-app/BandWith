/**
 * Which device the reader is on, so screenshots show their own screens.
 *
 * - Inside the app (?embed=1&device=…): the app says, and posts
 *   { type: 'bw-academy-device', device } when the posture changes
 *   (a Duo opened, folded into Laptop pose…).
 * - On the web: guessed from the screen (a phone, a tablet, a desktop
 *   browser), unless the reader picked one in the top bar (kept per browser).
 */
import { useEffect, useState } from 'react';
import type { ShotDevice } from '../content/types';
import { SHOT_FILES } from '../content/shotFiles';
import { u } from './ui';

export const VIEW_DEVICES: ShotDevice[] = ['phone', 'tablet', 'web', 'duoClosed', 'duoBook', 'duoLaptop'];

export const VIEW_DEVICE_LABEL: Record<ShotDevice, string> = {
  phone: u('iPhone & Android phone'),
  tablet: u('iPad & tablets'),
  web: u('Web browser'),
  duoClosed: u('Dual-screen, closed'),
  duoBook: u('Dual-screen, Book'),
  duoLaptop: u('Dual-screen, Laptop'),
};

const PICK_KEY = 'bw-academy-device';
const isDevice = (v: unknown): v is ShotDevice => typeof v === 'string' && (VIEW_DEVICES as string[]).includes(v);

const params = new URLSearchParams(location.search);
const FROM_APP = params.get('device');

/** A guess from the screen alone: touch screens by size, the rest is a desktop browser. */
export function guessDevice(): ShotDevice {
  const touch = matchMedia('(pointer: coarse)').matches;
  const short = Math.min(screen.width, screen.height);
  if (touch) return short >= 600 ? 'tablet' : 'phone';
  return innerWidth < 600 ? 'phone' : 'web';
}

function readPick(): ShotDevice | null {
  try {
    const v = localStorage.getItem(PICK_KEY);
    return isDevice(v) ? v : null;
  } catch {
    return null;
  }
}

let appDevice: ShotDevice | null = isDevice(FROM_APP) ? FROM_APP : null;
let picked: ShotDevice | null = appDevice ? null : readPick();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

window.addEventListener('message', (e) => {
  if (e.source !== window.parent || window.parent === window) return;
  const d = e.data as { type?: string; device?: unknown } | null;
  if (!d || d.type !== 'bw-academy-device' || !isDevice(d.device)) return;
  appDevice = d.device;
  picked = null; // the device changed under the reader: follow it again
  emit();
});

/** The device screenshots are shown for, and whether the reader chose it. */
export function useViewDevice(): { device: ShotDevice; auto: ShotDevice; picked: boolean; pick: (d: ShotDevice | null) => void } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const auto = appDevice ?? guessDevice();
  return {
    device: picked ?? auto,
    auto,
    picked: picked !== null,
    pick: (d) => {
      picked = d && d !== auto ? d : null;
      // Inside the app the pick lasts while the guide is open; on the web it stays.
      if (!appDevice) {
        try {
          if (picked) localStorage.setItem(PICK_KEY, picked);
          else localStorage.removeItem(PICK_KEY);
        } catch {
          /* storage blocked */
        }
      }
      emit();
    },
  };
}

/** Nearest capture when a screen wasn't captured on the reader's device. */
const NEAREST: Record<ShotDevice, ShotDevice[]> = {
  phone: ['phone', 'duoClosed', 'tablet', 'web', 'duoBook', 'duoLaptop'],
  duoClosed: ['duoClosed', 'phone', 'duoBook', 'tablet', 'web', 'duoLaptop'],
  duoBook: ['duoBook', 'tablet', 'web', 'duoClosed', 'phone', 'duoLaptop'],
  duoLaptop: ['duoLaptop', 'duoClosed', 'phone', 'duoBook', 'tablet', 'web'],
  tablet: ['tablet', 'web', 'duoBook', 'phone', 'duoClosed', 'duoLaptop'],
  web: ['web', 'tablet', 'duoBook', 'phone', 'duoClosed', 'duoLaptop'],
};

/** The capture to show for `want`, or null when the shot has none yet. */
export function shotFor(id: string, want: ShotDevice): ShotDevice | null {
  const have = SHOT_FILES[id] ?? [];
  return NEAREST[want].find((d) => have.includes(d)) ?? null;
}
