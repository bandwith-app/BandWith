// send-push must announce only the caller's own message and respect the push
// switch (audit 02 #6, #7). The function runs on Deno, so this checks how it
// is wired; the rules themselves are tested in chatPush.test.ts.
import { describe, expect, it } from 'vitest';
import sendPush from '../../../supabase/functions/send-push/index.ts?raw';
import chats from '../services/chats.ts?raw';

describe('send-push wiring', () => {
  it('refuses an app push that is not the caller’s own recent message', () => {
    expect(sendPush).toMatch(/findAnnouncedCandidates\(/);
    expect(sendPush).toMatch(/if \(userType && !chatPush\) throw new HttpError\(403/);
  });

  it('writes the alert text from the stored message, not the request', () => {
    expect(sendPush).toMatch(/sendToAPNs\(deviceToken, titleFor\(uid\), userSubtitle, pushBody, pushDataFor\(uid\),/);
    expect(sendPush).toMatch(/sendToFCM\(deviceToken, titleFor\(uid\), userSubtitle, pushBody, pushDataFor\(uid\),/);
    expect(sendPush).toMatch(/title: titleFor\(userId\),\s*body: pushBody,/);
    expect(sendPush).not.toMatch(/sendToAPNs\(deviceToken, title,/);
  });

  it('rings only devices of people who left push on', () => {
    expect(sendPush).toMatch(/\.in\('user_id', silent \? ringIds : pushAllowed\(ringIds, peopleRows\)\)/);
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
    expect(sendPush).toMatch(/\.eq\('id', messageId as string\)/);
  });

  it('mentions, the chat id and the payload come from the server', () => {
    expect(sendPush).toMatch(/mentionsAmong\(/);
    expect(sendPush).toMatch(/resolveChatId\(data\)/);
    expect(sendPush).toMatch(/chatPushData\(/);
  });

  it('the app names the message it announces', () => {
    expect(chats).toMatch(/message_id: data\?\.id/);
  });
});

// Codex + Claude review #284, round 2.
describe('send-push wiring, round 2', () => {
  it('a verified chat push rings on the Messages channel, whatever the caller asked', () => {
    expect(sendPush).toMatch(/const effectiveChannel = chatPush \? CHAT_PUSH_CHANNEL :/);
  });

  it('mentions are resolved against the whole chat roster', () => {
    expect(sendPush).toMatch(/from\('chat_participants'\)/);
    expect(sendPush).toMatch(/mentionsAmong\(/);
  });

  it('chat, sender and band lookups fail loudly', () => {
    expect(sendPush).toMatch(/if \(chatError\) throw chatError;/);
    expect(sendPush).toMatch(/if \(senderError\) throw senderError;/);
    expect(sendPush).toMatch(/if \(bandError\) throw bandError;/);
  });

  it('a non-UUID message id is refused before the query', () => {
    expect(sendPush).toMatch(/!isUuid\(messageId\)\) return null;/);
  });

  it('older builds look the preview up by content', () => {
    expect(sendPush).toMatch(/legacyContentFilter\(/);
  });

  it('each recipient is told about a message once, and only those whose inbox row was written ring', () => {
    expect(sendPush).toMatch(/chooseUnannounced\(/);
    expect(sendPush).toMatch(/\.insert\(notifications\)\s*\.select\('user_id'\)/);
    expect(sendPush).toMatch(/ringIds/);
  });
});
