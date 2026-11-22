// send-push must announce only the caller's own message and respect the push
// switch (audit 02 #6, #7). The function runs on Deno, so this checks how it
// is wired; the rules themselves are tested in chatPush.test.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const read = (env: string, rel: string) => readFileSync(process.env[env] || resolve(root, rel), 'utf8');
const sendPush = read('SEND_PUSH_SRC', 'supabase/functions/send-push/index.ts');
const chats = read('CHATS_SRC', 'src/lib/services/chats.ts');

describe('send-push wiring', () => {
  it('refuses an app push that is not the caller’s own recent message', () => {
    expect(sendPush).toMatch(/findAnnouncedMessage\(/);
    expect(sendPush).toMatch(/if \(userType && !chatPush\) throw new HttpError\(403/);
  });

  it('writes the alert text from the stored message, not the request', () => {
    expect(sendPush).toMatch(/sendToAPNs\(deviceToken, titleFor\(uid\), userSubtitle, pushBody, pushData,/);
    expect(sendPush).toMatch(/sendToFCM\(deviceToken, titleFor\(uid\), userSubtitle, pushBody, pushData,/);
    expect(sendPush).toMatch(/title: titleFor\(userId\),\s*body: pushBody,/);
    expect(sendPush).not.toMatch(/sendToAPNs\(deviceToken, title,/);
  });

  it('rings only devices of people who left push on', () => {
    expect(sendPush).toMatch(/\.in\('user_id', silent \? targetUserIds : pushAllowed\(targetUserIds, peopleRows\)\)/);
  });

  it('the app names the message it announces', () => {
    expect(chats).toMatch(/message_id: data\?\.id/);
  });
});
