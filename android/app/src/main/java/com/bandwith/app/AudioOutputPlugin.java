package com.bandwith.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Stage manager mode (the Regia): where the device's audio comes out. The
 * Android twin of ios/App/App/AudioOutputPlugin.swift (same JS contract,
 * src/lib/audioOutput.ts). Many tablets have no headphone jack: the Regia
 * reaches the mixer through USB-C, and if the cable comes out the sound
 * moves to the speaker; the Regia's bar shows the output so that is seen.
 * setPlayback is a no-op here (Android has no silent switch for media).
 */
@CapacitorPlugin(name = "BwAudioOutput")
public class AudioOutputPlugin extends Plugin {

    private AudioDeviceCallback callback;

    @Override
    public void load() {
        AudioManager am = manager();
        if (am == null) return;
        callback = new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
                notifyListeners("change", route());
            }

            @Override
            public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
                notifyListeners("change", route());
            }
        };
        am.registerAudioDeviceCallback(callback, new Handler(Looper.getMainLooper()));
    }

    @Override
    protected void handleOnDestroy() {
        AudioManager am = manager();
        if (am != null && callback != null) am.unregisterAudioDeviceCallback(callback);
    }

    @PluginMethod
    public void current(PluginCall call) {
        call.resolve(route());
    }

    @PluginMethod
    public void setPlayback(PluginCall call) {
        call.resolve(route());
    }

    private AudioManager manager() {
        Context ctx = getContext();
        return ctx == null ? null : (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
    }

    /** The device media plays through now (Android 13+ says so; before, the highest-priority output present). */
    private JSObject route() {
        JSObject out = new JSObject();
        AudioManager am = manager();
        AudioDeviceInfo best = null;
        if (am != null) {
            if (Build.VERSION.SDK_INT >= 33) {
                AudioAttributes media = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build();
                List<AudioDeviceInfo> devices = am.getAudioDevicesForAttributes(media);
                if (!devices.isEmpty()) best = devices.get(0);
            }
            if (best == null) {
                int bestRank = Integer.MAX_VALUE;
                for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                    int r = rank(kind(d.getType()));
                    if (r < bestRank) {
                        bestRank = r;
                        best = d;
                    }
                }
            }
        }
        out.put("kind", best == null ? "other" : kind(best.getType()));
        out.put("name", best == null || best.getProductName() == null ? "" : best.getProductName().toString());
        return out;
    }

    private static int rank(String kind) {
        switch (kind) {
            case "usb": return 0;
            case "wired": return 1;
            case "hdmi": return 2;
            case "bluetooth": return 3;
            case "speaker": return 4;
            default: return 5;
        }
    }

    private static String kind(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_USB_DEVICE:
            case AudioDeviceInfo.TYPE_USB_HEADSET:
            case AudioDeviceInfo.TYPE_USB_ACCESSORY:
                return "usb";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_LINE_ANALOG:
            case AudioDeviceInfo.TYPE_LINE_DIGITAL:
            case AudioDeviceInfo.TYPE_AUX_LINE:
                return "wired";
            case AudioDeviceInfo.TYPE_HDMI:
            case AudioDeviceInfo.TYPE_HDMI_ARC:
                return "hdmi";
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
            case AudioDeviceInfo.TYPE_BLE_SPEAKER:
                return "bluetooth";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE:
                return "speaker";
            default:
                return "other";
        }
    }
}
