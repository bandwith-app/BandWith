import React, { useState } from 'react';
import { HelpCircle } from '@/app/components/icons';
import { IconButton } from '@/app/components/bw/Screen';
import { useT } from '@/lib/i18n';
import type { AcademyTarget } from '@/lib/academy';
import { AcademySheet } from './AcademySheet';

/**
 * The "?" on a screen's header: opens the BandWith Academy guide for that
 * screen. An IconButton, so inside RailHeaderActions on the iPhone Duo it
 * moves into the rail like the other header actions.
 */
export const AcademyHelpButton: React.FC<{
  /** Article id in academy/content (e.g. 'gig-workspace'). */
  article: string;
  size?: 'sm' | 'md';
  variant?: React.ComponentProps<typeof IconButton>['variant'];
  className?: string;
}> = ({ article, size = 'md', variant = 'outline', className }) => {
  const t = useT();
  const [target, setTarget] = useState<AcademyTarget | undefined>(undefined);
  return (
    <>
      <IconButton
        label={t('Help for this screen')}
        icon={<HelpCircle />}
        size={size}
        variant={variant}
        className={className}
        data-academy={article}
        onClick={() => setTarget({ article })}
      />
      <AcademySheet target={target} onClose={() => setTarget(undefined)} />
    </>
  );
};
