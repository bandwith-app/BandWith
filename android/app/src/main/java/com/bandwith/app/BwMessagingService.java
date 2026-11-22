package com.bandwith.app;

import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Replaces the push plugin's FirebaseMessagingService (AndroidManifest).
 * A push tagged with an account (bw_uid, send-push for tokens marked
 * uid_gated, migration 184) is shown only when that account is the one
 * signed in on this device (PushIdentity): after an offline sign-out the
 * server may still push for the old account, and nothing of it appears.
 * Untagged pushes go through the plugin exactly as before.
 *
 * Tagged pushes are data-only, so the app draws them itself in the
 * background, the way the system draws a notification message; tapping one
 * opens the app with the same extras, so the plugin reports the tap
 * (pushNotificationActionPerformed) as for any push. In the foreground the
 * plugin forwards it to the app, which shows it as before.
 */
public class BwMessagingService extends MessagingService {
    private static final String DEFAULT_CHANNEL = "bandwith_general";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String target = data.get("bw_uid");
        switch (PushIdentity.decide(target, PushIdentity.current(this))) {
            case LEGACY:
                super.onMessageReceived(message);
                return;
            case DROP:
                return;
            case SHOW:
            default:
                break;
        }
        if ("1".equals(data.get("silent")) || inForeground()) {
            super.onMessageReceived(message);
            return;
        }
        show(message, data);
    }

    private boolean inForeground() {
        ActivityManager.RunningAppProcessInfo info = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(info);
        return info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
    }

    private String channelFor(NotificationManager manager, String wanted) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return wanted != null ? wanted : DEFAULT_CHANNEL;
        if (wanted != null && manager.getNotificationChannel(wanted) != null) return wanted;
        if (manager.getNotificationChannel(DEFAULT_CHANNEL) == null) {
            manager.createNotificationChannel(
                new NotificationChannel(DEFAULT_CHANNEL, "BandWith", NotificationManager.IMPORTANCE_HIGH)
            );
        }
        return DEFAULT_CHANNEL;
    }

    private void show(RemoteMessage message, Map<String, String> data) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        String title = data.get("bw_title");
        String body = data.get("bw_body");
        if (title == null || title.isEmpty()) title = "BandWith";
        if (body == null) body = "";

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open == null) open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        for (Map.Entry<String, String> e : data.entrySet()) open.putExtra(e.getKey(), e.getValue());
        String messageId = message.getMessageId() != null ? message.getMessageId() : String.valueOf(System.currentTimeMillis());
        // The plugin reports a tap for an intent carrying google.message_id.
        open.putExtra("google.message_id", messageId);
        PendingIntent tap = PendingIntent.getActivity(
            this,
            messageId.hashCode(),
            open,
            PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelFor(manager, data.get("channel_id")))
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setColor(0xFF050505)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_SOUND)
            .setContentIntent(tap);

        // Same collapse rule as the notification message: only a push with
        // the same tag replaces a shown one.
        String collapse = data.get("bw_tag");
        String tag = collapse != null && !collapse.isEmpty() ? collapse : "bw:" + messageId;
        try {
            manager.notify(tag, 0, builder.build());
        } catch (SecurityException ignored) {
            // Notifications not allowed (Android 13+ permission): nothing to show.
        }
    }
}
