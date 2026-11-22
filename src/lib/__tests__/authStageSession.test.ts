import { describe, expect, it } from 'vitest';
import src from '../AuthContext.tsx?raw';

// AuthContext has no render test (the auth library and the native shell); its wiring to the
// Bluetooth keys is checked here. Behaviour of clearStageCache: stageSigner.test.ts.

// The full sign-out clean-up (keys, private ones included, my live-mode files, old setlist
// copies), not a part of it: a session that ended by itself leaves no less behind (Claude on #288).
describe('AuthContext: a session that ends takes the Bluetooth keys along (Codex on #288)', () => {
  it('no session at start-up: the kept keys (private ones included) go', () => {
    expect(src).toMatch(/import \{[^}]*clearStageCache[^}]*\} from '\.\/stageBleNative'/);
    expect(src).not.toMatch(/endStageSession/);
    expect(src).toMatch(/setStageCacheUser\(session\.user\.id\);[\s\S]*?\} else \{\s*\/\/[^\n]*\n\s*clearStageCache\(\);/);
  });

  it('signed out by the auth library (expired or revoked, not the button): the same', () => {
    expect(src).toMatch(/if \(event === 'SIGNED_OUT'\) clearStageCache\(\);\s*\n\s*setStageCacheUser\(session\?\.user\?\.id\);/);
  });
});
