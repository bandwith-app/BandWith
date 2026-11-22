/**
 * A random RFC 4122 version 4 uuid, for ids the app sends to uuid columns
 * and parameters (request ids, client-made row ids). crypto.randomUUID when
 * the browser has it; otherwise built from crypto.getRandomValues (older
 * Safari / WebViews have it without randomUUID). Never a non-uuid string:
 * Postgres refuses one, and the step fails every time (Codex #297 r7 M3).
 */
export function newUuid(): string {
  const c: Crypto | undefined = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256); // no crypto at all: still a valid uuid
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
