import { navigateToNotificationTarget, notificationBandId, notificationTarget } from '@/lib/notificationRouting';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import {
  checkPushPermissions,
  subscribeToPush,
  setupNativePushListeners,
  removePushListeners,
  createNotificationChannel,
  isNative,
  pushTokenAge,
  type PushNotificationData,
} from '@/lib/services/pushNotifications';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { markAsRead } from '@/lib/services/notifications';
import { t } from '@/lib/i18n';

interface UsePushNotificationsReturn {
  isSupported: boolean;
  permissionStatus: 'granted' | 'denied' | 'prompt' | 'unavailable' | 'loading';
  lastNotification: PushNotificationData | null;
  initialize: () => Promise<boolean>;
}

export const usePushNotifications = (): UsePushNotificationsReturn => {
  const { user } = useAuth();
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt' | 'unavailable' | 'loading'>('loading');
  const [lastNotification, setLastNotification] = useState<PushNotificationData | null>(null);
  const initializingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  
  const isSupported = isNative();

  const initialize = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      console.log('[usePush] Not on native platform');
      setPermissionStatus('unavailable');
      return false;
    }

    if (!user?.id) {
      console.log('[usePush] No user ID');
      return false;
    }

    if (initializingRef.current) {
      console.log('[usePush] Already initializing');
      return false;
    }

    initializingRef.current = true;
    console.log('[usePush] Starting initialization for user:', user.id);

    try {
      // Create notification channels for Android
      if (Capacitor.getPlatform() === 'android') {
        await createNotificationChannel(
          'bandwith_general',
          t('General Notifications'),
          t('General app notifications'),
          4
        );
        await createNotificationChannel(
          'bandwith_messages',
          t('Messages'),
          t('Chat messages and direct messages'),
          5
        );
        await createNotificationChannel(
          'bandwith_events',
          t('Event Notifications'),
          t('Notifications about events and gigs'),
          5
        );
        await createNotificationChannel(
          'bandwith_finance',
          t('Finance & Payments'),
          t('Notifications about quotes and payments'),
          4
        );
      }

      // Setup listeners for receiving notifications immediately so cold-start tap actions aren't missed
      if (!cleanupRef.current) {
        cleanupRef.current = setupNativePushListeners(
          (notification) => {
            setLastNotification(notification);
          },
          (action) => {
            handleNotificationAction(action);
          }
        );
      }

      // Subscribe to push notifications
      const result = await subscribeToPush(user.id);
      console.log('[usePush] Subscribe result:', result);
      
      if (result.success) {
        setPermissionStatus('granted');
        return true;
      } else {
        console.log('[usePush] Subscribe failed:', result.error?.message);
        setPermissionStatus('denied');
        return false;
      }
    } catch (error) {
      console.error('[usePush] Initialize error:', error);
      setPermissionStatus('unavailable');
      return false;
    } finally {
      initializingRef.current = false;
    }
  }, [isSupported, user?.id]);

  // Defer permission check to avoid native bridge calls during cold start
  useEffect(() => {
    if (!isSupported) {
      setPermissionStatus('unavailable');
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const status = await checkPushPermissions();
        setPermissionStatus(status);
      } catch (error) {
        console.warn('[usePush] Permission check failed:', error);
        setPermissionStatus('unavailable');
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [isSupported]);

  // Back in the foreground: confirm this device's token again. The server may
  // have switched a token off, Android may have handed out a new one, or
  // notifications were just turned on in the phone's settings; before, the
  // token was only sent once per app start.
  useEffect(() => {
    if (!isSupported || !user?.id) return;
    let alive = true;
    let handle: PluginListenerHandle | null = null;
    App.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive) return;
      const status = await checkPushPermissions();
      if (!alive) return;
      setPermissionStatus(status);
      if (status === 'granted' && pushTokenAge() > 10 * 60 * 1000) void initialize();
    })
      .then((h) => {
        if (alive) handle = h;
        else void h.remove();
      })
      .catch(() => {});
    return () => {
      alive = false;
      void handle?.remove();
    };
  }, [isSupported, user?.id, initialize]);

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  // Handle notification action (when user taps on notification)
  const handleNotificationAction = (action: { notification: PushNotificationData; actionId: string }) => {
    const { notification } = action;
    const data = notification.data;


    if (!data) {
      console.log('[usePush] No data in notification, navigating to home');
      window.dispatchEvent(new CustomEvent('push-navigate', { 
        detail: { screen: 'home' } 
      }));
      return;
    }

    // Opened from the banner: it is read (bell and icon badge follow).
    if (data.notification_id) void markAsRead(String(data.notification_id));

    // Same routing as tapping the notification in the in-app inbox.
    navigateToNotificationTarget(notificationTarget(String(data.type || ''), data), notificationBandId({ data }));
  };

  return {
    isSupported,
    permissionStatus,
    lastNotification,
    initialize,
  };
};

export default usePushNotifications;
