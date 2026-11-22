package com.bandwith.app;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The account this device shows pushes for (migration 184, Codex review #287
 * round 5). Set by the app at sign-in, cleared at sign-out before anything
 * else, written with commit() so it holds even if the app dies right after.
 * BwMessagingService checks every push tagged with an account against it,
 * without the network: a late push for an account that signed out offline
 * shows nothing.
 */
public final class PushIdentity {
    private static final String PREFS = "bw_push_identity";
    private static final String KEY_UID = "uid";

    private PushIdentity() {}

    /** What to do with a push. */
    public enum Decision {
        /** No account tag: an older server or token, handled as before. */
        LEGACY,
        /** Tagged with the account signed in here: show it. */
        SHOW,
        /** Tagged with another account, or nobody is signed in: drop it. */
        DROP
    }

    public static Decision decide(String target, String current) {
        if (target == null) return Decision.LEGACY;
        if (target.isEmpty() || current == null || current.isEmpty()) return Decision.DROP;
        return target.equals(current) ? Decision.SHOW : Decision.DROP;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String current(Context context) {
        return prefs(context).getString(KEY_UID, null);
    }

    public static boolean set(Context context, String uid) {
        return prefs(context).edit().putString(KEY_UID, uid).commit();
    }

    public static boolean clear(Context context) {
        return prefs(context).edit().remove(KEY_UID).commit();
    }
}
