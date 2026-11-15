package com.bandwith.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins (not npm packages) are registered before the bridge starts.
        registerPlugin(StageBlePlugin.class);
        registerPlugin(IrealForumPlugin.class);
        registerPlugin(KeepAwakePlugin.class);
        registerPlugin(PrivacyPlugin.class);
        registerPlugin(NotificationSettingsPlugin.class);
        super.onCreate(savedInstanceState);
        PrivacyPlugin.apply(this);
    }

    @Override
    public void onPause() {
        PrivacyPlugin.paused(this, true);
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        PrivacyPlugin.paused(this, false);
    }
}
