// Silent pushes (migration 170): the live pack's background refresh. No alert,
// sound or badge and nothing in the notification list; the phone only wakes
// the app so it can download the changed setlist. Best effort by design: iOS
// may hold background pushes back, so app open/resume stays the sure path.

export type PushData = Record<string, unknown>;

/** Only the database (dispatch secret) or a server key may send one. */
export function isSilentRequest(body: { silent?: unknown }, callerKind: 'service' | 'user' | string): boolean {
  return body?.silent === true && callerKind === 'service';
}

/** APNs: background push type, priority 5 (Apple requires both). */
export function silentApns(data: PushData) {
  return {
    headers: {
      'apns-push-type': 'background',
      'apns-priority': '5',
    } as Record<string, string>,
    payload: { aps: { 'content-available': 1 }, ...data } as Record<string, unknown>,
  };
}

/** FCM v1: a data-only message (no notification block), normal priority. */
export function silentFcmMessage(token: string, data: PushData) {
  return {
    token,
    android: { priority: 'normal' as const },
    data: {
      ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      silent: '1',
    },
  };
}
