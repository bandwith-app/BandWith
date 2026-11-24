/**
 * Which door fits the visitor's device (Get page): TestFlight on iPhone and
 * iPad, the APK on Android, the web app anywhere else. On a phone the web app
 * comes first all the same: it opens right there, with nothing to install,
 * and the phone's own app is the second door.
 *
 * The functions are pure and stand alone: the Get page runs their source
 * inline, right after the doors (content/render.ts, doorOrderScript), so the
 * order is right before the first paint. Keep them free of imports, closures
 * and comments inside the body.
 */
export type Door = 'web' | 'android' | 'ios';

/**
 * The visitor's device, from the browser's user agent and touch points.
 * iPadOS Safari says it is a Mac; a Mac has no touch screen, so a "Macintosh"
 * with more than one touch point is an iPad.
 */
export function deviceOf(ua: string, maxTouchPoints: number): Door {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'web';
}

/**
 * Whether the device is a phone (not a tablet, not a computer). An iPhone
 * says so; Android phones carry "Mobile" in the user agent and Android
 * tablets leave it out; an iPad says iPad, or Macintosh.
 */
export function isPhone(ua: string): boolean {
  if (/iPhone|iPod/.test(ua)) return true;
  return /Android/.test(ua) && /Mobile/.test(ua);
}

/**
 * The doors in the order this device sees them. A phone: the web app first
 * (the fastest way in), then its own app, then the other. A tablet or a
 * computer: its own door first, the web app before the other phone.
 */
export function doorOrder(device: Door, phone?: boolean): Door[] {
  if (device === 'ios') return phone ? ['web', 'ios', 'android'] : ['ios', 'web', 'android'];
  if (device === 'android') return phone ? ['web', 'android', 'ios'] : ['android', 'web', 'ios'];
  return ['web', 'android', 'ios'];
}
