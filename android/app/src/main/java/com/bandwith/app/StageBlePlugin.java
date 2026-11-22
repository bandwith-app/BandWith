package com.bandwith.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * Stage mode over Bluetooth, leader side (see ios/App/App/StageBlePlugin.swift
 * for the same plugin on iOS and src/lib/stageBle.ts for the bytes): the band
 * admin's phone advertises the gig's service and serves one characteristic,
 * read = full state (by offset), notify = short value (subscribers then read).
 * No encryption, so members connect without pairing. That state (version 2,
 * band-key HMAC) is kept for apps from before signed states.
 *
 * More characteristics for members on this app (src/lib/stageBleSync.ts):
 * - signed state (read + notify, `signedUuid`): the same state signed with the
 *   gig's private key, which only admins get (version 4, audit #1);
 * - clock (read only, `clockUuid`): every read is answered at once with this
 *   phone's clock at that moment, signed here with `signKey` (ECDSA P-256,
 *   PKCS#8 base64); both only when `signKey` is given;
 * - live (read + notify, `liveUuid`): the click and the playhead (B3).
 * Reads, not writes: a member's write in flight can crash its app when
 * Bluetooth turns off; reads fail cleanly. Apps from before them never look at
 * them. JS also gets `updateSigned` / `updateLive({ value, notify })`, `now()`
 * (this plugin's clock, ms) and `setClock({ offset })` (the app's clock minus
 * this plugin's, so clock reads carry the app's clock). `stateChange` counts
 * the phones following on either state, once each.
 */
@CapacitorPlugin(
    name = "StageBle",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class StageBlePlugin extends Plugin {

    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private final Handler main = new Handler(Looper.getMainLooper());
    private BluetoothManager manager;
    private BluetoothGattServer server;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothGattCharacteristic characteristic;
    private UUID serviceUuid;
    private UUID characteristicUuid;
    private volatile byte[] value = new byte[0];
    private volatile byte[] notifyValue = new byte[0];
    private final Set<BluetoothDevice> subscribers = new CopyOnWriteArraySet<>();

    // Clock and live characteristics (frame version 3), signed state (version 4).
    private BluetoothGattCharacteristic liveCharacteristic;
    private BluetoothGattCharacteristic signedCharacteristic;
    private UUID clockUuid;
    private UUID liveUuid;
    private UUID signedUuid;
    private volatile PrivateKey signKey;
    /** Each phone's last clock answer, for a read continued at an offset (a small MTU). */
    private final Map<String, byte[]> lastClock = new ConcurrentHashMap<>();
    private volatile byte[] signedValue = new byte[0];
    private volatile byte[] signedNotifyValue = new byte[0];
    private final Set<BluetoothDevice> signedSubscribers = new CopyOnWriteArraySet<>();
    private volatile byte[] liveValue = new byte[0];
    private volatile byte[] liveNotifyValue = new byte[0];
    private final Set<BluetoothDevice> liveSubscribers = new CopyOnWriteArraySet<>();
    /** The app's clock minus clockMs() (set by the app, see setClock). */
    private volatile double clockOffset = 0;
    private String state = "unknown";
    private boolean adapterWatched = false;

    /**
     * Bluetooth turned on or off while Stage mode is open: start serving then
     * (iOS does the same on poweredOn), and drop the server when it goes off.
     */
    private final BroadcastReceiver adapterReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!BluetoothAdapter.ACTION_STATE_CHANGED.equals(intent.getAction()) || serviceUuid == null) return;
            int s = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
            if (s == BluetoothAdapter.STATE_ON) {
                bringUp();
            } else if (s == BluetoothAdapter.STATE_TURNING_OFF || s == BluetoothAdapter.STATE_OFF) {
                teardown();
                setState("off");
            }
        }
    };

    private void watchAdapter(boolean on) {
        if (on == adapterWatched) return;
        try {
            if (on) {
                ContextCompat.registerReceiver(getContext(), adapterReceiver,
                    new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED);
            } else {
                getContext().unregisterReceiver(adapterReceiver);
            }
            adapterWatched = on;
        } catch (Exception ignored) {
            // Not registered / already gone.
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        String service = call.getString("serviceUuid");
        String chr = call.getString("characteristicUuid");
        String v = call.getString("value");
        String n = call.getString("notify");
        if (service == null || chr == null || v == null || n == null) {
            call.reject("serviceUuid, characteristicUuid, value and notify are required");
            return;
        }
        // Android 12+: advertising and serving need runtime permissions.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "permissionCallback");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
            setState("unauthorized");
            JSObject ret = new JSObject();
            ret.put("state", state);
            call.resolve(ret);
            return;
        }
        doStart(call);
    }

    @SuppressLint("MissingPermission")
    private void doStart(PluginCall call) {
        try {
            UUID newService = UUID.fromString(call.getString("serviceUuid"));
            characteristicUuid = UUID.fromString(call.getString("characteristicUuid"));
            value = Base64.decode(call.getString("value"), Base64.NO_WRAP);
            notifyValue = Base64.decode(call.getString("notify"), Base64.NO_WRAP);
            PrivateKey newKey = privateKey(call.getString("signKey"));
            String clock = call.getString("clockUuid");
            String signed = call.getString("signedUuid");
            String live = call.getString("liveUuid");
            UUID newClock = clock != null && newKey != null ? UUID.fromString(clock) : null;
            UUID newSigned = signed != null && newKey != null ? UUID.fromString(signed) : null;
            UUID newLive = live != null ? UUID.fromString(live) : null;
            boolean extraChanged = !Objects.equals(newClock, clockUuid) || !Objects.equals(newLive, liveUuid)
                || !Objects.equals(newSigned, signedUuid);
            if (!newService.equals(serviceUuid) || extraChanged) teardown();
            serviceUuid = newService;
            clockUuid = newClock;
            signedUuid = newSigned;
            liveUuid = newLive;
            signKey = newKey;
        } catch (IllegalArgumentException e) {
            call.reject("Bad UUID or base64");
            return;
        }
        watchAdapter(true);
        bringUp();
        JSObject ret = new JSObject();
        ret.put("state", state);
        call.resolve(ret);
    }

    /** Opens the GATT server (advertising follows in onServiceAdded) when Bluetooth allows it. */
    @SuppressLint("MissingPermission")
    private void bringUp() {
        manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager != null ? manager.getAdapter() : null;
        if (adapter == null) {
            setState("unsupported");
        } else if (!adapter.isEnabled()) {
            setState("off");
        } else if (!adapter.isMultipleAdvertisementSupported() || adapter.getBluetoothLeAdvertiser() == null) {
            // Some phones can't be a peripheral at all.
            setState("unsupported");
        } else if (server == null) {
            advertiser = adapter.getBluetoothLeAdvertiser();
            server = manager.openGattServer(getContext(), callback);
            if (server == null) {
                setState("unsupported");
            } else {
                characteristic = new BluetoothGattCharacteristic(
                    characteristicUuid,
                    BluetoothGattCharacteristic.PROPERTY_READ | BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                    BluetoothGattCharacteristic.PERMISSION_READ
                );
                characteristic.addDescriptor(new BluetoothGattDescriptor(
                    CCCD, BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
                BluetoothGattService svc = new BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY);
                svc.addCharacteristic(characteristic);
                if (clockUuid != null && signKey != null) {
                    svc.addCharacteristic(new BluetoothGattCharacteristic(
                        clockUuid, BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ));
                }
                if (signedUuid != null && signKey != null) {
                    signedCharacteristic = new BluetoothGattCharacteristic(
                        signedUuid,
                        BluetoothGattCharacteristic.PROPERTY_READ | BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                        BluetoothGattCharacteristic.PERMISSION_READ
                    );
                    signedCharacteristic.addDescriptor(new BluetoothGattDescriptor(
                        CCCD, BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
                    svc.addCharacteristic(signedCharacteristic);
                }
                if (liveUuid != null) {
                    liveCharacteristic = new BluetoothGattCharacteristic(
                        liveUuid,
                        BluetoothGattCharacteristic.PROPERTY_READ | BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                        BluetoothGattCharacteristic.PERMISSION_READ
                    );
                    liveCharacteristic.addDescriptor(new BluetoothGattDescriptor(
                        CCCD, BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
                    svc.addCharacteristic(liveCharacteristic);
                }
                server.addService(svc); // advertising starts in onServiceAdded
                setState("on");
            }
        } else {
            setState("on");
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        String v = call.getString("value");
        String n = call.getString("notify");
        if (v == null || n == null) {
            call.reject("value and notify are required");
            return;
        }
        value = Base64.decode(v, Base64.NO_WRAP);
        notifyValue = Base64.decode(n, Base64.NO_WRAP);
        sendNotify();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        watchAdapter(false);
        teardown();
        serviceUuid = null;
        clockUuid = null;
        liveUuid = null;
        signedUuid = null;
        signKey = null;
        lastClock.clear();
        liveValue = new byte[0];
        liveNotifyValue = new byte[0];
        signedValue = new byte[0];
        signedNotifyValue = new byte[0];
        call.resolve();
    }

    /** Signed state: the value reads get, and a notice for its subscribers (empty: none). */
    @PluginMethod
    public void updateSigned(PluginCall call) {
        String v = call.getString("value");
        String n = call.getString("notify");
        if (v == null || n == null) {
            call.reject("value and notify are required");
            return;
        }
        signedValue = Base64.decode(v, Base64.NO_WRAP);
        signedNotifyValue = Base64.decode(n, Base64.NO_WRAP);
        if (signedNotifyValue.length > 0) {
            for (BluetoothDevice device : signedSubscribers) notifyTo(signedSubscribers, signedCharacteristic, device, signedNotifyValue);
        }
        call.resolve();
    }

    /** Live characteristic: the value reads get, and a notice for its subscribers (empty: none). */
    @PluginMethod
    public void updateLive(PluginCall call) {
        String v = call.getString("value");
        String n = call.getString("notify");
        if (v == null || n == null) {
            call.reject("value and notify are required");
            return;
        }
        liveValue = Base64.decode(v, Base64.NO_WRAP);
        liveNotifyValue = Base64.decode(n, Base64.NO_WRAP);
        if (liveNotifyValue.length > 0) {
            for (BluetoothDevice device : liveSubscribers) sendLive(device, liveNotifyValue);
        }
        call.resolve();
    }

    @PluginMethod
    public void now(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("now", clockMs());
        call.resolve(ret);
    }

    @PluginMethod
    public void setClock(PluginCall call) {
        Double offset = call.getDouble("offset");
        if (offset == null || offset.isNaN() || offset.isInfinite()) {
            call.reject("offset is required");
            return;
        }
        clockOffset = offset;
        call.resolve();
    }

    /** Monotonic, ms (doesn't jump when the wall clock is set). */
    static double clockMs() {
        return System.nanoTime() / 1_000_000.0;
    }

    /** The gig's private key (PKCS#8 base64, as WebCrypto exports it), or null. */
    static PrivateKey privateKey(String pkcs8) {
        if (pkcs8 == null || pkcs8.isEmpty()) return null;
        try {
            return KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(Base64.decode(pkcs8, Base64.NO_WRAP)));
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Clock answer stamped `t1` (the app's clock, ms), 72 bytes: see stageBleSync.ts.
     * ECDSA signatures differ every time: stageBleSync.test.ts checks a frame made here.
     */
    static byte[] clockFrame(double t1, PrivateKey key) {
        long ticks = Math.round(t1 * 10);
        byte[] out = new byte[72];
        out[0] = 3;
        out[1] = 2;
        for (int i = 0; i < 6; i++) out[2 + i] = (byte) ((ticks >> (8 * (5 - i))) & 0xff);
        try {
            Signature sig = Signature.getInstance("SHA256withECDSA");
            sig.initSign(key);
            sig.update(out, 0, 8);
            byte[] raw = rawSignature(sig.sign());
            if (raw == null) return null;
            System.arraycopy(raw, 0, out, 8, 64);
        } catch (Exception e) {
            return null;
        }
        return out;
    }

    /** Java's DER signature (SEQUENCE of two INTEGERs) as r‖s, 64 bytes (WebCrypto's form). */
    static byte[] rawSignature(byte[] der) {
        if (der == null || der.length < 8 || der[0] != 0x30) return null;
        int i = (der[1] & 0x80) != 0 ? 2 + (der[1] & 0x7f) : 2;
        byte[] out = new byte[64];
        for (int k = 0; k < 2; k++) {
            if (i + 2 > der.length || der[i] != 0x02) return null;
            int len = der[i + 1] & 0xff;
            i += 2;
            if (i + len > der.length) return null;
            int start = i;
            int n = len;
            while (n > 32 && der[start] == 0) {
                start++;
                n--;
            }
            if (n > 32) return null;
            System.arraycopy(der, start, out, k * 32 + 32 - n, n);
            i += len;
        }
        return out;
    }

    private void sendLive(BluetoothDevice device, byte[] data) {
        notifyTo(liveSubscribers, liveCharacteristic, device, data);
    }

    @SuppressLint("MissingPermission")
    private void notifyTo(Set<BluetoothDevice> set, BluetoothGattCharacteristic c, BluetoothDevice device, byte[] data) {
        BluetoothGattServer s = server;
        if (s == null || c == null || data == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                s.notifyCharacteristicChanged(device, c, false, data);
            } else {
                c.setValue(data);
                s.notifyCharacteristicChanged(device, c, false);
            }
        } catch (Exception ignored) {
            set.remove(device);
        }
    }

    /** Phones following: on the older state, the signed one, or both (counted once). */
    private int followerCount() {
        Set<String> all = new HashSet<>();
        for (BluetoothDevice d : subscribers) all.add(d.getAddress());
        for (BluetoothDevice d : signedSubscribers) all.add(d.getAddress());
        return all.size();
    }

    @Override
    protected void handleOnDestroy() {
        watchAdapter(false);
        teardown();
    }

    @SuppressLint("MissingPermission")
    private void teardown() {
        try {
            if (advertiser != null) advertiser.stopAdvertising(advertiseCallback);
        } catch (Exception ignored) {
            // Bluetooth off or permission revoked.
        }
        try {
            if (server != null) server.close();
        } catch (Exception ignored) {
            // idem
        }
        advertiser = null;
        server = null;
        characteristic = null;
        liveCharacteristic = null;
        signedCharacteristic = null;
        subscribers.clear();
        liveSubscribers.clear();
        signedSubscribers.clear();
        lastClock.clear();
    }

    @SuppressLint("MissingPermission")
    private void sendNotify() {
        BluetoothGattServer s = server;
        BluetoothGattCharacteristic c = characteristic;
        if (s == null || c == null) return;
        for (BluetoothDevice device : subscribers) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    s.notifyCharacteristicChanged(device, c, false, notifyValue);
                } else {
                    c.setValue(notifyValue);
                    s.notifyCharacteristicChanged(device, c, false);
                }
            } catch (Exception ignored) {
                subscribers.remove(device);
            }
        }
    }

    private void setState(String next) {
        state = next;
        main.post(() -> {
            JSObject data = new JSObject();
            data.put("state", state);
            data.put("subscribers", followerCount());
            notifyListeners("stateChange", data);
        });
    }

    private final AdvertiseCallback advertiseCallback = new AdvertiseCallback() {
        @Override
        public void onStartFailure(int errorCode) {
            setState("unsupported");
        }
    };

    private final BluetoothGattServerCallback callback = new BluetoothGattServerCallback() {
        @SuppressLint("MissingPermission")
        @Override
        public void onServiceAdded(int status, BluetoothGattService service) {
            if (status != BluetoothGatt.GATT_SUCCESS || advertiser == null) {
                setState("unsupported");
                return;
            }
            AdvertiseSettings settings = new AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .setConnectable(true)
                .build();
            AdvertiseData data = new AdvertiseData.Builder()
                .setIncludeDeviceName(false)
                .addServiceUuid(new ParcelUuid(serviceUuid))
                .build();
            try {
                advertiser.startAdvertising(settings, data, advertiseCallback);
            } catch (Exception e) {
                setState("unsupported");
            }
        }

        @Override
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                subscribers.remove(device);
                liveSubscribers.remove(device);
                signedSubscribers.remove(device);
                lastClock.remove(device.getAddress());
                setState(state);
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset, BluetoothGattCharacteristic c) {
            // Stamped first, before any other work: the member's round trip brackets this moment.
            double t1 = clockMs() + clockOffset;
            BluetoothGattServer s = server;
            if (s == null) return;
            UUID id = c.getUuid();
            byte[] v;
            if (characteristicUuid != null && characteristicUuid.equals(id)) {
                v = value;
            } else if (clockUuid != null && clockUuid.equals(id) && signKey != null) {
                String who = device.getAddress();
                if (offset == 0) {
                    byte[] frame = clockFrame(t1, signKey);
                    lastClock.put(who, frame != null ? frame : new byte[0]);
                }
                byte[] last = lastClock.get(who);
                v = last != null ? last : new byte[0];
            } else if (signedUuid != null && signedUuid.equals(id)) {
                v = signedValue;
            } else if (liveUuid != null && liveUuid.equals(id)) {
                v = liveValue;
            } else {
                s.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, offset, null);
                return;
            }
            if (offset > v.length) {
                s.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null);
            } else {
                s.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, Arrays.copyOfRange(v, offset, v.length));
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onDescriptorReadRequest(BluetoothDevice device, int requestId, int offset, BluetoothGattDescriptor descriptor) {
            BluetoothGattServer s = server;
            if (s == null) return;
            byte[] v = subscribersOf(descriptor).contains(device)
                ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                : BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE;
            s.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, v);
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onDescriptorWriteRequest(BluetoothDevice device, int requestId, BluetoothGattDescriptor descriptor,
                                             boolean preparedWrite, boolean responseNeeded, int offset, byte[] v) {
            Set<BluetoothDevice> set = subscribersOf(descriptor);
            if (CCCD.equals(descriptor.getUuid())) {
                if (v != null && Arrays.equals(v, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
                    set.add(device);
                } else {
                    set.remove(device);
                }
                if (set != liveSubscribers) setState(state);
            }
            BluetoothGattServer s = server;
            if (responseNeeded && s != null) s.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null);
            if (set == subscribers && subscribers.contains(device)) sendNotify();
            if (set == signedSubscribers && signedSubscribers.contains(device) && signedNotifyValue.length > 0) {
                notifyTo(signedSubscribers, signedCharacteristic, device, signedNotifyValue);
            }
        }
    };

    /** Who subscribed to this descriptor's characteristic. */
    private Set<BluetoothDevice> subscribersOf(BluetoothGattDescriptor descriptor) {
        UUID c = descriptor.getCharacteristic() != null ? descriptor.getCharacteristic().getUuid() : null;
        if (c != null && c.equals(liveUuid)) return liveSubscribers;
        if (c != null && c.equals(signedUuid)) return signedSubscribers;
        return subscribers;
    }
}
