/**
 * ERC-4337 v0.6 UserOperation hash verification.
 *
 * The wallet posts EVM operations as { userOpRequest, opHash } (consumer
 * MultiSigUserOp JSON) or { evmUserOp, rawUnsignedTx } (enterprise vault).
 * The approval screen decodes and DISPLAYS the userOpRequest, but Schnorr
 * signing consumes the wallet-supplied HASH — the SDK's fromJson trusts the
 * serialized opHash and never recomputes it. Without an on-device recompute
 * a compromised wallet could display a benign operation while the key signs
 * the hash of a different, malicious one.
 *
 * computeUserOpHash uses @alchemy/aa-core's own entry-point registry — the
 * exact same implementation the wallet uses at construction time
 * (multiSigSmartAccount.getEntryPoint().getUserOperationHash) — so a
 * legitimate wallet can never be blocked by this check.
 */
import { entryPointRegistry } from '@alchemy/aa-core';
import type { UserOperationRequest } from '@alchemy/aa-core';
import { hashMessage } from 'ethers';
import { blockchains } from '@storage/blockchains';
import type { cryptos } from '../types';

export function computeUserOpHash(
  userOpRequest: unknown,
  chain: keyof cryptos,
): string {
  // entrypointAddress/chainId exist only on EVM chain configs; the union type
  // does not declare them, so read through a narrow cast (guarded below).
  const blockchainConfig = blockchains[chain] as {
    entrypointAddress?: string;
    chainId?: string;
  };
  if (!blockchainConfig?.entrypointAddress || !blockchainConfig?.chainId) {
    throw new Error(`Chain ${chain} has no account-abstraction config`);
  }
  return entryPointRegistry['0.6.0'].getUserOperationHash(
    userOpRequest as UserOperationRequest<'0.6.0'>,
    blockchainConfig.entrypointAddress as `0x${string}`,
    Number(blockchainConfig.chainId),
  );
}

/**
 * True iff the wallet-supplied hash equals the hash of the DISPLAYED
 * operation. Fails closed: any parse/derivation error returns false.
 */
export function userOpHashMatches(
  userOpRequest: unknown,
  chain: keyof cryptos,
  claimedHash: unknown,
): boolean {
  try {
    if (typeof claimedHash !== 'string' || !claimedHash) return false;
    return (
      computeUserOpHash(userOpRequest, chain).toLowerCase() ===
      claimedHash.toLowerCase()
    );
  } catch (error) {
    console.log('[UserOpVerify] hash computation failed', error);
    return false;
  }
}

/**
 * True iff the wallet-supplied digest equals the EIP-191 hash of the message
 * the user is shown. Guards the vault MESSAGE-signing path (personal_sign):
 * the key otherwise Schnorr-signs an opaque 32-byte digest with no binding to
 * the displayed text, so a benign "sign in" message could hide the hash of a
 * vault-draining UserOp. Fails closed.
 */
export function messageDigestMatches(
  message: unknown,
  claimedDigest: unknown,
): boolean {
  try {
    if (typeof claimedDigest !== 'string' || !claimedDigest) return false;
    if (typeof message !== 'string') return false;
    return hashMessage(message).toLowerCase() === claimedDigest.toLowerCase();
  } catch (error) {
    console.log('[UserOpVerify] message digest computation failed', error);
    return false;
  }
}
