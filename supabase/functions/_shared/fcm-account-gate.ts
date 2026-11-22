// Android pushes that only the signed-in account sees (migration 184, Codex
// review #287 round 5). After a sign-out offline the server may keep pushing
// to the phone until the revocation gets through; a notification message is
// drawn by the system with no say from the app. Tokens saved by a build that
// checks the account natively (push_tokens.uid_gated) get a data-only
// message tagged with the recipient instead: the app's FirebaseMessagingService
// draws it only when that account is the one signed in on the device.
//
// Every other token keeps the notification message. An older APK draws no
// data-only message itself: the Capacitor plugin hands it to the WebView if
// the app is running (which shows it as "BandWith" with no text, since it
// reads only the notification block), and with the app not running keeps
// just the last one until the next start.

type PushData = Record<string, unknown>;

export interface GateTokenRow {
  platform?: unknown;
  token?: unknown;
  user_id?: unknown;
  uid_gated?: unknown;
}

/** Device token → the account it is for, for the tokens that check it on the phone. */
export function fcmAccountGates(tokens: GateTokenRow[] | null | undefined): Map<string, string> {
  const gates = new Map<string, string>();
  for (const t of tokens ?? []) {
    if (t?.platform === 'android' && t.uid_gated === true && typeof t.token === 'string' && t.user_id) {
      gates.set(t.token, String(t.user_id));
    }
  }
  return gates;
}

const strings = (data: PushData | undefined) =>
  data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : {};

export interface GatedFcmContent {
  /** What the notification shows as its title ("Title · Subtitle"). */
  displayTitle: string;
  title: string;
  subtitle?: string;
  body: string;
  data?: PushData;
  channelId?: string;
  tag?: string;
  /** Replaces a shown notification with the same tag (duplicates only). */
  collapseId?: string;
}

/** A silent push's data for a gated token: tagged too, so the app drops it for another account. */
export function accountTagged(data: PushData | undefined, uid: string): PushData {
  return { ...(data ?? {}), bw_uid: uid };
}

/**
 * The FCM v1 message for a token that checks the account on the phone:
 * data-only, high priority, with everything the app needs to draw it, and
 * bw_uid = the account it is for. (A silent push stays silentFcmMessage,
 * with accountTagged data.)
 */
export function gatedFcmMessage(deviceToken: string, uid: string, c: GatedFcmContent) {
  return {
    token: deviceToken,
    android: { priority: 'high' as const },
    data: {
      ...strings(c.data),
      title: c.title,
      subtitle: c.subtitle || '',
      tag: c.tag || '',
      channel_id: c.channelId || 'bandwith_general',
      bw_uid: uid,
      bw_title: c.displayTitle,
      bw_body: c.body,
      bw_tag: c.collapseId || '',
    },
  };
}
