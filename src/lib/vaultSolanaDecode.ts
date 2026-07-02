// ============================================================
// Solana enterprise-vault TRUSTLESS decode wrapper.
//
// Decodes the exact raw base64 bundle bytes the key device is about to
// ed25519 partial-sign (via the @runonflux/solana-multisig SDK decoder) and
// compares them against the relay-supplied display payload. A successful
// decode that contradicts the payload is an active-attack indicator — callers
// HARD-BLOCK approval on { kind: 'create', mismatch: true }. Undecodable bytes
// only degrade to a warn-but-allow state (never-strand-funds).
// ============================================================

import { blockchains } from '@storage/blockchains';
import type { cryptos } from '../types';
import type { VaultDecodedTx } from './transactions';

export type VaultSolDecodeKind = 'create' | 'approve' | 'undecodable';

export interface VaultSolDecodeState {
  mismatch: boolean;
  mismatchReasons: string[];
  kind: VaultSolDecodeKind;
}

export interface VaultSolDecodeResult extends VaultSolDecodeState {
  decoded: VaultDecodedTx;
}

export interface VaultSolExpectedPayload {
  recipients: Array<{ address: string; amount: string }>;
  tokenMint?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
}

/**
 * Trustlessly decode a raw enterprise-vault Solana transaction (base64) and
 * compare it against the relay-supplied expected payload.
 *
 * NEVER throws — failures map to { kind: 'undecodable' } with the error
 * message carried in decoded.error, matching the VaultDecodedTx error-shape
 * convention (see decodeVaultTransaction).
 */
export async function decodeVaultSolTransaction(
  rawUnsignedTxBase64: string,
  chain: keyof cryptos,
  expected: VaultSolExpectedPayload,
): Promise<VaultSolDecodeResult> {
  try {
    // Dynamic import keeps the decoder off the hot path (same pattern as the
    // other solana libs). web3.js is dynamically imported alongside the
    // decoder so the heavy dependency stays off Home's static module path
    // entirely.
    const [
      {
        decodeVaultSolanaTransaction,
        compareDecodedToExpected,
        deriveAssociatedTokenAddress,
        TOKEN_PROGRAM_ID,
        TOKEN_2022_PROGRAM_ID,
      },
      { PublicKey },
    ] = await Promise.all([
      import('@runonflux/solana-multisig'),
      import('@solana/web3.js'),
    ]);
    const programIdStr = blockchains[chain]?.programId;
    if (!programIdStr) {
      throw new Error(`Chain ${String(chain)} has no programId in spec`);
    }
    const programId = new PublicKey(programIdStr);
    const decodedSol = decodeVaultSolanaTransaction(
      rawUnsignedTxBase64,
      programId,
      expected.tokenMint && expected.recipients[0]?.address
        ? {
            expectedRecipientOwner: expected.recipients[0].address,
            expectedMint: expected.tokenMint,
          }
        : undefined,
    );

    if (decodedSol.kind === 'undecodable') {
      return {
        decoded: {
          sender: '',
          recipients: [],
          fee: '0',
          error: decodedSol.error,
        },
        mismatch: false,
        mismatchReasons: [],
        kind: 'undecodable',
      };
    }

    // Multi-recipient SPL proposals: the decoder resolves ATAs against a
    // single owner (recipients[0]); resolve any remaining unverified SPL
    // recipients against the other expected owners so a legitimate
    // multi-recipient send does not false-positive the mismatch hard-block.
    if (decodedSol.kind === 'create' && expected.tokenMint) {
      const mint = new PublicKey(expected.tokenMint);
      for (const r of decodedSol.recipients) {
        if (r.asset !== 'spl' || !r.ata || r.ataVerified) continue;
        for (const exp of expected.recipients) {
          try {
            const owner = new PublicKey(exp.address);
            if (
              deriveAssociatedTokenAddress(
                owner,
                mint,
                TOKEN_PROGRAM_ID,
              ).toBase58() === r.ata ||
              deriveAssociatedTokenAddress(
                owner,
                mint,
                TOKEN_2022_PROGRAM_ID,
              ).toBase58() === r.ata
            ) {
              r.address = exp.address;
              r.ataVerified = true;
              break;
            }
          } catch {
            // invalid expected address — cannot derive, try the next one
          }
        }
      }
    }

    const comparison = compareDecodedToExpected(decodedSol, {
      recipients: expected.recipients,
      tokenMint: expected.tokenMint,
    });

    if (decodedSol.kind === 'approve') {
      // Approve-only tx: recipients/amounts are NOT verifiable from the bytes
      // (they live in the on-chain proposal account created by the first
      // signer). Display the proposal-record values honestly; the outer-ix
      // allowlist (unknownOuterPrograms) is still enforced via `mismatch`.
      return {
        decoded: {
          sender: '',
          recipients: expected.recipients.map((r) => ({
            address: r.address,
            amount: r.amount,
          })),
          fee: '0',
          tokenContract: expected.tokenMint,
          tokenSymbol: expected.tokenSymbol,
          tokenDecimals: expected.tokenDecimals,
        },
        mismatch: !comparison.ok,
        mismatchReasons: comparison.mismatches,
        kind: 'approve',
      };
    }

    // kind === 'create' — the bytes are authoritative.
    const splRecipient = decodedSol.recipients.find((r) => r.asset === 'spl');
    return {
      decoded: {
        sender: decodedSol.sender,
        recipients: decodedSol.recipients.map((r) => ({
          address: r.address,
          amount: r.amount,
        })),
        fee: decodedSol.feeLamports,
        ...(splRecipient
          ? {
              tokenContract: splRecipient.mint ?? expected.tokenMint,
              // decimals from bytes (TransferChecked); legacy Transfer carries
              // no decimals on the wire — fall back to the expected metadata.
              tokenDecimals: splRecipient.decimals ?? expected.tokenDecimals,
              tokenSymbol: expected.tokenSymbol,
            }
          : {}),
      },
      mismatch: !comparison.ok,
      mismatchReasons: comparison.mismatches,
      kind: 'create',
    };
  } catch (error) {
    return {
      decoded: {
        sender: '',
        recipients: [],
        fee: '0',
        error:
          error instanceof Error
            ? error.message
            : 'Failed to decode Solana vault transaction',
      },
      mismatch: false,
      mismatchReasons: [],
      kind: 'undecodable',
    };
  }
}

/** Minimal shape of the relay vault-signing payload the sol decode needs. */
export interface VaultSolSigningPayload {
  chain: string;
  rawUnsignedTx?: string;
  recipients?: Array<{ address: string; amount: string; label?: string }>;
  sourceAddress?: string;
  fee?: string;
  tokenContract?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
}

/**
 * Shared Home.tsx helper — replaces the two previously duplicated synthetic
 * sol decode blocks (socket path + pull-to-refresh path). Decodes the raw
 * bundle bytes, stores the authoritative decode for display and the
 * mismatch/kind state that gates approval. NEVER throws.
 */
export async function applyVaultSolDecode(
  data: VaultSolSigningPayload,
  setDecodedVaultTx: (tx: VaultDecodedTx) => void,
  setSolDecodeState: (state: VaultSolDecodeState) => void,
): Promise<void> {
  const payloadRecipients = Array.isArray(data.recipients)
    ? data.recipients.map((r) => ({ address: r.address, amount: r.amount }))
    : [];
  const payloadSender =
    typeof data.sourceAddress === 'string' ? data.sourceAddress : '';
  const payloadFee = typeof data.fee === 'string' ? data.fee : '0';

  const result = await decodeVaultSolTransaction(
    typeof data.rawUnsignedTx === 'string' ? data.rawUnsignedTx : '',
    data.chain as keyof cryptos,
    {
      recipients: payloadRecipients,
      tokenMint: data.tokenContract,
      tokenSymbol: data.tokenSymbol,
      tokenDecimals: data.tokenDecimals,
    },
  );

  if (result.kind === 'create') {
    // Byte-decoded values are authoritative.
    setDecodedVaultTx(result.decoded);
  } else if (result.kind === 'approve') {
    // Amounts come from the proposal record (verified at creation) — the
    // sender/fee shown likewise; the approve-only banner marks provenance.
    setDecodedVaultTx({
      ...result.decoded,
      sender: payloadSender,
      fee: payloadFee,
    });
  } else {
    // Undecodable: degrade to the relay payload for display; the warning
    // banner tells the user these values are NOT byte-verified.
    setDecodedVaultTx({
      sender: payloadSender,
      recipients: payloadRecipients,
      fee: payloadFee,
    });
  }

  setSolDecodeState({
    mismatch: result.mismatch,
    mismatchReasons: result.mismatchReasons,
    kind: result.kind,
  });
}
