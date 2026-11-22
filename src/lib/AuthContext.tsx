import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, getSafeUser, getSessionOfflineSafe, signIn, signUp, signOut, resetPassword, signInWithOAuth, updatePasswordWithToken, RECOVERY_FLAG } from './supabase';
import { callbackProblem, callbackProblemText, callbackUrlError, markLaunchUrlHandled, recoveryRefusedText, wasLaunchUrlHandled } from './authCallback';
import { Capacitor } from '@capacitor/core';
import { cleanupPresence } from './services/presence';
import { clearOfflineCache as clearOfflineCacheOf, getOfflineItem, setOfflineItem, getCacheKey } from './offline/storage';
import { clearStageCache, setStageCacheUser } from './stageBleNative';
import { flushQueuedPushRevocations, forgetPushAccount, subscribeToPush, unregisterPushToken } from './services/pushNotifications';
import { clearRecoveryProof, hasAnyRecoveryProof, hasRecoveryProof, updatePasswordForProvenAccount } from './recoveryProof';
import { syncAppBadge } from './services/appBadge';
import { realName } from '@/lib/personName';

export type SubTier = 'free_member' | 'single_band' | 'multi_band' | 'unlimited';

// PLG: User mode — 'band'/'band_admin'/'member' = collaborative workspace, 'solo' = personal calendar
export type UserMode = 'band' | 'band_admin' | 'member' | 'solo';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: 'admin' | 'member';
  instrument: string | null;
  phone: string | null;
  bio?: string | null;
  location?: string | null;
  timezone?: string | null;
  preferred_language?: string | null;
  notification_preferences?: Record<string, boolean> | null;
  sub_tier?: SubTier | null;
  user_mode?: UserMode | null;
  updated_at?: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  isAuthenticated: boolean;
  userMode: UserMode | null;         // PLG: current user mode
  setUserMode: (mode: UserMode) => Promise<void>;  // PLG: switch mode
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  /**
   * `session` is null when the account still has to confirm its email.
   * `existing`: with email confirmation on, signing up an address that is
   * already registered returns no error, only a user without identities.
   */
  signUp: (
    email: string,
    password: string,
    metadata?: { full_name?: string }
  ) => Promise<{ error: AuthError | null; session: Session | null; existing: boolean }>;
  signInWithGoogle: () => Promise<{ error: AuthError | null }>;
  signInWithApple: () => Promise<{ error: AuthError | null }>;
  /** `discardPendingWrites`: the account is gone (deleted), drop its unsent changes too. */
  signOut: (opts?: { discardPendingWrites?: boolean }) => Promise<{ error: AuthError | null }>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  /** True after the user opened a password-reset link: the app must ask for a new password. */
  isPasswordRecovery: boolean;
  completePasswordRecovery: (newPassword: string) => Promise<{ error: AuthError | null }>;
  dismissPasswordRecovery: () => void;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>;
  /** A sign-in that came back to the app (deep link) and failed, in the app's language. */
  authError: string | null;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/** Like useAuth, but undefined outside an AuthProvider (shared views, tests). */
export const useOptionalAuth = (): AuthContextType | undefined => useContext(AuthContext);

/**
 * A deleted account's own keys left on this device (its refused changes and
 * unsent messages, which sign-out keeps): removed. The fallback when
 * signOutWipe can't load (Claude r8 M2); other accounts' keys stay.
 */
const dropAccountLists = (gone: string | null) => {
  if (!gone) return;
  const end = `:${gone.toLowerCase()}`;
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '');
    for (const k of keys) if (k.startsWith('bw:') && k.toLowerCase().endsWith(end)) localStorage.removeItem(k);
  } catch {
    /* storage blocked */
  }
};

/**
 * Sends the signed-in user's queued offline edits (a few seconds at most) and
 * returns whatever is still queued, to be stored again after sign-out.
 */
const takeUnsyncedQueue = async (
  userId: string | undefined
): Promise<{ key: string; items: unknown[] } | null> => {
  if (!userId) return null;
  try {
    const q = await import('./offline/syncQueue');
    if (typeof navigator === 'undefined' || navigator.onLine) {
      await Promise.race([q.processSyncQueue(), new Promise((resolve) => setTimeout(resolve, 6000))]);
    }
    const items = await q.getPendingMutations();
    return items.length > 0 ? { key: q.getOfflineQueueKey(userId), items } : null;
  } catch {
    return null;
  }
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // The flag alone is not enough (audit 04 #2): the reset link must have
  // signed this account in here (recoveryProof.ts).
  const [isPasswordRecovery, setIsPasswordRecovery] = useState<boolean>(() => {
    try {
      return new URLSearchParams(window.location.search).get(RECOVERY_FLAG) === '1' && hasAnyRecoveryProof();
    } catch {
      return false;
    }
  });

  const fetchProfile = async (userId: string) => {
    const profileCacheKey = getCacheKey(userId, 'global', 'user_profile');
    try {
      // First attempt to get the profile
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        // If profile doesn't exist (PGRST116), create a basic one
        if (error.code === 'PGRST116') {
          const { data: { user } } = await getSafeUser();
          if (!user) return null;

          const fallbackProfile: Profile = {
            id: user.id,
            email: user.email || '',
            // No name yet: leave it empty (the app shows the address and asks for a name).
            full_name: realName(user.user_metadata?.full_name, user.email) || null,
            avatar_url: user.user_metadata?.avatar_url || null,
            role: 'member',
            instrument: null,
            phone: null,
          };

          const { data: createdProfile, error: createError } = await supabase
            .from('profiles')
            .upsert({
              id: user.id,
              email: user.email || '',
              full_name: fallbackProfile.full_name,
              avatar_url: fallbackProfile.avatar_url,
              role: 'member',
            })
            .select()
            .single();

          if (createError) {
            console.error('Error creating fallback profile:', createError);
            return fallbackProfile;
          }
          setOfflineItem(profileCacheKey, createdProfile).catch(() => {});
          return createdProfile as Profile;
        }
        console.error('Error fetching profile:', error);
        const cached = await getOfflineItem<Profile>(profileCacheKey);
        return cached || null;
      }

      if (data) {
        setOfflineItem(profileCacheKey, data).catch(() => {});
      }
      return data as Profile;
    } catch (error) {
      console.error('Unexpected error in fetchProfile:', error);
      const cached = await getOfflineItem<Profile>(profileCacheKey);
      return cached || null;
    }
  };

  const refreshProfile = async () => {
    if (user) {
      const profileData = await fetchProfile(user.id);
      if (profileData) {
        setProfile(profileData);
      }
    }
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) {
      return { error: new Error('Not authenticated') };
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id);

      if (error) {
        return { error };
      }

      await refreshProfile();
      return { error: null };
    } catch (err: any) {
      return { error: err };
    }
  };

  // Push revocations left by an offline sign-out (audit 04 #6): now, and
  // whenever the network comes back.
  useEffect(() => {
    const flush = () => {
      void flushQueuedPushRevocations().catch(() => {});
    };
    // Back online: what waited after a network error goes at once (#287 r8).
    const flushOnline = () => {
      void flushQueuedPushRevocations({ online: true }).catch(() => {});
    };
    flush();
    window.addEventListener('online', flushOnline);
    return () => window.removeEventListener('online', flushOnline);
  }, []);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Offline with an expired access token this is the stored session:
        // the person stays signed in on the cached data (and the app lock
        // still applies), instead of landing on the welcome screen.
        const { session } = await getSessionOfflineSafe();

        if (session) {
          setSession(session);
          setUser(session.user);
          setStageCacheUser(session.user.id);
          const cachedProfile = await getOfflineItem<Profile>(getCacheKey(session.user.id, 'global', 'user_profile'));
          if (cachedProfile) {
            setProfile(cachedProfile);
            setLoading(false);
          }
          const profileData = await fetchProfile(session.user.id);
          if (profileData) {
            setProfile(profileData);
          }
        } else {
          // No session at start: no Bluetooth key stays (#288), no pushes show (#287).
          clearStageCache();
          void forgetPushAccount().catch(() => {});
          // Signed out since the last run (no stored session, even offline): the sign-out
          // clean-up, an admin's private key included (Codex + Claude on #288), and the device
          // shows no account's pushes (Codex review #287 round 6). Both source checks
          // (authStageSession.test, pushRevocation.test) read this branch from its first line.
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
    // A sign-out whose recordings deletion didn't finish (app closed, 3 s budget): finished now;
    // then the older builds' recordings move into the signed-in account's folder (#296 round 6).
    void import('./regiaAudio').then((m) => m.finishPendingAudioCleanup()).catch(() => {});

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }
      // Every end of a session, also a refused refresh or a deleted account,
      // not only the sign-out button: the device shows none of its pushes
      // (Codex review #287 round 6).
      if (event === 'SIGNED_OUT') void forgetPushAccount().catch(() => {});
      // The initial state is initializeAuth's: offline, the library reports no
      // session here although the stored one is still valid.
      if (event === 'INITIAL_SESSION' && !session) return;
      if (event === 'SIGNED_IN') {
        setAuthError(null);
        // Older builds' Stage recordings left unclaimed (no session at the first launch): maybe another account's, deleted (#296 round 6).
        void import('./regiaAudio').then((m) => m.legacyAudioSignedIn()).catch(() => {});
      }

      setSession(session);
      setUser(session?.user ?? null);
      // Expired or revoked (not only the sign-out button): the same clean-up as the button's.
      if (event === 'SIGNED_OUT') clearStageCache();
      setStageCacheUser(session?.user?.id);

      // Quick sign-in keeps the refresh token, which Supabase rotates.
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session && Capacitor.isNativePlatform()) {
        import('@/lib/services/biometric')
          .then((m) => m.updateStoredSession(session))
          .catch(() => {});
      }

      if (session?.user) {
        setTimeout(async () => {
          const profileData = await fetchProfile(session.user.id);
          if (profileData) {
            setProfile(profileData);
          }
        }, 0);
      } else if (event === 'SIGNED_OUT') {
        setProfile(null);
        // Any sign-out (an expired or revoked session too): the Stage recordings go (#296 round 3).
        void import('./regiaAudio').then((m) => m.clearDownloadedAudio()).catch(() => {});
      }
    });

    // Native OAuth / magic-link / password-reset redirects come back as deep
    // links (com.bandwith.app://auth/callback?code=...). With PKCE the code can
    // only be exchanged by this app instance (it holds the code_verifier), so a
    // forged link cannot swap the session. Tokens in a URL fragment
    // (#access_token=...) are no longer accepted.
    let removeDeepLinkListener: (() => void) | undefined;
    let disposed = false;
    if (Capacitor.isNativePlatform()) {
      // `fromLaunch`: the URL that cold-started the app (getLaunchUrl), which
      // Capacitor keeps returning for the whole run, also after a reload.
      const handleAuthUrl = async (url: string | undefined, fromLaunch = false) => {
        if (!url || !url.includes('auth/callback')) return;
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return;
        }
        // The launch link was handled at an earlier start of this run (sign-out
        // reloads the WebView): it would re-run its spent code or show its old
        // error on the welcome screen.
        if (fromLaunch) {
          if (wasLaunchUrlHandled(url)) return;
          markLaunchUrlHandled(url);
        }
        const closeBrowser = async () => {
          try {
            const { Browser } = await import('@capacitor/browser');
            await Browser.close();
          } catch {
            // In-app browser may already be closed
          }
        };
        const isRecoveryLink = parsed.searchParams.get(RECOVERY_FLAG) === '1';
        const code = parsed.searchParams.get('code');
        if (!code) {
          // Expired reset / confirmation link, or a cancelled sign-in.
          const urlError = callbackUrlError(parsed.search, parsed.hash);
          if (urlError) {
            setAuthError(callbackProblemText(callbackProblem(urlError), isRecoveryLink).body);
            await closeBrowser();
          }
          return;
        }
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error('[DeepLink] Could not complete sign-in:', error.message);
          await closeBrowser();
          // The same sign-in delivered twice, or a stale launch link: the
          // code is spent but the person is signed in, so nothing failed.
          const { data } = await supabase.auth.getSession();
          if (data?.session) return;
          // A launch link with no code verifier on this device belongs to an
          // earlier run: nothing to tell the person.
          if (fromLaunch && callbackProblem(error) === 'other_browser') return;
          setAuthError(callbackProblemText(callbackProblem(error), isRecoveryLink).body);
          return;
        }
        setAuthError(null);
        if (isRecoveryLink) {
          setIsPasswordRecovery(true);
        }
        await closeBrowser();
      };

      const setupDeepLinkListener = async () => {
        try {
          const { App } = await import('@capacitor/app');
          const handle = await App.addListener('appUrlOpen', (data) => {
            handleAuthUrl(data.url);
          });
          if (disposed) {
            handle.remove();
          } else {
            removeDeepLinkListener = () => handle.remove();
          }
          // App opened via a URL while it was closed
          const launch = await App.getLaunchUrl();
          await handleAuthUrl(launch?.url, true);
        } catch (err) {
          console.error('[DeepLink] Error setting up deep link listener:', err);
        }
      };

      setupDeepLinkListener();
    }

    return () => {
      disposed = true;
      subscription.unsubscribe();
      removeDeepLinkListener?.();
    };
  }, []);

  const handleSignIn = async (email: string, password: string) => {
    const { error } = await signIn(email, password);
    return { error };
  };

  const handleSignUp = async (
    email: string,
    password: string,
    metadata?: { full_name?: string }
  ) => {
    const { data, error } = await signUp(email, password, metadata);
    const identities = data?.user?.identities;
    return {
      error,
      session: data?.session ?? null,
      existing: !error && !data?.session && Array.isArray(identities) && identities.length === 0,
    };
  };

  const handleSignInWithGoogle = async () => {
    const { error } = await signInWithOAuth('google');
    return { error };
  };

  const handleSignInWithApple = async () => {
    const { error } = await signInWithOAuth('apple');
    return { error };
  };

  const handleSignOut = async (opts?: { discardPendingWrites?: boolean }) => {
    // Offline edits not sent yet: try now, while the session is still valid.
    // What still can't be sent is kept on this device for this account only
    // (its own queue key) and syncs at its next sign-in, instead of being
    // wiped with the offline cache below.
    const pendingQueue = opts?.discardPendingWrites ? null : await takeUnsyncedQueue(user?.id);
    // After the sign-out, read caches go; each account's unsent changes stay
    // for its next sign-in (audit 04 #9). A deleted account drops only its
    // own: other people's notes on a shared tablet stay (Codex review #287).
    const clearOfflineCache = () =>
      clearOfflineCacheOf('bw:', {
        keepPendingWrites: true,
        discardPendingWritesOf: opts?.discardPendingWrites ? user?.id ?? null : null,
      });
    // Before the session ends: this device must stop receiving this account's
    // pushes (offline: on the device now, on the server once online). A
    // deleted account's token row is gone: the device only (#287 r8, M2).
    await unregisterPushToken(user?.id, { accountGone: !!opts?.discardPendingWrites });
    // The next person on this device must not see this account's badge or
    // message previews in Notification Center (0 also clears delivered ones).
    syncAppBadge(0);
    cleanupPresence();
    // With quick sign-in on for this account, keep its session for Face ID.
    let keepDeviceSession = false;
    if (Capacitor.isNativePlatform() && user?.id) {
      try {
        const owner = await (await import('@/lib/services/biometric')).getQuickSignInOwner();
        keepDeviceSession = !!owner?.userId && owner.userId === user.id;
      } catch {
        keepDeviceSession = false;
      }
    }
    const { error } = await signOut({ keepDeviceSession });
    if (!error) {
      // The band's private recordings downloaded for Stage go too, downloads on their way included
      // (audit 06 #2). Awaited: the app navigates as soon as this returns (#296 B4); 3 s at most.
      await Promise.race([
        import('./regiaAudio').then((m) => m.clearDownloadedAudio()).catch(() => {}),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      setUser(null);
      setProfile(null);
      clearRecoveryProof();
      setSession(null);
      clearStageCache();
      // Refused notes stay for this account (#296 round 8): read before the clear, put back after.
      // Awaited, every step (main, three-way sign-out with #287/#292): nothing of it runs after this
      // returns, so what follows (a deleted account's discardAccountWrites) always comes last.
      // A deleted account (Claude r8 M2): nothing of it is kept or put back, deletion always wins.
      const gone = opts?.discardPendingWrites ? user?.id ?? null : null;
      await import('./signOutWipe')
        .then(
          (m) => m.keepingSignOutLists(() => clearOfflineCache(), { gone }),
          // Its chunk not there (offline, an old cache): the clear still runs, a deleted account's lists still go.
          () => clearOfflineCache().then(() => dropAccountLists(gone)),
        )
        .then(() => (pendingQueue && !gone ? setOfflineItem(pendingQueue.key, pendingQueue.items) : undefined))
        .catch(() => {});
    } else if (user?.id) {
      // Still signed in: the device gets this account's pushes again, with
      // its native account (Claude review #287 round 5, M3).
      void subscribeToPush(user.id).catch(() => {});
    }
    return { error };
  };

  const handleResetPassword = async (email: string) => {
    const { error } = await resetPassword(email);
    return { error };
  };

  const stripRecoveryFlag = () => {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has(RECOVERY_FLAG)) return;
      url.searchParams.delete(RECOVERY_FLAG);
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore
    }
  };

  // The flag stays on until "Continue", so the "Password updated" screen shows.
  const completePasswordRecovery = async (newPassword: string) => {
    // Only the account the reset link signed in (audit 04 #2), with exactly
    // the session its exchange returned in this tab: the shared session can
    // be switched by another tab at any moment (Codex review #287 rounds 3-4).
    const { error } = await updatePasswordForProvenAccount(newPassword, user?.id, {
      update: updatePasswordWithToken,
    });
    if (error && (error as { code?: string }).code === 'recovery_not_verified') {
      return { error: new AuthError(recoveryRefusedText(), 403, 'recovery_not_verified') };
    }
    if (error) {
      const e = error as { message?: string; status?: number; code?: string };
      // The token's session ended (an hour after the link): same advice.
      if (e.status === 401 || e.status === 403) return { error: new AuthError(recoveryRefusedText(), e.status, 'recovery_not_verified') };
      return { error: new AuthError(e.message || 'Password change failed', e.status, e.code) };
    }
    stripRecoveryFlag();
    return { error: null };
  };

  const dismissPasswordRecovery = () => {
    stripRecoveryFlag();
    clearRecoveryProof();
    setIsPasswordRecovery(false);
  };

  // PLG: Derived user mode from profile
  const userMode: UserMode | null = profile?.user_mode || null;

  // PLG: Set user mode and persist to profile
  const setUserMode = async (mode: UserMode) => {
    if (!user) return;
    const { error } = await supabase
      .from('profiles')
      .update({ user_mode: mode, role: mode === 'solo' ? 'member' : 'admin' })
      .eq('id', user.id);
    if (error) {
      console.error('Failed to set user mode:', error);
      return;
    }
    await refreshProfile();
  };

  // Changes still waiting on this phone (notes, suggestions, a setlist order):
  // asked first, "Send now" or "Sign out anyway" (signOutGate.ts); closed,
  // still signed in. A deleted account is not asked: all it left on this
  // device goes first (accountWrites.ts), so nothing is sent or written back.
  const signOutAfterAsking = async (opts?: { discardPendingWrites?: boolean }, again?: { cantKeep?: boolean }): Promise<Awaited<ReturnType<typeof handleSignOut>> & { cancelled?: true }> => {
    if (opts?.discardPendingWrites) {
      const { discardAccountWrites } = await import('./accountWrites');
      await discardAccountWrites(user?.id);
    } else {
      const asked = user?.id ?? null;
      const { askSignOutChoice } = await import('./signOutGate');
      const choice = await askSignOutChoice(asked, again);
      if (choice === 'cancel') return { error: null, cancelled: true as const };
      // Answered for the account it was asked about only: another tab signed
      // someone else in meanwhile → no sign-out, nothing cleared. Can't tell
      // (token expired, no signal): the confirmed sign-out goes ahead, on this
      // device, and keeps what the keep list keeps; never called off unseen.
      if (asked) {
        let now: string | null = null;
        try {
          now = (await getSessionOfflineSafe()).session?.user?.id ?? null;
        } catch {
          now = null;
        }
        if (now && now !== asked) return { error: null, cancelled: true as const };
        // Only now, for the account asked about: erased only once it is
        // known to be the one signed in; kept as refused whenever the
        // sign-out goes ahead (the wipe would delete them).
        if (choice === 'erase' && now === asked) {
          const { discardRefusedChanges } = await import('./liveOutbox');
          discardRefusedChanges(asked);
        }
        if (choice === 'keep-queued') {
          const { keepQueuedAsRefused, queuedNotKeptOnSignOut, waitingChanges } = await import('./liveOutbox');
          // Room checked before anything moves (another tab may have filled
          // the list since the sheet's check); not all kept: asked again, the
          // sheet says unlock to send. The wipe never deletes what waits.
          if (queuedNotKeptOnSignOut(asked) > 0) return signOutAfterAsking(opts, { cantKeep: true });
          // Storage full partway: each change is either kept as refused or stays queued; nothing is lost.
          keepQueuedAsRefused(asked);
          if (waitingChanges(asked) > 0) return signOutAfterAsking(opts, { cantKeep: true });
        }
      }
    }
    const gone = opts?.discardPendingWrites ? user?.id : null;
    const res = await (handleSignOut as (o?: typeof opts) => ReturnType<typeof handleSignOut>)(opts);
    // A send answered while signing out (a refusal, a queue write): it goes too.
    if (gone && !res.error) {
      const { discardAccountWrites } = await import('./accountWrites');
      await discardAccountWrites(gone);
    }
    return res;
  };

  const value: AuthContextType = {
    user,
    profile,
    session,
    loading,
    isAuthenticated: !!user,
    userMode,
    setUserMode,
    signIn: handleSignIn,
    signUp: handleSignUp,
    signInWithGoogle: handleSignInWithGoogle,
    signInWithApple: handleSignInWithApple,
    signOut: signOutAfterAsking,
    resetPassword: handleResetPassword,
    isPasswordRecovery: isPasswordRecovery && (user ? hasRecoveryProof(user.id) : hasAnyRecoveryProof()),
    completePasswordRecovery,
    dismissPasswordRecovery,
    refreshProfile,
    updateProfile,
    authError,
    clearAuthError: () => setAuthError(null),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
