// Codex review #287 round 5 (B1): after an offline sign-out on Android the
// previous account's previews must not reach the lock screen, whatever the
// network does. Tokens of builds that check the account natively get a
// data-only push tagged with its recipient; every other token keeps the
// notification message (an older APK would show nothing for a data-only one).
import { describe, expect, it } from 'vitest';
import { accountTagged, clientPushData, fcmAccountGates, gatedFcmMessage } from '../../../supabase/functions/_shared/fcm-account-gate';
import { silentFcmMessage } from '../../../supabase/functions/_shared/push-silent';
import sendPush from '../../../supabase/functions/send-push/index.ts?raw';
import manifest from '../../../android/app/src/main/AndroidManifest.xml?raw';
import service from '../../../android/app/src/main/java/com/bandwith/app/BwMessagingService.java?raw';
import activity from '../../../android/app/src/main/java/com/bandwith/app/MainActivity.java?raw';

describe('Android pushes only the signed-in account sees', () => {
  it('only Android tokens a new build marked are gated, each to its own account', () => {
    const gates = fcmAccountGates([
      { platform: 'android', token: 'new', user_id: 'alice', uid_gated: true },
      { platform: 'android', token: 'old', user_id: 'bob', uid_gated: false },
      { platform: 'android', token: 'before-184', user_id: 'bob' },
      { platform: 'ios', token: 'apns', user_id: 'alice', uid_gated: true },
    ]);
    expect([...gates]).toEqual([['new', 'alice']]);
    expect(fcmAccountGates(null).size).toBe(0);
  });

  it('a gated push is data-only, high priority, tagged, with what the app needs to draw it', () => {
    const m = gatedFcmMessage('tok', 'alice', {
      displayTitle: 'Mirage · Chat',
      title: 'Mirage',
      subtitle: 'Chat',
      body: 'See you at 8',
      data: { chat_id: 'c1', n: 3 },
      channelId: 'bandwith_messages',
      tag: 'chat',
      collapseId: 'chat:c1',
    });
    expect(m).not.toHaveProperty('notification');
    expect(m.android).toEqual({ priority: 'high' });
    expect(m.data).toMatchObject({
      chat_id: 'c1',
      n: '3',
      bw_uid: 'alice',
      bw_title: 'Mirage · Chat',
      bw_body: 'See you at 8',
      bw_tag: 'chat:c1',
      channel_id: 'bandwith_messages',
    });
    expect(Object.values(m.data).every((v) => typeof v === 'string')).toBe(true);
  });

  it('a silent push stays silent, tagged too', () => {
    const m = silentFcmMessage('tok', accountTagged({ type: 'live_pack_refresh' }, 'alice'));
    expect(m.data).toMatchObject({ silent: '1', bw_uid: 'alice', type: 'live_pack_refresh' });
    expect(m.android).toEqual({ priority: 'normal' });
  });

  it('send-push gates by token, and keeps the notification message for the rest', () => {
    expect(sendPush).toMatch(/const fcmGates = fcmAccountGates\(tokens\)/);
    expect(sendPush).toMatch(/sendFcmMessage\(fcmGates\.get\(deviceToken\), deviceToken, \.\.\.rest\)/);
    expect(sendPush).toMatch(/gatedFcmMessage\(deviceToken, gateUid,/);
    expect(sendPush).toMatch(/silentFcmMessage\(deviceToken, gateUid \? accountTagged\(data, gateUid\) : data \?\? \{\}\)/);
    expect(sendPush).toMatch(/notification: \{ title: displayTitle, body \}/);
  });

  it('the app replaces the plugin service with the account check', () => {
    expect(manifest).toMatch(/android:name="\.BwMessagingService"/);
    expect(manifest).toMatch(/pushnotifications\.MessagingService" tools:node="remove"/);
    expect(service).toMatch(/PushIdentity\.decide\(target, PushIdentity\.current\(this\)\)/);
    expect(service).toMatch(/case DROP:\s*return;/);
    expect(activity).toMatch(/registerPlugin\(PushIdentityPlugin\.class\)/);
  });

  // Codex review #287 round 6 (minor): only the server sets silent and the
  // bw_* keys. A chat sender's data.silent="1" would hide the push on phones.
  it('a sender passing data.silent="1" (or a bw_uid) still produces a shown notification', () => {
    const sent = { chat_id: 'c1', silent: '1', bw_uid: 'mallory', bw_title: 'x', bw_body: 'y', bw_tag: 'z' };
    expect(clientPushData(sent)).toEqual({ chat_id: 'c1' });
    expect(clientPushData(undefined)).toBeUndefined();
    const m = gatedFcmMessage('tok', 'alice', { displayTitle: 'T', title: 'T', body: 'B', data: sent });
    expect(m.data).not.toHaveProperty('silent');
    expect(m.data).toMatchObject({ chat_id: 'c1', bw_uid: 'alice', bw_title: 'T', bw_body: 'B' });
    // Every FCM send drops them before anything else, gated or not.
    expect(sendPush).toMatch(/\): Promise<\{ success: boolean; error\?: string \}> \{\s*\/\/ The keys only the server sets[^\n]*\n\s*data = clientPushData\(data\);/);
  });

  // Codex review #287 round 7: sendToAPNs spreads the caller's data after
  // the aps block, so a data.aps replaced the alert, thread-id or sound.
  it('a sender passing data.aps cannot replace the APNs alert, thread or sound', () => {
    const sent = { chat_id: 'c1', aps: { alert: 'spoofed', sound: 'none', 'thread-id': 'x' } };
    expect(clientPushData(sent)).toEqual({ chat_id: 'c1' });
    const apns = sendPush.slice(sendPush.indexOf('async function sendToAPNs('));
    const body = apns.slice(0, apns.indexOf('const apnsPayload'));
    // Dropped first thing, before the silent payload or the alert's spread.
    expect(body).toMatch(/\): Promise<\{ success: boolean; error\?: string \}> \{\s*\/\/[^\n]*\n\s*data = clientPushData\(data\);\s*try \{/);
    expect(body.indexOf('clientPushData(data)')).toBeLessThan(body.indexOf('silentApns('));
  });
});
