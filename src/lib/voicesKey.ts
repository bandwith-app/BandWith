/**
 * Who sings what (setlist_songs.vocal_parts), as a key compared like 188:
 * {} and null are the same, key order doesn't count. Shared by the app's
 * save checks (services/songs) and the demo's bw_save_setlist_songs.
 */
export const voicesKey = (v: unknown): string => {
  if (v == null || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)) return 'null';
  if (Array.isArray(v)) return `[${v.map(voicesKey).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${voicesKey(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
};
