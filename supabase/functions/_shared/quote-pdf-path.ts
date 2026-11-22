/**
 * The storage path of a band's quote PDF, decoded and checked (migrations
 * 176/177). Plain TypeScript with no imports: Deno and vitest share it.
 *
 * Stored URLs keep the file name URL-encoded (`%20`…). Decoding has to come
 * BEFORE the folder check: an encoded `/` or `..` in the name (`%2F`, `%2E`)
 * would otherwise turn `quotes/<band>/<name>` into another band's folder after
 * the check passed, and the server would sign that file (Codex review #281).
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** `quotes/<band>/<file>` decoded, or null when it could reach anywhere else. */
export function quoteStoragePath(encoded: string | null | undefined, bandId?: string | null): string | null {
  if (typeof encoded !== 'string' || !encoded) return null;
  let path: string;
  try {
    path = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  const m = new RegExp(`^quotes/(${UUID})/([^/\\\\%]+)$`, 'i').exec(path);
  if (!m) return null;
  const file = m[2];
  if (file === '.' || file === '..' || /[\u0000-\u001f\u007f]/.test(file)) return null;
  if (bandId && m[1].toLowerCase() !== bandId.toLowerCase()) return null;
  return path;
}
