package com.bandwith.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * In-app updates for the tester APKs published on GitHub releases
 * (scripts/release-android.sh). The page (src/lib/androidUpdate.ts) calls:
 *
 * - download({ url, version, size }): saves the APK in app-private storage
 *   (cache/updates/BandWith-<version>.apk), sending "downloadProgress"
 *   events, and checks it is a newer BandWith signed like this one;
 * - canInstall() / openInstallSettings(): Android 8+ asks once per app
 *   before it may install other APKs ("Allow from this source");
 * - install({ version }): checks the file again and opens the system
 *   installer on it through the FileProvider.
 *
 * Errors carry a code (DOWNLOAD_FAILED, SIZE_MISMATCH, BAD_APK,
 * WRONG_PACKAGE, NOT_NEWER, SIGNATURE_MISMATCH, NOT_ALLOWED, NOT_FOUND,
 * BUSY, INSTALLER_FAILED) so the page can say what went wrong or fall back
 * to the browser download. Files left over from an earlier update are
 * deleted when the app starts.
 */
@CapacitorPlugin(name = "BwApkUpdate")
public class ApkUpdatePlugin extends Plugin {
    private static final String DIR = "updates";
    private static final String APK_MIME = "application/vnd.android.package-archive";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);

    private static final class ApkError extends Exception {
        final String code;

        ApkError(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    @Override
    public void load() {
        worker.execute(this::cleanUp);
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject res = new JSObject();
        res.put("allowed", canInstallPackages());
        call.resolve(res);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity", "INSTALLER_FAILED");
            return;
        }
        Intent intent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))
            : new Intent(Settings.ACTION_SECURITY_SETTINGS);
        try {
            activity.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the setting", "INSTALLER_FAILED", e);
        }
    }

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url", "");
        final String version = call.getString("version", "");
        final long expected = Math.max(0L, call.getData().optLong("size", 0L)); // getLong misses small (Integer) numbers
        if (!url.startsWith("https://") || !safeVersion(version)) {
            call.reject("Bad download request", "DOWNLOAD_FAILED");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("A download is already running", "BUSY");
            return;
        }
        // Not on the plugin thread: a download of ~20 MB would hold up every other plugin call.
        worker.execute(() -> {
            try {
                File apk = fetch(url, version, expected);
                call.resolve(describe(verify(apk), apk));
            } catch (ApkError e) {
                call.reject(e.getMessage(), e.code);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()), "DOWNLOAD_FAILED", e);
            } finally {
                busy.set(false);
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        final String version = call.getString("version", "");
        final Activity activity = getActivity();
        if (activity == null || !safeVersion(version)) {
            call.reject("Bad install request", "INSTALLER_FAILED");
            return;
        }
        if (!canInstallPackages()) {
            call.reject("BandWith may not install apps yet", "NOT_ALLOWED");
            return;
        }
        File apk = apkFile(version);
        if (!apk.isFile()) {
            call.reject("No downloaded update", "NOT_FOUND");
            return;
        }
        try {
            verify(apk);
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, APK_MIME)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(intent);
            call.resolve();
        } catch (ApkError e) {
            call.reject(e.getMessage(), e.code);
        } catch (Exception e) {
            call.reject("Could not open the installer", "INSTALLER_FAILED", e);
        }
    }

    private boolean canInstallPackages() {
        // Before Android 8 the installer itself asks about unknown sources.
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private static boolean safeVersion(String version) {
        return version != null && version.matches("\\d+(\\.\\d+){0,3}");
    }

    private File updatesDir() {
        File dir = new File(getContext().getCacheDir(), DIR);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    private File apkFile(String version) {
        return new File(updatesDir(), "BandWith-" + version + ".apk");
    }

    private File fetch(String url, String version, long expected) throws Exception {
        File target = apkFile(version);
        // Already downloaded (the user went to Settings and came back, or the
        // system closed the app meanwhile): no second download.
        if (target.isFile() && (expected <= 0 || target.length() == expected)) {
            try {
                verify(target);
                progress(version, target.length(), target.length());
                return target;
            } catch (ApkError e) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
            }
        }
        File[] old = updatesDir().listFiles();
        if (old != null) {
            for (File f : old) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }

        File part = new File(updatesDir(), target.getName() + ".part");
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(true); // GitHub answers with a redirect to its file host
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty("Accept", "application/octet-stream");
        long written = 0;
        try {
            int status = conn.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new ApkError("DOWNLOAD_FAILED", "HTTP " + status);
            long total = conn.getContentLengthLong();
            if (total <= 0) total = expected;
            if (expected > 0 && total != expected) {
                throw new ApkError("SIZE_MISMATCH", "Server size " + total + ", release says " + expected);
            }
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                int lastPercent = -1;
                long lastSent = 0;
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    written += n;
                    long now = System.currentTimeMillis();
                    int percent = total > 0 ? (int) (written * 100 / total) : -1;
                    if (percent != lastPercent && (total > 0 || now - lastSent > 500)) {
                        lastPercent = percent;
                        lastSent = now;
                        progress(version, written, total);
                    }
                }
            }
            if (total > 0 && written != total) {
                throw new ApkError("SIZE_MISMATCH", "Got " + written + " of " + total + " bytes");
            }
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            throw e;
        } finally {
            conn.disconnect();
        }
        if (!part.renameTo(target)) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            throw new ApkError("DOWNLOAD_FAILED", "Could not save the update");
        }
        try {
            verify(target);
        } catch (ApkError e) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw e;
        }
        return target;
    }

    private void progress(String version, long bytes, long total) {
        JSObject data = new JSObject();
        data.put("version", version);
        data.put("bytes", bytes);
        data.put("total", total);
        data.put("percent", total > 0 ? (int) Math.min(100, bytes * 100 / total) : -1);
        notifyListeners("downloadProgress", data);
    }

    /** The APK is BandWith, newer than this install and signed with the same key. */
    @SuppressWarnings("deprecation")
    private PackageInfo verify(File apk) throws ApkError {
        Context ctx = getContext();
        PackageManager pm = ctx.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo archive = pm.getPackageArchiveInfo(apk.getPath(), flags);
        if (archive == null) throw new ApkError("BAD_APK", "Not a readable APK");
        if (!ctx.getPackageName().equals(archive.packageName)) {
            throw new ApkError("WRONG_PACKAGE", "APK is " + archive.packageName);
        }
        PackageInfo installed;
        try {
            installed = pm.getPackageInfo(ctx.getPackageName(), flags);
        } catch (PackageManager.NameNotFoundException e) {
            throw new ApkError("BAD_APK", "Installed app not found");
        }
        long newCode = PackageInfoCompat.getLongVersionCode(archive);
        long oldCode = PackageInfoCompat.getLongVersionCode(installed);
        if (newCode <= oldCode) {
            throw new ApkError("NOT_NEWER", "APK code " + newCode + ", installed " + oldCode);
        }
        Set<String> newKeys = signers(archive);
        Set<String> oldKeys = signers(installed);
        // Unknown signers: leave the decision to the installer.
        if (!newKeys.isEmpty() && !oldKeys.isEmpty()) {
            newKeys.retainAll(oldKeys);
            if (newKeys.isEmpty()) {
                throw new ApkError("SIGNATURE_MISMATCH", "Signed with a different key than this install");
            }
        }
        return archive;
    }

    @SuppressWarnings("deprecation")
    private static Set<String> signers(PackageInfo info) {
        Set<String> out = new HashSet<>();
        Signature[] sigs = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            sigs = info.signingInfo.hasMultipleSigners()
                ? info.signingInfo.getApkContentsSigners()
                : info.signingInfo.getSigningCertificateHistory();
        } else if (info.signatures != null) {
            sigs = info.signatures;
        }
        if (sigs != null) {
            for (Signature s : sigs) out.add(s.toCharsString());
        }
        return out;
    }

    private static JSObject describe(PackageInfo info, File apk) {
        JSObject res = new JSObject();
        res.put("versionName", info.versionName);
        res.put("versionCode", PackageInfoCompat.getLongVersionCode(info));
        res.put("bytes", apk.length());
        return res;
    }

    /** Deletes half downloads and updates that are installed by now (or no longer usable). */
    private void cleanUp() {
        if (busy.get()) return;
        File[] files = updatesDir().listFiles();
        if (files == null) return;
        for (File f : files) {
            boolean keep = false;
            if (f.getName().endsWith(".apk")) {
                try {
                    verify(f);
                    keep = true;
                } catch (ApkError ignored) {
                    // installed already, or never usable
                }
            }
            if (!keep) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }
}
