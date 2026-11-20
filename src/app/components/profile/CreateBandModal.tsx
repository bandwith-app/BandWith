import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Users, Link, Check, Plus } from '@/app/components/icons';
import { HeaderAction, IconButton } from '@/app/components/bw/Screen';
import { RailCover } from '@/lib/railActions';
import { PillButton, PillField, Selector, FormError } from '@/app/components/bw/Form';
import { userMessage } from '@/lib/userError';
import { cn } from '@/app/components/ui/utils';
import { PeekingScrollContainer } from '@/app/components/ui/PeekingScrollContainer';
import { createBand, type Band as BandRecord } from '@/lib/services/bands';
import { useBand } from '@/lib/BandContext';
import { useAuth } from '@/lib/AuthContext';
import { t, useT } from '@/lib/i18n';

interface CreateBandModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the new band's id and its inserted row, after the bands list was refreshed. */
  onBandCreated?: (bandId: string, band: BandRecord) => void;
}

// Figma set first (Rock, Pop, Jazz, Funk, Wedding band), then the extra genres, Other last.
const GENRES = [
  'Rock', 'Pop', 'Jazz', 'Funk', 'Wedding band', 'Blues',
  'Soul', 'R&B', 'Country', 'Electronic', 'Hip-Hop', 'Classical',
  'Folk', 'Metal', 'Reggae', 'Latin', 'World', 'Other'
];

/** Adds https:// when the user typed a bare domain. */
const normalizeWebsite = (raw: string): string | undefined => {
  const v = raw.trim();
  if (!v) return undefined;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
};

export const CreateBandModal: React.FC<CreateBandModalProps> = ({
  isOpen,
  onClose,
  onBandCreated
}) => {
  const { refreshBands } = useBand();
  const { refreshProfile } = useAuth();
  const tr = useT();
  
  const [name, setName] = useState('');
  const [genre, setGenre] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError(t('Band name is required'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { data, error: createError } = await createBand({
        name: name.trim(),
        description: description.trim() || undefined,
        genre: genre || undefined,
        website: normalizeWebsite(website),
      });

      if (createError) throw createError;

      setSuccess(true);
      
      // Refresh bands list, and the profile: a solo account is now a band
      // member (trigger 034), so the app must leave solo mode.
      await Promise.all([refreshBands(), refreshProfile()]);

      setTimeout(() => {
        if (data) {
          onBandCreated?.(data.id, data);
        }
        onClose();
        resetForm();
      }, 1000);
    } catch (err) {
      // A plan refusal (161 bands_as_admin) also opens the plan prompt.
      setError(userMessage(err, t('Failed to create band')));
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setName('');
    setGenre('');
    setDescription('');
    setWebsite('');
    setSuccess(false);
    setError(null);
  };

  if (!isOpen) return null;

  const initials = name?.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '??';
  // Every new band starts on Free (product name, stays English); Settings → Plan shows the rest.
  const planName = 'Free';
  // Chip labels only — the saved genre stays the English value.
  const genreLabel: Record<string, string> = {
    'Wedding band': tr('Wedding band'),
    Country: tr('Country', { context: 'genre' }),
    Electronic: tr('Electronic'),
    Classical: tr('Classical'),
    Folk: tr('Folk', { context: 'genre' }),
    Latin: tr('Latin'),
    World: tr('World'),
    Other: tr('Other'),
  };
  const genreText = (g: string) => genreLabel[g] ?? g;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="bw-pane-detail fixed inset-0 z-[115] flex flex-col overflow-hidden bg-background text-foreground"
    >
      {/* Header (Figma: Band / Create band — Kicker + Outline close) */}
      <header className="px-4 shrink-0 bg-background" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
        <div className="max-w-xl mx-auto w-full flex items-end gap-3">
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <p className="bw-label-sm text-muted-foreground">{tr('New entity · Start a band or project')}</p>
            <h2 className="bw-display-lg text-foreground">{tr('Create')}</h2>
          </div>
          <RailCover pane />
          <HeaderAction pane label={tr('Close')} icon={<X />} onClick={onClose} />
        </div>
      </header>

      <PeekingScrollContainer className="flex-1">
        <div className="px-4 pt-4 pb-6 max-w-xl mx-auto w-full flex flex-col gap-6">
          {/* Preview card */}
          <div className="p-5 rounded-[24px] bg-surface-inverse text-surface-inverse-foreground flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-accent text-accent-foreground flex items-center justify-center bw-h2 shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex flex-col gap-1">
              <h3 className="bw-h2 [overflow-wrap:anywhere]">{name || tr('Band name')}</h3>
              <p className="bw-body-sm opacity-85 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 shrink-0" />
                {[genre && genreText(genre), tr('1 member'), planName].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          {error && <FormError>{error}</FormError>}

          <PillField
            label={tr('Band name')}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tr('e.g. The Jazz Collective')}
          />

          {/* Genre */}
          <fieldset className="flex flex-col gap-2">
            <legend className="bw-label-sm text-muted-foreground mb-2">{tr('Genre')}</legend>
            <div className="flex flex-wrap gap-2">
              {GENRES.map((g) => (
                <Selector
                  key={g}
                  selected={genre === g}
                  onClick={() => setGenre(genre === g ? '' : g)}
                  className={cn('justify-center', genre === g && 'bg-accent text-accent-foreground')}
                >
                  {genreText(g)}
                </Selector>
              ))}
            </div>
          </fieldset>

          {/* Description */}
          <label className="flex flex-col gap-2 p-4 rounded-[24px] bg-field border border-border focus-within:border-foreground transition-colors">
            <span className="bw-label-xs text-muted-foreground">{tr('Description')}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={tr('Tell us about your band…')}
              rows={2}
              className="w-full bg-transparent bw-body-lg text-foreground placeholder:text-muted-foreground/60 outline-none resize-none"
            />
          </label>

          <PillField
            label={tr('Website (optional)')}
            type="url"
            icon={<Link className="w-5 h-5" />}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://"
          />

        </div>
      </PeekingScrollContainer>

      {/* Footer */}
      <div className="shrink-0 px-4 pt-3 bg-background" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
        <div className="max-w-xl mx-auto w-full">
          <PillButton
            onClick={handleCreate}
            disabled={!name.trim()}
            loading={saving}
            variant={success ? 'dark' : 'primary'}
            icon={success ? <Check className="w-[18px] h-[18px]" /> : <Plus className="w-[18px] h-[18px]" />}
          >
            {success ? tr('Created') : tr('Create band')}
          </PillButton>
        </div>
      </div>
    </motion.div>
  );
};

export default CreateBandModal;
