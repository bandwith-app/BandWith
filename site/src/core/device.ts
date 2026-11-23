/**
 * Which door fits the visitor's device (Get page): TestFlight on iPhone and
 * iPad, the APK on Android, the web app anywhere else.
 *
 * Both functions are pure and stand alone: the Get page runs their source
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

/** The doors in the order this device sees them: its own first, the web app before the other phone. */
export function doorOrder(device: Door): Door[] {
  if (device === 'ios') return ['ios', 'web', 'android'];
  if (device === 'android') return ['android', 'web', 'ios'];
  return ['web', 'android', 'ios'];
}
