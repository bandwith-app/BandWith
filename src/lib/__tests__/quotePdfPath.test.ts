import { describe, it, expect } from 'vitest';
import { quoteStoragePath } from '../../../supabase/functions/_shared/quote-pdf-path';

// Codex review #281: the PDF signers checked the band folder, then decoded,
// so `%2F..%2F` in the file name reached another band's PDF after the check.
const BAND = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';

describe('quote PDF storage path', () => {
  it('decodes a normal stored name', () => {
    expect(quoteStoragePath(`quotes/${BAND}/Q-2026-014_Quote%20Hudson%20Horns.pdf`, BAND)).toBe(
      `quotes/${BAND}/Q-2026-014_Quote Hudson Horns.pdf`,
    );
  });

  it('refuses encoded separators and parent folders', () => {
    expect(quoteStoragePath(`quotes/${BAND}/..%2F${OTHER}%2Fsecret.pdf`, BAND)).toBeNull();
    expect(quoteStoragePath(`quotes/${BAND}/%2E%2E%2F%2E%2E%2Favatars%2Fx.png`, BAND)).toBeNull();
    expect(quoteStoragePath(`quotes/${BAND}/%2E%2E`, BAND)).toBeNull();
    expect(quoteStoragePath(`quotes/${BAND}/a%5Cb.pdf`, BAND)).toBeNull();
    expect(quoteStoragePath(`quotes/${BAND}/a%252Fb.pdf`, BAND)).toBeNull();
    expect(quoteStoragePath(`quotes/${BAND}/a%00.pdf`, BAND)).toBeNull();
    expect(quoteStoragePath(`quotes/${BAND}/bad%E0%A4%A.pdf`, BAND)).toBeNull();
  });

  it("refuses another band's folder", () => {
    expect(quoteStoragePath(`quotes/${OTHER}/x.pdf`, BAND)).toBeNull();
    expect(quoteStoragePath(`quotes/${OTHER}/x.pdf`)).toBe(`quotes/${OTHER}/x.pdf`);
    expect(quoteStoragePath(`avatars/${BAND}/x.pdf`, BAND)).toBeNull();
    expect(quoteStoragePath('', BAND)).toBeNull();
  });
});
