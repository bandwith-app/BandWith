package com.bandwith.app;

import android.app.Activity;
import android.content.Context;
import android.os.Build;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Privacy cover: with the app lock on, Recents shows no picture of the last
 * screen (fees, totals), so nothing is seen before the fingerprint on the next
 * launch. Android 13+: setRecentsScreenshotEnabled(false), screenshots still
 * work; older versions: FLAG_SECURE while the app is paused (MainActivity).
 * The page calls BwPrivacy.set({ on }) with the app lock setting
 * (src/lib/appLock.ts); on by default, like the lock.
 */
@CapacitorPlugin(name = "BwPrivacy")
public class PrivacyPlugin extends Plugin {
    private static final String PREFS = "bw_privacy";
    private static final String KEY = "cover";

    static boolean enabled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, true);
    }

    static void apply(Activity activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.setRecentsScreenshotEnabled(!enabled(activity));
        }
    }

    /** Before Android 13: hide the window from Recents while paused. */
    static void paused(Activity activity, boolean paused) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return;
        if (paused && enabled(activity)) {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply();
        activity.runOnUiThread(() -> {
            apply(activity);
            call.resolve();
        });
    }
}
