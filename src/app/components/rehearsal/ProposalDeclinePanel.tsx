import React, { useState } from 'react';
import { PillButton, PillField } from '@/app/components/bw';
import { useT } from '@/lib/i18n';

/**
 * Admin: decline a member's rehearsal proposal, with an optional short reason
 * the member reads in the notice. Inline, like the Withdraw confirmation.
 */
export const ProposalDeclinePanel: React.FC<{
  id: string;
  /** Who proposed it: they read the reason. */
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  tone?: 'default' | 'sheet';
}> = ({ id, name, busy, onCancel, onConfirm, tone = 'default' }) => {
  const t = useT();
  const [reason, setReason] = useState('');
  const sheet = tone === 'sheet';
  return (
    <div role="alertdialog" aria-labelledby={id} className="flex flex-col gap-3 p-4 rounded-[16px] border-2 border-destructive">
      <div className="flex flex-col gap-1">
        <span id={id} className="bw-h3 text-destructive">
          {t('Decline this proposal?')}
        </span>
        <p className={sheet ? 'bw-body-sm text-sheet-foreground/80' : 'bw-body-sm text-muted-foreground'}>
          {t('{name} gets a notice and the proposal leaves their list.', { name })}
        </p>
      </div>
      <PillField
        tone={tone}
        label={t('Reason (optional, {name} will see it)', { name })}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('e.g. The room is booked that week')}
        maxLength={200}
        disabled={busy}
      />
      <div className="flex items-center justify-end gap-2">
        <PillButton variant="ghost" size="sm" fullWidth={false} disabled={busy} onClick={onCancel}>
          {t('Cancel')}
        </PillButton>
        <PillButton
          size="sm"
          fullWidth={false}
          loading={busy}
          className="bg-destructive-solid text-white"
          onClick={() => onConfirm(reason.trim())}
        >
          {t('Decline')}
        </PillButton>
      </div>
    </div>
  );
};
