import { useSystemBack } from '@/lib/backStack';
import React, { useState, useEffect } from 'react';
import { readLocalPref, loadNotificationPrefs, saveNotificationPref } from '@/lib/services/notificationPrefs';
import { exportMyData } from '@/lib/services/dataExport';
import { Toggle, IconButton, NavBackButton, PillButton, Selector } from '@/app/components/bw';
import { motion, AnimatePresence } from 'motion/react';
import { BrandLogo } from '@/app/components/ui/BrandLogo';
import {
  Bell,
  BellOff,
  Mail,
  Sparkles,
  Play,
  ArrowLeft,
  Eye,
  Lock,
  Sun,
  Star,
  MessageSquare,
  Globe,
  Trash2,
  AlertCircle,
  ChevronRight,
  Download,
  Smartphone,
  FileText,
  Navigation,
  Check,
  BookOpen,
  RotateCcw,
  Crown,
  Calendar,
  BarChart3,
  WifiOff,
} from '@/app/components/icons';
import { CalendarSyncSection } from '@/app/components/settings/CalendarSyncSection';
import { OfflineLiveSection } from '@/app/components/settings/OfflineLiveSection';
import { PlanSection } from '@/app/components/plans/PlanSection';
import { useOptionalBand } from '@/lib/BandContext';
import { usePlan } from '@/lib/usePlan';
import { planName } from '@/lib/planText';
import { LegalSheet, type LegalDoc } from '@/app/components/legal/LegalSheet';
import { AcademySheet } from '@/app/components/academy/AcademySheet';
import { RoleTourModal } from '@/app/components/onboarding/RoleTourModal';
import type { AcademyTarget } from '@/lib/academy';
import { useAppVersion } from '@/lib/appVersion';
import { allowAndroidInstalls, androidInstallMessage, openAndroidUpdate, useAndroidInstallState, useAndroidUpdate } from '@/lib/androidUpdate';
import { deleteMyAccount } from '@/lib/services/account';
import { useAuth } from '@/lib/AuthContext';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { checkPushPermissions, openNotificationSettings, subscribeToPush } from '@/lib/services/pushNotifications';
import { useTheme } from '@/lib/ThemeContext';
import { cn } from '@/app/components/ui/utils';
import { useRailLayout } from '@/lib/deviceRegions';
import { useLaptopPose } from '@/app/components/duo/FoldSplit';
import { usePosture, useLaptopPoseEnabled, setLaptopPoseEnabled } from '@/lib/posture';
import { setDistanceUnit, useDistanceUnit } from '@/lib/units';
import { useT, useLocalePref, setLocalePref, getLocale, deviceLocale, formatList, LANGUAGES } from '@/lib/i18n';
import { appLockSupported, authenticateDevice, setAppLockEnabled, useAppLockEnabled } from '@/lib/appLock';
import { analyticsAvailable, setAnalyticsConsent, useAnalyticsConsent, useAnalyticsConsentSaveFailed } from '@/lib/appAnalytics';
import { CARD, IconTile, ROW, RowText } from '@/app/components/settings/rows';
import { CrashReportsRow } from '@/app/components/settings/CrashReportsRow';

type SettingsSection = 'notifications' | 'calendar' | 'offline' | 'plan' | 'appearance' | 'units' | 'privacy' | 'duo' | 'help' | 'about' | 'language';

interface SettingsViewProps {
  onClose: () => void;
  initialSection?: string;
  isAdmin?: boolean;
}

/* Card / Icon tile building blocks: ../components/settings/rows.tsx */

const PRESSABLE =
  'transition-colors hover:bg-foreground/[0.03] active:bg-foreground/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

export const SettingsView: React.FC<SettingsViewProps> = ({
  onClose,
  initialSection = 'notifications',
  isAdmin = false,
}) => {
  const { signOut, user } = useAuth();
  const appVersion = useAppVersion();
  const androidUpdate = useAndroidUpdate();
  const { state: androidInstall } = useAndroidInstallState();
  const { mode, setMode, resolvedTheme } = useTheme();
  const t = useT();
  const localePref = useLocalePref();
  const languageName = (id: string) => LANGUAGES.find((l) => l.id === id)?.name ?? 'English';

  // Paid plans (P3a): the band's plan, read from the server (bw_band_entitlements).
  const planBand = useOptionalBand()?.selectedBand ?? null;
  const plan = usePlan(planBand?.id);

  const themeLabel = mode === 'system' ? t('System') : mode === 'dark' ? t('Dark') : t('Light');

  // iPhone Duo: only where the device reports posture (fold / hinge / Duo
  // status column); ordinary phones never see it.
  const { detected: postureDetected } = usePosture();
  const laptopPoseEnabled = useLaptopPoseEnabled();
  const distanceUnit = useDistanceUnit();
  const appLockAvailable = appLockSupported();
  const analyticsConsent = useAnalyticsConsent();
  // Storage full: the answer holds for this run only (a no stays a no), and the row says so.
  const analyticsSaveFailed = useAnalyticsConsentSaveFailed();
  const appLockOn = useAppLockEnabled();
  const [appLockBusy, setAppLockBusy] = useState(false);
  // Turning the lock off asks for the same check as unlocking.
  const handleToggleAppLock = async (on: boolean) => {
    if (on) {
      setAppLockEnabled(true);
      return;
    }
    setAppLockBusy(true);
    const result = await authenticateDevice(t('Turn off app lock'), { cancel: t('Cancel'), title: t('Turn off app lock') });
    setAppLockBusy(false);
    if (result === 'ok' || result === 'unavailable') setAppLockEnabled(false);
  };

  const SECTIONS: {
    id: SettingsSection;
    label: string;
    hint?: string;
    value?: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'notifications', label: t('Notifications'), hint: t('Push and email'), icon: Bell },
    { id: 'calendar', label: t('Calendar sync'), hint: t('Your events in Apple or Google Calendar'), icon: Calendar },
    // Stays while live_pack is off: what is on the device can still be seen and deleted.
    { id: 'offline' as const, label: t('Offline & live'), hint: t('Setlists on this device for no signal'), icon: WifiOff },
    ...(planBand ? [{ id: 'plan' as const, label: t('Plan'), hint: t('Your band’s plan'), value: planName(plan), icon: Crown }] : []),
    { id: 'appearance', label: t('Appearance'), hint: t('Light, dark or system'), value: themeLabel, icon: Sun },
    { id: 'units', label: t('Units'), hint: t('Distances in km or miles'), value: distanceUnit === 'mi' ? t('Miles') : t('Kilometres'), icon: Navigation },
    { id: 'privacy', label: t('Privacy & account'), hint: appLockAvailable ? t('App lock, gig privacy, export, delete account') : t('Gig privacy, export, delete account'), icon: Lock },
    ...(postureDetected
      ? [{ id: 'duo' as const, label: t('iPhone Duo'), hint: t('Laptop pose'), value: laptopPoseEnabled ? t('On') : t('Off'), icon: Smartphone }]
      : []),
    { id: 'language', label: t('Language'), value: languageName(getLocale()), icon: MessageSquare },
    { id: 'help', label: t('Help & support'), hint: t('Answers and what you can do in the app'), icon: Mail },
    { id: 'about', label: t('About'), hint: androidUpdate ? t('BandWith {version} is available', { version: androidUpdate.version }) : appVersion ? t('Version {version}', { version: appVersion }) : undefined, icon: Star },
  ];
  const isKnownSection = (v?: string): v is SettingsSection =>
    !!v && SECTIONS.some((sec) => sec.id === v);

  // 'main' (or nothing) opens the section list; a known id opens that section.
  const openedFromMenu = !isKnownSection(initialSection);
  const [activeSection, setActiveSection] = useState<SettingsSection | null>(
    isKnownSection(initialSection) ? initialSection : null
  );

  // iPhone Duo, open (Figma "Duo · 09"): the list stays on the leading page
  // and the section you are changing is on the trailing page, so one is
  // always selected (Notifications first).
  const { twoPane } = useRailLayout();
  // Laptop pose (one pane): Settings is a hub like the Account hub it opens
  // from. That puts it over the page's own fold split (Band desk, Planner:
  // z-70, later in #root; index.css hides a split while a hub is open), and
  // its top bar holds the Display so the rows scroll on the Deck, never
  // resting on the fold.
  const laptop = useLaptopPose();
  const selectedSection: SettingsSection | null = twoPane ? activeSection ?? 'notifications' : activeSection;

  const handleBack = () => {
    if (twoPane) {
      onClose();
      return;
    }
    if (activeSection && openedFromMenu) {
      setActiveSection(null);
      return;
    }
    onClose();
  };

  // System Back (Android) from a section returns to the list, like the header back.
  useSystemBack(!twoPane && !!activeSection && openedFromMenu, () => setActiveSection(null));

  const [pushEnabled, setPushEnabled] = useState(() => readLocalPref('push'));
  const [emailEnabled, setEmailEnabled] = useState(() => readLocalPref('email'));
  const [productUpdatesEnabled, setProductUpdatesEnabled] = useState(() => readLocalPref('product_updates'));
  useEffect(() => {
    let cancelled = false;
    loadNotificationPrefs().then((prefs) => {
      if (cancelled || !prefs) return;
      if (prefs.push !== undefined) setPushEnabled(prefs.push);
      if (prefs.email !== undefined) setEmailEnabled(prefs.email);
      if (prefs.product_updates !== undefined) setProductUpdatesEnabled(prefs.product_updates);
    });
    return () => { cancelled = true; };
  }, []);

  const [notifError, setNotifError] = useState<string | null>(null);

  const handleTogglePush = (val: boolean) => {
    setPushEnabled(val);
    setNotifError(null);
    saveNotificationPref('push', val).then(({ error }) => {
      if (error) {
        setPushEnabled(!val);
        setNotifError(t('Couldn’t save push setting: {error}', { error: error.message }));
      }
    });
  };

  const handleToggleEmail = (val: boolean) => {
    setEmailEnabled(val);
    setNotifError(null);
    saveNotificationPref('email', val).then(({ error }) => {
      if (error) {
        setEmailEnabled(!val);
        setNotifError(t('Couldn’t save email setting: {error}', { error: error.message }));
      }
    });
  };

  const handleToggleProductUpdates = (val: boolean) => {
    setProductUpdatesEnabled(val);
    setNotifError(null);
    saveNotificationPref('product_updates', val).then(({ error }) => {
      if (error) {
        setProductUpdatesEnabled(!val);
        setNotifError(t('Couldn’t save product news setting: {error}', { error: error.message }));
      }
    });
  };

  /* Export my data (dataExport.ts) */
  const [exporting, setExporting] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);
  const [academy, setAcademy] = useState<AcademyTarget | undefined>(undefined);
  const [showTour, setShowTour] = useState(false);
  const role = isAdmin ? 'admin' : 'member';
  const [exportError, setExportError] = useState<string | null>(null);
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await exportMyData();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : t('Couldn’t export your data.'));
    } finally {
      setExporting(false);
    }
  };


  // The toggle is the account's choice; the phone can still block BandWith's
  // notifications. Checked again whenever the app comes back to the front
  // (e.g. after turning them on in the phone's settings).
  const [devicePush, setDevicePush] = useState<'granted' | 'denied' | 'prompt' | 'unavailable'>('unavailable');
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let alive = true;
    let handle: PluginListenerHandle | null = null;
    const check = () => { void checkPushPermissions().then((s) => { if (alive) setDevicePush(s); }); };
    check();
    CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) check(); })
      .then((h) => { if (alive) handle = h; else void h.remove(); })
      .catch(() => {});
    return () => { alive = false; void handle?.remove(); };
  }, []);
  const devicePushOff = pushEnabled && (devicePush === 'denied' || devicePush === 'prompt');
  const fixDevicePush = () => {
    if (devicePush === 'prompt' && user?.id) {
      void subscribeToPush(user.id).then(() => checkPushPermissions()).then(setDevicePush);
    } else {
      void openNotificationSettings().catch(() => {});
    }
  };

  const notificationStatus = (() => {
    if (devicePushOff) return emailEnabled ? t('email alerts enabled') : t('All alerts paused');
    if (pushEnabled && emailEnabled) return t('push & email alerts enabled');
    if (pushEnabled) return t('push alerts enabled');
    if (emailEnabled) return t('email alerts enabled');
    return t('All alerts paused');
  })();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const closeDeleteConfirm = () => {
    if (deleting) return;
    setShowDeleteConfirm(false);
    setDeleteText('');
    setDeleteError(null);
  };
  // Android Back and Escape cancel the delete confirm before leaving the section.
  useSystemBack(showDeleteConfirm, closeDeleteConfirm);

  const handleDeleteAccount = async () => {
    if (deleteText.trim().toUpperCase() !== 'DELETE' || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteMyAccount();
    if (result.ok) {
      // Quick sign-in (Face ID) must not keep the deleted account's session.
      await import('@/lib/services/biometric')
        .then((m) => m.forgetQuickSignInFor(user?.id, user?.email))
        .catch(() => {});
      // The account no longer exists: clear the local session.
      await signOut().catch(() => {});
      onClose();
      return;
    }
    setDeleting(false);
    if (result.reason === 'admin_of_bands') {
      const names = result.bands.filter(Boolean);
      const list = names.length === 0 ? t('your band') : formatList(names);
      setDeleteError(t('Add another admin to {bands} first.', { bands: list }));
    } else {
      setDeleteError(result.message);
    }
  };

  const getSectionTitle = (section: SettingsSection | null = activeSection): string => {
    switch (section) {
      case 'notifications': return t('Notifications');
      case 'calendar': return t('Calendar sync');
      case 'offline': return t('Offline & live');
      case 'plan': return t('Plan');
      case 'appearance': return t('Appearance');
      case 'units': return t('Units');
      case 'privacy': return t('Privacy & account');
      case 'duo': return t('iPhone Duo');
      case 'help': return t('Help & support');
      case 'about': return t('About');
      case 'language': return t('Language');
      default: return t('App settings');
    }
  };

  const renderMenu = () => (
    <nav aria-label={t('Settings sections')} className="flex flex-col gap-3">
      {SECTIONS.map((sec) => {
        const Icon = sec.icon;
        const selected = twoPane && selectedSection === sec.id;
        return (
          <button
            key={sec.id}
            type="button"
            onClick={() => setActiveSection(sec.id)}
            aria-current={selected ? 'page' : undefined}
            className={cn(CARD, ROW, PRESSABLE, 'min-h-[72px]', selected && 'ring-[1.5px] ring-inset ring-foreground')}
          >
            <IconTile>
              <Icon />
            </IconTile>
            <RowText title={sec.label} hint={sec.hint} />
            {sec.value && (
              <span className="bw-label-sm text-muted-foreground shrink-0">{sec.value}</span>
            )}
            <ChevronRight aria-hidden className="w-[18px] h-[18px] text-foreground shrink-0" />
          </button>
        );
      })}
    </nav>
  );

  const renderNotificationsSection = () => (
    <div className="flex flex-col gap-3">
      <div
        role="status"
        className="dark bg-sheet text-sheet-foreground rounded-full px-5 py-4 flex items-center gap-3"
      >
        <Bell aria-hidden className="w-[22px] h-[22px] text-accent shrink-0" />
        <span className="bw-label-md">{notificationStatus}</span>
      </div>

      {devicePushOff && (
        <button type="button" onClick={fixDevicePush} className={cn(CARD, ROW, PRESSABLE)}>
          <IconTile>
            <BellOff />
          </IconTile>
          <RowText
            title={devicePush === 'denied' ? t('Notifications are off on this device') : t('Allow notifications on this device')}
            hint={
              devicePush === 'denied'
                ? t('Turn them on in your phone’s settings. Until then, chat messages and gig alerts won’t reach you.')
                : t('Tap to allow them. Until then, chat messages and gig alerts won’t reach you.')
            }
          />
          <ChevronRight aria-hidden className="w-[18px] h-[18px] text-foreground shrink-0" />
        </button>
      )}

      <div className={cn(CARD, ROW)}>
        <IconTile>
          <Bell />
        </IconTile>
        <RowText title={t('Push notifications')} hint={t('Gig invites, polls, chat messages')} />
        <Toggle
          checked={pushEnabled}
          onCheckedChange={handleTogglePush}
          aria-label={t('Push notifications')}
        />
      </div>

      <div className={cn(CARD, ROW)}>
        <IconTile>
          <Mail />
        </IconTile>
        <RowText title={t('Email notifications')} hint={t('Invites and new members by email')} />
        <Toggle
          checked={emailEnabled}
          onCheckedChange={handleToggleEmail}
          aria-label={t('Email notifications')}
        />
      </div>

      <div className={cn(CARD, ROW)}>
        <IconTile>
          <Sparkles />
        </IconTile>
        <RowText
          title={t('Product news')}
          hint={emailEnabled ? t('What’s new in BandWith, a few times a year') : t('Off while email notifications are off')}
        />
        <Toggle
          checked={emailEnabled && productUpdatesEnabled}
          disabled={!emailEnabled}
          onCheckedChange={handleToggleProductUpdates}
          aria-label={t('Product news emails')}
        />
      </div>

      {notifError && (
        <p role="alert" className="bw-body-sm text-destructive">
          {notifError}
        </p>
      )}

      <p className="bw-body-sm text-muted-foreground">
        {t('Urgent invites and polls always show a pop-up, even when push is off.')}
      </p>
    </div>
  );

  const renderAppearanceSection = () => (
    <div className={cn(CARD, 'p-4 flex flex-col gap-3')}>
      <div className="flex items-center justify-between gap-3">
        <span className="bw-label-sm text-muted-foreground">{t('Theme')}</span>
        <span className="bw-label-sm text-muted-foreground">{resolvedTheme === 'dark' ? t('Current: dark mode') : t('Current: light mode')}</span>
      </div>
      <div role="group" aria-label={t('Theme')} className="flex items-center gap-2">
        {[
          { id: 'light' as const, label: t('Light') },
          { id: 'dark' as const, label: t('Dark') },
          { id: 'system' as const, label: t('System') },
        ].map((th) => (
          <Selector
            key={th.id}
            size="md"
            selected={mode === th.id}
            onClick={() => setMode(th.id)}
            className="flex-1 min-w-0 justify-center"
          >
            {th.label}
          </Selector>
        ))}
      </div>
    </div>
  );

  const renderUnitsSection = () => (
    <div className={cn(CARD, 'p-4 flex flex-col gap-3')}>
      <span className="bw-label-sm text-muted-foreground">{t('Distance')}</span>
      <div role="group" aria-label={t('Distance unit')} className="flex items-center gap-2">
        {[
          { id: 'km' as const, label: t('Kilometres') },
          { id: 'mi' as const, label: t('Miles') },
        ].map((u) => (
          <Selector
            key={u.id}
            size="md"
            selected={distanceUnit === u.id}
            onClick={() => setDistanceUnit(u.id)}
            className="flex-1 min-w-0 justify-center"
          >
            {u.label}
          </Selector>
        ))}
      </div>
      <p className="bw-body-sm text-muted-foreground">
        {t("Travel distances and rates in quotes and pricing, and wind speed in the weather. Saved quotes and prices don't change, only how they're shown on this device.")}
      </p>
    </div>
  );

  const renderPrivacySection = () => (
    <div className="flex flex-col gap-3">
      {appLockAvailable && (
        <div className={cn(CARD, ROW)}>
          <IconTile>
            <Lock />
          </IconTile>
          <RowText
            title={t('App lock')}
            hint={t('When BandWith starts again after being closed, ask for Face ID, fingerprint or the device passcode')}
          />
          <Toggle
            checked={appLockOn}
            onCheckedChange={(on: boolean) => void handleToggleAppLock(on)}
            disabled={appLockBusy}
            aria-label={t('App lock')}
          />
        </div>
      )}
      {analyticsAvailable() && (
        <div className={cn(CARD, ROW)}>
          <IconTile>
            <BarChart3 />
          </IconTile>
          <RowText
            title={t('Anonymous usage statistics')}
            hint={
              <>
                {t('Which screens are used and how often, and the crash details if the app crashes, to improve BandWith. Never your songs, gigs, messages or contacts, and nothing for ads.')}
                {analyticsSaveFailed && (
                  <span role="alert" className="block mt-1 text-destructive">
                    {t("Couldn't save the choice, free up some space")}
                  </span>
                )}
              </>
            }
          />
          <Toggle
            checked={analyticsConsent === 'granted'}
            onCheckedChange={(on: boolean) => void setAnalyticsConsent(on ? 'granted' : 'denied')}
            aria-label={t('Anonymous usage statistics')}
          />
        </div>
      )}
      <CrashReportsRow />
      {/* Personal gigs are private by design (only their creator can read them,
          migration 056): bands never see their title or venue. */}
      <div className={cn(CARD, 'p-4 flex items-center gap-3')}>
        <IconTile>
          <Eye />
        </IconTile>
        <RowText
          title={t('Personal gigs stay private')}
          hint={t('Only you see their title and venue. Bands only see that you’re busy.')}
        />
      </div>

      <button
        type="button"
        onClick={handleExport}
        disabled={exporting}
        aria-busy={exporting}
        className={cn(CARD, ROW, PRESSABLE, 'disabled:opacity-60')}
      >
        <IconTile>
          <Download />
        </IconTile>
        <RowText title={t('Export my data')} hint={exporting ? t('Preparing your file…') : t('Download a JSON copy')} />
        <ChevronRight aria-hidden className="w-[18px] h-[18px] text-foreground shrink-0" />
      </button>
      {exportError && (
        <p role="alert" className="bw-body-sm text-destructive">
          {exportError}
        </p>
      )}

      <div className={cn(CARD, 'flex flex-col')}>
        {(['terms', 'privacy'] as const).map((doc, i) => (
          <button
            key={doc}
            type="button"
            onClick={() => setLegalDoc(doc)}
            className={cn(ROW, PRESSABLE, i > 0 && 'border-t border-border')}
          >
            <IconTile>
              <FileText />
            </IconTile>
            <RowText title={doc === 'terms' ? t('Terms of Service') : t('Privacy Policy')} hint={doc === 'terms' ? t('The rules for using BandWith') : t('How your data is used and protected')} />
            <ChevronRight aria-hidden className="w-[18px] h-[18px] text-foreground shrink-0" />
          </button>
        ))}
      </div>
      <LegalSheet doc={legalDoc} onClose={() => setLegalDoc(null)} />

      <div className={cn(CARD, 'p-4 flex flex-col gap-3 border-[1.5px] border-destructive')}>
        <div className="flex items-center gap-3">
          <Trash2 aria-hidden className="w-5 h-5 text-destructive shrink-0" />
          <span className="bw-h2 text-destructive">{t('Delete account')}</span>
        </div>
        <p className="bw-body-md text-foreground">
          {t('Permanently removes your profile, personal gigs and messages. If you are the only admin of a band with other members, make someone else admin first; bands where you are alone are deleted with your account.')}
        </p>
        <PillButton
          variant="danger"
          size="md"
          fullWidth={false}
          onClick={() => setShowDeleteConfirm(true)}
          icon={<Trash2 aria-hidden className="w-[18px] h-[18px]" />}
          className="self-start"
        >
          {t('Delete account')}
        </PillButton>
      </div>
    </div>
  );

  // The help page ships with the app (public/legal/help.html): it opens
  // offline, and is the same page on the web. So does the Academy (academy/).
  const renderHelpSection = () => (
    <>
      <button
        type="button"
        onClick={() => setAcademy({ role })}
        className={cn(CARD, ROW, PRESSABLE)}
      >
        <IconTile>
          <BookOpen />
        </IconTile>
        <RowText title={t('BandWith Academy')} hint={t('Guides for every role and device')} />
        <ChevronRight aria-hidden className="w-[18px] h-[18px] text-foreground shrink-0" />
      </button>
      <button
        type="button"
        onClick={() => setShowTour(true)}
        className={cn(CARD, ROW, PRESSABLE)}
      >
        <IconTile>
          <RotateCcw />
        </IconTile>
        <RowText title={t('Show the tour again')} hint={t('The welcome cards for your role')} />
        <ChevronRight aria-hidden className="w-[18px] h-[18px] text-foreground shrink-0" />
      </button>
      <p className="bw-body-sm text-muted-foreground px-1">{t('The guides are in English for now.')}</p>
      <button
        type="button"
        onClick={() => setLegalDoc('help')}
        className={cn(CARD, ROW, PRESSABLE)}
      >
        <IconTile>
          <Mail />
        </IconTile>
        <RowText title={t('Help & support')} hint={t('Answers and what you can do in the app')} />
        <ChevronRight aria-hidden className="w-[18px] h-[18px] text-foreground shrink-0" />
      </button>
      <LegalSheet doc={legalDoc} onClose={() => setLegalDoc(null)} />
      <AcademySheet target={academy} onClose={() => setAcademy(undefined)} />
      {showTour && <RoleTourModal role={role} onClose={() => setShowTour(false)} />}
    </>
  );

  const renderAboutSection = () => (
    <div className={cn(CARD, 'p-5 flex flex-col gap-4')}>
      <BrandLogo variant="waveform" lockup="horizontal" className="h-8" textClassName="text-2xl" />
      {appVersion && <span className="bw-label-sm text-muted-foreground">{t('Version {version}', { version: appVersion })}</span>}
      {androidUpdate && (() => {
        // In-app install (src/lib/androidUpdate.ts): progress on the button,
        // Android's one-time permission and errors in a line under it.
        const status = androidInstall.phase !== 'idle' && androidInstall.version === androidUpdate.version ? androidInstall : null;
        const message = status ? androidInstallMessage(status, t) : null;
        return (
          <div className="flex flex-col items-start gap-2">
            {status?.phase === 'permission' ? (
              <PillButton variant="dark" size="md" fullWidth={false} onClick={() => void allowAndroidInstalls()}>
                {t('Allow')}
              </PillButton>
            ) : (
              <PillButton
                variant="dark"
                size="md"
                fullWidth={false}
                disabled={status?.phase === 'downloading'}
                onClick={() => void openAndroidUpdate(androidUpdate, 'settings')}
              >
                {status?.phase === 'downloading' ? message : t('Update to {version}', { version: androidUpdate.version })}
              </PillButton>
            )}
            {message && status?.phase !== 'downloading' && (
              <p
                role={status?.phase === 'error' ? 'alert' : 'status'}
                className={cn('bw-body-sm', status?.phase === 'error' ? 'text-destructive' : 'text-muted-foreground')}
              >
                {message}
              </p>
            )}
          </div>
        );
      })()}
      <p className="bw-body-sm text-muted-foreground">
        {t('All workspace data is encrypted in transit and at rest. Built for musicians, managers, and touring crews.')}
      </p>
    </div>
  );

  // Settings › Language: Automatic follows the phone; the names are written in their own language.
  const renderLanguageSection = () => {
    const options: { id: 'system' | (typeof LANGUAGES)[number]['id']; title: string; hint?: string }[] = [
      { id: 'system', title: t('Automatic'), hint: t('Same as this phone: {language}', { language: languageName(deviceLocale()) }) },
      ...LANGUAGES.map((l) => ({ id: l.id, title: l.name })),
    ];
    return (
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label={t('Language')} className={cn(CARD, 'flex flex-col')}>
          {options.map((o, i) => {
            const selected = localePref === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={selected}
                lang={o.id === 'system' ? undefined : o.id}
                onClick={() => setLocalePref(o.id)}
                className={cn(ROW, PRESSABLE, 'min-h-[60px]', i > 0 && 'border-t border-border')}
              >
                {o.id === 'system' ? (
                  <IconTile>
                    <Globe />
                  </IconTile>
                ) : null}
                <RowText title={o.title} hint={o.hint} />
                {selected && <Check aria-hidden className="w-[18px] h-[18px] text-foreground shrink-0" />}
              </button>
            );
          })}
        </div>
        <p className="bw-body-sm text-muted-foreground">
          {t('Some screens, notifications and emails are still in English while translations are being added.')}
        </p>
      </div>
    );
  };

  const renderDuoSection = () => (
    <div className={cn(CARD, ROW)}>
      <IconTile>
        <Smartphone />
      </IconTile>
      <RowText title={t('Laptop pose')} hint={t('Switch layouts when the phone is half open on a table')} />
      <Toggle
        checked={laptopPoseEnabled}
        onCheckedChange={(on: boolean) => setLaptopPoseEnabled(on)}
        aria-label={t('Laptop pose')}
      />
    </div>
  );

  const renderSection = (section: SettingsSection | null) => (
    <>
      {section === null && renderMenu()}
      {section === 'notifications' && renderNotificationsSection()}
      {section === 'calendar' && <CalendarSyncSection />}
      {section === 'offline' && <OfflineLiveSection userId={user?.id} />}
      {section === 'plan' && <PlanSection />}
      {section === 'appearance' && renderAppearanceSection()}
      {section === 'units' && renderUnitsSection()}
      {section === 'privacy' && renderPrivacySection()}
      {section === 'duo' && renderDuoSection()}
      {section === 'help' && renderHelpSection()}
      {section === 'about' && renderAboutSection()}
      {section === 'language' && renderLanguageSection()}
    </>
  );

  /* Figma: Top Bar — back circle + H2 title. On the Duo, Back is in the rail. */
  const renderTopBar = (title: string, withBack: boolean) => (
    <div
      className="bw-hub-head px-4 shrink-0 bg-[var(--bg)] sticky top-0 z-30 bw-status-clear"
      style={{
        paddingTop: 'calc(var(--safe-top) + 8px)',
      }}
    >
      <div className="max-w-xl mx-auto w-full h-14 flex items-center gap-3">
        {withBack && <NavBackButton size="sm" onClick={handleBack} />}
        <h1 className="bw-h2 text-foreground truncate min-w-0 flex-1">{title}</h1>
      </div>
    </div>
  );

  /* Bottom spacer: the nav bar is hidden here, so only the home indicator needs clearing */
  const bottomSpacer = (
    <div
      className="shrink-0 pointer-events-none"
      style={{ height: 'calc(var(--safe-bottom) + 40px)' }}
      aria-hidden="true"
    />
  );

  const slideUp = {
    initial: { y: '100%' },
    animate: { y: 0 },
    exit: { y: '100%' },
    transition: { type: 'tween' as const, duration: 0.3, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] },
  };
  const layerClass = 'fixed inset-0 z-[70] bg-[var(--bg)] text-foreground overflow-y-auto overflow-x-hidden flex flex-col min-h-screen';
  const layerStyle: React.CSSProperties = { overscrollBehaviorX: 'none', touchAction: 'pan-y' };

  // Figma "Open · Settings / Privacy & account | Account / Delete – confirm":
  // while you confirm, what will be deleted stays readable on the left.
  const leadingSection: SettingsSection | null = twoPane && showDeleteConfirm ? 'privacy' : null;

  return (
    <>
    <motion.div
      {...slideUp}
      className={cn(layerClass, (twoPane || laptop) && 'bw-pane-hub')}
      style={layerStyle}
    >
      {renderTopBar(twoPane ? getSectionTitle(leadingSection) : getSectionTitle(), true)}

      {/* Content */}
      <div className="px-4 pt-3 pb-2 max-w-xl mx-auto w-full flex flex-col gap-3">
        {renderSection(twoPane ? leadingSection : activeSection)}

        {/* Footer */}
        <p className="bw-label-sm text-muted-foreground pt-1">{appVersion ? t('v{version} · Encrypted in transit and at rest', { version: appVersion }) : t('Encrypted in transit and at rest')}</p>

        {bottomSpacer}
      </div>
    </motion.div>

    {twoPane && selectedSection && (
      <motion.div
        key="settings-detail"
        {...slideUp}
        className={cn(layerClass, 'bw-pane-detail')}
        style={layerStyle}
      >
        {renderTopBar(getSectionTitle(selectedSection), false)}
        <div className="px-4 pt-3 pb-2 max-w-xl mx-auto w-full flex flex-col gap-3">
          {renderSection(selectedSection)}
          {bottomSpacer}
        </div>
      </motion.div>
    )}

      {/* Delete Confirm Modal (Figma: Account / Delete – confirm) */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="bw-pane-dialog fixed inset-0 z-[80] bg-black/65 flex items-center justify-center p-6"
            onClick={closeDeleteConfirm}
          >
            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-account-title"
              aria-describedby="delete-account-desc"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[342px] rounded-[24px] bg-[var(--bg)] text-foreground p-6 flex flex-col gap-4"
            >
              <div className="w-14 h-14 rounded-full bg-destructive-solid text-white flex items-center justify-center shrink-0">
                <AlertCircle aria-hidden className="w-6 h-6" />
              </div>
              <h2 id="delete-account-title" className="bw-h1 text-foreground">
                {t('Delete account?')}
              </h2>
              <p id="delete-account-desc" className="bw-body-md text-muted-foreground">
                {t("This can't be undone. Your profile, personal gigs and messages will be deleted.")}
              </p>
              <div className="flex flex-col gap-2">
                <label htmlFor="delete-account-confirm" className="bw-label-sm text-muted-foreground">
                  {t('Type DELETE to confirm')}
                </label>
                <div
                  className={cn(
                    'h-[52px] rounded-full bg-field px-4 flex items-center gap-3 transition-colors',
                    deleteError ? 'border-2 border-destructive' : 'border border-border focus-within:border-2 focus-within:border-foreground'
                  )}
                >
                  <input
                    id="delete-account-confirm"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoFocus
                    value={deleteText}
                    onChange={(e) => setDeleteText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleDeleteAccount(); }}
                    disabled={deleting}
                    aria-invalid={!!deleteError}
                    className="flex-1 min-w-0 bg-transparent bw-body-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                  />
                  {deleteError && (
                    <AlertCircle aria-hidden className="w-5 h-5 text-destructive shrink-0" />
                  )}
                </div>
                {deleteError && (
                  <p role="alert" className="bw-body-sm text-destructive">
                    {deleteError}
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <PillButton variant="outline" className="flex-1" onClick={closeDeleteConfirm} disabled={deleting}>
                  {t('Cancel')}
                </PillButton>
                <PillButton
                  variant="dark"
                  className="flex-1 bg-destructive-solid text-white"
                  onClick={handleDeleteAccount}
                  disabled={deleting || deleteText.trim().toUpperCase() !== 'DELETE'}
                  aria-busy={deleting}
                  loading={deleting}
                  icon={<Trash2 aria-hidden className="w-5 h-5" />}
                >
                  {deleting ? t('Deleting…') : t('Delete')}
                </PillButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
