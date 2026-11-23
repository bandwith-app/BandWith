import { vi } from 'vitest';

/**
 * App time for the Stage-over-Bluetooth tests. They run on fake timers, but
 * WebCrypto (signing, checking, hashing) answers on the real event loop. A
 * jump of app time on a slow machine runs past work that hasn't answered
 * yet: a look, a probe or a "newer pair" check then never happens inside the
 * window the test moved through (CI on the release PR #299).
 *
 * `pass` moves app time on in small steps and, between steps, lets the real
 * loop turn until no WebCrypto call is in flight. What a test asserts is
 * unchanged; only how its clock is moved.
 */
const realSetImmediate = (globalThis as unknown as { setImmediate: (fn: () => void) => unknown }).setImmediate;
const realSetTimeout = globalThis.setTimeout;
let inFlight = 0;

/** A slow runner, for trying this out: every WebCrypto call takes this long (BW_SLOW_CRYPTO_MS). */
const SLOW_MS = Number((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BW_SLOW_CRYPTO_MS ?? 0) || 0;

/** Count the WebCrypto calls in flight. Once per test file, after its WebCrypto is in place. */
export function watchCrypto() {
  const subtle = globalThis.crypto.subtle as unknown as Record<string, ((...args: unknown[]) => Promise<unknown>) & { watched?: boolean }>;
  for (const name of ['digest', 'sign', 'verify', 'importKey', 'exportKey', 'generateKey', 'deriveBits', 'deriveKey', 'encrypt', 'decrypt']) {
    const call = subtle[name];
    if (typeof call !== 'function' || call.watched) continue;
    const watched = Object.assign(
      (...args: unknown[]) => {
        inFlight++;
        const slow = SLOW_MS ? new Promise((r) => realSetTimeout(r, SLOW_MS)) : null;
        return Promise.resolve(call.apply(subtle, args))
          .then(async (v) => {
            if (slow) await slow;
            return v;
          })
          .finally(() => {
            inFlight--;
          });
      },
      { watched: true },
    );
    Object.defineProperty(subtle, name, { value: watched, configurable: true, writable: true });
  }
}

/** The real event loop turns until no WebCrypto call is in flight, and none starts right after. */
export async function cryptoIdle() {
  for (let quiet = 0; quiet < 2; ) {
    await new Promise<void>((r) => realSetImmediate(() => r()));
    quiet = inFlight === 0 ? quiet + 1 : 0;
  }
}

/** Move app time on by `ms`, in steps, never past WebCrypto work still on its way. */
export async function pass(ms: number, step = 250) {
  await cryptoIdle();
  for (let moved = 0; moved < ms; moved += step) {
    await vi.advanceTimersByTimeAsync(Math.min(step, ms - moved));
    await cryptoIdle();
  }
}
