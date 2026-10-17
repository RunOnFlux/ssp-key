/**
 * Binds a vault approval to the exact request that was on screen (CHN-5).
 *
 * The relay can push a new `enterprisevaultsign` while the user is in the
 * biometric/password prompt. The approval screen re-renders with the new
 * request and, without a binding, the approval the user gave for the old
 * request signs the new one — which the user never saw.
 *
 * The binding is a sha256 digest over a canonical serialisation of the whole
 * normalised request (rawUnsignedTx, walletSignedHex, evmUserOp, signMessage,
 * indices, inputs, nonces, …):
 *
 * 1. Ingestion computes the digest and attaches it to the decoded view it
 *    hands to the approval screen (`bindDecodedToRequest`).
 * 2. The approval screen captures the digest of what it shows when the user
 *    starts approving, closes authentication if it changes, and on success
 *    re-checks it and arms the approval with it (`armVaultApproval`).
 * 3. The sign action recomputes the digest of the request it is about to
 *    sign and refuses unless it equals the armed one
 *    (`consumeVaultApproval`). Arming is single-use.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Deterministic JSON: object keys sorted at every level, `undefined` members
 * dropped (exactly as JSON.stringify drops them), bigint as a decimal string.
 */
export function canonicalJson(value: unknown): string {
  const normalise = (v: unknown): unknown => {
    if (typeof v === 'bigint') {
      return v.toString();
    }
    if (Array.isArray(v)) {
      return v.map((item) => (item === undefined ? null : normalise(item)));
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      Object.keys(v)
        .sort()
        .forEach((key) => {
          const member = (v as Record<string, unknown>)[key];
          if (member !== undefined && typeof member !== 'function') {
            out[key] = normalise(member);
          }
        });
      return out;
    }
    return v;
  };
  return JSON.stringify(normalise(value)) ?? '';
}

/** sha256 (hex) of the canonical serialisation of a vault request. */
export function vaultRequestDigest(request: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(request))));
}

// ---------------------------------------------------------------------------
// Decoded view → request digest (display side)
// ---------------------------------------------------------------------------

const decodedDigests = new WeakMap<object, string>();

/** Records which request a decoded view belongs to. Returns the view. */
export function bindDecodedToRequest<T extends object>(
  decoded: T,
  requestDigest: string,
): T {
  decodedDigests.set(decoded, requestDigest);
  return decoded;
}

/** The request digest a decoded view was bound to, if any. */
export function requestDigestOfDecoded(
  decoded: object | null | undefined,
): string | undefined {
  return decoded ? decodedDigests.get(decoded) : undefined;
}

// ---------------------------------------------------------------------------
// Approval arming (approval screen → sign action)
// ---------------------------------------------------------------------------

let armedDigest: string | null = null;

/** Arms the next sign action for the request with this digest. */
export function armVaultApproval(requestDigest: string): void {
  armedDigest = requestDigest;
}

/** Clears any armed approval. */
export function disarmVaultApproval(): void {
  armedDigest = null;
}

/**
 * True iff an approval is armed for exactly this request digest. Single-use:
 * the armed approval is cleared whatever the outcome.
 */
export function consumeVaultApproval(requestDigest: string): boolean {
  const armed = armedDigest;
  armedDigest = null;
  return armed !== null && armed === requestDigest;
}
