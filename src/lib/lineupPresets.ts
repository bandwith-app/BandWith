/**
 * Lineup presets in the gig form (Solo, Duo, Trio, Full band).
 *
 * A preset picks the first `count` band members, the user always among them.
 * It shows as selected only when the lineup is exactly what it would pick (a
 * count match isn't enough: a 3-person band's Trio and Full band pick the
 * same people, and any 3 musicians aren't "Trio"). When two presets pick the
 * same people, the one last chosen (`performanceType`) wins, else the first.
 */

export interface LineupPreset<T extends string = string> {
  count: number;
  type: T;
}

/** The member ids a preset selects. */
export function lineupPresetMembers(count: number, memberIds: readonly string[], currentUserMemberId?: string | null): string[] {
  if (memberIds.length === 0) return currentUserMemberId ? [currentUserMemberId] : [];
  const picked = memberIds.slice(0, count);
  if (currentUserMemberId && !picked.includes(currentUserMemberId)) picked[0] = currentUserMemberId;
  return picked;
}

const sameSet = (a: readonly string[], b: readonly string[]) => {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id)) && set.size === new Set(b).size;
};

/** The preset matching the lineup exactly, if any (see the module note). */
export function selectedLineupPreset<T extends string>(
  presets: ReadonlyArray<LineupPreset<T>>,
  selected: readonly string[],
  memberIds: readonly string[],
  currentUserMemberId: string | null | undefined,
  performanceType?: T | null,
): T | null {
  const matching = presets.filter((p) => sameSet(lineupPresetMembers(p.count, memberIds, currentUserMemberId), selected));
  if (matching.length === 0) return null;
  return (matching.find((p) => p.type === performanceType) ?? matching[0]).type;
}
