/**
 * The small line above a notification in the inbox: its kind, the band and
 * the push subtitle. A push subtitle often starts with the same kind
 * ("Rehearsal · Weekly rehearsal"), which then read twice.
 */
export function notificationTypeLine(label: string, band: string | null, subtitle: string | null): string {
  const parts = (subtitle || '').split(' · ');
  const rest =
    parts.length > 1 && parts[0].trim().toLocaleLowerCase() === label.trim().toLocaleLowerCase()
      ? parts.slice(1).join(' · ')
      : subtitle;
  return [label, band && band !== subtitle && band !== rest ? band : null, rest].filter(Boolean).join(' · ');
}
