// Supabase Edge Function: Send Push Notification (Zero External Dependencies)
import { adminClient, chatRecipients, HttpError, requireCaller } from '../_shared/auth.ts';
import { localizePushLabel, pushCollapseId, pushLanguage, pushThreadId } from '../_shared/push-labels.ts';
import { isSilentRequest, silentApns, silentFcmMessage } from '../_shared/push-silent.ts';
import {
  CHAT_PUSH_CHANNEL,
  CHAT_PUSH_WINDOW_MS,
  LEGACY_CANDIDATES,
  noticeSettled,
  chatPreview,
  chatPushData,
  chatPushSubtitle,
  chatPushTitle,
  chooseUnannounced,
  findAnnouncedCandidates,
  isUuid,
  legacyContentFilter,
  mentionsAmong,
  pushAllowed,
  resolveChatId,
  senderDisplayName,
} from '../_shared/chat-push.ts';

const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID');
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID');
const APNS_PRIVATE_KEY = Deno.env.get('APNS_PRIVATE_KEY'); 
const APNS_BUNDLE_ID = 'app.bandwith.mobile';

// Xcode/debug builds get sandbox tokens, TestFlight/App Store builds get
// production tokens. Try the preferred host first and fall back to the other
// one on BadDeviceToken, so one deployment serves both kinds of build.
// APNS_PRODUCTION=true only changes which host is tried first.
const APNS_PROD_HOST = 'api.push.apple.com';
const APNS_SANDBOX_HOST = 'api.sandbox.push.apple.com';
const APNS_HOSTS = Deno.env.get('APNS_PRODUCTION') === 'false'
  ? [APNS_SANDBOX_HOST, APNS_PROD_HOST]
  : [APNS_PROD_HOST, APNS_SANDBOX_HOST];

const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID');
const FCM_CLIENT_EMAIL = Deno.env.get('FCM_CLIENT_EMAIL');
const FCM_PRIVATE_KEY = Deno.env.get('FCM_PRIVATE_KEY');

interface PushRequest {
  user_id?: string;
  user_ids?: string[];
  title: string;
  subtitle?: string;
  tag?: string;
  channel_id?: string;
  body: string;
  data?: Record<string, any>;
  badge?: number;
  sound?: string;
  create_in_app?: boolean; 
  /** Background wake-up only (live pack refresh, migration 170). Server calls only. */
  silent?: boolean;
}

// Pure JS Base64URL encoder to avoid external std library imports
function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// Apple accepts a new provider token (the signed JWT) at most once every 20
// minutes (429 TooManyProviderTokenUpdates) and expires it after 60. Edge
// instances start and stop all the time, so a token kept only in memory was
// signed again on almost every push and Apple refused them. The token is now
// shared by every instance through the database (migration 121) and reused
// for 45 minutes; memory is only a fast path.
const APNS_TOKEN_MAX_AGE_S = 45 * 60;
type ApnsJwt = { token: string; iat: number };
let cachedApnsJwt: ApnsJwt | null = null;
let pendingApnsJwt: Promise<string> | null = null;

const freshInMemory = () =>
  cachedApnsJwt && Math.floor(Date.now() / 1000) - cachedApnsJwt.iat < APNS_TOKEN_MAX_AGE_S;

async function claimSharedApnsJwt(candidate: ApnsJwt | null, reject?: string): Promise<ApnsJwt | null> {
  const { data, error } = await adminClient().rpc('bw_apns_token_claim', {
    p_candidate: candidate?.token ?? null,
    p_issued_at: candidate?.iat ?? null,
    p_reject: reject ?? null,
    p_max_age: APNS_TOKEN_MAX_AGE_S,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row?.token ? { token: String(row.token), iat: Number(row.issued_at) } : null;
}

/**
 * The provider token every instance shares. `reject` is a token Apple just
 * called expired or invalid: it is replaced instead of returned.
 */
async function generateAPNsJWT(reject?: string): Promise<string> {
  if (!reject && freshInMemory()) return cachedApnsJwt!.token;
  if (!reject && pendingApnsJwt) return pendingApnsJwt;
  const run = (async () => {
    try {
      let shared = await claimSharedApnsJwt(null, reject);
      if (!shared) shared = await claimSharedApnsJwt(await signAPNsJWT(), reject);
      if (shared) {
        cachedApnsJwt = shared;
        return shared.token;
      }
    } catch (e) {
      console.warn('APNs shared token unavailable:', e instanceof Error ? e.message : String(e));
    }
    // Database unreachable: fall back to this instance's own token.
    if (!reject && freshInMemory()) return cachedApnsJwt!.token;
    cachedApnsJwt = await signAPNsJWT();
    return cachedApnsJwt.token;
  })();
  if (!reject) pendingApnsJwt = run;
  try {
    return await run;
  } finally {
    if (pendingApnsJwt === run) pendingApnsJwt = null;
  }
}

async function signAPNsJWT(): Promise<ApnsJwt> {
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) {
    throw new Error(`APNs credentials missing`);
  }

  const header = { alg: 'ES256', kid: APNS_KEY_ID };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: APNS_TEAM_ID, iat: now };

  const encoder = new TextEncoder();
  const encodedHeader = encodeBase64Url(encoder.encode(JSON.stringify(header)));
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  let pemContent = APNS_PRIVATE_KEY;
  if (pemContent.includes('-----BEGIN PRIVATE KEY-----')) {
    pemContent = pemContent
      .replace(/\\n/g, '\n')
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '');
  } else {
    pemContent = pemContent.replace(/\\n/g, '').replace(/\s/g, '');
  }

  const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey as any,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    encoder.encode(unsignedToken)
  );

  return { token: `${unsignedToken}.${encodeBase64Url(new Uint8Array(signature))}`, iat: now };
}

async function sendToAPNs(
  deviceToken: string, 
  title: string, 
  subtitle: string | undefined,
  body: string,
  data?: Record<string, any>,
  badge?: number,
  sound?: string,
  collapseId?: string,
  silent = false
): Promise<{ success: boolean; error?: string }> {
  try {
    let jwt = await generateAPNsJWT();
    const quiet = silent ? silentApns(data ?? {}) : null;
    const alert: Record<string, string> = { title, body };
    if (subtitle) {
      alert.subtitle = subtitle;
    }
    const threadId = pushThreadId(data);
    // Custom keys first, our aps last: a caller's `aps` never replaces the alert.
    const { aps: _callerAps, ...extra } = data ?? {};

    const apnsPayload = quiet ? quiet.payload : {
      ...extra,
      aps: {
        alert,
        // No count known: leave the icon as it is rather than forcing 1.
        ...(badge !== undefined ? { badge } : {}),
        sound: sound ?? 'default',
        'mutable-content': 1,
        'content-available': 1,
        // Notification Center stacks a chat's (or an event's) notifications.
        ...(threadId ? { 'thread-id': threadId } : {}),
      },
    };
    
    let lastError = 'APNs: no host tried';
    let badTokenEverywhere = true;
    const post = (host: string) =>
      fetch(`https://${host}/3/device/${deviceToken}`, {
        method: 'POST',
        headers: {
          'Authorization': `bearer ${jwt}`,
          'apns-topic': APNS_BUNDLE_ID,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-expiration': '0',
          // Was data.tag ("Direct Message", "Gig Alert"): every DM replaced the last one.
          ...(collapseId && !quiet ? { 'apns-collapse-id': collapseId } : {}),
          // Silent: background push type, priority 5.
          ...(quiet ? quiet.headers : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(apnsPayload),
      });
    const reasonOf = async (response: Response) => {
      const text = await response.text();
      try { return { text, reason: String(JSON.parse(text)?.reason || '') }; } catch { return { text, reason: '' }; }
    };
    for (const host of APNS_HOSTS) {
      let response = await post(host);
      if (!response.ok && (response.status === 403 || response.status === 429)) {
        // The provider token, not the device: swap it once and retry.
        const { text, reason } = await reasonOf(response);
        let next: string | null = null;
        if (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken') {
          next = await generateAPNsJWT(jwt);
        } else if (reason === 'TooManyProviderTokenUpdates') {
          // Another instance may already hold the token Apple knows.
          cachedApnsJwt = null;
          next = await generateAPNsJWT();
        }
        if (next && next !== jwt) {
          jwt = next;
          response = await post(host);
        } else {
          response = new Response(text, { status: response.status });
        }
      }
      if (response.ok) return { success: true };

      const errorBody = await response.text();
      let reason = '';
      try { reason = JSON.parse(errorBody)?.reason || ''; } catch { /* not JSON */ }
      lastError = `APNs ${host} ${response.status} ${reason || errorBody}`;

      // 410 Unregistered: the app was removed from the device. Final.
      if (response.status === 410) return { success: false, error: 'invalid_token' };
      // Token from the other environment: try the next host.
      if (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic') continue;
      // Anything else (bad payload, auth, throttling) is not the token's fault.
      badTokenEverywhere = false;
      break;
    }
    return { success: false, error: badTokenEverywhere ? 'invalid_token' : lastError };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

// Google's access token lasts an hour: reuse it inside this instance.
let cachedFcmToken: { token: string; until: number } | null = null;

async function getFCMAccessToken(): Promise<string | null> {
  if (!FCM_CLIENT_EMAIL || !FCM_PRIVATE_KEY) return null;
  if (cachedFcmToken && Date.now() < cachedFcmToken.until) return cachedFcmToken.token;

  try {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: FCM_CLIENT_EMAIL,
      sub: FCM_CLIENT_EMAIL,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    };

    const encoder = new TextEncoder();
    const encodedHeader = encodeBase64Url(encoder.encode(JSON.stringify(header)));
    const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    let pemContent = FCM_PRIVATE_KEY;
    pemContent = pemContent
      .replace(/\\n/g, '\n')
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/[\n\r\s]/g, '');

    const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryKey as any,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      encoder.encode(unsignedToken)
    );

    const jwt = `${unsignedToken}.${encodeBase64Url(new Uint8Array(signature))}`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!tokenResponse.ok) return null;
    const tokenData = await tokenResponse.json();
    if (!tokenData?.access_token) return null;
    const lifeS = Number(tokenData.expires_in) || 3600;
    cachedFcmToken = { token: tokenData.access_token, until: Date.now() + Math.max(60, lifeS - 300) * 1000 };
    return tokenData.access_token;
  } catch {
    return null;
  }
}

async function sendToFCM(
  deviceToken: string,
  title: string,
  subtitle: string | undefined,
  body: string,
  data?: Record<string, any>,
  channelId?: string,
  tag?: string,
  collapseId?: string,
  silent = false
): Promise<{ success: boolean; error?: string }> {
  if (!FCM_PROJECT_ID) return { success: false, error: 'FCM not configured' };
  const accessToken = await getFCMAccessToken();
  if (!accessToken) return { success: false, error: 'Could not get FCM access token' };

  try {
    const displayTitle = subtitle ? `${title} · ${subtitle}` : title;
    const androidNotification: Record<string, any> = {
      sound: 'default',
      channelId: channelId || 'bandwith_general',
      icon: 'ic_stat_notification',
      color: '#050505',
    };
    // The notification tag replaces the shown notification with the same tag:
    // only duplicates collapse (the label stays in data.tag).
    if (collapseId) androidNotification.tag = collapseId;

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(silent ? { message: silentFcmMessage(deviceToken, data ?? {}) } : {
          message: {
            token: deviceToken,
            notification: { title: displayTitle, body },
            android: {
              priority: 'high',
              notification: androidNotification,
            },
            data: {
              ...(data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : {}),
              title,
              subtitle: subtitle || '',
              tag: tag || '',
              channel_id: channelId || 'bandwith_general',
            },
          },
        }),
      }
    );

    if (!response.ok) {
      // Our access token was refused: sign a new one next time.
      if (response.status === 401) cachedFcmToken = null;
      const errorBody = await response.text();
      // Only a dead or malformed token turns the device off. Any other
      // INVALID_ARGUMENT is a payload problem: switching every Android token
      // off for it would silence the device for good.
      if (errorBody.includes('UNREGISTERED') || (errorBody.includes('INVALID_ARGUMENT') && /registration token/i.test(errorBody))) {
        return { success: false, error: 'invalid_token' };
      }
      console.error(`FCM error ${response.status}:`, errorBody.slice(0, 500));
      return { success: false, error: `FCM error: ${response.status}` };
    }
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

type VerifiedChatPush = {
  /** Messages this push may announce, newest first (one when named by id). */
  candidates: { id: string; chat_id: string; sender_id: string; content: string | null; created_at: string }[];
  senderName: string;
  subtitle: string;
  bandId: string | null;
  bandName: string | null;
  chatType: string | null;
};

/**
 * 02 #7: a signed-in caller may only announce a message they just sent in
 * that chat. Who sent it and what it says come from the database, never from
 * the request. Older builds send no message id: the body (the app's preview
 * of the message) is matched against the caller's recent messages instead.
 */
async function verifyChatPush(
  supabase: ReturnType<typeof adminClient>,
  callerId: string,
  chatId: unknown,
  messageId: unknown,
  body: unknown,
): Promise<VerifiedChatPush | null> {
  if (!callerId || typeof chatId !== 'string' || !chatId) return null;
  const since = new Date(Date.now() - CHAT_PUSH_WINDOW_MS).toISOString();
  // Newer builds name the message: look it up exactly (a busy chat could push
  // it out of any window). It must be a UUID: anything else made the cast
  // fail with a 500 (Claude review #284), now it is refused (403).
  const named = messageId !== undefined && messageId !== null && messageId !== '';
  if (named && !isUuid(messageId)) return null;
  if (!named && typeof body !== 'string') return null;
  let query = supabase
    .from('messages')
    .select('id, chat_id, sender_id, content, created_at')
    .eq('chat_id', chatId)
    .eq('sender_id', callerId);
  if (named) {
    query = query.eq('id', messageId as string);
  } else {
    // Older builds: by content, so a sender's 20 newer messages can't hide it.
    const f = legacyContentFilter(body as string);
    query = 'eq' in f ? query.eq('content', f.eq) : 'like' in f ? query.like('content', f.like) : query.in('content', f.in);
    query = query.gte('created_at', since);
  }
  // Older builds: every recent message with that preview is a candidate
  // (20 identical "OK"s within ten minutes left the 21st unannounced).
  const { data: recent, error } = await query.order('created_at', { ascending: false }).limit(named ? 1 : LEGACY_CANDIDATES);
  if (error) throw error;
  const candidates = findAnnouncedCandidates(recent || [], {
    callerId,
    chatId,
    messageId: named ? messageId : undefined,
    body: typeof body === 'string' ? body : undefined,
  });
  if (candidates.length === 0) return null;

  // A failed lookup must not label a DM "Band Chat" or the sender "Someone".
  const [{ data: chat, error: chatError }, { data: sender, error: senderError }] = await Promise.all([
    supabase.from('chats').select('type, name, band_id').eq('id', chatId).maybeSingle(),
    supabase.from('profiles').select('full_name, email').eq('id', callerId).maybeSingle(),
  ]);
  if (chatError) throw chatError;
  if (senderError) throw senderError;
  if (!chat) return null;
  let bandName: string | null = null;
  if (chat.band_id) {
    const { data: band, error: bandError } = await supabase.from('bands').select('name').eq('id', chat.band_id).maybeSingle();
    if (bandError) throw bandError;
    bandName = band?.name ?? null;
  }
  return {
    candidates,
    senderName: senderDisplayName(sender?.full_name, sender?.email),
    subtitle: chatPushSubtitle(chat.type ?? null, bandName, chat.name ?? null),
    bandId: chat.band_id ?? null,
    bandName,
    chatType: chat.type ?? null,
  };
}

/**
 * Chat notices already announced for these messages (Claude review #284):
 * each recipient hears about a message once. Announced = pushed, or being
 * pushed right now (Codex review #284 r3): a notice written but never
 * pushed is pushed by a retry.
 */
async function chatNoticesFor(
  supabase: ReturnType<typeof adminClient>,
  userIds: string[],
  messageIds: string[],
): Promise<{ user_id: string; message_id: string | null }[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('user_id, message_id:data->>message_id, pushed_at:data->>pushed_at, push_claimed_at:data->>push_claimed_at')
    .in('user_id', userIds)
    .in('type', ['chat_message', 'chat_mention'])
    .in('data->>message_id', messageIds);
  if (error) throw error;
  const now = Date.now();
  return ((data || []) as { user_id: string; message_id: string | null; pushed_at?: string | null; push_claimed_at?: string | null }[])
    .filter((n) => noticeSettled(n, now));
}

/** Everyone in the chat but the caller, with display names (for @mentions). */
async function chatRoster(
  supabase: ReturnType<typeof adminClient>,
  chatId: string,
  callerId: string,
): Promise<{ id: string; name: string }[]> {
  const { data: parts, error } = await supabase.from('chat_participants').select('user_id').eq('chat_id', chatId);
  if (error) throw error;
  const ids = [...new Set((parts || []).map((p: { user_id: string }) => String(p.user_id)))].filter((id) => id !== callerId);
  if (ids.length === 0) return [];
  const { data: people, error: peopleError } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
  if (peopleError) throw peopleError;
  return ((people || []) as { id: string; full_name?: string | null; email?: string | null }[])
    .map((p) => ({ id: String(p.id), name: senderDisplayName(p.full_name, p.email, '') }));
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // SECURITY: require a signed-in caller (or a server call with a secret
    // key on apikey) and only deliver to users who share a band or chat with them.
    const supabase = adminClient();
    // The notifications trigger (migration 048) authenticates with a
    // database-generated secret instead of a secret key.
    const dispatchSecret = req.headers.get('x-bw-dispatch-secret');
    let caller: Awaited<ReturnType<typeof requireCaller>>;
    if (dispatchSecret) {
      const { data: ok, error } = await supabase.rpc('bw_verify_push_dispatch_secret', {
        p_secret: dispatchSecret,
      });
      if (error || ok !== true) throw new HttpError(401, 'Invalid dispatch secret');
      caller = { kind: 'service' };
    } else {
      caller = await requireCaller(req, supabase);
    }

    const body = await req.json();
    const {
      user_id,
      user_ids,
      title,
      subtitle,
      tag,
      channel_id,
      body: notificationBody,
      data,
      badge,
      sound,
      create_in_app
    } = body as PushRequest;

    if ((body as PushRequest)?.silent === true && caller.kind !== 'service') {
      throw new HttpError(403, 'Silent pushes come from the server only');
    }
    const silent = isSilentRequest(body as PushRequest, caller.kind);
    if (!silent && (!title || !notificationBody)) throw new HttpError(400, 'Missing title or body');
    if (String(title ?? '').length > 200 || String(notificationBody ?? '').length > 2000) {
      throw new HttpError(400, 'Title or body too long');
    }
    const requestedIds = (user_ids || (user_id ? [user_id] : [])).slice(0, 200);
    if (requestedIds.length === 0) throw new HttpError(400, 'No user IDs provided');
    // Users can only push chat notices, to the other people in that chat.
    // Every other notice comes from the database (dispatch secret) or a
    // server call.
    const userType = caller.kind === 'service' ? null : (data?.type || 'chat_message');
    if (userType && userType !== 'chat_message' && userType !== 'chat_mention') {
      throw new HttpError(403, 'Only chat notifications can be sent from the app');
    }
    // One chat for checks, inbox and tap routing (chat_id and chatId must agree).
    const requestChat = resolveChatId(data);
    if (userType && requestChat.conflict) throw new HttpError(400, 'chat_id and chatId differ');
    const allowedIds = caller.kind === 'service'
      ? requestedIds
      : await chatRecipients(supabase, caller.id, requestChat.chatId, requestedIds);
    if (allowedIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No permitted recipients' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 02 #7: an app caller can only announce their own new message, and the
    // server writes who sent it and what it says (title, subtitle, body).
    const chatPush = userType
      ? await verifyChatPush(supabase, caller.kind === 'user' ? caller.id : '', requestChat.chatId, data?.message_id ?? data?.messageId, notificationBody)
      : null;
    if (userType && !chatPush) throw new HttpError(403, 'Only your own new message can be announced');

    // One message rings each recipient once (Claude review #284): skip those
    // who already have its chat notice. Older builds sending "OK" twice get
    // the other "OK" announced.
    let announced: { id: string; content: string | null } | null = null;
    let targetUserIds = allowedIds;
    if (chatPush) {
      // In chunks: up to LEGACY_CANDIDATES ids don't fit one request URL.
      let pick: ReturnType<typeof chooseUnannounced> = null;
      for (let i = 0; i < chatPush.candidates.length && !pick; i += 50) {
        const chunk = chatPush.candidates.slice(i, i + 50);
        const existing = await chatNoticesFor(supabase, allowedIds, chunk.map((m) => String(m.id)));
        pick = chooseUnannounced(chunk, allowedIds, existing);
      }
      if (!pick) {
        return new Response(
          JSON.stringify({ success: true, sent: 0, message: 'Already announced' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      announced = { id: String(pick.message.id), content: pick.message.content ?? '' };
      // One order for every call (the database locks rows in user order).
      targetUserIds = [...pick.recipients].sort();
    }

    // Recipients' language and push switch (02 #6).
    // Without the push switch we can't know who turned push off: send nothing.
    const { data: people, error: peopleError } = await supabase
      .from('profiles')
      .select('id, full_name, email, preferred_language, notification_preferences')
      .in('id', targetUserIds);
    if (peopleError) throw peopleError;
    const peopleRows = (people || []) as { id: string; full_name?: string | null; email?: string | null; preferred_language?: string | null; notification_preferences: unknown }[];
    const prefLangByUser = new Map(peopleRows.map((p) => [String(p.id), p.preferred_language ?? null]));
    // "{name} mentioned you" only for people the stored message mentions,
    // with names read against the whole chat (Ana vs Ana Maria).
    const mentioned = new Set(
      chatPush && announced && userType === 'chat_mention' && requestChat.chatId
        ? mentionsAmong(
            announced.content,
            await chatRoster(supabase, requestChat.chatId, caller.kind === 'user' ? caller.id : ''),
            targetUserIds,
            caller.kind === 'user' ? caller.id : null,
          )
        : [],
    );
    const typeFor = (uid: string): 'chat_message' | 'chat_mention' =>
      userType === 'chat_mention' && mentioned.has(uid) ? 'chat_mention' : 'chat_message';
    const titleFor = (uid: string) =>
      chatPush ? chatPushTitle(typeFor(uid), chatPush.senderName, prefLangByUser.get(uid)) : title;
    const pushBody = chatPush && announced ? chatPreview(announced.content) : notificationBody;
    const verifiedFor = (uid: string) =>
      chatPush && announced && requestChat.chatId
        ? chatPushData(data, {
            chatId: requestChat.chatId,
            type: typeFor(uid),
            senderName: chatPush.senderName,
            body: pushBody,
            messageId: announced.id,
            bandId: chatPush.bandId,
            bandName: chatPush.bandName,
            chatType: chatPush.chatType,
            subtitle: localizePushLabel(chatPush.subtitle, pushLanguage(prefLangByUser.get(uid) ?? null)),
          })
        : null;
    const pushDataFor = (uid: string): Record<string, any> | undefined => verifiedFor(uid) ?? data;

    const effectiveSubtitle = chatPush ? chatPush.subtitle : (subtitle || data?.subtitle);
    const effectiveTag = tag || data?.tag;
    const notificationType = userType || data?.type || 'chat_message';
    // A verified chat push always uses the Messages channel: someone who
    // muted Messages must not get the preview through Events (Codex #284).
    const effectiveChannel = chatPush ? CHAT_PUSH_CHANNEL : (channel_id || data?.channel_id || (
      notificationType.includes('chat') ? 'bandwith_messages' :
      notificationType.includes('quote') || notificationType.includes('payment') ? 'bandwith_finance' :
      notificationType.includes('event') || notificationType.includes('member_dropped_out') ? 'bandwith_events' :
      'bandwith_general'
    ));

    // Devices that may ring. A chat push rings only recipients whose inbox
    // row was written and claimed: once per message, and a message deleted
    // meanwhile writes none (bw_write_chat_notices, 194).
    let ringIds = targetUserIds;
    // Chat notices this call claimed: marked pushed once the push was tried
    // (also when nobody has a device), so a retry never pushes them again.
    let claimedIds: string[] = [];
    const markPushed = async () => {
      if (claimedIds.length === 0) return;
      const { error: markError } = await supabase.rpc('bw_mark_chat_notices_pushed', { p_ids: claimedIds });
      if (markError) console.warn('Pushed mark failed:', markError.message);
    };
    // App chat pushes always write the inbox (the app never turns it off).
    if ((create_in_app !== false || chatPush) && !silent) {
      const chatId = requestChat.chatId;

      const notifications = targetUserIds.map(userId => ({
        user_id: userId,
        type: chatPush ? typeFor(userId) : notificationType,
        title: titleFor(userId),
        body: pushBody,
        data: {
          ...pushDataFor(userId),
          subtitle: effectiveSubtitle,
          tag: effectiveTag,
          chat_id: chatId,
          // This function pushes these itself: the DB push trigger must skip them.
          skip_push: true,
        },
        read: false,
        band_id: pushDataFor(userId)?.band_id || null,
        action_url: chatId ? `/chat/${chatId}` : null,
      }));

      if (chatPush && announced) {
        // Per recipient, in the database (194): only for a message still
        // there and not deleted, ON CONFLICT DO NOTHING (an overlapping call
        // no longer rolls back the others), and returns who to push now.
        let { data: claimed, error: writeError } = await supabase
          .rpc('bw_write_chat_notices', { p_message_id: announced.id, p_rows: notifications });
        // A deadlock with an overlapping call rolled this one back: retry.
        for (let attempt = 0; attempt < 2 && writeError?.code === '40P01'; attempt++) {
          ({ data: claimed, error: writeError } = await supabase
            .rpc('bw_write_chat_notices', { p_message_id: announced.id, p_rows: notifications }));
        }
        if (writeError && writeError.code === 'PGRST202') {
          // send-push deployed before 194: write as before.
          console.warn('bw_write_chat_notices missing (apply 194):', writeError.message);
          const { error: plainError } = await supabase.from('notifications').insert(notifications);
          if (plainError) throw plainError;
        } else {
          if (writeError) throw writeError;
          const rows = (claimed || []) as { id: string; user_id: string }[];
          claimedIds = rows.map((r) => String(r.id));
          const toPush = new Set(rows.map((r) => String(r.user_id)));
          ringIds = targetUserIds.filter((id) => toPush.has(id));
        }
      } else {
        const { error: writeError } = await supabase.from('notifications').insert(notifications);
        if (writeError) console.warn('In-app notification insert failed:', writeError.message);
      }
    }
    if (ringIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'Nothing to ring' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: tokens, error: tokenError } = await supabase
      .from('push_tokens')
      .select('*')
      // Devices ring only for people who left push on (02 #6); the in-app
      // notification above is kept either way. Silent refreshes aren't alerts.
      .in('user_id', silent ? ringIds : pushAllowed(ringIds, peopleRows))
      .eq('is_active', true);

    if (tokenError) throw tokenError;

    if (!tokens || tokens.length === 0) {
      await markPushed();
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No active tokens found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Per recipient: the icon badge is their own unread count (a band message
    // used to set everyone's to 1), and the subtitle label is in their language.
    const tokenUserIds: string[] = [...new Set(tokens.map((tk: any) => String(tk.user_id)))];
    const badgeByUser = new Map<string, number>();
    if (badge === undefined && !silent) {
      await Promise.all(tokenUserIds.map(async (uid) => {
        const { count, error } = await supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', uid)
          .eq('read', false);
        if (!error) badgeByUser.set(uid, Math.max(1, count ?? 1));
      }));
    }
    const langByUser = new Map<string, ReturnType<typeof pushLanguage>>();
    if (effectiveSubtitle && !silent) {
      tokenUserIds.forEach((uid) => langByUser.set(uid, pushLanguage(prefLangByUser.get(uid) ?? null)));
    }
    const collapseId = pushCollapseId(notificationType, data);

    const results = await Promise.allSettled(
      tokens.map(async (tokenRecord: any) => {
        const platform = tokenRecord.platform;
        const deviceToken = tokenRecord.token;
        const uid = String(tokenRecord.user_id);
        const userBadge = badge ?? badgeByUser.get(uid);
        const userSubtitle = localizePushLabel(effectiveSubtitle, langByUser.get(uid) ?? null);

        if (platform === 'ios') {
          const result = await sendToAPNs(deviceToken, titleFor(uid), userSubtitle, pushBody, pushDataFor(uid), userBadge, sound, collapseId, silent);
          if (!result.success && result.error === 'invalid_token') {
            await supabase.from('push_tokens').update({ is_active: false }).eq('id', tokenRecord.id);
          }
          return { token_id: tokenRecord.id, platform, ...result };
        } else if (platform === 'android') {
          const result = await sendToFCM(deviceToken, titleFor(uid), userSubtitle, pushBody, pushDataFor(uid), effectiveChannel, effectiveTag, collapseId, silent);
          if (!result.success && result.error === 'invalid_token') {
            await supabase.from('push_tokens').update({ is_active: false }).eq('id', tokenRecord.id);
          }
          return { token_id: tokenRecord.id, platform, ...result };
        }
        return { token_id: tokenRecord.id, platform, success: false, error: 'Unknown platform' };
      })
    );

    await markPushed();
    const successful = results.filter((r: any) => r.status === 'fulfilled' && r.value.success).length;

    // A chat push that Apple or Google accepted reached the recipient's phone:
    // the sender sees ✓✓ even while the recipient's app sleeps in the
    // background (migration 122). Recipients with no device reached stay ✓.
    const pushChatId = requestChat.chatId;
    if (pushChatId && (notificationType === 'chat_message' || notificationType === 'chat_mention')) {
      const reached = [...new Set(
        results
          .map((r: any, i: number) => (r.status === 'fulfilled' && r.value.success ? String(tokens[i].user_id) : null))
          .filter((id: string | null): id is string => !!id),
      )];
      if (reached.length > 0) {
        const { error: deliveredError } = await supabase.rpc('bw_mark_chat_delivered_by_push', {
          p_chat_id: String(pushChatId),
          p_user_ids: reached,
        });
        if (deliveredError) console.warn('Delivered mark failed:', deliveredError.message);
      }
    }
    return new Response(
      JSON.stringify({ 
        success: true, 
        sent: successful, 
        results: results.map((r: any) => r.status === 'fulfilled' ? r.value : { error: 'promise_rejected' })
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: error.status }
      );
    }
    console.error('send-push error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
