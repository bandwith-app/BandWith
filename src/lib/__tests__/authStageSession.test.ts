import { describe, expect, it } from 'vitest';
import src from '../AuthContext.tsx?raw';

// AuthContext has no render test (the auth library and the native shell); its wiring to the
// Bluetooth keys is checked here. Behaviour of endStageSession: stageSigner.test.ts.

describe('AuthContext: a session that ends takes the Bluetooth keys along (Codex on #288)', () => {
  it('no session at start-up: the kept keys (private ones included) go', () => {
    expect(src).toMatch(/import \{[^}]*endStageSession[^}]*\} from '\.\/stageBleNative'/);
    expect(src).toMatch(/setStageCacheUser\(session\.user\.id\);[\s\S]*?\} else \{\s*\/\/[^\n]*\n\s*endStageSession\(\);/);
  });

  it('signed out by the auth library (expired or revoked, not the button): the same', () => {
    expect(src).toMatch(/if \(event === 'SIGNED_OUT'\) endStageSession\(\);\s*\n\s*setStageCacheUser\(session\?\.user\?\.id\);/);
  });
});
