/**
 * Stage mode over Bluetooth: who may lead (audit #1).
 *
 * The band key (migration 087) is the same for every member: it finds the
 * gig's Bluetooth service and it used to sign the leader's messages too, so
 * any member could pose as the leader. Now each gig also has an ECDSA P-256
 * key pair (migration 190): the private key only reaches the band's admins
 * (bw_stage_signer), members get the public key (bw_stage_verify_key). The
 * leader signs its state and its clock readings; members check them.
 *
 * Keys travel base64: the private key as PKCS#8 (what CryptoKit and Java's
 * KeyFactory read), the public key raw (65 bytes, uncompressed). Signatures
 * are 64 bytes, r‖s (WebCrypto's form; the native plugins convert to it).
 */

export const SIGNATURE_BYTES = 64;

const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;
const bs = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;

const b64 = (bytes: ArrayBuffer | Uint8Array) => {
  let s = '';
  new Uint8Array(bytes).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};
const unb64 = (s: string) => {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

export interface StageKeyPair {
  /** PKCS#8, base64: admins only. */
  private: string;
  /** Raw uncompressed point, base64: every member. */
  public: string;
}

/**
 * The gig's pair as the server keeps it: `version` goes up each time an admin
 * stops being one (migration 190 clears the pair then); the leader's messages
 * carry it, so members know when their public key is out of date.
 */
export interface StageSigner extends StageKeyPair {
  version: number;
}

/** What members check the leader with. */
export interface StageVerifyKey {
  public: string;
  version: number;
}

/**
 * The server's answer for a gig's public key: the key, or "pending" (rotated,
 * the new pair not made yet: the version with no key, migration 190).
 */
export type StageVerifyAnswer = StageVerifyKey | { public: null; version: number };

/** A new key pair for a gig (the first admin who needs one makes it; the server keeps the first). */
export async function generateSigner(): Promise<StageKeyPair> {
  const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  return {
    private: b64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    public: b64(await crypto.subtle.exportKey('raw', pair.publicKey)),
  };
}

const privCache = new Map<string, Promise<CryptoKey>>();
const pubCache = new Map<string, Promise<CryptoKey>>();

const privateKey = (pkcs8: string) => {
  let k = privCache.get(pkcs8);
  if (!k) {
    k = crypto.subtle.importKey('pkcs8', bs(unb64(pkcs8)), ALG, false, ['sign']);
    privCache.set(pkcs8, k);
  }
  return k;
};
const publicKey = (raw: string) => {
  let k = pubCache.get(raw);
  if (!k) {
    k = crypto.subtle.importKey('raw', bs(unb64(raw)), ALG, false, ['verify']);
    pubCache.set(raw, k);
  }
  return k;
};

/** The leader's signature over `data` (64 bytes). */
export async function signBytes(pkcs8: string, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign(SIGN, await privateKey(pkcs8), bs(data)));
}

/** True when `sig` is the leader's over `data`; false for anything else (a bad key included). */
export async function verifyBytes(publicRaw: string, data: Uint8Array, sig: Uint8Array): Promise<boolean> {
  if (sig.length !== SIGNATURE_BYTES) return false;
  try {
    return await crypto.subtle.verify(SIGN, await publicKey(publicRaw), bs(sig), bs(data));
  } catch {
    pubCache.delete(publicRaw);
    return false;
  }
}

/** The private key signs what the public one checks (a pair stored wrong would sign frames nobody accepts). */
export async function pairMatches(pair: StageKeyPair): Promise<boolean> {
  const probe = new TextEncoder().encode('bandwith-stage-pair');
  try {
    return await verifyBytes(pair.public, probe, await signBytes(pair.private, probe));
  } catch {
    return false;
  }
}

/** A public key's well-formedness (65 bytes, uncompressed point). */
export const isPublicKey = (raw: unknown): raw is string => {
  if (typeof raw !== 'string') return false;
  try {
    const b = unb64(raw);
    return b.length === 65 && b[0] === 4;
  } catch {
    return false;
  }
};
