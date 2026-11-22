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
import { flushPushRevocations, forgetRevocation, forgetRevocationsOf, rememberPushToken, rememberedPushToken, revokeOnSignOut } from '@/lib/pushRevocation';

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
 * Android hands out a new FCM token now and then (and after an update or a
 * data wipe): save every token it reports, not only the first one, or
 * pushes go to a dead token and the device goes quiet.
 */
const watchTokenChanges = () => {
  if (tokenWatch) return;
  tokenWatch = true;
  PushNotifications.addListener('registration', (token) => {
    cachedToken = token.value;
    if (pushUserId && token.value !== savedToken) void saveTokenToDatabase(pushUserId, token.value);
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
      return await saveTokenToDatabase(userId, cachedToken);
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
        cachedToken = token.value;
        
        const result = await saveTokenToDatabase(userId, token.value);
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
 * After a save: no revocation is waiting for this token any more, and the
 * token and its server stamp are remembered for the next sign-out (audit
 * 04 #6, Codex review #287). The stamp is the row's updated_at, so the
 * offline revocation matches exactly this registration. It comes back with
 * the save itself (184, bw_register_push_token_stamped); only an older
 * database needs the separate read, which a dropped connection can lose.
 */
const afterSave = async (userId: string, token: string, stamp: string | null = null) => {
  savedToken = token;
  savedAt = Date.now();
  // Saved for this account now: no other account's revocation for it either.
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
  rememberPushToken(revokeStore(), { token, userId, registeredAt });
};

/** The database has no such function yet (migration 184 not applied). */
const isMissingFunction = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? ''));

const saveTokenToDatabase = async (userId: string, token: string): Promise<{ success: boolean; error: Error | null }> => {
  const platform = Capacitor.getPlatform();
  // This account's own waiting revocation for this token goes before the
  // save, and a flush already on its way finishes first: a revocation
  // without a stamp must never land after the new registration (Codex
  // review #287 round 3).
  forgetRevocation(revokeStore(), token, userId);
  await flushing?.catch(() => undefined);

  try {
    // 184: the same save as bw_register_push_token (046, which older builds
    // keep calling unchanged), returning the row's stamp in one round trip.
    const { data: stamp, error: stampedError } = await supabase.rpc('bw_register_push_token_stamped', { p_token: token, p_platform: platform });
    if (!stampedError) {
      await afterSave(userId, token, typeof stamp === 'string' ? stamp : null);
      return { success: true, error: null };
    }
    if (!isMissingFunction(stampedError)) {
      console.warn('[Push] Stamped token save failed:', stampedError.message);
    }

    const { error: rpcError } = await supabase.rpc('bw_register_push_token', { p_token: token, p_platform: platform });
    if (!rpcError) {
      await afterSave(userId, token);
      return { success: true, error: null };
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
    await afterSave(userId, token);
    return { success: true, error: null };
  } catch (err: any) {
    console.error('[Push] Save error:', err);
    return { success: false, error: err };
  }
};

/**
 * Stop pushes to this device for the account that is signing out. Call it
 * BEFORE the session ends (the RPC needs the user's JWT).
 */
export const unregisterPushToken = async (userId?: string | null): Promise<void> => {
  const owner = userId ?? pushUserId ?? '';
  pushUserId = null;
  savedToken = null;
  if (!isNative()) return;
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
    cachedToken = null;
    try {
      await PushNotifications.unregister();
    } catch {
      /* best effort: never block sign-out */
    }
    return;
  }
  const registeredAt = remembered?.token === token ? remembered.registeredAt : null;
  const outcome = await revokeOnSignOut(token, owner, registeredAt, {
    store: owner ? revokeStore() : null,
    revokeOnServer: async () => {
      const { error } = await supabase.rpc('bw_unregister_push_token', { p_token: token });
      if (!error) return true;
      // "No error" for 0 rows (RLS, a row that moved) switched nothing off:
      // only a row actually updated counts (Claude review #287).
      const { data, error: updateError } = await supabase
        .from('push_tokens')
        .update({ is_active: false })
        .eq('token', token)
        .select('id');
      return !updateError && Array.isArray(data) && data.length > 0;
    },
    // Offline (audit 04 #6): stop delivery on the phone itself; the next
    // sign-in registers again.
    unregisterDevice: async () => {
      cachedToken = null;
      await PushNotifications.unregister();
    },
  });
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

/**
 * Someone signed in on this device: their own waiting revocations are
 * dropped at once, before any token save (iOS keeps the same token, and a
 * save may fail offline; Claude review #287 round 3).
 */
export const forgetQueuedPushRevocationsFor = (userId: string): void => {
  forgetRevocationsOf(revokeStore(), userId);
};

/** The flush on its way, if any: a token save waits for it. */
let flushing: Promise<number> | null = null;

/**
 * Revocations queued by an offline sign-out (audit 04 #6), sent once online.
 * Works signed out: migration 184 needs only the token and its account.
 */
export const flushQueuedPushRevocations = async (): Promise<number> => {
  if (!isNative()) return 0;
  if (flushing) return flushing;
  const run = flushPushRevocations(revokeStore(), async (p) =>
    supabase.rpc('bw_revoke_push_token', { p_token: p.token, p_user_id: p.userId, p_registered_at: p.registeredAt }),
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
  PushNotifications.addListener('pushNotificationReceived', async (notification) => {
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
