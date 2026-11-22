/**
 * Push Notifications Service - iOS APNs + Android FCM
 * Based on the working implementation from BandOps Mobile App
 */

import { supabase } from '../supabase';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { getActiveChat } from './activeChatTracker';
import { getLocale } from '@/lib/i18n';
import { localizePushLabel, pushLanguage } from '@/lib/pushLabels';
import { LIVE_PACK_REFRESH_EVENT } from '@/lib/livePack';
import {
  beginPushSave,
  confirmPushSave,
  flushPushRevocations,
  forgetRevocation,
  newRevokeSecret,
  rememberPushToken,
  rememberedPushToken,
  revokeOnSignOut,
} from '@/lib/pushRevocation';

const revokeStore = (): Storage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

// Cache the token to avoid re-registration issues
let cachedToken: string | null = null;
// The account this device's pushes belong to, and the token last saved for it.
let pushUserId: string | null = null;
let savedToken: string | null = null;
let savedAt = 0;
let tokenWatch = false;
/**
 * Bumped by every sign-out: a registration answer or a save started for the
 * session before is stale and saves nothing (Claude review #287 round 4).
 */
let pushSession = 0;
/**
 * Saves, the sign-out revocation and the flush run one at a time: a save
 * never interleaves with a revocation of the same token, and two saves of
 * one token answer in order (Codex/Claude review #287 rounds 3-4).
 */
let pushLock: Promise<unknown> = Promise.resolve();
const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = pushLock.then(fn, fn);
  pushLock = run.catch(() => undefined);
  return run;
};

/**
 * The longest a sign-out waits for the push work ahead of it (a save whose
 * request never answers, a long flush): then the local sign-out goes on and
 * the revocation waits in the queue (Claude review #287 round 5).
 */
export const SIGN_OUT_PUSH_WAIT_MS = 5000;

/**
 * Android builds from #287 round 5 on (BwPushIdentityPlugin): the device
 * keeps the signed-in account natively and shows a push only when it is for
 * that account, so a late push for an account that signed out offline shows
 * nothing, whatever the network did. The account is cleared before anything
 * else at sign-out, and the FCM token deletion is awaited.
 */
interface PushIdentityPlugin {
  setUser(options: { uid: string }): Promise<void>;
  clear(): Promise<void>;
  deleteToken(): Promise<void>;
}
const pushIdentity = registerPlugin<PushIdentityPlugin>('BwPushIdentity');
const checksAccountNatively = (): boolean =>
  Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('BwPushIdentity');

/** The account this device shows pushes for; true when the native side has it. */
const markNativePushUser = async (userId: string): Promise<boolean> => {
  if (!checksAccountNatively()) return false;
  try {
    await pushIdentity.setUser({ uid: userId });
    return true;
  } catch {
    return false;
  }
};

const clearNativePushUser = async (): Promise<void> => {
  if (!checksAccountNatively()) return;
  try {
    await pushIdentity.clear();
  } catch {
    /* never block sign-out */
  }
};

/**
 * The session ended without a sign-out here (refresh refused, account
 * deleted, an app start with no session): from now on the device shows no
 * push for the account that was signed in (Codex review #287 round 6). Saves
 * started for it save nothing.
 */
export const forgetPushAccount = async (): Promise<void> => {
  pushUserId = null;
  savedToken = null;
  pushSession += 1;
  if (!isNative()) return;
  await clearNativePushUser();
};

/** Resolves with the work, or at the deadline with nothing while the work goes on. */
const untilDeadline = (work: Promise<unknown>, deadline: number): Promise<void> =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });

/** Stops delivery on the device: on the new Android builds, waits for FCM to delete the token. */
const stopDevicePush = async (): Promise<void> => {
  cachedToken = null;
  if (checksAccountNatively()) {
    try {
      await pushIdentity.deleteToken();
      return;
    } catch {
      /* the plugin's unregister below */
    }
  }
  await PushNotifications.unregister();
};

/**
 * Android hands out a new FCM token now and then (and after an update or a
 * data wipe): save every token it reports, not only the first one, or
 * pushes go to a dead token and the device goes quiet.
 */
const watchTokenChanges = () => {
  if (tokenWatch) return;
  tokenWatch = true;
  PushNotifications.addListener('registration', (token) => {
    cachedToken = token.value;
    if (pushUserId && token.value !== savedToken) void saveTokenToDatabase(pushUserId, token.value, pushSession);
  }).catch(() => {
    tokenWatch = false;
  });
};

/** How long ago this device's token was last confirmed to the server. */
export const pushTokenAge = (): number => (savedToken ? Date.now() - savedAt : Infinity);

// Types
export interface PushNotificationToken {
  value: string;
}

export interface PushNotificationData {
  title?: string;
  body?: string;
  data?: Record<string, any>;
}

export interface PushNotificationListeners {
  onRegistration?: (token: PushNotificationToken) => void;
  onRegistrationError?: (error: any) => void;
  onPushReceived?: (notification: PushNotificationData) => void;
  onPushActionPerformed?: (notification: { notification: PushNotificationData; actionId: string }) => void;
}

// Check if we're running in native app
export const isNative = (): boolean => {
  return Capacitor.isNativePlatform();
};

// Check if push notifications are supported
export const isPushSupported = (): boolean => {
  return isNative();
};

// Check current permission status
export const checkPushPermissions = async (): Promise<'granted' | 'denied' | 'prompt' | 'unavailable'> => {
  if (!isNative()) {
    return 'unavailable';
  }
  
  try {
    const result = await PushNotifications.checkPermissions();
    console.log('[Push] Permission check result:', result.receive);
    return result.receive as 'granted' | 'denied' | 'prompt';
  } catch (error) {
    console.error('[Push] Permission check error:', error);
    return 'unavailable';
  }
};

// Subscribe to push notifications
/**
 * iOS uses APNs directly. Android goes through Firebase Cloud Messaging and
 * is enabled only for builds made with VITE_ANDROID_PUSH=true (i.e. when
 * android/app/google-services.json is present).
 */
export const isRemotePushConfigured = (): boolean => {
  if (Capacitor.getPlatform() !== 'android') return true;
  return import.meta.env.VITE_ANDROID_PUSH === 'true';
};

export const subscribeToPush = async (userId: string): Promise<{ success: boolean; error: Error | null }> => {
  if (!userId) {
    return { success: false, error: new Error('User ID required') };
  }

  if (!isNative()) {
    console.log('[Push] Not on native platform');
    return { success: false, error: new Error('Not on native platform') };
  }

  if (!isRemotePushConfigured()) {
    // Android remote push needs Firebase (google-services.json). Without it
    // PushNotifications.register() crashes natively, so skip it; local
    // notifications keep working.
    console.log('[Push] Remote push not configured on this platform');
    return { success: false, error: new Error('Push not configured') };
  }

  pushUserId = userId;
  const session = pushSession;
  await markNativePushUser(userId);

  try {
    console.log('[Push] Starting subscription for user:', userId);
    
    // Request permission
    const permResult = await PushNotifications.requestPermissions();
    console.log('[Push] Permission result:', permResult);
    
    if (permResult.receive !== 'granted') {
      return { success: false, error: new Error('Permission denied') };
    }

    watchTokenChanges();

    // If we already have a cached token, just save it
    if (cachedToken) {
      return await saveTokenToDatabase(userId, cachedToken, session);
    }

    // Wait for the token - set up listeners BEFORE calling register
    return new Promise((resolve) => {
      let resolved = false;
      let regHandle: any = null;
      let errHandle: any = null;

      const cleanup = () => {
        if (regHandle) {
          regHandle.remove().catch(() => {});
          regHandle = null;
        }
        if (errHandle) {
          errHandle.remove().catch(() => {});
          errHandle = null;
        }
      };

      const timeout = setTimeout(async () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        console.log('[Push] Registration timeout - checking DB');
        const exists = await checkExistingSubscription(userId);
        if (exists) {
          resolve({ success: true, error: null });
        } else {
          resolve({ success: false, error: new Error('Registration timeout') });
        }
      }, 10000);

      const registrationHandler = async (token: { value: string }) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        // Signed out meanwhile (the sign-out's own register() answers here
        // too): saving now would switch the token back on for that account.
        if (session !== pushSession) {
          resolve({ success: false, error: new Error('Signed out') });
          return;
        }
        cachedToken = token.value;

        const result = await saveTokenToDatabase(userId, token.value, session);
        resolve(result);
      };

      const errorHandler = (error: { error: string }) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        console.error('[Push] Registration error:', error);
        resolve({ success: false, error: new Error(error.error) });
      };

      // Add listeners FIRST without wiping existing notification listeners
      (async () => {
        try {
          regHandle = await PushNotifications.addListener('registration', registrationHandler);
          errHandle = await PushNotifications.addListener('registrationError', errorHandler);
          await PushNotifications.register();
          console.log('[Push] Registered with APNs/FCM');
        } catch (err: any) {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          console.error('[Push] Register call failed:', err);
          resolve({ success: false, error: err instanceof Error ? err : new Error(String(err)) });
        }
      })();
    });
  } catch (err: any) {
    console.error('[Push] Subscribe error:', err);
    return { success: false, error: err };
  }
};

// Save the device token for the signed-in user. The RPC (migration 046) moves
// the token to this account if another account used this device before;
// the plain upsert is the fallback until the migration is applied.
/**
 * After a save the server confirmed: the token is this account's current
 * registration, so no revocation waiting for it can apply any more (Codex
 * review #287 round 4: only now, never at sign-in). The token, its stamp and
 * the secret the server holds are remembered for the next sign-out. The
 * stamp comes back with the save (184); only an older database needs the
 * separate read, and it stores no secret.
 */
const afterSave = async (userId: string, token: string, stamp: string | null, secret: string | null) => {
  savedToken = token;
  savedAt = Date.now();
  forgetRevocation(revokeStore(), token);
  let registeredAt: string | null = stamp;
  if (!registeredAt) {
    try {
      const { data } = await supabase
        .from('push_tokens')
        .select('updated_at')
        .eq('token', token)
        .eq('user_id', userId)
        .maybeSingle();
      registeredAt = typeof data?.updated_at === 'string' ? data.updated_at : null;
    } catch {
      registeredAt = null;
    }
  }
  confirmPushSave(revokeStore(), token, userId, secret, registeredAt);
};

/** The database has no such function yet (migration 184 not applied). */
const isMissingFunction = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? ''));

const saveTokenToDatabase = (userId: string, token: string, session = pushSession): Promise<{ success: boolean; error: Error | null }> =>
  exclusive(async () => {
    // Signed out (or someone else signed in) since this save was asked for.
    if (session !== pushSession || pushUserId !== userId) return { success: false, error: new Error('Signed out') };
    const platform = Capacitor.getPlatform();
    // The secret is kept before it goes out: if the answer is lost, the
    // server may hold it (Codex review #287 round 4).
    const secret = newRevokeSecret();
    beginPushSave(revokeStore(), token, userId, secret);
    // Marked only when the native side holds this account: otherwise a
    // data-only push would find no account and show nothing.
    const uidGated = await markNativePushUser(userId);

    try {
      // 184: the same save as bw_register_push_token (046, which older builds
      // keep calling unchanged), with the revocation secret and the row's
      // stamp in one round trip.
      const { data, error: stampedError } = await supabase.rpc('bw_register_push_token_stamped', {
        p_token: token,
        p_platform: platform,
        p_secret: secret,
        p_uid_gated: uidGated,
      });
      // Answered after a sign-out that stopped waiting for it: the queued
      // revocation already holds this secret, and nothing here may forget it.
      if (session !== pushSession) return { success: false, error: new Error('Signed out') };
      if (!stampedError) {
        const reply = (data ?? {}) as { registered_at?: unknown; secret?: unknown };
        const at = typeof reply.registered_at === 'string' ? reply.registered_at : null;
        await afterSave(userId, token, at, typeof reply.secret === 'string' && reply.secret ? reply.secret : secret);
        return { success: true, error: null };
      }
      // Only a database without 184 falls back to the older saves, never a
      // server error or a timeout (Codex review #287 round 5).
      if (!isMissingFunction(stampedError)) {
        console.warn('[Push] Stamped token save failed:', stampedError.message);
        return { success: false, error: new Error(stampedError.message) };
      }

      const { error: rpcError } = await supabase.rpc('bw_register_push_token', { p_token: token, p_platform: platform });
      if (session !== pushSession) return { success: false, error: new Error('Signed out') };
      if (!rpcError) {
        await afterSave(userId, token, null, null);
        return { success: true, error: null };
      }
      if (!isMissingFunction(rpcError)) {
        console.warn('[Push] Token save failed:', rpcError.message);
        return { success: false, error: new Error(rpcError.message) };
      }

      const { error } = await supabase
        .from('push_tokens')
        .upsert(
          {
            user_id: userId,
            token,
            platform,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'token' }
        );

      if (error) {
        console.error('[Push] Token save failed:', error.message);
        return { success: false, error: new Error(error.message) };
      }
      await afterSave(userId, token, null, null);
      return { success: true, error: null };
    } catch (err: any) {
      console.error('[Push] Save error:', err);
      return { success: false, error: err };
    }
  });

/**
 * Stop pushes to this device for the account that is signing out. Call it
 * BEFORE the session ends (the RPC needs the user's JWT).
 */
export const unregisterPushToken = async (userId?: string | null): Promise<void> => {
  const owner = userId ?? pushUserId ?? '';
  pushUserId = null;
  savedToken = null;
  pushSession += 1;
  if (!isNative()) return;
  // Sign-out waits for push work SIGN_OUT_PUSH_WAIT_MS at most, native calls
  // included: past that they go on in the background (Codex review #287 r6).
  const deadline = Date.now() + SIGN_OUT_PUSH_WAIT_MS;
  // First, before any network: from now on this device shows no push for
  // that account (Codex review #287 round 5).
  await untilDeadline(clearNativePushUser(), deadline);
  // After an offline cold start the native token may not be back yet: the
  // one last saved for this account is (Codex review #287).
  const remembered = rememberedPushToken(revokeStore(), owner);
  const known = cachedToken ?? remembered?.token ?? null;
  rememberPushToken(revokeStore(), null);
  // Android built without Firebase never registered, and the plugin's
  // unregister() would crash on an uninitialised Firebase (Codex review
  // #287 round 3): nothing to stop on this device.
  if (!isRemotePushConfigured()) return;
  // No token known (the first start after an upgrade, offline, before the
  // native callback): the plugin still has it (Codex review #287 round 3).
  const token = known ?? (await tokenFromPlugin());
  if (!token) {
    // Not even the plugin: delivery stops on the device itself.
    try {
      await untilDeadline(stopDevicePush(), deadline);
    } catch {
      /* best effort: never block sign-out */
    }
    return;
  }
  const saved = remembered?.token === token ? remembered : null;
  const store = owner ? revokeStore() : null;
  // Delivery stops on the phone itself in every case (audit 04 #6; Codex
  // review #287 round 6: also when the server says the token was not this
  // account's); the next sign-in registers again.
  const unregisterDevice = () => untilDeadline(stopDevicePush(), deadline);
  // After a save already on its way: it can't switch the token back on later.
  let gaveUp = false;
  let serverTookIt = false;
  const job = exclusive(async () => {
    if (gaveUp) return 'queued' as const;
    return revokeOnSignOut(token, owner, saved, {
      store,
      revokeOnServer: async () => {
        // 184: true only when it switched this account's token off; false
        // when the token is (still) another account's.
        const { data: switchedOff, error } = await supabase.rpc('bw_unregister_push_token', { p_token: token });
        if (!error && typeof switchedOff === 'boolean') return (serverTookIt = switchedOff);
        // A database without 184 answers nothing ("no error" for 0 rows too):
        // only a row actually updated counts (Claude review #287).
        const { data, error: updateError } = await supabase
          .from('push_tokens')
          .update({ is_active: false })
          .eq('token', token)
          .select('id');
        return (serverTookIt = !updateError && Array.isArray(data) && data.length > 0);
      },
      unregisterDevice,
    });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), Math.max(0, deadline - Date.now()));
  });
  let outcome = await Promise.race([job, late]);
  clearTimeout(timer);
  if (outcome === 'late') {
    // The push work ahead never finished: queue it here and stop the device.
    // If that work does reach the server later, the queue still holds what
    // it needs (Claude review #287 round 5).
    gaveUp = true;
    // Only the device's own deletion is still running: the server took it.
    outcome = serverTookIt ? 'server' : await revokeOnSignOut(token, owner, saved, { store, revokeOnServer: async () => false, unregisterDevice });
  }
  if (outcome === 'queued') console.warn('[Push] Server not reached: device unregistered, revocation queued');
};

/**
 * The device's token from the plugin, when nothing remembers it: register()
 * answers with the token the system already holds (also offline, as a
 * rule). Waits a moment at most; null when it doesn't come.
 */
const tokenFromPlugin = async (waitMs = 2500): Promise<string | null> => {
  try {
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') return null;
  } catch {
    return null;
  }
  let handle: { remove: () => Promise<void> } | null = null;
  try {
    return await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), waitMs);
      void PushNotifications.addListener('registration', (t) => {
        clearTimeout(timer);
        resolve(typeof t?.value === 'string' && t.value ? t.value : null);
      })
        .then((h) => {
          handle = h;
          return PushNotifications.register();
        })
        .catch(() => {
          clearTimeout(timer);
          resolve(null);
        });
    });
  } finally {
    await (handle as { remove: () => Promise<void> } | null)?.remove().catch(() => undefined);
  }
};

/** The flush on its way, if any: a token save waits for it. */
let flushing: Promise<number> | null = null;

/**
 * Revocations queued by an offline sign-out (audit 04 #6), sent once online.
 * Works signed out: migration 184 takes the token, its account and the
 * registration's secret.
 */
export const flushQueuedPushRevocations = async (): Promise<number> => {
  if (!isNative()) return 0;
  if (flushing) return flushing;
  const session = pushSession;
  const run = exclusive(() =>
    flushPushRevocations(revokeStore(), {
      revoke: async (p, secret) =>
        supabase.rpc('bw_revoke_push_token', { p_token: p.token, p_user_id: p.userId, p_registered_at: p.registeredAt, p_secret: secret }),
      // A sign-out waiting behind the flush: stop between entries.
      alive: () => session === pushSession,
    }),
  );
  flushing = run;
  try {
    return await run;
  } finally {
    if (flushing === run) flushing = null;
  }
};

/**
 * Opens this app's notification settings on the phone, for someone who said
 * no to notifications (the system asks only once). iOS: the app's page in
 * Settings; Android: its notification settings (NotificationSettingsPlugin).
 */
export const openNotificationSettings = async (): Promise<void> => {
  if (!isNative()) return;
  if (Capacitor.getPlatform() === 'ios') {
    window.location.href = 'app-settings:';
    return;
  }
  const plugin = registerPlugin<{ open: () => Promise<void> }>('BwNotificationSettings');
  await plugin.open();
};

// Check if subscription exists
const checkExistingSubscription = async (userId: string): Promise<boolean> => {
  try {
    const { data } = await supabase
      .from('push_tokens')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .single();
    return !!data;
  } catch {
    return false;
  }
};

// Setup native listeners for receiving notifications
export const setupNativePushListeners = (
  onNotification: (n: PushNotificationData) => void,
  onAction: (a: { notification: PushNotificationData; actionId: string }) => void
): (() => void) => {
  if (!isNative()) return () => {};

  // Request local notification permissions (for foreground display)
  LocalNotifications.requestPermissions().catch(() => {});

  const handles: Array<{ remove: () => Promise<void> }> = [];

  // Listen for push notifications received while app is in foreground
  PushNotifications.addListener('pushNotificationReceived', async (received) => {
    // A data-only push (Android builds that check the account natively, 184)
    // carries its title and body in data.
    const notification = {
      ...received,
      title: received.title || (received.data?.bw_title as string | undefined) || undefined,
      body: received.body || (received.data?.bw_body as string | undefined) || undefined,
    };
    // Silent live pack refresh (170): download the changed setlist, show nothing.
    if (notification.data?.type === 'live_pack_refresh') {
      window.dispatchEvent(new CustomEvent(LIVE_PACK_REFRESH_EVENT, { detail: { eventId: String(notification.data?.event_id || '') } }));
      return;
    }

    // Check if this is a chat notification for the currently open chat
    const notificationChatId = notification.data?.chatId || notification.data?.chat_id;
    const activeChat = getActiveChat();
    
    if (notificationChatId && activeChat === notificationChatId) {
      console.log('[Push] Skipping notification - user is already viewing this chat');
      return;
    }

    // Suppress local notification for event invites - the in-app RSVP sheet handles these
    if (notification.data?.type === 'event_invite') {
      console.log('[Push] Skipping local notification for event_invite - RSVP sheet handles it');
      onNotification({ title: notification.title, body: notification.body, data: notification.data });
      return;
    }
    
    // In the foreground the OS does not draw the banner itself
    // (capacitor.config presentationOptions has no "alert"), so this listener is
    // the only place that decides: the open chat is skipped above, everything
    // else gets a local notification on both iOS and Android.
    try {
      // Use a smaller ID that fits in Java int (max ~2 billion)
      const notificationId = Math.floor(Math.random() * 2147483647);
      
      const channelId = (notification.data?.channel_id as string) || 'bandwith_messages';
      // The payload keeps the English label; the banner shows it in the app language.
      const summaryText = localizePushLabel((notification.data?.subtitle as string) || undefined, pushLanguage(getLocale())) || undefined;

      await LocalNotifications.schedule({
        notifications: [{
          id: notificationId,
          title: notification.title || 'BandWith',
          body: notification.body || '',
          largeBody: notification.body,
          summaryText: summaryText,
          sound: 'default',
          channelId: channelId,
          smallIcon: 'ic_stat_notification',
          iconColor: '#050505',
          extra: notification.data,
        }],
      });
      console.log('[Push] Local notification shown with id:', notificationId);
    } catch (e) {
      console.warn('[Push] Failed to show local notification:', e);
    }
    
    // Also notify the callback
    onNotification({
      title: notification.title,
      body: notification.body,
      data: notification.data,
    });
  }).then(h => handles.push(h));
  
  // Listen for push notification actions (when user taps the notification)
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    onAction({
      notification: {
        title: action.notification.title,
        body: action.notification.body,
        data: action.notification.data,
      },
      actionId: action.actionId,
    });
  }).then(h => handles.push(h));

  // Also listen for local notification actions
  LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    onAction({
      notification: {
        title: action.notification.title,
        body: action.notification.body,
        data: action.notification.extra,
      },
      actionId: action.actionId,
    });
  }).then(h => handles.push(h));
  
  // Return cleanup function removing only this instance's listeners
  return () => {
    handles.forEach(h => {
      try {
        h.remove().catch(() => {});
      } catch (_) {}
    });
  };
};

// Create notification channel for Android
export const createNotificationChannel = async (
  id: string,
  name: string,
  description: string,
  importance: number = 4
): Promise<void> => {
  if (Capacitor.getPlatform() !== 'android') {
    return;
  }

  try {
    await PushNotifications.createChannel({
      id,
      name,
      description,
      importance: importance as any,
      visibility: 1,
      lights: true,
      vibration: true,
    });
    console.log('[Push] Channel created:', id);
  } catch (error) {
    console.error('[Push] Error creating channel:', error);
  }
};

// Remove listeners
export const removePushListeners = async (): Promise<void> => {
  if (!isNative()) return;
  
  tokenWatch = false;
  try {
    await PushNotifications.removeAllListeners();
  } catch (error) {
    console.error('[Push] Error removing listeners:', error);
  }
};

// Legacy exports for compatibility
export const initializePushNotifications = async (
  listeners: PushNotificationListeners
): Promise<boolean> => {
  console.log('[Push] initializePushNotifications called');
  // This is now handled by subscribeToPush
  // Just setup the notification listeners
  if (listeners.onPushReceived || listeners.onPushActionPerformed) {
    setupNativePushListeners(
      listeners.onPushReceived || (() => {}),
      listeners.onPushActionPerformed || (() => {})
    );
  }
  return true;
};

export const savePushToken = async (
  token: string,
  userId: string
): Promise<{ error: Error | null }> => {
  const result = await saveTokenToDatabase(userId, token);
  return { error: result.error };
};

export default {
  isNative,
  isPushSupported,
  checkPushPermissions,
  subscribeToPush,
  setupNativePushListeners,
  createNotificationChannel,
  removePushListeners,
};
