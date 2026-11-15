// Supabase Edge Function: Send Push Notification (Zero External Dependencies)
import { adminClient, chatRecipients, HttpError, requireCaller } from '../_shared/auth.ts';
import { localizePushLabel, pushCollapseId, pushLanguage, pushThreadId } from '../_shared/push-labels.ts';

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
  collapseId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    let jwt = await generateAPNsJWT();
    const alert: Record<string, string> = { title, body };
    if (subtitle) {
      alert.subtitle = subtitle;
    }
    const threadId = pushThreadId(data);

    const apnsPayload = {
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
      ...data,
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
          ...(collapseId ? { 'apns-collapse-id': collapseId } : {}),
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
  collapseId?: string
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
        body: JSON.stringify({
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

    if (!title || !notificationBody) throw new HttpError(400, 'Missing title or body');
    if (String(title).length > 200 || String(notificationBody).length > 2000) {
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
    const targetUserIds = caller.kind === 'service'
      ? requestedIds
      : await chatRecipients(supabase, caller.id, data?.chat_id || data?.chatId, requestedIds);
    if (targetUserIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No permitted recipients' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const effectiveSubtitle = subtitle || data?.subtitle;
    const effectiveTag = tag || data?.tag;
    const notificationType = userType || data?.type || 'chat_message';
    const effectiveChannel = channel_id || data?.channel_id || (
      notificationType.includes('chat') ? 'bandwith_messages' :
      notificationType.includes('quote') || notificationType.includes('payment') ? 'bandwith_finance' :
      notificationType.includes('event') || notificationType.includes('member_dropped_out') ? 'bandwith_events' :
      'bandwith_general'
    );

    if (create_in_app !== false) {
      const chatId = data?.chat_id || data?.chatId;
      
      const notifications = targetUserIds.map(userId => ({
        user_id: userId,
        type: notificationType,
        title: title,
        body: notificationBody,
        data: {
          ...data,
          subtitle: effectiveSubtitle,
          tag: effectiveTag,
          chat_id: chatId,
          // This function pushes these itself: the DB push trigger must skip them.
          skip_push: true,
        },
        read: false,
        band_id: data?.band_id || null,
        action_url: chatId ? `/chat/${chatId}` : null,
      }));

      await supabase.from('notifications').insert(notifications);
    }

    const { data: tokens, error: tokenError } = await supabase
      .from('push_tokens')
      .select('*')
      .in('user_id', targetUserIds)
      .eq('is_active', true);

    if (tokenError) throw tokenError;

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No active tokens found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Per recipient: the icon badge is their own unread count (a band message
    // used to set everyone's to 1), and the subtitle label is in their language.
    const tokenUserIds: string[] = [...new Set(tokens.map((tk: any) => String(tk.user_id)))];
    const badgeByUser = new Map<string, number>();
    if (badge === undefined) {
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
    if (effectiveSubtitle) {
      const { data: prefs } = await supabase
        .from('profiles')
        .select('id, preferred_language')
        .in('id', tokenUserIds);
      (prefs || []).forEach((p: any) => langByUser.set(String(p.id), pushLanguage(p.preferred_language)));
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
          const result = await sendToAPNs(deviceToken, title, userSubtitle, notificationBody, data, userBadge, sound, collapseId);
          if (!result.success && result.error === 'invalid_token') {
            await supabase.from('push_tokens').update({ is_active: false }).eq('id', tokenRecord.id);
          }
          return { token_id: tokenRecord.id, platform, ...result };
        } else if (platform === 'android') {
          const result = await sendToFCM(deviceToken, title, userSubtitle, notificationBody, data, effectiveChannel, effectiveTag, collapseId);
          if (!result.success && result.error === 'invalid_token') {
            await supabase.from('push_tokens').update({ is_active: false }).eq('id', tokenRecord.id);
          }
          return { token_id: tokenRecord.id, platform, ...result };
        }
        return { token_id: tokenRecord.id, platform, success: false, error: 'Unknown platform' };
      })
    );

    const successful = results.filter((r: any) => r.status === 'fulfilled' && r.value.success).length;

    // A chat push that Apple or Google accepted reached the recipient's phone:
    // the sender sees ✓✓ even while the recipient's app sleeps in the
    // background (migration 122). Recipients with no device reached stay ✓.
    const pushChatId = data?.chat_id || data?.chatId;
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
