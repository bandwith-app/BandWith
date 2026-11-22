import React from 'react';
import { AlertCircle } from '@/app/components/icons';
import { Toggle } from '@/app/components/bw/Toggle';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { setCrashReportsEnabled, useCrashReportsEnabled } from '@/lib/crashReports';
import { CARD, IconTile, ROW, RowText } from './rows';

/** Settings › Privacy & account: "Send crash reports" (on by default for the scrubbed JS reports; Crashlytics also needs the usage statistics yes, src/lib/crashReports.ts). */
export const CrashReportsRow: React.FC = () => {
  const t = useT();
  const on = useCrashReportsEnabled();
  return (
    <div className={cn(CARD, ROW)}>
      <IconTile>
        <AlertCircle />
      </IconTile>
      <RowText
        title={t('Send crash reports')}
        hint={t('When something goes wrong: the error, the screen and the app version, so we can fix it. Never your songs, gigs, messages or contacts. On the phone apps, full crash details go only with Anonymous usage statistics on.')}
      />
      <Toggle checked={on} onCheckedChange={(v: boolean) => setCrashReportsEnabled(v)} aria-label={t('Send crash reports')} />
    </div>
  );
};
