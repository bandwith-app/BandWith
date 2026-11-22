/**
 * Stage mode's Bluetooth link in plain words (no "BLE", no "peripheral").
 *
 * Musicians shouldn't have to think about Bluetooth: it takes over when the
 * internet drops. So while the internet works nothing is shown, except a
 * missing permission (worth fixing before the internet drops, one button).
 * Texts come translated (src/lib/i18n), in the app's language.
 */
import { t } from '@/lib/i18n';

/**
 * - off: not running (web, demo, closed, no key);
 * - leading: the admin's phone is serving the band;
 * - searching / connected: a member's phone looking for / linked to the leader;
 * - denied: Bluetooth not allowed for the app;
 * - bt-off: Bluetooth turned off on the phone;
 * - unsupported: this phone can't do it;
 * - outdated: linked, but the leader's setlist has other songs than the one
 *   on this phone (songs added or removed while it was offline);
 * - old-leader: linked and following, but the leader's app is from before
 *   signed states (audit #1): it works, the leader should update.
 * - stale-key: the server says the gig's key pair changed (an admin stopped
 *   being one, migration 190: "pending") and the new one isn't on this phone
 *   yet: one trip online. Never from a leader's claim alone.
 * - unverified: linked and following, but this phone has no key to check the
 *   leader's signature yet (it wasn't online since the pair was made).
 * - leader-unverified: linked and following an admin on this app who has no
 *   key pair yet (offline since before one was made): it can't sign.
 * - clock-off: linked, but the leader's band-key state is far ahead of this
 *   phone's time, with no clock measured to explain it: not followed.
 */
export type StageBleStatus =
  | 'off'
  | 'leading'
  | 'searching'
  | 'connected'
  | 'old-leader'
  | 'stale-key'
  | 'unverified'
  | 'leader-unverified'
  | 'denied'
  | 'bt-off'
  | 'unsupported'
  | 'outdated'
  | 'clock-off';

/** A member's phone linked to the leader's (and following it). */
export const bleLinked = (status: StageBleStatus | undefined) =>
  status === 'connected' || status === 'old-leader' || status === 'unverified' || status === 'leader-unverified';

export interface StageBleNoticeInput {
  status: StageBleStatus;
  /** The live channel (internet) is connected. */
  online: boolean;
  isLeader: boolean;
  /** Leader: phones linked to it. */
  followers: number;
  platform: string;
}

export interface StageBleNotice {
  tone: 'ok' | 'warn';
  text: string;
  /** One button: allow Bluetooth, or turn it on (Android only). */
  action?: 'allow' | 'turn-on';
}

export function stageBleNotice({ status, online, isLeader, followers, platform }: StageBleNoticeInput): StageBleNotice | null {
  if (status === 'off') return null;
  if (status === 'denied') {
    return {
      tone: 'warn',
      text: isLeader
        ? t('Allow Bluetooth so the band can follow you when the internet drops.')
        : t('Allow Bluetooth to stay with the band when the internet drops.'),
      action: 'allow',
    };
  }
  // Worth fixing before the internet drops, so shown with it up too.
  if (status === 'old-leader') return { tone: 'warn', text: t("The leader's app is out of date: ask them to update") };
  // With the internet up, the band is in sync anyway: nothing to say.
  if (online) return null;
  switch (status) {
    case 'connected':
      return { tone: 'ok', text: t("Connected to the leader's phone") };
    case 'searching':
      return { tone: 'warn', text: t('Not connected: ask the leader to open Stage') };
    case 'leading':
      if (followers <= 0) return { tone: 'warn', text: t('No phones connected yet: ask the band to open Stage') };
      return {
        tone: 'ok',
        text: followers === 1 ? t('1 phone connected to you') : t('{count} phones connected to you', { count: followers }),
      };
    case 'bt-off':
      return platform === 'android'
        ? { tone: 'warn', text: t('Bluetooth is off: turn it on to stay in sync without internet.'), action: 'turn-on' }
        : { tone: 'warn', text: t('Bluetooth is off: turn it on in Control Center to stay in sync without internet.') };
    case 'outdated':
      return { tone: 'warn', text: t('This phone has an older setlist: connect to the internet once to follow the leader.') };
    case 'stale-key':
      return { tone: 'warn', text: t('The band changed who can lead: connect to the internet once to follow the leader.') };
    case 'unverified':
      return { tone: 'warn', text: t('Leader not verified yet: connect to the internet once to check it.') };
    case 'leader-unverified':
      return { tone: 'warn', text: t('Leader not verified yet: ask the leader to connect to the internet once.') };
    case 'clock-off':
      return { tone: 'warn', text: t("This phone's time and the leader's are far apart: set both to automatic date and time.") };
    case 'unsupported':
      return {
        tone: 'warn',
        text: isLeader ? t("This phone can't lead the band without internet.") : t("This phone can't follow the leader without internet."),
      };
    default:
      return null;
  }
}

/** A failed Bluetooth start: no permission (the usual case) or no Bluetooth LE on this phone. */
export const bleProblem = (error: unknown): 'denied' | 'unsupported' => {
  const msg = String((error as { message?: unknown })?.message ?? error);
  return /unsupported|not available|not supported/i.test(msg) ? 'unsupported' : 'denied';
};
