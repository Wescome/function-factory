/**
 * PLAYBOOK-KEEL-SCR-PORT-1, Track 3 (INV-12): lifted from SCR (identity.ts)
 * VERBATIM at the RUNTIME level -- the only addition is the type-only
 * `/// <reference types="node" />` below (KEEL's tsconfig deliberately
 * excludes "node" from its global `types` array to avoid an ambient clash
 * with @cloudflare/workers-types elsewhere in the project, so `node:crypto`'s
 * types need file-scoped opt-in; this has zero runtime effect, erased at
 * compile time like every other type annotation).
 *
 * Empirically confirmed (not assumed) against KEEL's real deployed runtime
 * (Workers + `compatibility_flags: ["nodejs_compat"]`, compat date
 * 2026-06-01, via a temporary probe RPC run through vitest-pool-workers'
 * real workerd, since removed): `node:crypto`'s `generateKeyPairSync('ed25519')`,
 * `sign`/`verify`, and `createHash('sha256')` all round-trip correctly under
 * KEEL's substrate exactly as they do under SCR's own Node runtime.
 *
 * WebCrypto (`crypto.subtle`) with `{name:"Ed25519"}` was ALSO confirmed
 * working in the same probe -- but was deliberately NOT chosen. WebCrypto's
 * sign/verify are Promise-based; adopting it would force `Keyring.sign`/
 * `.verify` to become async, which would then force every public method on
 * `ReviewService` that calls `#emit` (openSeries, openChange, appendRevision,
 * recordVerdict, land, ... effectively all of it) to become async too --
 * directly violating Track 1's "these compile with no behaviour change."
 * `node:crypto`'s synchronous API is what lets `service.ts` (Track 1) port
 * completely unmodified. Do not swap this for WebCrypto without re-deriving
 * that ripple.
 */
/// <reference types="node" />
import {
  createHash,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  createPublicKey,
  createPrivateKey,
  type KeyObject,
} from 'node:crypto';

import type { ReviewEvent } from './events';

/** Fields the seal adds. Everything else is what the command produced. */
export interface Seal {
  /** Digest of the preceding event. The genesis event uses GENESIS. */
  prev: string;
  /** Digest of this event's canonical form, chained to `prev`. */
  digest: string;
  /** Ed25519 signature over `digest`, by the actor named in the event. */
  sig: string;
}

export const GENESIS = '0'.repeat(64);

/** Stable serialisation: object keys sorted, so the digest is reproducible. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    // `undefined` values vanish on JSON round-trip, so they must not
    // contribute to the digest either — otherwise an event sealed in memory
    // fails verification the moment it is read back from storage.
    .filter((k) => k !== 'digest' && k !== 'sig' && o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

export function digestOf(event: object, prev: string): string {
  return createHash('sha256').update(prev).update(canonical(event)).digest('hex');
}

export interface KeyPair {
  publicKey: KeyObject;
  privateKey?: KeyObject;
}

export function exportPublic(k: KeyObject): string {
  return k.export({ type: 'spki', format: 'pem' }).toString();
}

export function exportPrivate(k: KeyObject): string {
  return k.export({ type: 'pkcs8', format: 'pem' }).toString();
}

export function importPublic(pem: string): KeyObject {
  return createPublicKey(pem);
}

export function importPrivate(pem: string): KeyObject {
  return createPrivateKey(pem);
}

/**
 * Who may speak as whom.
 *
 * A review record whose entire value is the answer to "who approved this"
 * cannot take the answer on the actor's word. Every event is signed by the key
 * registered to the actor it names.
 */
export class Keyring {
  #keys = new Map<string, KeyPair>();
  #tofu: boolean;

  /**
   * `trustOnFirstUse` registers a fresh key the first time an actor appears.
   *
   * Be precise about what that buys: it guarantees **continuity** — once an
   * actor has spoken, nobody without the private key can speak as them again —
   * and it guarantees nothing about the **authenticity** of that first
   * registration. A deployment that cares must enrol keys out of band and
   * construct the Keyring with `trustOnFirstUse: false`.
   */
  constructor(opts: { trustOnFirstUse?: boolean } = {}) {
    this.#tofu = opts.trustOnFirstUse ?? true;
  }

  enrol(actorId: string, keys: KeyPair): void {
    this.#keys.set(actorId, keys);
  }

  generate(actorId: string): KeyPair {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pair = { publicKey, privateKey };
    this.#keys.set(actorId, pair);
    return pair;
  }

  known(actorId: string): boolean {
    return this.#keys.has(actorId);
  }

  actors(): string[] {
    return [...this.#keys.keys()];
  }

  publicKeyOf(actorId: string): KeyObject | undefined {
    return this.#keys.get(actorId)?.publicKey;
  }

  privateKeyOf(actorId: string): KeyObject | undefined {
    return this.#keys.get(actorId)?.privateKey;
  }

  /** Sign on behalf of an actor. Throws when the actor cannot be spoken for. */
  sign(actorId: string, digest: string): string {
    let pair = this.#keys.get(actorId);
    if (!pair && this.#tofu) pair = this.generate(actorId);
    if (!pair) throw new Error(`no key enrolled for ${actorId}`);
    if (!pair.privateKey) throw new Error(`no private key held for ${actorId}`);
    return edSign(null, Buffer.from(digest, 'hex'), pair.privateKey).toString('base64');
  }

  verify(actorId: string, digest: string, sig: string): boolean {
    const pub = this.#keys.get(actorId)?.publicKey;
    if (!pub) return false;
    try {
      return edVerify(null, Buffer.from(digest, 'hex'), pub, Buffer.from(sig, 'base64'));
    } catch {
      return false;
    }
  }
}

export interface ChainViolation {
  property: string;
  invariant: string;
  detail: string;
}

/**
 * INV-12 LOG-IS-SEALED.
 *
 * Append-only is a policy; a hash chain is evidence. Verify walks the log and
 * reports any event whose digest does not follow from its predecessor, or whose
 * signature does not belong to the actor it names.
 *
 * This is what makes deletion and reordering *detectable* rather than merely
 * forbidden — the SQLite triggers stop a careless `DELETE`, but a copied
 * database with rows dropped is caught only here.
 */
export function verifyChain(events: ReviewEvent[], keyring?: Keyring): ChainViolation[] {
  const out: ChainViolation[] = [];
  let prev = GENESIS;

  for (const [i, e] of events.entries()) {
    const sealed = e as ReviewEvent & Partial<Seal>;

    if (sealed.prev === undefined || sealed.digest === undefined || sealed.sig === undefined) {
      out.push({
        property: 'P14 SEALED',
        invariant: 'INV-12',
        detail: `event ${i} (${e.eventId}) is unsealed`,
      });
      continue;
    }

    if (sealed.prev !== prev) {
      out.push({
        property: 'P15 CHAIN-INTACT',
        invariant: 'INV-12',
        detail: `event ${i} (${e.eventId}) follows ${sealed.prev.slice(0, 8)}, but the log is at ${prev.slice(0, 8)} — an event was removed, reordered or inserted`,
      });
    }

    const recomputed = digestOf(sealed, sealed.prev);
    if (recomputed !== sealed.digest) {
      out.push({
        property: 'P16 CONTENT-BOUND',
        invariant: 'INV-12',
        detail: `event ${i} (${e.eventId}) has been altered since it was sealed`,
      });
    }

    // Chain and content binding need no keys. Attribution does.
    if (keyring && !keyring.verify(e.actorId, sealed.digest, sealed.sig)) {
      out.push({
        property: 'P17 ATTRIBUTED-BY-KEY',
        invariant: 'INV-12',
        detail: `event ${i} (${e.eventId}) is not signed by ${e.actorId}`,
      });
    }

    prev = sealed.digest;
  }

  return out;
}
