package com.bandwith.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens this app's notification settings, so someone who said no to
 * notifications can turn them back on (Android asks only once or twice).
 * The page calls BwNotificationSettings.open() from Settings > Notifications
 * (src/lib/services/pushNotifications.ts).
 */
@CapacitorPlugin(name = "BwNotificationSettings")
public class NotificationSettingsPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", activity.getPackageName(), null));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open settings", e);
        }
    }
}
