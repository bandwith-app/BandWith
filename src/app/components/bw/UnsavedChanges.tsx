import React from 'react';
import { BwSheet } from '@/app/components/bw/Screen';
import { FormError, PillButton } from '@/app/components/bw/Form';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';

/**
 * "Unsaved changes · Cancel / Save": shown while edits wait for Save (the
 * gig's setlist in its overview). Rendered as the last row of the screen or
 * sheet that holds the changes, not as a fixed layer, so it stays inside its
 * pane on the iPhone Duo and the iPad.
 */
export const UnsavedChangesBar: React.FC<{
  onCancel: () => void;
  onSave: () => void;
  saving?: boolean;
  error?: string | null;
  className?: string;
  /** Inside a sheet's footer: no top border or safe-area padding of its own. */
  inSheet?: boolean;
}> = ({ onCancel, onSave, saving, error, className, inSheet }) => {
  const t = useT();
  return (
    <div
      role="region"
      aria-label={t('Unsaved changes')}
      className={cn(
        'shrink-0 flex flex-col gap-2',
        !inSheet && 'border-t border-border bg-background px-4 pt-3',
        className
      )}
      style={inSheet ? undefined : { paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
    >
      {error && <FormError>{error}</FormError>}
      <div className="flex items-center gap-3 w-full max-w-[640px] mx-auto">
        <span className="bw-label-sm flex-1 min-w-0 truncate" aria-live="polite">
          {t('Unsaved changes')}
        </span>
        <PillButton variant="outline" size="sm" fullWidth={false} onClick={onCancel} disabled={saving}>
          {t('Cancel')}
        </PillButton>
        <PillButton size="sm" fullWidth={false} onClick={onSave} loading={saving}>
          {t('Save')}
        </PillButton>
      </div>
    </div>
  );
};

/**
 * Leaving with changes that aren't saved: save them, throw them away, or go
 * back (the sheet's X, the scrim or a swipe down).
 */
export const UnsavedChangesSheet: React.FC<{
  open: boolean;
  title: string;
  body?: string;
  onSave: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  saving?: boolean;
  error?: string | null;
}> = ({ open, title, body, onSave, onDiscard, onKeepEditing, saving, error }) => {
  const t = useT();
  return (
    <BwSheet
      open={open}
      onClose={onKeepEditing}
      overline={t('Unsaved changes')}
      title={title}
      closeLabel={t('Keep editing')}
      tone="light"
      zIndex={170}
      portal
      footer={
        <div className="flex flex-col gap-2">
          <PillButton onClick={onSave} loading={saving}>
            {t('Save changes')}
          </PillButton>
          <PillButton variant="outline" onClick={onDiscard} disabled={saving}>
            {t('Discard')}
          </PillButton>
        </div>
      }
    >
      {error && <FormError className="mb-3">{error}</FormError>}
      <p className="bw-body-md text-muted-foreground">
        {body ?? t('Your changes are only on this device until you save them. Members are notified once, after you save.')}
      </p>
    </BwSheet>
  );
};
