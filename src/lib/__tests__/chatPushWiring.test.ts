// send-push must announce only the caller's own message and respect the push
// switch (audit 02 #6, #7). The function runs on Deno, so this checks how it
// is wired; the rules themselves are tested in chatPush.test.ts.
import { describe, expect, it } from 'vitest';
import sendPush from '../../../supabase/functions/send-push/index.ts?raw';
import chats from '../services/chats.ts?raw';

describe('send-push wiring', () => {
  it('refuses an app push that is not the caller’s own recent message', () => {
    expect(sendPush).toMatch(/findAnnouncedMessage\(/);
    expect(sendPush).toMatch(/if \(userType && !chatPush\) throw new HttpError\(403/);
  });

  it('writes the alert text from the stored message, not the request', () => {
    expect(sendPush).toMatch(/sendToAPNs\(deviceToken, titleFor\(uid\), userSubtitle, pushBody, pushDataFor\(uid\),/);
    expect(sendPush).toMatch(/sendToFCM\(deviceToken, titleFor\(uid\), userSubtitle, pushBody, pushDataFor\(uid\),/);
    expect(sendPush).toMatch(/title: titleFor\(userId\),\s*body: pushBody,/);
    expect(sendPush).not.toMatch(/sendToAPNs\(deviceToken, title,/);
  });

  it('rings only devices of people who left push on', () => {
    expect(sendPush).toMatch(/\.in\('user_id', silent \? targetUserIds : pushAllowed\(targetUserIds, peopleRows\)\)/);
  });

  // Codex review #284.
  it('caller data can never replace the APNs alert', () => {
    expect(sendPush).toMatch(/const \{ aps: _callerAps, \.\.\.extra \} = data \?\? \{\};/);
    expect(sendPush).toMatch(/\{\s*\.\.\.extra,\s*aps: \{/);
  });

  it('a failed preferences lookup sends nothing', () => {
    expect(sendPush).toMatch(/if \(peopleError\) throw peopleError;/);
  });

  it('a message named by id is looked up exactly, not in a 20-row window', () => {
    expect(sendPush).toMatch(/\.eq\('id', messageId\)/);
  });

  it('mentions, the chat id and the payload come from the server', () => {
    expect(sendPush).toMatch(/mentionedInMessage\(/);
    expect(sendPush).toMatch(/resolveChatId\(data\)/);
    expect(sendPush).toMatch(/chatPushData\(/);
  });

  it('the app names the message it announces', () => {
    expect(chats).toMatch(/message_id: data\?\.id/);
  });
});
