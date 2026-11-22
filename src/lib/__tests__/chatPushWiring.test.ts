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
    // Round 8: per reader (pushBodyFor), from the stored message.
    expect(sendPush).toMatch(/sendToAPNs\(deviceToken, titleFor\(uid\), userSubtitle, pushBodyFor\(uid\), pushDataFor\(uid\),/);
    expect(sendPush).toMatch(/sendToFCM\(deviceToken, titleFor\(uid\), userSubtitle, pushBodyFor\(uid\), pushDataFor\(uid\),/);
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
    expect(sendPush).toMatch(/pendingAnnouncements\(/);
    expect(sendPush).toMatch(/\.rpc\('bw_write_chat_notices'/);
    expect(sendPush).toMatch(/ringIds/);
  });
});

// Codex review #284, round 3.
describe('send-push wiring, round 3', () => {
  it('notices are written per recipient by the database, for a live message only', () => {
    expect(sendPush).toMatch(/\.rpc\('bw_write_chat_notices', \{ p_message_id: current\.id, p_rows: notifications \}\)/);
    expect(sendPush).not.toMatch(/23505/);
  });

  it('pushes are marked once attempted, also when nobody has a device', () => {
    expect(sendPush).toMatch(/\.rpc\('bw_mark_chat_notices_pushed'/);
    expect((sendPush.match(/await markPushed\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('"already announced" means pushed (or being pushed), not only written', () => {
    expect(sendPush).toMatch(/noticeSettled\(/);
  });

  it('older builds: a wide candidate set', () => {
    expect(sendPush).toMatch(/\.limit\(named \? 1 : LEGACY_CANDIDATES\)/);
  });
});

// Claude review #284: overlapping calls with recipients in another order
// could deadlock (40P01) on the unique index.
describe('send-push wiring, round 3 (Claude)', () => {
  it('recipients are written in one order, and a deadlock is retried', () => {
    expect(sendPush).toMatch(/targetUserIds = \[\.\.\.recipients\]\.sort\(\);/);
    expect(sendPush).toMatch(/writeError\?\.code === '40P01'/);
  });
});

// Codex review #284, round 3 (second pass).
describe('send-push wiring, round 3b', () => {
  it('messages are read whole, so a deleted one is skipped on every path', () => {
    expect(sendPush).toMatch(/\.from\('messages'\)\s*\.select\('\*'\)/);
  });

  it('marks pushed only the recipients a device took (or with nothing to deliver to)', () => {
    expect(sendPush).toMatch(/pushSettledUsers\(/);
    expect(sendPush).not.toMatch(/await markPushed\(\);\s*const successful/);
  });

  it('a lost claim moves on to the next candidate', () => {
    expect(sendPush).toMatch(/pendingAnnouncements\(/);
    expect(sendPush).toMatch(/claim lost/i);
  });

  it('existing notices are read page by page (PostgREST returns at most 1000 rows)', () => {
    expect(sendPush).toMatch(/\.range\(from, from \+ NOTICE_PAGE - 1\)/);
  });
});

describe('send-push wiring, round 4', () => {
  const verify = sendPush.slice(sendPush.indexOf('async function verifyChatPush'), sendPush.indexOf('const NOTICE_PAGE'));
  it('the band name is used only when the sender is in that band', () => {
    expect(verify).toMatch(/\.from\('band_members'\)[\s\S]*\.eq\('band_id', chat\.band_id\)[\s\S]*\.eq\('user_id', callerId\)/);
    expect(verify).toMatch(/const pushBandId = inBand \? chat\.band_id : null;/);
    expect(verify).toMatch(/bandId: pushBandId,/);
  });

  it('without 194, the fallback skips recipients who already have the notice', () => {
    const fallback = sendPush.slice(sendPush.indexOf("writeError.code === 'PGRST202'"), sendPush.indexOf('if (writeError) throw writeError;'));
    expect(fallback).toMatch(/chatNoticesFor\(supabase, targetUserIds, \[current\.id\], \{ settledOnly: false \}\)/);
    expect(fallback).toMatch(/\.insert\(fresh\)/);
    expect(fallback).not.toMatch(/\.insert\(notifications\)/);
  });

  it('a failed token lookup releases the claims, so a retry delivers', () => {
    expect(sendPush).toMatch(/if \(tokenError\) \{\s*await releaseClaims\(\);\s*throw tokenError;/);
    expect(sendPush).toMatch(/rpc\('bw_release_chat_notice_claims', \{ p_ids: /);
  });

  it('create_in_app: false pushes only, with no inbox row', () => {
    const loop = sendPush.slice(sendPush.indexOf('for (const p of pendingAnnouncements('), sendPush.indexOf("rpc('bw_write_chat_notices'"));
    expect(loop).toMatch(/if \(create_in_app === false\) \{[\s\S]*ringIds = targetUserIds;[\s\S]*done = true;[\s\S]*break;/);
  });
});

describe('send-push wiring, round 5 (Codex)', () => {
  it('every device failing for now releases those claims, so a retry within the window delivers', () => {
    const tail = sendPush.slice(sendPush.indexOf('const settled = pushSettledUsers('));
    expect(tail).toMatch(/await markPushed\(settled\);/);
    expect(tail).toMatch(/await releaseClaims\(ringIds\.filter\(\(uid\) => !settledSet\.has\(uid\)\)\);/);
    const release = sendPush.slice(sendPush.indexOf('const releaseClaims = async'), sendPush.indexOf('if (chatPush) {'));
    expect(release).toMatch(/only\.has\(String\(c\.user_id\)\)/);
  });

  it('a push-only call is recorded per message and recipient: a retry never rings twice', () => {
    const loop = sendPush.slice(sendPush.indexOf('if (create_in_app === false) {'), sendPush.indexOf('const notifications = noticeRows();'));
    expect(loop).toMatch(/rpc\('bw_claim_chat_push_only', \{ p_message_id: current\.id, p_user_ids: targetUserIds \}\)/);
    expect(loop).toMatch(/if \(got\.size === 0\) continue;/);
    expect(loop).toMatch(/ringIds = targetUserIds\.filter\(\(uid\) => got\.has\(uid\)\);/);
    expect(sendPush).toMatch(/rpc\('bw_settle_chat_push_only'/);
    const mark = sendPush.slice(sendPush.indexOf('const markPushed = async'), sendPush.indexOf('const releaseClaims = async'));
    expect(mark).toMatch(/await settlePushOnly\(userIds, \[\]\);/);
  });
});

// Claude review of #284 00d5ce6f (round 8, finding 1): an edit between
// verifyChatPush and the write. What rings is what the database read under
// the message's lock, and @mentions are found in it.
describe('send-push wiring, round 8', () => {
  it('after the write, the stored content is announced and each reader gets their inbox preview', () => {
    const after = sendPush.slice(sendPush.indexOf('claimed = (got || [])'));
    expect(after).toMatch(/const stored = storedAnnouncement\(got\);\s*if \(stored\) \{\s*announce\(\{ id: current\.id, content: stored\.content \}, targetUserIds\);\s*pushBodyByUser = stored\.previewByUser;/);
  });

  it('every device gets its reader\'s text, never the shared body', () => {
    expect(sendPush).toMatch(/sendToAPNs\(deviceToken, titleFor\(uid\), userSubtitle, pushBodyFor\(uid\),/);
    expect(sendPush).toMatch(/sendToFCM\(deviceToken, titleFor\(uid\), userSubtitle, pushBodyFor\(uid\),/);
    expect(sendPush).toMatch(/body: pushBodyFor\(uid\),\s*messageId: announced\.id/);
    expect(sendPush).not.toMatch(/sendTo(APNs|FCM)\([^)]*, pushBody,/);
  });

  it('with nothing from the database, "New message" is still in the reader\'s language', () => {
    expect(sendPush).toMatch(/pushBodyByUser\.get\(uid\) \?\? chatPreviewIn\(/);
  });
});


// Claude delta review of #284 9338ea61 / #291 18912dd5 (round 9).
describe('send-push wiring, round 9', () => {
  it('NIT-3: after the stored announce, notice rows whose type changed get the type and title of the push', () => {
    const after = sendPush.slice(sendPush.indexOf('pushBodyByUser = stored.previewByUser;'));
    expect(after).toMatch(/^pushBodyByUser = stored\.previewByUser;\s*for \(const r of retypedNotices\(notifications, claimed, typeFor, titleFor\)\) \{\s*const \{ error: retypeError \} = await supabase\s*\.from\('notifications'\)\s*\.update\(\{ type: r\.type, title: r\.title \}\)\s*\.eq\('id', r\.id\)/);
  });

  it('MINOR-2: a push-only call rings the message as read after its claim, not verifyChatPush\'s read', () => {
    const po = sendPush.slice(sendPush.indexOf("if (create_in_app === false) {"), sendPush.indexOf('const notifications = noticeRows();'));
    const claim = po.indexOf("rpc('bw_claim_chat_push_only'");
    const reread = po.search(/from\('messages'\)\s*\.select\('\*'\)\s*\.eq\('id', current\.id\)\s*\.maybeSingle\(\)/);
    expect(claim).toBeGreaterThan(0);
    expect(reread).toBeGreaterThan(claim);
    expect(po).toMatch(/announce\(\{ id: current\.id, content: String\(\(nowRow as \{ content\?: unknown \}\)\.content \?\? ''\) \}, targetUserIds\);/);
    // Gone or deleted since: the claims go back and nobody rings.
    expect(po).toMatch(/await settlePushOnly\(\[\], \[\.\.\.got\]\);\s*ringIds = \[\];/);
  });
});
