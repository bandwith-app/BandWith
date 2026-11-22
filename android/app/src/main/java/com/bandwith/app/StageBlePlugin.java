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

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Arrays;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * Stage mode over Bluetooth, leader side (see ios/App/App/StageBlePlugin.swift
 * for the same plugin on iOS and src/lib/stageBle.ts for the bytes): the band
 * admin's phone advertises the gig's service and serves one characteristic,
 * read = full state (by offset), notify = short value (subscribers then read).
 * No encryption, so members connect without pairing.
 *
 * A second characteristic, "sync" (read + write + notify, only when
 * `syncUuid` and `key` are given), carries the leader's clock for members
 * with no internet (src/lib/stageBleSync.ts, frame version 3): a member
 * writes a 4-byte ping and this phone answers that member at once with an
 * 18-byte signed pong holding its clock when the ping arrived. Apps from
 * before it never look at it. JS also gets `updateSync({ value, notify })`,
 * `now()` (this plugin's clock, ms) and `setClock({ offset })` (the app's
 * clock minus this plugin's, so pongs carry the app's clock).
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

    // Sync characteristic (clock, frame version 3).
    private BluetoothGattCharacteristic syncCharacteristic;
    private UUID syncUuid;
    private volatile byte[] key = new byte[0];
    private volatile byte[] syncValue = new byte[0];
    private final Set<BluetoothDevice> syncSubscribers = new CopyOnWriteArraySet<>();
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
            String sync = call.getString("syncUuid");
            String k = call.getString("key");
            UUID newSync = sync != null && k != null ? UUID.fromString(sync) : null;
            byte[] newKey = k != null ? Base64.decode(k, Base64.NO_WRAP) : new byte[0];
            boolean syncChanged = newSync != null && newKey.length > 0 && !newSync.equals(syncUuid);
            if (!newService.equals(serviceUuid) || syncChanged) teardown();
            serviceUuid = newService;
            if (newSync != null && newKey.length > 0) {
                syncUuid = newSync;
                key = newKey;
            }
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
                if (syncUuid != null && key.length > 0) {
                    syncCharacteristic = new BluetoothGattCharacteristic(
                        syncUuid,
                        BluetoothGattCharacteristic.PROPERTY_READ | BluetoothGattCharacteristic.PROPERTY_WRITE
                            | BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                        BluetoothGattCharacteristic.PERMISSION_READ | BluetoothGattCharacteristic.PERMISSION_WRITE
                    );
                    syncCharacteristic.addDescriptor(new BluetoothGattDescriptor(
                        CCCD, BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
                    svc.addCharacteristic(syncCharacteristic);
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
        syncUuid = null;
        key = new byte[0];
        syncValue = new byte[0];
        call.resolve();
    }

    /** Sync characteristic: the value reads get, and a notice for its subscribers (empty: none). */
    @PluginMethod
    public void updateSync(PluginCall call) {
        String v = call.getString("value");
        String n = call.getString("notify");
        if (v == null || n == null) {
            call.reject("value and notify are required");
            return;
        }
        syncValue = Base64.decode(v, Base64.NO_WRAP);
        byte[] notice = Base64.decode(n, Base64.NO_WRAP);
        if (notice.length > 0) {
            for (BluetoothDevice device : syncSubscribers) sendSync(device, notice);
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

    /**
     * Pong for ping `nonce`, stamped `t1` (the app's clock, ms): see stageBleSync.ts.
     * Test vector: nonce 0x1234, t1 1795000000123.4, the test key → 0302123410534f5fb0d2879d96279f5e7feb.
     */
    static byte[] pong(int nonce, double t1, byte[] key) {
        long ticks = Math.round(t1 * 10);
        byte[] out = new byte[18];
        out[0] = 3;
        out[1] = 2;
        out[2] = (byte) ((nonce >> 8) & 0xff);
        out[3] = (byte) (nonce & 0xff);
        for (int i = 0; i < 6; i++) out[4 + i] = (byte) ((ticks >> (8 * (5 - i))) & 0xff);
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            mac.update(out, 0, 10);
            System.arraycopy(mac.doFinal(), 0, out, 10, 8);
        } catch (Exception e) {
            return null;
        }
        return out;
    }

    @SuppressLint("MissingPermission")
    private void sendSync(BluetoothDevice device, byte[] data) {
        BluetoothGattServer s = server;
        BluetoothGattCharacteristic c = syncCharacteristic;
        if (s == null || c == null || data == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                s.notifyCharacteristicChanged(device, c, false, data);
            } else {
                c.setValue(data);
                s.notifyCharacteristicChanged(device, c, false);
            }
        } catch (Exception ignored) {
            syncSubscribers.remove(device);
        }
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
        syncCharacteristic = null;
        subscribers.clear();
        syncSubscribers.clear();
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
            data.put("subscribers", subscribers.size());
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
                syncSubscribers.remove(device);
                setState(state);
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset, BluetoothGattCharacteristic c) {
            BluetoothGattServer s = server;
            if (s == null) return;
            boolean isSync = syncUuid != null && syncUuid.equals(c.getUuid());
            byte[] v = isSync ? syncValue : value;
            if (!isSync && (characteristicUuid == null || !characteristicUuid.equals(c.getUuid()))) {
                s.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, offset, null);
            } else if (offset > v.length) {
                s.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null);
            } else {
                s.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, Arrays.copyOfRange(v, offset, v.length));
            }
        }

        /** A member's ping: answered at once, to that member only, with this phone's clock. */
        @SuppressLint("MissingPermission")
        @Override
        public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId, BluetoothGattCharacteristic c,
                                                 boolean preparedWrite, boolean responseNeeded, int offset, byte[] v) {
            // Stamped first, before any other work.
            double t1 = clockMs() + clockOffset;
            BluetoothGattServer s = server;
            if (s == null) return;
            boolean isSync = syncUuid != null && syncUuid.equals(c.getUuid());
            if (responseNeeded) {
                s.sendResponse(device, requestId, isSync ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_WRITE_NOT_PERMITTED, 0, null);
            }
            if (!isSync || preparedWrite || offset != 0 || v == null || v.length != 4 || v[0] != 3 || v[1] != 1) return;
            byte[] k = key;
            if (k.length == 0) return;
            sendSync(device, pong(((v[2] & 0xff) << 8) | (v[3] & 0xff), t1, k));
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onDescriptorReadRequest(BluetoothDevice device, int requestId, int offset, BluetoothGattDescriptor descriptor) {
            BluetoothGattServer s = server;
            if (s == null) return;
            boolean isSync = syncUuid != null && descriptor.getCharacteristic() != null
                && syncUuid.equals(descriptor.getCharacteristic().getUuid());
            byte[] v = (isSync ? syncSubscribers : subscribers).contains(device)
                ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                : BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE;
            s.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, v);
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onDescriptorWriteRequest(BluetoothDevice device, int requestId, BluetoothGattDescriptor descriptor,
                                             boolean preparedWrite, boolean responseNeeded, int offset, byte[] v) {
            boolean isSync = syncUuid != null && descriptor.getCharacteristic() != null
                && syncUuid.equals(descriptor.getCharacteristic().getUuid());
            if (CCCD.equals(descriptor.getUuid())) {
                Set<BluetoothDevice> set = isSync ? syncSubscribers : subscribers;
                if (v != null && Arrays.equals(v, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
                    set.add(device);
                } else {
                    set.remove(device);
                }
                if (!isSync) setState(state);
            }
            BluetoothGattServer s = server;
            if (responseNeeded && s != null) s.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null);
            if (!isSync && subscribers.contains(device)) sendNotify();
        }
    };
}
