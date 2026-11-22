import React from 'react';
import { BwSheet } from '@/app/components/bw/Screen';
import { AcademyHelpButton } from '@/app/components/academy/AcademyHelpButton';
import { FormError, PillButton } from '@/app/components/bw';
import { Check } from '@/app/components/icons';
import { cn } from '@/app/components/ui/utils';
import { useOptionalBand } from '@/lib/BandContext';
import { useT } from '@/lib/i18n';
import { userMessage } from '@/lib/userError';
import { normalizeLyrics } from '@/lib/songFormat';
import { ASSIGNABLE_PARTS, effectiveVocalParts, instrumentVoicePart, songVoiceParts, type VocalParts, type VoicePart } from '@/lib/voiceParts';
import { fetchSetlistVocalParts, fetchSongVocalParts, saveSetlistVocalParts, saveSongVocalParts } from '@/lib/services/vocalParts';
import { useMemberNames, voiceLabelClass, voicePartLabel, VoiceAssignmentProvider } from '@/app/components/ui/VoiceParts';

/**
 * "Who sings what" (plan §5.2, migration 172): each voice part of a song
 * assigned to band members, per song, with a per-setlist override for one
 * gig (a deputy sings the backing tonight). Members read it in the legend;
 * admins change it here.
 */

// ── A small shared cache: the reader, Stage and the floor wedge read the same rows ──
const cache = new Map<string, VocalParts | null>();
const listeners = new Set<() => void>();
const put = (key: string, v: VocalParts | null) => {
  cache.set(key, v);
  listeners.forEach((l) => l());
};
function useCacheTick() {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
}

/** The song's and (on a gig) the setlist row's assignment, fetched once per id. */
function useStoredParts(songId: string | undefined, rowId: string | undefined, enabled: boolean) {
  useCacheTick();
  React.useEffect(() => {
    if (!enabled) return;
    if (songId && !cache.has(`s:${songId}`))
      void fetchSongVocalParts([songId]).then((r) => {
        if (songId in r) put(`s:${songId}`, r[songId]);
      });
    if (rowId && !cache.has(`r:${rowId}`))
      void fetchSetlistVocalParts([rowId]).then((r) => {
        if (rowId in r) put(`r:${rowId}`, r[rowId]);
      });
  }, [songId, rowId, enabled]);
  return {
    song: songId ? cache.get(`s:${songId}`) ?? null : null,
    setlist: rowId ? cache.get(`r:${rowId}`) ?? null : null,
  };
}

/** For tests: forget what was fetched. */
export const clearVocalPartsCache = () => {
  cache.clear();
  listeners.forEach((l) => l());
};

export interface VoiceAssignmentScopeProps {
  songId?: string;
  /** setlist_songs.id on a gig: the override for this gig. */
  setlistSongId?: string;
  songTitle?: string;
  lyrics?: string | null;
  children: React.ReactNode;
}

/**
 * Gives the lyrics inside it the song's "who sings what" (my part, names in
 * the legend) and, for admins, the sheet to change it.
 */
export const VoiceAssignmentScope: React.FC<VoiceAssignmentScopeProps> = ({ songId, setlistSongId, songTitle, lyrics, children }) => {
  const band = useOptionalBand();
  const used = React.useMemo(() => songVoiceParts(normalizeLyrics(lyrics)), [lyrics]);
  const enabled = used.length > 0 && !!songId;
  const stored = useStoredParts(songId, setlistSongId, enabled);
  const [open, setOpen] = React.useState(false);
  const isAdmin = !!band?.isAdmin;
  const value = React.useMemo(
    () => ({ parts: effectiveVocalParts(stored.song, stored.setlist), onAssign: isAdmin && enabled ? () => setOpen(true) : undefined }),
    [stored.song, stored.setlist, isAdmin, enabled],
  );
  return (
    <VoiceAssignmentProvider value={enabled ? value : null}>
      {children}
      {open && songId && (
        <WhoSingsWhatSheet
          songTitle={songTitle}
          parts={used}
          song={stored.song}
          setlist={setlistSongId ? stored.setlist : undefined}
          onClose={() => setOpen(false)}
          onSave={async (next, scope) => {
            if (scope === 'gig' && setlistSongId) {
              const { error } = await saveSetlistVocalParts(setlistSongId, next);
              if (!error) put(`r:${setlistSongId}`, next);
              return error;
            }
            const { error } = await saveSongVocalParts(songId, next);
            if (!error) put(`s:${songId}`, next);
            return error;
          }}
        />
      )}
    </VoiceAssignmentProvider>
  );
};

const clean = (v: VocalParts): VocalParts | null => {
  const out: VocalParts = {};
  for (const p of ASSIGNABLE_PARTS) if (v[p]?.length) out[p] = v[p];
  return Object.keys(out).length ? out : null;
};

export const WhoSingsWhatSheet: React.FC<{
  songTitle?: string;
  /** The parts the song uses. */
  parts: VoicePart[];
  song: VocalParts | null;
  /** Given on a gig: this setlist's override (null = none yet). */
  setlist?: VocalParts | null;
  onClose: () => void;
  onSave: (next: VocalParts | null, scope: 'song' | 'gig') => Promise<unknown>;
}> = ({ songTitle, parts, song, setlist, onClose, onSave }) => {
  const t = useT();
  const names = useMemberNames();
  const band = useOptionalBand();
  const gigable = setlist !== undefined;
  const [scope, setScope] = React.useState<'song' | 'gig'>(gigable && setlist ? 'gig' : 'song');
  // Nothing set yet: start from what the app already shows (each member's instrument).
  const fromInstruments = React.useMemo(() => {
    const out: VocalParts = {};
    for (const m of band?.selectedBand?.members ?? []) {
      if (m.is_active === false || !m.user_id) continue;
      const p = instrumentVoicePart(m.instrument);
      if (!p || p === 'all' || (p !== 'lead' && !parts.includes(p))) continue;
      out[p] = [...(out[p] ?? []), m.user_id];
    }
    return Object.keys(out).length ? out : null;
  }, [band?.selectedBand?.members, parts]);
  const stored = (sc: 'song' | 'gig') => (sc === 'gig' ? setlist ?? song : song);
  const prefilled = !stored(scope) && !!fromInstruments;
  const [draft, setDraft] = React.useState<VocalParts>(() => ({ ...(stored(scope) ?? fromInstruments ?? {}) }));
  React.useEffect(() => {
    setDraft({ ...(stored(scope) ?? fromInstruments ?? {}) });
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const assignable = ASSIGNABLE_PARTS.filter((p) => p === 'lead' || parts.includes(p));
  const toggle = (p: (typeof ASSIGNABLE_PARTS)[number], id: string) =>
    setDraft((d) => {
      const cur = d[p] ?? [];
      return { ...d, [p]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });
  const save = async (next: VocalParts | null) => {
    setSaving(true);
    setError(null);
    const e = await onSave(next, scope);
    setSaving(false);
    if (e) {
      setError(userMessage(e, t('Couldn’t save who sings what.')));
      return;
    }
    onClose();
  };
  return (
    <BwSheet
      open
      onClose={onClose}
      overline={songTitle}
      title={t('Who sings what')}
      zIndex={165}
      headerAction={<AcademyHelpButton article="who-sings-what" size="sm" variant="sheet" />}
      footer={
        <div className="flex flex-col gap-2">
          {error && <FormError>{error}</FormError>}
          <PillButton variant="white" icon={<Check className="w-4 h-4" />} loading={saving} onClick={() => void save(clean(draft))}>
            {t('Save')}
          </PillButton>
          {scope === 'gig' && setlist && (
            <PillButton variant="ghost" disabled={saving} onClick={() => void save(null)}>
              {t('Use the song’s parts')}
            </PillButton>
          )}
        </div>
      }
    >
      <div className="dark flex flex-col gap-5">
        {gigable && (
          <div className="flex gap-2" role="group" aria-label={t('For')}>
            {(['song', 'gig'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
                className={cn('min-h-11 px-4 rounded-full bw-label-md border border-white/30', scope === s && 'bg-white text-black border-white')}
              >
                {s === 'song' ? t('Every gig') : t('This gig only')}
              </button>
            ))}
          </div>
        )}
        <p className="bw-body-sm text-white/70">
          {scope === 'gig' ? t('Only for this setlist, e.g. when a deputy sings.') : t('Each singer sees their part highlighted.')}
        </p>
        {prefilled && <p className="bw-body-sm text-white/70 -mt-3">{t('Filled in from each member’s instrument. Change it and save.')}</p>}
        {assignable.map((p) => (
          <section key={p} className="flex flex-col gap-2" aria-label={voicePartLabel(p, t)}>
            <h3 className={voiceLabelClass(p)}>{voicePartLabel(p, t)}</h3>
            <div className="flex flex-wrap gap-2">
              {[...names].map(([id, name]) => {
                const on = !!draft[p]?.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(p, id)}
                    className={cn('min-h-11 px-4 rounded-full bw-label-md border border-white/30 inline-flex items-center gap-1.5', on && 'bg-white text-black border-white')}
                  >
                    {on && <Check className="w-4 h-4" aria-hidden />}
                    {name}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </BwSheet>
  );
};
