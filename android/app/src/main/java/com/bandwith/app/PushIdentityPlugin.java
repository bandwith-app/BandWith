package com.bandwith.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * BwPushIdentity (src/lib/services/pushNotifications.ts): keeps the
 * signed-in account natively for BwMessagingService, and deletes the FCM
 * token waiting for Firebase to finish (the push plugin's unregister()
 * returns before the deletion is done).
 */
@CapacitorPlugin(name = "BwPushIdentity")
public class PushIdentityPlugin extends Plugin {
    @PluginMethod
    public void setUser(PluginCall call) {
        String uid = call.getString("uid");
        if (uid == null || uid.isEmpty()) {
            call.reject("uid required");
            return;
        }
        if (PushIdentity.set(getContext(), uid)) call.resolve();
        else call.reject("Could not store the account");
    }

    @PluginMethod
    public void clear(PluginCall call) {
        if (PushIdentity.clear(getContext())) call.resolve();
        else call.reject("Could not clear the account");
    }

    @PluginMethod
    public void deleteToken(PluginCall call) {
        // A build without google-services.json has no Firebase: nothing to delete.
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.resolve();
            return;
        }
        try {
            FirebaseMessaging messaging = FirebaseMessaging.getInstance();
            messaging.setAutoInitEnabled(false);
            messaging.deleteToken().addOnCompleteListener(task -> {
                if (task.isSuccessful()) call.resolve();
                else call.reject("Token not deleted", task.getException());
            });
        } catch (Exception e) {
            call.reject("Token not deleted", e);
        }
    }
}
