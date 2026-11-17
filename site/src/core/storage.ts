/** Browser storage that never throws (private windows, blocked site data). */
type Kind = 'local' | 'session';
const store = (k: Kind) => (k === 'local' ? window.localStorage : window.sessionStorage);

export function storageGet(key: string, kind: Kind = 'local'): string | null {
  try { return store(kind).getItem(key); } catch { return null; }
}

export function storageSet(key: string, value: string, kind: Kind = 'local') {
  try { store(kind).setItem(key, value); } catch { /* not available: fine */ }
}
