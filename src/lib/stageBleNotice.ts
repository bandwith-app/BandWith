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
 *   on this phone (songs added or removed while it was offline).
 */
export type StageBleStatus = 'off' | 'leading' | 'searching' | 'connected' | 'denied' | 'bt-off' | 'unsupported' | 'outdated';

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

export interface FollowLabelInput {
  following: boolean;
  /** A leader's state (a song) has arrived. */
  leaderSeen: boolean;
  /** The leader's phone is in Stage mode and reachable, song picked or not. */
  leaderHere?: boolean;
  /** The live channel (internet) is connected. */
  connected: boolean;
  bluetooth?: StageBleStatus;
}

/**
 * A member's follow button, one state at a time and never against the status
 * line: linked to the leader's phone before it picked a song is "hasn't
 * started yet", not "waiting".
 */
export function followLabel({ following, leaderSeen, leaderHere, connected, bluetooth }: FollowLabelInput): string {
  if (!following) return t('Follow leader');
  if (!leaderSeen) return leaderHere ? t("Leader hasn't started yet") : t('Waiting for leader');
  if (!connected && bluetooth !== 'connected') return t('Offline');
  return t('Following leader');
}
