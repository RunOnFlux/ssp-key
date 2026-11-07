/**
 * Consumer 2-of-2 Solana decode for the SSP Key (C-3 / SOL-1 / CHN-1,
 * H-3 / CHN-2, CHN-7).
 *
 * The key partial-signs the whole serialized transaction, so it must be able
 * to say what EVERY instruction in it does. This decoder is a positive
 * allowlist bound to the key's own vault:
 *
 *  - program id pinned from the key's local chain spec;
 *  - multisig PDA and vault PDA derived on-device from the two leaf pubkeys
 *    (wallet leaf from the stored wallet pubkey list, own leaf);
 *  - outer instructions: optional nonce advance (first, paymaster authority,
 *    this multisig's nonce account), capped ComputeBudget, at most one
 *    recipient ATA createIdempotent funded by the fee payer, exactly one
 *    create_transaction on this multisig, and approve / execute / close only
 *    for the proposal that create makes;
 *  - inner (proposal) instructions: System Transfer and SPL TransferChecked
 *    out of the vault, and an account-less Memo. Legacy SPL Transfer (tag 3),
 *    Token-2022 and anything else is refused;
 *  - the vault → fee-payer reimbursement is capped.
 *
 * Anything outside that throws; callers treat a throw as "cannot be
 * approved". The signing path re-runs the same decode on the exact bytes it
 * signs.
 */
import BigNumber from 'bignumber.js';
import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  APPROVE_TRANSACTION_DISCRIMINATOR,
  ATA_PROGRAM_ID,
  CLOSE_TRANSACTION_DISCRIMINATOR,
  CREATE_TRANSACTION_DISCRIMINATOR,
  EXECUTE_TRANSACTION_DISCRIMINATOR,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  deriveAssociatedTokenAddress,
  deriveMultisigAddress,
  deriveNonceAccount,
  deriveVaultAddress,
} from '@runonflux/solana-multisig';
import { blockchains } from '@storage/blockchains';
import {
  CONSUMER_SOL_MAX_FEE_LAMPORTS,
  maxConsumerFee,
  parseConsumerDerivationPath,
} from './consumerGuards';
import type { cryptos } from '../types';

const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey(
  'ComputeBudget111111111111111111111111111111',
);
const MEMO_PROGRAM_ID = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
);

/** SSP Wallet requests 200k CU; anything far above that is not ours. */
export const CONSUMER_SOL_MAX_COMPUTE_UNITS = 400_000;
/** SSP Wallet sets 50k micro-lamports on mainnet; allow generous headroom. */
export const CONSUMER_SOL_MAX_CU_PRICE_MICROLAMPORTS = 5_000_000n;
const MAX_MEMO_BYTES = 566;

const SYSTEM_TRANSFER_TAG = 2;
const SYSTEM_NONCE_ADVANCE_TAG = 4;
const SPL_TRANSFER_TAG = 3;
const SPL_TRANSFER_CHECKED_TAG = 12;
const ATA_CREATE_IDEMPOTENT_TAG = 1;
const COMPUTE_UNIT_LIMIT_TAG = 2;
const COMPUTE_UNIT_PRICE_TAG = 3;

export interface ConsumerSolanaPayload {
  serializedTxBase64: string;
  /** Wallet-supplied mint hint (legacy field). Must match the bytes. */
  tokenMint?: string;
  /** Wallet-supplied decimals hint. Must match the bytes. */
  tokenDecimals?: number;
  /** H-3: recipient OWNER the user typed (SPL sends). */
  splRecipientOwner?: string;
  /** H-3: SPL mint the wallet built the send for. */
  splMint?: string;
}

/**
 * Unwrap the consumer Solana request. Newer wallets send JSON
 * `{ unsignedTxBase64, tokenMint, tokenSymbol, tokenDecimals,
 * splRecipientOwner, splMint }`; older ones a bare base64 string. The
 * wallet-supplied symbol is deliberately ignored.
 */
export function parseConsumerSolanaPayload(raw: string): ConsumerSolanaPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { serializedTxBase64: raw };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { serializedTxBase64: raw };
  }
  const p = parsed as Record<string, unknown>;
  if (typeof p.unsignedTxBase64 !== 'string') {
    throw new Error('Solana request is missing the transaction');
  }
  const optionalString = (value: unknown, field: string) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw new Error(`Invalid ${field}`);
    }
    return value;
  };
  let tokenDecimals: number | undefined;
  if (p.tokenDecimals !== undefined && p.tokenDecimals !== null) {
    if (
      typeof p.tokenDecimals !== 'number' ||
      !Number.isInteger(p.tokenDecimals)
    ) {
      throw new Error('Invalid tokenDecimals');
    }
    tokenDecimals = p.tokenDecimals;
  }
  return {
    serializedTxBase64: p.unsignedTxBase64,
    tokenMint: optionalString(p.tokenMint, 'tokenMint'),
    tokenDecimals,
    splRecipientOwner: optionalString(p.splRecipientOwner, 'splRecipientOwner'),
    splMint: optionalString(p.splMint, 'splMint'),
  };
}

export interface ConsumerSolanaLeaves {
  walletLeaf: string;
  keyLeaf: string;
}

/**
 * Resolve both leaf pubkeys for a consumer path from the stored pubkey lists
 * (Solana "xpubs" are JSON arrays of 20 base58 ed25519 leaves).
 */
export function resolveConsumerSolanaLeaves(
  xpubWallet: string,
  xpubKey: string,
  path: string,
): ConsumerSolanaLeaves {
  const { typeIndex, addressIndex } = parseConsumerDerivationPath(path);
  if (typeIndex !== 0) {
    throw new Error('Solana consumer requests use branch 0 only');
  }
  let walletLeaves: unknown;
  let keyLeaves: unknown;
  try {
    walletLeaves = JSON.parse(xpubWallet);
    keyLeaves = JSON.parse(xpubKey);
  } catch {
    throw new Error('Solana pubkey lists are malformed');
  }
  if (
    !Array.isArray(walletLeaves) ||
    !Array.isArray(keyLeaves) ||
    walletLeaves.length !== 20 ||
    keyLeaves.length !== 20
  ) {
    throw new Error('Solana pubkey lists are malformed');
  }
  if (addressIndex >= 20) {
    throw new Error('Solana address index out of range');
  }
  const walletLeaf = walletLeaves[addressIndex];
  const keyLeaf = keyLeaves[addressIndex];
  if (typeof walletLeaf !== 'string' || typeof keyLeaf !== 'string') {
    throw new Error('Solana pubkey lists are malformed');
  }
  // Validates base58 / length.
  new PublicKey(walletLeaf);
  new PublicKey(keyLeaf);
  if (walletLeaf === keyLeaf) {
    throw new Error('Wallet and key leaves must differ');
  }
  return { walletLeaf, keyLeaf };
}

export interface ConsumerSolanaRecipient {
  /** Recipient OWNER when verified (SPL) or the native destination. */
  address: string;
  /** SPL only: the destination token account. */
  ata?: string;
  /** SPL only: ATA derivation from the wallet-supplied owner matched. */
  ownerVerified?: boolean;
  /** Base units. */
  amount: string;
}

export type ConsumerSolanaWarning = 'spl_owner_unverified' | 'unknown_token';

export interface ConsumerSolanaDecoded {
  /** Vault PDA derived from the two leaves. */
  sender: string;
  multisigPda: string;
  transactionPda: string;
  feePayer: string;
  asset: 'native' | 'spl';
  /** SPL only. */
  mint?: string;
  /** Native decimals, or the decimals byte of TransferChecked. */
  decimals: number;
  /** Native symbol, the key's own token-list symbol, or '' when unknown. */
  tokenSymbol: string;
  recipients: ConsumerSolanaRecipient[];
  /** Vault → fee-payer reimbursement, lamports. */
  feeLamports: string;
  maxFeeLamports: string;
  memo?: string;
  warnings: ConsumerSolanaWarning[];
}

function bytesEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function discriminatorOf(data: Buffer): Buffer {
  return data.subarray(0, 8);
}

class StrictReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}
  private ensure(n: number) {
    if (this.offset + n > this.buf.length) {
      throw new Error('Proposal message is truncated');
    }
  }
  u8(): number {
    this.ensure(1);
    const v = this.buf[this.offset];
    this.offset += 1;
    return v;
  }
  u32(): number {
    this.ensure(4);
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }
  bytes(n: number): Buffer {
    this.ensure(n);
    const v = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return Buffer.from(v);
  }
  done(): boolean {
    return this.offset === this.buf.length;
  }
}

interface InnerInstruction {
  program: PublicKey;
  accounts: PublicKey[];
  data: Buffer;
}

function parseCreateMessage(data: Buffer): {
  vaultIndex: number;
  numSigners: number;
  accountKeys: PublicKey[];
  instructions: InnerInstruction[];
} {
  const reader = new StrictReader(data);
  reader.bytes(8); // discriminator, matched by the caller
  const vaultIndex = reader.u8();
  const numSigners = reader.u8();
  reader.u8(); // num_writable_signers
  reader.u8(); // num_writable_non_signers
  const keyCount = reader.u32();
  if (keyCount === 0 || keyCount > 64) {
    throw new Error('Proposal message has an invalid key count');
  }
  const accountKeys: PublicKey[] = [];
  for (let i = 0; i < keyCount; i += 1) {
    accountKeys.push(new PublicKey(reader.bytes(32)));
  }
  const ixCount = reader.u32();
  if (ixCount === 0 || ixCount > 16) {
    throw new Error('Proposal message has an invalid instruction count');
  }
  const resolve = (index: number) => {
    const key = accountKeys[index];
    if (!key) {
      throw new Error('Proposal instruction references an unknown account');
    }
    return key;
  };
  const instructions: InnerInstruction[] = [];
  for (let i = 0; i < ixCount; i += 1) {
    const program = resolve(reader.u8());
    const accountLen = reader.u32();
    const accountIdx = Array.from(reader.bytes(accountLen));
    const dataLen = reader.u32();
    const ixData = reader.bytes(dataLen);
    instructions.push({
      program,
      accounts: accountIdx.map(resolve),
      data: ixData,
    });
  }
  const lookupCount = reader.u32();
  if (lookupCount !== 0) {
    throw new Error('Address lookup tables are not supported');
  }
  if (!reader.done()) {
    throw new Error('Proposal message has trailing bytes');
  }
  return { vaultIndex, numSigners, accountKeys, instructions };
}

function lookupKeyToken(
  chain: keyof cryptos,
  mint: string,
): { symbol: string; decimals: number } | null {
  const tokens = blockchains[chain].tokens;
  if (!Array.isArray(tokens)) return null;
  const found = tokens.find((t) => t.contract && t.contract === mint);
  if (!found || !found.symbol || typeof found.decimals !== 'number') {
    return null;
  }
  return { symbol: found.symbol, decimals: found.decimals };
}

/**
 * Strict, fail-closed decode of a consumer Solana bundle. Throws on anything
 * that is not exactly an SSP consumer send from this key's own vault.
 */
export async function decodeConsumerSolanaTransaction(
  chain: keyof cryptos,
  payload: ConsumerSolanaPayload,
  leaves: ConsumerSolanaLeaves,
  usdRate?: number,
): Promise<ConsumerSolanaDecoded> {
  const config = blockchains[chain];
  if (config.chainType !== 'sol' || !config.programId) {
    throw new Error('Not a Solana chain');
  }
  const programId = new PublicKey(config.programId);
  const walletLeaf = new PublicKey(leaves.walletLeaf);
  const keyLeaf = new PublicKey(leaves.keyLeaf);
  const [multisigPda] = deriveMultisigAddress(
    [walletLeaf, keyLeaf],
    2,
    programId,
  );
  const [vaultPda] = deriveVaultAddress(multisigPda, 0, programId);
  const nonceAccount = await deriveNonceAccount(multisigPda);
  const isMember = (key: PublicKey) =>
    key.equals(walletLeaf) || key.equals(keyLeaf);

  const raw = Buffer.from(payload.serializedTxBase64, 'base64');
  if (!raw.length) {
    throw new Error('Empty Solana transaction');
  }
  const tx = Transaction.from(raw);
  if (!tx.feePayer) {
    throw new Error('Solana transaction has no fee payer');
  }
  const feePayer = tx.feePayer;
  if (
    isMember(feePayer) ||
    feePayer.equals(vaultPda) ||
    feePayer.equals(multisigPda)
  ) {
    throw new Error('Unexpected Solana fee payer');
  }

  let sawComputeLimit = false;
  let sawComputePrice = false;
  let ataCreate:
    | { ata: PublicKey; owner: PublicKey; mint: PublicKey }
    | undefined;
  let create:
    | {
        transactionPda: PublicKey;
        message: ReturnType<typeof parseCreateMessage>;
      }
    | undefined;
  const approveTargets: PublicKey[] = [];
  const approvers: PublicKey[] = [];
  const otherTargets: PublicKey[] = [];
  let sawExecute = false;
  let sawClose = false;

  tx.instructions.forEach((ix, index) => {
    const data = Buffer.from(ix.data);
    const keys = ix.keys.map((k) => k.pubkey);
    const pid = ix.programId;
    if (pid.equals(SystemProgram.programId)) {
      if (
        index === 0 &&
        data.length === 4 &&
        data.readUInt32LE(0) === SYSTEM_NONCE_ADVANCE_TAG &&
        keys.length === 3 &&
        keys[0].equals(nonceAccount) &&
        keys[2].equals(feePayer)
      ) {
        return;
      }
      throw new Error('Unexpected System instruction in the transaction');
    }
    if (pid.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
      if (keys.length !== 0) {
        throw new Error('Unexpected ComputeBudget accounts');
      }
      if (
        data.length === 5 &&
        data[0] === COMPUTE_UNIT_LIMIT_TAG &&
        !sawComputeLimit
      ) {
        sawComputeLimit = true;
        if (data.readUInt32LE(1) > CONSUMER_SOL_MAX_COMPUTE_UNITS) {
          throw new Error('Compute unit limit is above the allowed maximum');
        }
        return;
      }
      if (
        data.length === 9 &&
        data[0] === COMPUTE_UNIT_PRICE_TAG &&
        !sawComputePrice
      ) {
        sawComputePrice = true;
        if (data.readBigUInt64LE(1) > CONSUMER_SOL_MAX_CU_PRICE_MICROLAMPORTS) {
          throw new Error('Compute unit price is above the allowed maximum');
        }
        return;
      }
      throw new Error('Unexpected ComputeBudget instruction');
    }
    if (pid.equals(ATA_PROGRAM_ID)) {
      if (
        ataCreate ||
        data.length !== 1 ||
        data[0] !== ATA_CREATE_IDEMPOTENT_TAG ||
        keys.length !== 6 ||
        !keys[0].equals(feePayer) ||
        !keys[4].equals(SystemProgram.programId) ||
        !keys[5].equals(TOKEN_PROGRAM_ID)
      ) {
        throw new Error('Unexpected token-account instruction');
      }
      const [ata, owner, mint] = [keys[1], keys[2], keys[3]];
      if (
        !deriveAssociatedTokenAddress(owner, mint, TOKEN_PROGRAM_ID).equals(ata)
      ) {
        throw new Error('Token account does not match its owner and mint');
      }
      ataCreate = { ata, owner, mint };
      return;
    }
    if (pid.equals(programId)) {
      if (data.length < 8 || keys.length < 3 || !keys[0].equals(multisigPda)) {
        throw new Error('Multisig instruction for a different vault');
      }
      const disc = discriminatorOf(data);
      // approve / execute / close carry exactly one u64 transaction_index.
      const indexOnly = data.length === 16;
      if (bytesEqual(disc, CREATE_TRANSACTION_DISCRIMINATOR)) {
        if (create) {
          throw new Error('More than one proposal in the transaction');
        }
        if (
          keys.length !== 5 ||
          !isMember(keys[2]) ||
          !keys[3].equals(feePayer) ||
          !keys[4].equals(SystemProgram.programId)
        ) {
          throw new Error('Unexpected proposal accounts');
        }
        create = { transactionPda: keys[1], message: parseCreateMessage(data) };
        return;
      }
      if (bytesEqual(disc, APPROVE_TRANSACTION_DISCRIMINATOR)) {
        if (!indexOnly || keys.length !== 3 || !isMember(keys[2])) {
          throw new Error('Unexpected approval accounts');
        }
        if (approvers.some((a) => a.equals(keys[2]))) {
          throw new Error('Duplicate approval');
        }
        approvers.push(keys[2]);
        approveTargets.push(keys[1]);
        return;
      }
      if (bytesEqual(disc, EXECUTE_TRANSACTION_DISCRIMINATOR)) {
        if (
          sawExecute ||
          !indexOnly ||
          !(isMember(keys[2]) || keys[2].equals(feePayer))
        ) {
          throw new Error('Unexpected execute instruction');
        }
        sawExecute = true;
        otherTargets.push(keys[1]);
        return;
      }
      if (bytesEqual(disc, CLOSE_TRANSACTION_DISCRIMINATOR)) {
        if (
          sawClose ||
          !indexOnly ||
          keys.length !== 3 ||
          !keys[2].equals(feePayer)
        ) {
          throw new Error('Unexpected close instruction');
        }
        sawClose = true;
        otherTargets.push(keys[1]);
        return;
      }
      throw new Error('Unexpected multisig instruction');
    }
    throw new Error(`Unexpected program ${pid.toBase58()} in the transaction`);
  });

  if (!create) {
    throw new Error('Transaction does not create a proposal');
  }
  const proposalPda = create.transactionPda;
  [...approveTargets, ...otherTargets].forEach((target) => {
    if (!target.equals(proposalPda)) {
      throw new Error('Instruction targets a different proposal');
    }
  });
  if (!approvers.some((a) => a.equals(keyLeaf))) {
    throw new Error('Transaction does not ask this key to approve');
  }

  const message = create.message;
  if (message.vaultIndex !== 0 || message.numSigners !== 1) {
    throw new Error('Proposal is not a single-vault proposal');
  }
  if (!message.accountKeys[0].equals(vaultPda)) {
    throw new Error('Proposal does not spend from this wallet vault');
  }

  const recipients: ConsumerSolanaRecipient[] = [];
  const splDestinations: PublicKey[] = [];
  let feeLamports = 0n;
  let sawNative = false;
  let mint: PublicKey | undefined;
  let splDecimals: number | undefined;
  let memo: string | undefined;

  message.instructions.forEach((inner) => {
    const { program, accounts, data } = inner;
    if (program.equals(SystemProgram.programId)) {
      if (
        data.length !== 12 ||
        data.readUInt32LE(0) !== SYSTEM_TRANSFER_TAG ||
        accounts.length !== 2 ||
        !accounts[0].equals(vaultPda)
      ) {
        throw new Error('Unexpected System instruction in the proposal');
      }
      const amount = data.readBigUInt64LE(4);
      if (accounts[1].equals(feePayer)) {
        feeLamports += amount;
        return;
      }
      sawNative = true;
      recipients.push({
        address: accounts[1].toBase58(),
        amount: amount.toString(),
      });
      return;
    }
    if (program.equals(TOKEN_PROGRAM_ID)) {
      if (data.length >= 1 && data[0] === SPL_TRANSFER_TAG) {
        throw new Error('Legacy SPL Transfer is not accepted');
      }
      if (
        data.length !== 10 ||
        data[0] !== SPL_TRANSFER_CHECKED_TAG ||
        accounts.length !== 4
      ) {
        throw new Error('Unexpected token instruction in the proposal');
      }
      const [source, ixMint, dest, authority] = accounts;
      if (!authority.equals(vaultPda)) {
        throw new Error('Token transfer is not authorised by this vault');
      }
      if (
        !deriveAssociatedTokenAddress(
          vaultPda,
          ixMint,
          TOKEN_PROGRAM_ID,
        ).equals(source)
      ) {
        throw new Error('Token transfer does not spend from this vault');
      }
      if (mint && !mint.equals(ixMint)) {
        throw new Error('Proposal mixes token mints');
      }
      const decimals = data[9];
      if (splDecimals !== undefined && splDecimals !== decimals) {
        throw new Error('Proposal mixes token decimals');
      }
      mint = ixMint;
      splDecimals = decimals;
      splDestinations.push(dest);
      recipients.push({
        address: dest.toBase58(),
        ata: dest.toBase58(),
        ownerVerified: false,
        amount: data.readBigUInt64LE(1).toString(),
      });
      return;
    }
    if (program.equals(TOKEN_2022_PROGRAM_ID)) {
      throw new Error('Token-2022 instructions are not supported');
    }
    if (program.equals(MEMO_PROGRAM_ID)) {
      if (memo !== undefined || accounts.length !== 0) {
        throw new Error('Unexpected memo instruction');
      }
      if (data.length > MAX_MEMO_BYTES) {
        throw new Error('Memo is too long');
      }
      const text = data.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(data)) {
        throw new Error('Memo is not valid UTF-8');
      }
      memo = text;
      return;
    }
    throw new Error(`Unexpected program ${program.toBase58()} in the proposal`);
  });

  if (!recipients.length) {
    throw new Error('Proposal has no recipient');
  }
  if (sawNative && mint) {
    throw new Error('Proposal mixes native SOL and token transfers');
  }

  // CHN-7: bounded paymaster reimbursement.
  const maxFee = maxConsumerFee(
    CONSUMER_SOL_MAX_FEE_LAMPORTS,
    config.decimals,
    usdRate,
  );
  if (new BigNumber(feeLamports.toString()).isGreaterThan(maxFee)) {
    throw new Error(
      `Paymaster fee ${feeLamports.toString()} lamports exceeds the maximum of ${maxFee.toFixed()}`,
    );
  }

  const warnings: ConsumerSolanaWarning[] = [];
  let tokenSymbol = config.symbol;
  let decimals = config.decimals;

  if (mint) {
    const mintBase58 = mint.toBase58();
    for (const hint of [payload.splMint, payload.tokenMint]) {
      if (hint !== undefined && hint !== mintBase58) {
        throw new Error('Token mint does not match the signed transaction');
      }
    }
    if (
      payload.tokenDecimals !== undefined &&
      payload.tokenDecimals !== splDecimals
    ) {
      throw new Error('Token decimals do not match the signed transaction');
    }
    decimals = splDecimals as number;
    const known = lookupKeyToken(chain, mintBase58);
    if (known) {
      if (known.decimals !== decimals) {
        throw new Error('Token decimals differ from this device token list');
      }
      tokenSymbol = known.symbol;
    } else {
      tokenSymbol = '';
      warnings.push('unknown_token');
    }
    // H-3: bind the destination token account to the owner the user typed.
    if (payload.splRecipientOwner !== undefined) {
      const owner = new PublicKey(payload.splRecipientOwner);
      const expectedAta = deriveAssociatedTokenAddress(
        owner,
        mint,
        TOKEN_PROGRAM_ID,
      );
      recipients.forEach((r) => {
        if (r.ata !== expectedAta.toBase58()) {
          throw new Error(
            'Token account does not belong to the requested recipient',
          );
        }
        r.address = owner.toBase58();
        r.ownerVerified = true;
      });
    } else {
      warnings.push('spl_owner_unverified');
    }
  } else if (payload.splRecipientOwner !== undefined || payload.splMint) {
    throw new Error('Token send metadata on a native transfer');
  }

  if (ataCreate) {
    const created = ataCreate;
    if (
      !mint ||
      !created.mint.equals(mint) ||
      !splDestinations.some((d) => d.equals(created.ata))
    ) {
      throw new Error('Token account creation does not match the transfer');
    }
    if (
      payload.splRecipientOwner !== undefined &&
      created.owner.toBase58() !== payload.splRecipientOwner
    ) {
      throw new Error('Token account creation is for a different owner');
    }
  }

  return {
    sender: vaultPda.toBase58(),
    multisigPda: multisigPda.toBase58(),
    transactionPda: proposalPda.toBase58(),
    feePayer: feePayer.toBase58(),
    asset: mint ? 'spl' : 'native',
    mint: mint?.toBase58(),
    decimals,
    tokenSymbol,
    recipients,
    feeLamports: feeLamports.toString(),
    maxFeeLamports: maxFee.toFixed(),
    memo,
    warnings,
  };
}
