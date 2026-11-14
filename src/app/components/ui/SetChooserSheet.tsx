import React from 'react';
import { BwSheet, ListRow } from '@/app/components/bw/Screen';
import { Layers, Plus } from '@/app/components/icons';
import { useT } from '@/lib/i18n';

export interface ChoosableSet {
  uid: string;
  title: string;
  count: number;
}

/**
 * Adding songs to a gig with more than one set: which set they go in. With a
 * single set the caller skips this and uses that set. "New set" adds one at
 * the end and puts the songs there.
 */
export const SetChooserSheet: React.FC<{
  open: boolean;
  sets: ChoosableSet[];
  onChoose: (setUid: string) => void;
  onNewSet?: () => void;
  onClose: () => void;
  zIndex?: number;
}> = ({ open, sets, onChoose, onNewSet, onClose, zIndex = 120 }) => {
  const t = useT();
  return (
    <BwSheet
      open={open}
      onClose={onClose}
      overline={t('Add songs')}
      title={t('Which set?')}
      closeLabel={t('Close')}
      zIndex={zIndex}
      portal
      picker
    >
      <div className="dark flex flex-col gap-2">
        {sets.map((s) => (
          <ListRow
            key={s.uid}
            icon={<Layers />}
            title={s.title}
            subtitle={t('{count} songs', { count: s.count })}
            onClick={() => onChoose(s.uid)}
          />
        ))}
        {onNewSet && <ListRow icon={<Plus />} title={t('New set')} onClick={onNewSet} />}
      </div>
    </BwSheet>
  );
};
