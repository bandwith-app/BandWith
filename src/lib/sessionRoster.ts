/**
 * Rehearsal session types (wizard step 1): which band members a focused
 * session picks by default, from their instrument (src/lib/instruments.ts,
 * so "Tastiere", "Keyboards" and "Piano" all count as keys).
 */
import { instrumentKeys } from '@/lib/instruments';

/** Instrument keys per session type. "Rhythm" is drums, bass and keys, as its card says. */
const SESSION_INSTRUMENTS: Record<string, string[]> = {
  vocals: ['vocals'],
  rhythm: ['drums', 'percussion', 'bass', 'double-bass', 'keys'],
  acoustic: ['guitar', 'keys'],
};

/** Words that are not instrument names but still pick a member (roles like "Coro", "Acoustic"). */
const EXTRA_WORDS: Record<string, string[]> = {
  vocals: ['coro', 'singer'],
  rhythm: [],
  acoustic: ['acoustic'],
};

/** Whether a member with this instrument / role text belongs in the session type. */
export function fitsSession(type: string, role: string | null | undefined): boolean {
  const keys = SESSION_INSTRUMENTS[type];
  if (!keys) return false;
  const text = (role || '').toLowerCase();
  if (instrumentKeys(role).some((k) => keys.includes(k))) return true;
  return (EXTRA_WORDS[type] || []).some((w) => text.includes(w));
}

/** Members picked for a session type; everyone when nobody fits (or the type has no filter). */
export function sessionAudience<M extends { id: string; role?: string | null }>(type: string, members: M[]): string[] {
  if (!SESSION_INSTRUMENTS[type]) return members.map((m) => m.id);
  const ids = members.filter((m) => fitsSession(type, m.role)).map((m) => m.id);
  return ids.length > 0 ? ids : members.map((m) => m.id);
}
