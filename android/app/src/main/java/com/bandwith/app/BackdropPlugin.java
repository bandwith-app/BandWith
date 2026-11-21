package com.bandwith.app;

import android.app.Activity;
import android.graphics.Color;
import android.view.View;
import android.view.ViewParent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The colour behind the web view. On Android 15+ with a System WebView older
 * than 140, Capacitor's SystemBars pads the web view's parent by the status
 * bar and the camera cutout instead of letting the page draw under them; that
 * padding showed the window's white, also over Stage mode's black and with the
 * system bars hidden (full screen). The page tells us the colour at its top
 * (src/lib/androidBackdrop.ts) and the padding takes it.
 */
@CapacitorPlugin(name = "BwBackdrop")
public class BackdropPlugin extends Plugin {

    @PluginMethod
    public void set(PluginCall call) {
        final int color;
        try {
            color = Color.parseColor(call.getString("color", ""));
        } catch (IllegalArgumentException e) {
            call.reject("Not a colour");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null || getBridge() == null || getBridge().getWebView() == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            ViewParent parent = getBridge().getWebView().getParent();
            if (parent instanceof View) ((View) parent).setBackgroundColor(color);
            call.resolve();
        });
    }
}
