import { useCallback } from 'react';
import type { EventData } from '@/app/components/dashboard/EventCard';
import { useT } from '@/lib/i18n';
import { haptic } from '@/lib/haptics';
import { useOptionalAuth } from '@/lib/AuthContext';
import { personName } from '@/lib/personName';
import { userMessage } from '@/lib/userError';
import { eventDataPatch, type EditKind } from '@/lib/eventOverviewEdit';
import { saveEventFields, saveLineupEdit, saveTasksEdit } from '@/lib/services/eventEdits';
import type { LineupRow } from '@/lib/services/eventMemberMoney';
import type { EventTaskDraft } from '@/lib/services/eventTasks';

export type OverviewToast = (message: string, type: 'success' | 'error' | 'info') => void;

export interface OverviewEditApi {
  /** One card's event fields (null: nothing changed). Resolves an error message, or null when saved. */
  saveFields: (patch: Record<string, unknown> | null) => Promise<string | null>;
  /** The whole lineup after the edit, and the gig fee that follows it. */
  saveLineup: (wanted: LineupRow[], eventPatch: Record<string, unknown> | null, feeTbd?: boolean) => Promise<string | null>;
  saveTasks: (drafts: EventTaskDraft[], originalIds: string[]) => Promise<string | null>;
}

/**
 * The saves behind the overview's card editors. The overview shows a save at
 * once (onPatched), then the events list reloads (onSaved), which also brings
 * the change to everyone else with the event open.
 */
export function useOverviewEdit(opts: {
  event: EventData;
  kind: EditKind;
  currentUserId?: string;
  onPatched: (patch: Partial<EventData>) => void;
  onSaved?: () => void;
  onToast?: OverviewToast;
  reloadMembers: () => void;
  reloadTasks: () => void;
}): OverviewEditApi {
  const { event, kind, currentUserId, onPatched, onSaved, onToast, reloadMembers, reloadTasks } = opts;
  const t = useT();
  const auth = useOptionalAuth();

  const done = useCallback(
    (offline?: boolean) => {
      haptic.confirm();
      onToast?.(offline ? t('Saved offline • Will sync when connected') : t('Event updated!'), offline ? 'info' : 'success');
      onSaved?.();
    },
    [onToast, onSaved, t],
  );

  const saveFields = useCallback<OverviewEditApi['saveFields']>(
    async (patch) => {
      if (!patch) return null;
      if (!event.eventId) return t('Could not save the event. Please try again.');
      try {
        const res = await saveEventFields(event.eventId, patch, event.title);
        if (res.error) return userMessage(res.error, t('Could not save the event. Please try again.'));
        onPatched(eventDataPatch(patch, event) as Partial<EventData>);
        done(res.offline);
        return null;
      } catch (err) {
        return userMessage(err, t('Could not save the event. Please try again.'));
      }
    },
    [event, onPatched, done, t],
  );

  const saveLineup = useCallback<OverviewEditApi['saveLineup']>(
    async (wanted, eventPatch, feeTbd) => {
      if (!event.eventId || !event.band_id) return t('Could not save the lineup.');
      const user = auth?.user;
      const actorId = currentUserId || user?.id || '';
      const actorName = personName(
        { full_name: auth?.profile?.full_name || user?.user_metadata?.full_name, email: user?.email },
        'Someone',
      );
      try {
        const res = await saveLineupEdit(
          {
            eventId: event.eventId,
            bandId: event.band_id,
            eventType: kind === 'rehearsal' ? 'rehearsal' : event.eventType || 'other',
            title: event.title,
            date: event.date,
            time: event.timeSet === false ? '' : (event.time || '').slice(0, 5),
            venue: event.venueName || undefined,
            actorId,
            actorName,
            feeTbd,
          },
          wanted,
          eventPatch,
        );
        if (res.error) return userMessage(res.error, t('Could not save the lineup.'));
        if (eventPatch) onPatched(eventDataPatch(eventPatch, event) as Partial<EventData>);
        reloadMembers();
        done(res.offline);
        return null;
      } catch (err) {
        return userMessage(err, t('Could not save the lineup.'));
      }
    },
    [event, kind, auth, currentUserId, onPatched, reloadMembers, done, t],
  );

  const saveTasks = useCallback<OverviewEditApi['saveTasks']>(
    async (drafts, originalIds) => {
      if (!event.eventId) return t('Could not save the tasks.');
      try {
        const res = await saveTasksEdit(event.eventId, drafts, event.date || null, originalIds, event.title);
        if (res.error) return userMessage(res.error, t('Could not save the tasks.'));
        reloadTasks();
        done(res.offline);
        return null;
      } catch (err) {
        return userMessage(err, t('Could not save the tasks.'));
      }
    },
    [event, reloadTasks, done, t],
  );

  return { saveFields, saveLineup, saveTasks };
}
