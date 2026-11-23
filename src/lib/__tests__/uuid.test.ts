/**
 * Codex #297 r7 M3: on a browser without crypto.randomUUID, "Only this date"
 * sent `${Date.now()}-${Math.random()}` to a Postgres uuid parameter, so every
 * move from that editor failed. One shared helper builds a real v4 from
 * crypto.getRandomValues; every request id of #297 uses it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import overviewSheets from '@/app/components/event/edit/OverviewEditSheets.tsx?raw';
import wizard from '@/app/components/rehearsal/RehearsalCreationWizard.tsx?raw';
import skipService from '@/lib/services/rehearsalSkip.ts?raw';
import pollService from '@/lib/services/rehearsalPolls.ts?raw';
import app from '@/app/AuthenticatedApp.tsx?raw';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const real = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true, writable: true });
  vi.resetModules();
});

describe('newUuid', () => {
  it('without crypto.randomUUID: a v4 uuid from getRandomValues', async () => {
    const getRandomValues = vi.fn((a: Uint8Array) => { a.fill(0xab); return a; });
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues }, configurable: true, writable: true });
    const { newUuid } = await import('../uuid');
    const v = newUuid();
    expect(v).toMatch(V4);
    expect(getRandomValues).toHaveBeenCalled();
    expect(v).toBe('abababab-abab-4bab-abab-abababababab');
  });

  it('with no crypto at all: still a v4 uuid', async () => {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    const { newUuid } = await import('../uuid');
    expect(newUuid()).toMatch(V4);
  });

  it('the poll publish request id is one too', async () => {
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: (a: Uint8Array) => a.fill(7) }, configurable: true, writable: true });
    const { newPublishRequestId } = await import('../services/rehearsalPolls');
    expect(newPublishRequestId()).toMatch(V4);
  });

  it('every request id of the move / delete / publish flows comes from it', () => {
    const files: Record<string, string> = { overviewSheets, wizard, skipService, pollService, app };
    for (const [f, src] of Object.entries(files)) {
      expect(src, f).toMatch(/from ['"]@\/lib\/uuid['"]/);
      expect(src, f).not.toMatch(/\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\}/);
      expect(src, f).not.toMatch(/xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx/);
    }
  });
});
