/**
 * Band membership rules shared by the Band members list and Member detail:
 * who can co-manage, when you can leave, and how a member's instrument and
 * default fee are read and edited.
 */
import { hasPlanFeature } from '@/lib/beta';

/** Co-managing a band is a paid feature, open to everyone during the beta. */
export const canCoManage = (subTier?: string | null): boolean => hasPlanFeature(subTier);

interface MemberRow {
  user_id: string;
  role: string;
  is_active?: boolean | null;
}

/**
 * Why the signed-in user can't leave the band, or null when they can.
 * A member can always leave; an admin only while another active admin stays.
 */
export function leaveBandBlock(members: MemberRow[], userId: string | null | undefined): 'last_admin' | null {
  if (!userId) return null;
  const me = members.find((m) => m.user_id === userId);
  if (!me || me.role !== 'admin') return null;
  const otherAdmins = members.filter((m) => m.user_id !== userId && m.role === 'admin' && m.is_active !== false);
  return otherAdmins.length > 0 ? null : 'last_admin';
}

/**
 * The instrument to show for a band member: the band's own entry
 * (band_members.instrument), else the one on their profile. Members who
 * joined by invite have no band entry until an admin sets one.
 */
export function memberInstrument(member: {
  instrument?: string | null;
  profile?: { instrument?: string | null } | null;
}): string {
  return (member.instrument || '').trim() || (member.profile?.instrument || '').trim();
}

/** A typed fee ("150", "150,50", ""): the number, or null when empty. */
export function parseFeeInput(text: string): { value: number | null; invalid: boolean } {
  const s = text.trim();
  if (!s) return { value: null, invalid: false };
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { value: null, invalid: true };
  return { value: Math.round(n * 100) / 100, invalid: false };
}

/** Notices the database sends the band when its roster changes (migration 046). */
export const isRosterChange = (type: string | null | undefined): boolean =>
  type === 'member_joined' || type === 'member_left';

/**
 * Whether a fresh band list says the same as the one on screen (same bands,
 * same members, roles, instruments and fees), so a refresh can keep it.
 */
export function bandsUnchanged(prev: readonly unknown[], next: readonly unknown[]): boolean {
  if (prev.length !== next.length) return false;
  try {
    return JSON.stringify(prev) === JSON.stringify(next);
  } catch {
    return false;
  }
}
