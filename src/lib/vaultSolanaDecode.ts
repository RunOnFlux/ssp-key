// ============================================================
// Solana enterprise-vault TRUSTLESS decode wrapper.
//
// Decodes the exact raw base64 bundle bytes the key device is about to
// ed25519 partial-sign (via the @runonflux/solana-multisig SDK decoder) and
// compares them against the relay-supplied display payload. Every outcome
// that is not a positive, complete verification blocks approval:
//
// - create: the bytes are authoritative. Any contradiction with the payload
//   is an active-attack indicator (mismatch → hard block).
// - approve-only (split flow, H-13 / SOL-3): the bytes carry no proposal
//   message, so the device fetches the proposal account at the approve target
//   from its own Solana RPC backend, decodes the stored message with the same
//   SDK decoder and compares it like a create. No fetch, no approval.
// - undecodable (SOL-4): blocked. decoded.error is kept so the screen and the
//   sign action both refuse.
//
// Token identity (H-14 / CHN-3 / SOL-5): the mint and decimals come only from
// the signed bytes (TransferChecked), the symbol only from this device's own
// token list keyed by that mint. Legacy SPL Transfer (no mint, no decimals on
// the wire) is refused. The relay's tokenSymbol / tokenDecimals are never
// used.
//
// Vault binding (SOL-7): the source vault in the bytes must be the vault PDA
// of the multisig in the bytes; when the request names the multisig members
// and threshold, the multisig PDA must re-derive from them. For approve-only
// requests the member set is read from chain. The sign action then requires
// this device's own leaf to be one of the verified members.
//
// Vault descriptor pinning (VD-4): when the caller passes `vaultBinding` (the
// multisig + vault PDA and member set this device derived itself from the
// verified, pinned vault descriptor), the bytes must act on exactly that
// multisig and vault. The relay's own `solMembers` / `solThreshold` are then
// ignored.
//
// Outer ComputeBudget (mainnet): the relay builder adds SetComputeUnitLimit +
// SetComputeUnitPrice next to nonceAdvance. SDK 0.12.0 flags every
// ComputeBudget instruction as an unknown outer program. They are tolerated
// only after a byte-level check with the same shapes and caps the server's
// `verifyOuterComputeBudget` enforces; anything else still blocks.
// ============================================================

import axios from 'axios';
import { Buffer } from 'buffer';
import { blockchains } from '@storage/blockchains';
import type { cryptos } from '../types';
import type { VaultDecodedTx } from './transactions';

/**
 * Hard ceiling (lamports) on the vault->paymaster fee reimbursement the device
 * accepts without hard-blocking. The relay is untrusted, so this independently
 * bounds any fee-routed vault drain regardless of what the relay claims; a
 * legitimate paymaster fee (proposal + ATA rent + network fees) is well under
 * it. The exact decoded fee is still surfaced to the user. Tunable — 0.05 SOL.
 */
const SOL_VAULT_MAX_FEE_LAMPORTS = '50000000';

/** Anchor account discriminators (IDL `accounts[].discriminator`). */
const VAULT_TRANSACTION_DISCRIMINATOR = [168, 250, 162, 100, 81, 14, 162, 207];
const MULTISIG_DISCRIMINATOR = [224, 116, 121, 186, 68, 161, 79, 236];

// Outer ComputeBudget allowlist — identical shapes and caps to relay-enterprise
// solanaVaultProposalBuilderService `verifyOuterComputeBudget` (and the relay
// paymaster's own caps). The priority fee is paid by the paymaster.
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
const COMPUTE_BUDGET_SET_UNIT_LIMIT_TAG = 2;
const COMPUTE_BUDGET_SET_UNIT_PRICE_TAG = 3;
/** Solana's per-transaction compute unit maximum. */
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1_000_000n;
const MAX_PRIORITY_FEE_LAMPORTS = 50_000n;

export type VaultSolDecodeKind = 'create' | 'approve' | 'undecodable';

export interface VaultSolDecodeState {
  mismatch: boolean;
  mismatchReasons: string[];
  kind: VaultSolDecodeKind;
  /** Digest of the request this verdict belongs to (see vaultApprovalBinding). */
  requestDigest?: string;
  /**
   * Multisig member set (base58 leaves) this device verified for the vault in
   * the bytes: request-supplied and re-derived to the multisig PDA, or read
   * from chain for approve-only requests. When set, the sign action refuses
   * unless this device's own leaf is one of them.
   */
  members?: string[];
  /** The multisig PDA the bytes act on. */
  multisigPda?: string;
}

export interface VaultSolDecodeResult extends VaultSolDecodeState {
  decoded: VaultDecodedTx;
}

export interface VaultSolExpectedPayload {
  recipients: Array<{ address: string; amount: string }>;
  /** The mint the relay claims; compared with the bytes, never displayed. */
  tokenMint?: string;
  /** Multisig member leaves (base58) the request claims for the vault. */
  members?: string[];
  /** Multisig threshold the request claims for the vault. */
  threshold?: number;
  /**
   * VD-4: the vault this device derived itself from the verified, pinned
   * vault descriptor. When present it replaces `members` / `threshold`, and
   * the bytes must act on exactly this multisig and vault PDA.
   */
  vaultBinding?: VaultSolBinding;
}

/** Multisig + vault PDA derived on device from a pinned vault descriptor. */
export interface VaultSolBinding {
  multisigPda: string;
  vaultPda: string;
  members: string[];
  threshold: number;
}

/** One Solana account as returned by getMultipleAccounts (base64). */
export interface SolAccountInfo {
  owner: string;
  data: Buffer;
}

export type SolAccountFetcher = (
  chain: keyof cryptos,
  addresses: string[],
) => Promise<Array<SolAccountInfo | null>>;

export interface VaultSolDecodeOptions {
  /** Reads accounts from chain. Defaults to this device's Solana RPC backend. */
  fetchAccounts?: SolAccountFetcher;
}

/**
 * Reads accounts through the Key's own Solana RPC backend (chain spec
 * `node`), never through the relay.
 */
export const fetchSolAccounts: SolAccountFetcher = async (chain, addresses) => {
  const node = blockchains[chain]?.node;
  if (!node) {
    throw new Error(`Chain ${String(chain)} has no Solana RPC backend`);
  }
  const response = await axios.post(
    `https://${node}`,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'getMultipleAccounts',
      params: [addresses, { encoding: 'base64', commitment: 'confirmed' }],
    },
    { timeout: 15000, headers: { 'Content-Type': 'application/json' } },
  );
  const value = (response.data as { result?: { value?: unknown } } | undefined)
    ?.result?.value;
  if (!Array.isArray(value) || value.length !== addresses.length) {
    throw new Error('Unexpected Solana RPC response');
  }
  return value.map((entry: unknown) => {
    if (entry === null) {
      return null;
    }
    const account = entry as { owner?: unknown; data?: unknown };
    if (
      typeof account.owner !== 'string' ||
      !Array.isArray(account.data) ||
      typeof account.data[0] !== 'string' ||
      account.data[1] !== 'base64'
    ) {
      throw new Error('Unexpected Solana account encoding');
    }
    return {
      owner: account.owner,
      data: Buffer.from(account.data[0], 'base64'),
    };
  });
};

// ---------------------------------------------------------------------------
// On-chain account parsing (Borsh, bounds-checked)
// ---------------------------------------------------------------------------

class AccountReader {
  offset = 0;
  constructor(private readonly buf: Buffer) {}
  private ensure(n: number) {
    if (this.offset + n > this.buf.length) {
      throw new Error('account data is truncated');
    }
  }
  u8(): number {
    this.ensure(1);
    return this.buf[this.offset++];
  }
  u32(): number {
    this.ensure(4);
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }
  u64(): bigint {
    this.ensure(8);
    let v = 0n;
    for (let i = 7; i >= 0; i--) {
      v = (v << 8n) | BigInt(this.buf[this.offset + i]);
    }
    this.offset += 8;
    return v;
  }
  bytes(n: number): Buffer {
    this.ensure(n);
    const out = Buffer.from(this.buf.subarray(this.offset, this.offset + n));
    this.offset += n;
    return out;
  }
  vecBytes(): Buffer {
    return this.bytes(this.u32());
  }
  pubkeys(): Buffer[] {
    const count = this.u32();
    const out: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      out.push(this.bytes(32));
    }
    return out;
  }
}

function expectDiscriminator(data: Buffer, expected: number[], name: string) {
  if (data.length < 8 || expected.some((byte, index) => data[index] !== byte)) {
    throw new Error(`account is not a ${name}`);
  }
}

export interface ParsedVaultTransactionAccount {
  multisig: Buffer;
  transactionIndex: bigint;
  creator: Buffer;
  payer: Buffer;
  vaultIndex: number;
  executed: boolean;
  approvals: Buffer[];
  /** The Borsh-serialised TransactionMessage exactly as stored. */
  messageBytes: Buffer;
}

/** Parses a VaultTransaction account (see programs/solana-multisig lib.rs). */
export function parseVaultTransactionAccount(
  data: Buffer,
): ParsedVaultTransactionAccount {
  expectDiscriminator(data, VAULT_TRANSACTION_DISCRIMINATOR, 'proposal');
  const r = new AccountReader(data);
  r.bytes(8);
  const multisig = r.bytes(32);
  const transactionIndex = r.u64();
  const creator = r.bytes(32);
  const payer = r.bytes(32);
  r.u8(); // bump
  const vaultIndex = r.u8();
  r.u8(); // vault_bump
  const executedByte = r.u8();
  if (executedByte > 1) {
    throw new Error('proposal account has an invalid executed flag');
  }
  const approvals = r.pubkeys();
  const messageStart = r.offset;
  r.u8(); // num_signers
  r.u8(); // num_writable_signers
  r.u8(); // num_writable_non_signers
  r.pubkeys(); // account_keys
  const instructionCount = r.u32();
  for (let i = 0; i < instructionCount; i++) {
    r.u8(); // program_id_index
    r.vecBytes(); // account_indexes
    r.vecBytes(); // data
  }
  const lookupCount = r.u32();
  for (let i = 0; i < lookupCount; i++) {
    r.bytes(32);
    r.vecBytes();
    r.vecBytes();
  }
  return {
    multisig,
    transactionIndex,
    creator,
    payer,
    vaultIndex,
    executed: executedByte === 1,
    approvals,
    messageBytes: Buffer.from(data.subarray(messageStart, r.offset)),
  };
}

export interface ParsedMultisigAccount {
  members: Buffer[];
  threshold: number;
}

/** Parses a Multisig account (see programs/solana-multisig lib.rs). */
export function parseMultisigAccount(data: Buffer): ParsedMultisigAccount {
  expectDiscriminator(data, MULTISIG_DISCRIMINATOR, 'multisig');
  const r = new AccountReader(data);
  r.bytes(8);
  const members = r.pubkeys();
  const threshold = r.u8();
  return { members, threshold };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const undecodable = (error: string): VaultSolDecodeResult => ({
  decoded: { sender: '', recipients: [], fee: '0', error },
  mismatch: false,
  mismatchReasons: [],
  kind: 'undecodable',
});

const blockedApprove = (reasons: string[]): VaultSolDecodeResult => ({
  decoded: { sender: '', recipients: [], fee: '0' },
  mismatch: true,
  mismatchReasons: reasons,
  kind: 'approve',
});

type SolanaSdk = typeof import('@runonflux/solana-multisig');
type SolanaWeb3 = typeof import('@solana/web3.js');
type DecodedCreate = Extract<
  ReturnType<SolanaSdk['decodeVaultSolanaTransaction']>,
  { kind: 'create' }
>;

/**
 * Byte-level check of the OUTER ComputeBudget instructions (port of the
 * server's `verifyOuterComputeBudget`, identical rules and caps). Every
 * ComputeBudget instruction must be SetComputeUnitLimit (5 bytes) or
 * SetComputeUnitPrice (9 bytes) with no accounts, at most one of each, never
 * at instruction 0 (the durable-nonce advance), unit limit ≤ 1,400,000, price
 * ≤ 1,000,000 µlamports/CU and total priority fee ≤ 50,000 lamports. Returns
 * how many it verified. Never throws.
 */
function verifyOuterComputeBudget(
  web3: SolanaWeb3,
  rawUnsignedTxBase64: string,
): { ok: true; count: number } | { ok: false; error: string } {
  let tx: InstanceType<SolanaWeb3['Transaction']>;
  try {
    tx = web3.Transaction.from(Buffer.from(rawUnsignedTxBase64, 'base64'));
  } catch (error) {
    return {
      ok: false,
      error: `transaction bytes are not parseable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  let count = 0;
  let limitCount = 0;
  let priceCount = 0;
  // Without an explicit limit the runtime may bill up to the per-tx maximum.
  let units = BigInt(MAX_COMPUTE_UNIT_LIMIT);
  let price = 0n;
  for (let i = 0; i < tx.instructions.length; i++) {
    const ix = tx.instructions[i];
    if (ix.programId.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID) {
      continue;
    }
    if (i === 0) {
      return {
        ok: false,
        error:
          'ComputeBudget instruction at instruction[0] (must be nonceAdvance)',
      };
    }
    if (ix.keys.length !== 0) {
      return {
        ok: false,
        error: 'ComputeBudget instruction must not take accounts',
      };
    }
    const data = Buffer.from(ix.data);
    const tag = data.length > 0 ? data[0] : -1;
    if (tag === COMPUTE_BUDGET_SET_UNIT_LIMIT_TAG && data.length === 5) {
      limitCount++;
      const requested = data.readUInt32LE(1);
      if (requested > MAX_COMPUTE_UNIT_LIMIT) {
        return {
          ok: false,
          error: `ComputeBudget unit limit ${requested} exceeds ${MAX_COMPUTE_UNIT_LIMIT}`,
        };
      }
      units = BigInt(requested);
    } else if (tag === COMPUTE_BUDGET_SET_UNIT_PRICE_TAG && data.length === 9) {
      priceCount++;
      price = data.readBigUInt64LE(1);
      if (price > MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS) {
        return {
          ok: false,
          error: `ComputeBudget unit price ${price} exceeds ${MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS} microlamports/CU`,
        };
      }
    } else {
      return { ok: false, error: 'non-allowlisted ComputeBudget instruction' };
    }
    count++;
  }
  if (limitCount > 1 || priceCount > 1) {
    return { ok: false, error: 'duplicate ComputeBudget instruction' };
  }
  const feeLamports = (units * price + 999_999n) / 1_000_000n;
  if (feeLamports > MAX_PRIORITY_FEE_LAMPORTS) {
    return {
      ok: false,
      error: `ComputeBudget priority fee ${feeLamports} lamports exceeds the ${MAX_PRIORITY_FEE_LAMPORTS} lamport cap`,
    };
  }
  return { ok: true, count };
}

/**
 * Removes the decoder's ComputeBudget flags from `unknownOuterPrograms` only
 * when the byte check verified exactly that many allowlisted instructions.
 * Otherwise the flags stay (and still block) and the reason is returned.
 */
function exemptOuterComputeBudget<T extends { unknownOuterPrograms: string[] }>(
  web3: SolanaWeb3,
  rawUnsignedTxBase64: string,
  decoded: T,
): { decoded: T; reasons: string[] } {
  const flagged = decoded.unknownOuterPrograms.filter(
    (p) => p === COMPUTE_BUDGET_PROGRAM_ID,
  ).length;
  if (flagged === 0) {
    return { decoded, reasons: [] };
  }
  const budget = verifyOuterComputeBudget(web3, rawUnsignedTxBase64);
  if (budget.ok && budget.count === flagged) {
    return {
      decoded: {
        ...decoded,
        unknownOuterPrograms: decoded.unknownOuterPrograms.filter(
          (p) => p !== COMPUTE_BUDGET_PROGRAM_ID,
        ),
      },
      reasons: [],
    };
  }
  const reason = budget.ok
    ? `verified ${budget.count} but the decoder flagged ${flagged}`
    : budget.error;
  return {
    decoded,
    reasons: [`ComputeBudget instruction(s) not allowed: ${reason}`],
  };
}

/** Adds blocking reasons to a decode result. */
function withReasons(
  result: VaultSolDecodeResult,
  reasons: string[],
): VaultSolDecodeResult {
  if (reasons.length === 0) {
    return result;
  }
  const mismatchReasons = [...result.mismatchReasons, ...reasons];
  return { ...result, mismatch: true, mismatchReasons };
}

/** VD-4: the bytes must act on the multisig and vault of the pinned vault. */
function vaultBindingReasons(
  binding: VaultSolBinding | undefined,
  multisigPda: string | undefined,
  vaultPda: string | undefined,
): string[] {
  if (!binding) {
    return [];
  }
  const reasons: string[] = [];
  if (multisigPda !== binding.multisigPda) {
    reasons.push(
      `multisig ${multisigPda ?? '?'} is not the multisig of the pinned vault (${binding.multisigPda})`,
    );
  }
  if (vaultPda !== undefined && vaultPda !== binding.vaultPda) {
    reasons.push(
      `source ${vaultPda || '?'} is not the address of the pinned vault (${binding.vaultPda})`,
    );
  }
  return reasons;
}

/** Validates a request-supplied member set; undefined when absent. */
function parseClaimedMembers(
  web3: SolanaWeb3,
  members: unknown,
  threshold: unknown,
): { members: string[]; threshold: number } | undefined | 'invalid' {
  if (
    (members === undefined || members === null) &&
    (threshold === undefined || threshold === null)
  ) {
    return undefined;
  }
  if (
    !Array.isArray(members) ||
    members.length === 0 ||
    typeof threshold !== 'number' ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > members.length
  ) {
    return 'invalid';
  }
  try {
    const keys = members.map((m) => {
      if (typeof m !== 'string') {
        throw new Error('member is not a string');
      }
      return new web3.PublicKey(m).toBase58();
    });
    if (new Set(keys).size !== keys.length) {
      return 'invalid';
    }
    return { members: keys, threshold };
  } catch {
    return 'invalid';
  }
}

/**
 * Turns an SDK create decode into the authoritative display plus every
 * reason it may not be approved.
 */
function verifyCreate(
  sdk: SolanaSdk,
  web3: SolanaWeb3,
  programId: InstanceType<SolanaWeb3['PublicKey']>,
  chain: keyof cryptos,
  decodedSol: DecodedCreate,
  expected: VaultSolExpectedPayload,
  expectedTransactionPda?: string,
): { decoded: VaultDecodedTx; reasons: string[] } {
  const reasons: string[] = [];

  // Resolve SPL destinations to recipient owners with the mint FROM THE
  // BYTES (never the relay's mint): a destination counts only when it is the
  // associated token account of one of the expected owners.
  for (const r of decodedSol.recipients) {
    if (r.asset !== 'spl' || !r.ata || !r.mint) continue;
    const mint = new web3.PublicKey(r.mint);
    for (const exp of expected.recipients) {
      try {
        const owner = new web3.PublicKey(exp.address);
        if (
          sdk
            .deriveAssociatedTokenAddress(owner, mint, sdk.TOKEN_PROGRAM_ID)
            .toBase58() === r.ata ||
          sdk
            .deriveAssociatedTokenAddress(
              owner,
              mint,
              sdk.TOKEN_2022_PROGRAM_ID,
            )
            .toBase58() === r.ata
        ) {
          r.address = owner.toBase58();
          r.ataVerified = true;
          break;
        }
      } catch {
        // invalid expected address — cannot derive, try the next one
      }
    }
  }

  const comparison = sdk.compareDecodedToExpected(decodedSol, {
    recipients: expected.recipients,
    tokenMint: expected.tokenMint,
    maxFeeLamports: SOL_VAULT_MAX_FEE_LAMPORTS,
    expectedTransactionPda,
  });
  reasons.push(...comparison.mismatches);

  const splRecipients = decodedSol.recipients.filter((r) => r.asset === 'spl');
  if (splRecipients.some((r) => !r.mint || r.decimals === undefined)) {
    reasons.push(
      'legacy SPL Transfer (no mint or decimals in the bytes) is not accepted; only TransferChecked',
    );
  }
  splRecipients.forEach((r) => {
    if (r.ataVerified !== true) {
      reasons.push(
        `token account ${r.ata ?? r.address} is not the associated token account of an expected recipient`,
      );
    }
  });
  const assetKeys = new Set(
    decodedSol.recipients.map((r) =>
      r.asset === 'spl' ? `spl:${r.mint ?? '?'}:${String(r.decimals)}` : 'sol',
    ),
  );
  if (assetKeys.size > 1) {
    reasons.push(
      'the proposal moves more than one asset, which this device cannot display',
    );
  }

  const mint = splRecipients[0]?.mint;
  const bytesDecimals = splRecipients[0]?.decimals;
  const known = mint
    ? blockchains[chain]?.tokens?.find(
        (tk) => !!tk.contract && tk.contract === mint,
      )
    : undefined;
  if (
    known &&
    bytesDecimals !== undefined &&
    known.decimals !== bytesDecimals
  ) {
    reasons.push(
      `token ${known.symbol} has ${known.decimals} decimals, the transaction claims ${bytesDecimals}`,
    );
  }

  // SOL-7: the source vault must be the vault PDA of the multisig the bytes
  // act on, and — when the request names them — that multisig must re-derive
  // from the claimed members and threshold.
  try {
    const multisig = new web3.PublicKey(decodedSol.multisigPda);
    const [vaultPda] = sdk.deriveVaultAddress(
      multisig,
      decodedSol.vaultIndex,
      programId,
    );
    if (vaultPda.toBase58() !== decodedSol.sender) {
      reasons.push(
        `source ${decodedSol.sender} is not the vault of multisig ${decodedSol.multisigPda}`,
      );
    }
  } catch {
    reasons.push('could not derive the vault address of the multisig');
  }

  return {
    decoded: {
      sender: decodedSol.sender,
      recipients: decodedSol.recipients.map((r) => ({
        address: r.address,
        amount: r.amount,
      })),
      fee: decodedSol.feeLamports,
      ...(mint
        ? {
            tokenContract: mint,
            tokenDecimals: bytesDecimals,
            tokenSymbol: known?.symbol,
          }
        : {}),
    },
    reasons,
  };
}

/** True when the request-claimed multisig re-derives to `multisigPda`. */
function claimedMultisigMatches(
  sdk: SolanaSdk,
  web3: SolanaWeb3,
  programId: InstanceType<SolanaWeb3['PublicKey']>,
  claimed: { members: string[]; threshold: number },
  multisigPda: string,
): boolean {
  try {
    const [derived] = sdk.deriveMultisigAddress(
      claimed.members.map((m) => new web3.PublicKey(m)),
      claimed.threshold,
      programId,
    );
    return derived.toBase58() === multisigPda;
  } catch {
    return false;
  }
}

/** Wire-format transaction around a message, with empty signature slots. */
function wireTransaction(message: Buffer): Buffer {
  const signatureCount = message[0];
  if (signatureCount === undefined || signatureCount > 127) {
    throw new Error('unexpected signer count');
  }
  return Buffer.concat([
    Buffer.from([signatureCount]),
    Buffer.alloc(64 * signatureCount),
    message,
  ]);
}

/**
 * Approve-only (split) request: fetch the proposal at the approve target and
 * its multisig from chain, decode the stored message with the SDK decoder
 * (wrapped in the create instruction that would have carried it) and verify
 * it exactly like a create bundle.
 */
async function verifyApproveOnChain(
  sdk: SolanaSdk,
  web3: SolanaWeb3,
  programId: InstanceType<SolanaWeb3['PublicKey']>,
  chain: keyof cryptos,
  decodedSol: Extract<
    ReturnType<SolanaSdk['decodeVaultSolanaTransaction']>,
    { kind: 'approve' }
  >,
  expected: VaultSolExpectedPayload,
  claimed: { members: string[]; threshold: number } | undefined,
  fetchAccounts: SolAccountFetcher,
): Promise<VaultSolDecodeResult> {
  const reasons: string[] = [];
  if (decodedSol.unknownOuterPrograms.length > 0) {
    reasons.push(
      `unknown outer program instruction(s): ${decodedSol.unknownOuterPrograms.join(', ')}`,
    );
  }
  const targets = new Set(decodedSol.approveTargets);
  if (targets.size !== 1) {
    reasons.push(
      'an approve-only transaction must approve exactly one proposal',
    );
  }
  if (reasons.length > 0) {
    return blockedApprove(reasons);
  }
  const transactionPda = decodedSol.transactionPda;
  const multisigPda = decodedSol.multisigPda;

  let accounts: Array<SolAccountInfo | null>;
  try {
    accounts = await fetchAccounts(chain, [transactionPda, multisigPda]);
  } catch (error) {
    return blockedApprove([
      `could not fetch the on-chain proposal: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ]);
  }
  const [proposalAccount, multisigAccount] = accounts;
  const programIdStr = programId.toBase58();
  if (!proposalAccount) {
    return blockedApprove([
      `proposal ${transactionPda} does not exist on chain`,
    ]);
  }
  if (!multisigAccount) {
    return blockedApprove([`multisig ${multisigPda} does not exist on chain`]);
  }
  if (
    proposalAccount.owner !== programIdStr ||
    multisigAccount.owner !== programIdStr
  ) {
    return blockedApprove([
      'proposal or multisig account is not owned by the SSP multisig program',
    ]);
  }

  let proposal: ParsedVaultTransactionAccount;
  let multisigState: ParsedMultisigAccount;
  try {
    proposal = parseVaultTransactionAccount(proposalAccount.data);
    multisigState = parseMultisigAccount(multisigAccount.data);
  } catch (error) {
    return blockedApprove([
      `could not decode the on-chain proposal: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ]);
  }

  const multisigKey = new web3.PublicKey(multisigPda);
  if (!new web3.PublicKey(proposal.multisig).equals(multisigKey)) {
    reasons.push('the on-chain proposal belongs to a different multisig');
  }
  if (proposal.executed) {
    reasons.push('the on-chain proposal has already been executed');
  }
  const indexBytes = Buffer.alloc(8);
  indexBytes.writeBigUInt64LE(proposal.transactionIndex);
  const [canonicalProposal] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('transaction'), multisigKey.toBuffer(), indexBytes],
    programId,
  );
  if (canonicalProposal.toBase58() !== transactionPda) {
    reasons.push('the approve target is not the canonical proposal address');
  }

  const onChainMembers = multisigState.members.map((m) =>
    new web3.PublicKey(m).toBase58(),
  );
  if (
    !claimedMultisigMatches(
      sdk,
      web3,
      programId,
      { members: onChainMembers, threshold: multisigState.threshold },
      multisigPda,
    )
  ) {
    reasons.push('the multisig account does not match its own address');
  }
  if (claimed) {
    const sameMembers =
      claimed.members.length === onChainMembers.length &&
      [...claimed.members].sort().join(',') ===
        [...onChainMembers].sort().join(',');
    if (!sameMembers || claimed.threshold !== multisigState.threshold) {
      reasons.push(
        'the vault members or threshold in the request differ from the multisig on chain',
      );
    }
  }

  // Decode the stored message with the SDK decoder: wrap it in the
  // create_transaction instruction that carried it.
  let createDecoded: ReturnType<SolanaSdk['decodeVaultSolanaTransaction']>;
  try {
    const payer = new web3.PublicKey(proposal.payer);
    const ix = new web3.TransactionInstruction({
      programId,
      keys: [
        { pubkey: multisigKey, isSigner: false, isWritable: true },
        {
          pubkey: new web3.PublicKey(transactionPda),
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: new web3.PublicKey(proposal.creator),
          isSigner: true,
          isWritable: false,
        },
        { pubkey: payer, isSigner: true, isWritable: true },
        {
          pubkey: web3.SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
      ],
      data: Buffer.concat([
        Buffer.from(sdk.CREATE_TRANSACTION_DISCRIMINATOR),
        Buffer.from([proposal.vaultIndex]),
        proposal.messageBytes,
      ]),
    });
    const tx = new web3.Transaction();
    tx.feePayer = payer;
    tx.recentBlockhash = web3.PublicKey.default.toBase58();
    tx.add(ix);
    const wire = wireTransaction(tx.serializeMessage());
    createDecoded = sdk.decodeVaultSolanaTransaction(
      wire.toString('base64'),
      programId,
    );
  } catch (error) {
    return blockedApprove([
      ...reasons,
      `could not decode the on-chain proposal message: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ]);
  }
  if (createDecoded.kind !== 'create') {
    return blockedApprove([
      ...reasons,
      `could not decode the on-chain proposal message${
        createDecoded.kind === 'undecodable' ? `: ${createDecoded.error}` : ''
      }`,
    ]);
  }

  const verified = verifyCreate(
    sdk,
    web3,
    programId,
    chain,
    createDecoded,
    expected,
    transactionPda,
  );
  reasons.push(...verified.reasons);

  // The outer bytes: allowlist + bound to the proposal verified above.
  const outer = sdk.compareDecodedToExpected(decodedSol, {
    recipients: [],
    expectedTransactionPda: transactionPda,
    approveOnlyVerifiedOnChain: true,
  });
  reasons.push(...outer.mismatches);

  return {
    decoded: verified.decoded,
    mismatch: reasons.length > 0,
    mismatchReasons: reasons,
    kind: 'approve',
    members: onChainMembers,
    multisigPda,
  };
}

/**
 * Trustlessly decode a raw enterprise-vault Solana transaction (base64) and
 * compare it against the relay-supplied expected payload.
 *
 * NEVER throws — failures map to { kind: 'undecodable' } with the error
 * message carried in decoded.error (which blocks approval).
 */
export async function decodeVaultSolTransaction(
  rawUnsignedTxBase64: string,
  chain: keyof cryptos,
  expected: VaultSolExpectedPayload,
  options: VaultSolDecodeOptions = {},
): Promise<VaultSolDecodeResult> {
  try {
    // Dynamic import keeps the decoder off the hot path (same pattern as the
    // other solana libs). web3.js is dynamically imported alongside the
    // decoder so the heavy dependency stays off Home's static module path
    // entirely.
    const [sdk, web3] = await Promise.all([
      import('@runonflux/solana-multisig'),
      import('@solana/web3.js'),
    ]);
    const programIdStr = blockchains[chain]?.programId;
    if (!programIdStr) {
      throw new Error(`Chain ${String(chain)} has no programId in spec`);
    }
    const programId = new web3.PublicKey(programIdStr);
    // VD-4: the member set derived from the pinned descriptor replaces any
    // relay-supplied one.
    const binding = expected.vaultBinding;
    const claimed = binding
      ? parseClaimedMembers(web3, binding.members, binding.threshold)
      : parseClaimedMembers(web3, expected.members, expected.threshold);
    if (claimed === 'invalid') {
      return {
        decoded: { sender: '', recipients: [], fee: '0' },
        mismatch: true,
        mismatchReasons: ['the request names an invalid vault member set'],
        kind: 'create',
      };
    }

    const rawDecoded = sdk.decodeVaultSolanaTransaction(
      rawUnsignedTxBase64,
      programId,
    );

    if (rawDecoded.kind === 'undecodable') {
      return undecodable(rawDecoded.error);
    }

    // Mainnet bundles carry outer ComputeBudget instructions; tolerate them
    // only when the byte check verifies every one the decoder flagged.
    const budget = exemptOuterComputeBudget(
      web3,
      rawUnsignedTxBase64,
      rawDecoded,
    );
    const decodedSol = budget.decoded;

    if (decodedSol.kind === 'approve') {
      const approved = await verifyApproveOnChain(
        sdk,
        web3,
        programId,
        chain,
        decodedSol,
        expected,
        claimed,
        options.fetchAccounts ?? fetchSolAccounts,
      );
      return withReasons(approved, [
        ...budget.reasons,
        ...vaultBindingReasons(
          binding,
          decodedSol.multisigPda,
          approved.decoded.sender || undefined,
        ),
      ]);
    }

    // kind === 'create' — the bytes are authoritative.
    const verified = verifyCreate(
      sdk,
      web3,
      programId,
      chain,
      decodedSol,
      expected,
    );
    const reasons = [
      ...budget.reasons,
      ...verified.reasons,
      ...vaultBindingReasons(
        binding,
        decodedSol.multisigPda,
        decodedSol.sender,
      ),
    ];
    if (
      claimed &&
      !claimedMultisigMatches(
        sdk,
        web3,
        programId,
        claimed,
        decodedSol.multisigPda,
      )
    ) {
      reasons.push(
        `multisig ${decodedSol.multisigPda} is not the vault named by the request`,
      );
    }
    return {
      decoded: verified.decoded,
      mismatch: reasons.length > 0,
      mismatchReasons: reasons,
      kind: 'create',
      members: claimed?.members,
      multisigPda: decodedSol.multisigPda,
    };
  } catch (error) {
    return undecodable(
      error instanceof Error
        ? error.message
        : 'Failed to decode Solana vault transaction',
    );
  }
}

/** Minimal shape of the relay vault-signing payload the sol decode needs. */
export interface VaultSolSigningPayload {
  chain: string;
  rawUnsignedTx?: string;
  recipients?: Array<{ address: string; amount: string; label?: string }>;
  tokenContract?: string;
  /** Optional: the vault's multisig member leaves (base58). */
  solMembers?: unknown;
  /** Optional: the vault's multisig threshold. */
  solThreshold?: unknown;
}

export interface ApplyVaultSolDecodeOptions extends VaultSolDecodeOptions {
  /** Digest of the request being decoded (see vaultApprovalBinding). */
  requestDigest?: string;
  /** VD-4: multisig/vault derived from the pinned vault descriptor. */
  vaultBinding?: VaultSolBinding;
}

/**
 * Shared ingestion helper — decodes the raw bundle bytes, stores the
 * authoritative decode for display and the verdict that gates approval.
 * Relay-supplied values are never displayed in place of decoded ones: an
 * undecodable request shows nothing but its error. NEVER throws.
 */
export async function applyVaultSolDecode(
  data: VaultSolSigningPayload,
  setDecodedVaultTx: (tx: VaultDecodedTx) => void,
  setSolDecodeState: (state: VaultSolDecodeState) => void,
  options: ApplyVaultSolDecodeOptions = {},
): Promise<void> {
  const payloadRecipients = Array.isArray(data.recipients)
    ? data.recipients.map((r) => ({ address: r.address, amount: r.amount }))
    : [];

  const result = await decodeVaultSolTransaction(
    typeof data.rawUnsignedTx === 'string' ? data.rawUnsignedTx : '',
    data.chain as keyof cryptos,
    {
      recipients: payloadRecipients,
      tokenMint:
        typeof data.tokenContract === 'string' && data.tokenContract
          ? data.tokenContract
          : undefined,
      members: data.solMembers as string[] | undefined,
      threshold: data.solThreshold as number | undefined,
      vaultBinding: options.vaultBinding,
    },
    { fetchAccounts: options.fetchAccounts },
  );

  setDecodedVaultTx(result.decoded);
  setSolDecodeState({
    mismatch: result.mismatch,
    mismatchReasons: result.mismatchReasons,
    kind: result.kind,
    requestDigest: options.requestDigest,
    members: result.members,
    multisigPda: result.multisigPda,
  });
}
