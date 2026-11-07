/**
 * Binds a consumer EVM personal_sign approval to the exact request that was
 * on screen (review round 1, Key item 4) — the vault approval binding
 * (vaultApprovalBinding, CHN-5) for EvmSigningRequest.
 *
 * The wallet/relay can push a new `evmsigningrequest` while the user is in
 * the biometric/password prompt. Without a binding, the approval given for
 * the message on screen would sign the request that replaced it.
 *
 * 1. Home renders EvmSigningRequest keyed by the request digest, so a new
 *    request remounts the screen (closing any open authentication).
 * 2. The screen captures the digest when the user starts approving and, on
 *    success, arms the approval with it only if it is still the digest of
 *    the request on screen.
 * 3. The sign action recomputes the digest of the request it is about to
 *    sign and refuses — before any nonce is touched — unless it equals the
 *    armed one. Arming is single-use.
 */
import { vaultRequestDigest } from './vaultApprovalBinding';

/** sha256 (hex) of the canonical serialisation of an EVM signing request. */
export function evmSigningRequestDigest(request: unknown): string {
  return vaultRequestDigest(request);
}

let armedDigest: string | null = null;

/** Arms the next EVM sign action for the request with this digest. */
export function armEvmSigningApproval(requestDigest: string): void {
  armedDigest = requestDigest;
}

/** Clears any armed approval. */
export function disarmEvmSigningApproval(): void {
  armedDigest = null;
}

/**
 * True iff an approval is armed for exactly this request digest. Single-use:
 * the armed approval is cleared whatever the outcome.
 */
export function consumeEvmSigningApproval(requestDigest: string): boolean {
  const armed = armedDigest;
  armedDigest = null;
  return armed !== null && armed === requestDigest;
}
