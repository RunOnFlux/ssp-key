import { Buffer } from 'buffer';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

import {
  CREATE_TRANSACTION_DISCRIMINATOR,
  APPROVE_TRANSACTION_DISCRIMINATOR,
  TOKEN_PROGRAM_ID,
  deriveAssociatedTokenAddress,
  decodeVaultSolanaTransaction,
  compareDecodedToExpected,
} from '@runonflux/solana-multisig';
import { decodeVaultSolTransaction } from '../../src/lib/vaultSolanaDecode';
import { blockchains } from '../../src/storage/blockchains';

// Must match the chain spec the wrapper resolves the program id from.
const PROGRAM_ID = new PublicKey(blockchains.solDevnet.programId);
const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';

// Deterministic-ish fixture keys
const paymaster = Keypair.generate().publicKey;
const nonceAccount = Keypair.generate().publicKey;
const vaultPda = Keypair.generate().publicKey;
const multisigPda = Keypair.generate().publicKey;
const transactionPda = Keypair.generate().publicKey;
const creator = Keypair.generate().publicKey;
const member = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const recipientB = Keypair.generate().publicKey;
const attacker = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;

// ---------------------------------------------------------------------------
// Fixture builders — compose bundles exactly like the relay builder:
// Transaction().add(nonceAdvance, [ataCreate], create, approve×n, ...) with
// feePayer = paymaster, then serialize unsigned.
// ---------------------------------------------------------------------------

interface InnerIx {
  programIdIndex: number;
  accountIndexes: number[];
  data: Buffer;
}

function serializeCreateData(
  vaultIndex: number,
  accountKeys: PublicKey[],
  instructions: InnerIx[],
): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from(CREATE_TRANSACTION_DISCRIMINATOR));
  // vault_index, num_signers, num_writable_signers, num_writable_non_signers
  parts.push(Buffer.from([vaultIndex, 1, 1, 1]));
  const keyCount = Buffer.alloc(4);
  keyCount.writeUInt32LE(accountKeys.length, 0);
  parts.push(keyCount);
  for (const k of accountKeys) {
    parts.push(k.toBuffer());
  }
  const ixCount = Buffer.alloc(4);
  ixCount.writeUInt32LE(instructions.length, 0);
  parts.push(ixCount);
  for (const ix of instructions) {
    parts.push(Buffer.from([ix.programIdIndex]));
    const accLen = Buffer.alloc(4);
    accLen.writeUInt32LE(ix.accountIndexes.length, 0);
    parts.push(accLen, Buffer.from(ix.accountIndexes));
    const dataLen = Buffer.alloc(4);
    dataLen.writeUInt32LE(ix.data.length, 0);
    parts.push(dataLen, ix.data);
  }
  parts.push(Buffer.alloc(4)); // 0 address_table_lookups
  return Buffer.concat(parts);
}

function systemTransferData(lamports: bigint): Buffer {
  const d = Buffer.alloc(12);
  d.writeUInt32LE(2, 0); // SystemProgram transfer tag
  d.writeBigUInt64LE(lamports, 4);
  return d;
}

function splTransferCheckedData(amount: bigint, decimals: number): Buffer {
  const d = Buffer.alloc(10);
  d[0] = 12; // TransferChecked tag
  d.writeBigUInt64LE(amount, 1);
  d[9] = decimals;
  return d;
}

function makeCreateIx(data: Buffer): TransactionInstruction {
  // Account order per IDL: multisig, transaction, creator, payer, systemProgram
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: multisigPda, isSigner: false, isWritable: true },
      { pubkey: transactionPda, isSigner: false, isWritable: true },
      { pubkey: creator, isSigner: true, isWritable: false },
      { pubkey: paymaster, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function makeApproveIx(approver: PublicKey): TransactionInstruction {
  // Account order per IDL: multisig, transaction, member
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: multisigPda, isSigner: false, isWritable: true },
      { pubkey: transactionPda, isSigner: false, isWritable: true },
      { pubkey: approver, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(APPROVE_TRANSACTION_DISCRIMINATOR),
  });
}

function makeNonceAdvanceIx(): TransactionInstruction {
  return SystemProgram.nonceAdvance({
    noncePubkey: nonceAccount,
    authorizedPubkey: paymaster,
  });
}

function buildBundle(ixs: TransactionInstruction[]): string {
  const tx = new Transaction();
  tx.recentBlockhash = BLOCKHASH;
  tx.feePayer = paymaster;
  tx.add(...ixs);
  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');
}

/** Native SOL bundle: vault → recipient + vault → paymaster (fee). */
function buildNativeBundle(
  lamports: bigint,
  feeLamports: bigint,
  dest: PublicKey = recipient,
): string {
  const accountKeys = [vaultPda, dest, paymaster, SystemProgram.programId];
  const createData = serializeCreateData(0, accountKeys, [
    {
      programIdIndex: 3,
      accountIndexes: [0, 1],
      data: systemTransferData(lamports),
    },
    {
      programIdIndex: 3,
      accountIndexes: [0, 2],
      data: systemTransferData(feeLamports),
    },
  ]);
  return buildBundle([
    makeNonceAdvanceIx(),
    makeCreateIx(createData),
    makeApproveIx(member),
  ]);
}

/** SPL TransferChecked bundle: vault ATA → owner's ATA. */
function buildSplBundle(
  owner: PublicKey,
  amount: bigint,
  decimals: number,
): string {
  const sourceAta = deriveAssociatedTokenAddress(vaultPda, mint);
  const destAta = deriveAssociatedTokenAddress(owner, mint);
  const accountKeys = [vaultPda, sourceAta, mint, destAta, TOKEN_PROGRAM_ID];
  const createData = serializeCreateData(0, accountKeys, [
    {
      programIdIndex: 4,
      accountIndexes: [1, 2, 3, 0], // source, mint, dest, authority
      data: splTransferCheckedData(amount, decimals),
    },
  ]);
  return buildBundle([
    makeNonceAdvanceIx(),
    makeCreateIx(createData),
    makeApproveIx(member),
  ]);
}

/** SPL TransferChecked bundle paying TWO different owners' ATAs. */
function buildMultiSplBundle(
  owners: [PublicKey, PublicKey],
  amounts: [bigint, bigint],
  decimals: number,
): string {
  const sourceAta = deriveAssociatedTokenAddress(vaultPda, mint);
  const destAtaA = deriveAssociatedTokenAddress(owners[0], mint);
  const destAtaB = deriveAssociatedTokenAddress(owners[1], mint);
  const accountKeys = [
    vaultPda,
    sourceAta,
    mint,
    destAtaA,
    destAtaB,
    TOKEN_PROGRAM_ID,
  ];
  const createData = serializeCreateData(0, accountKeys, [
    {
      programIdIndex: 5,
      accountIndexes: [1, 2, 3, 0], // source, mint, dest, authority
      data: splTransferCheckedData(amounts[0], decimals),
    },
    {
      programIdIndex: 5,
      accountIndexes: [1, 2, 4, 0], // source, mint, dest, authority
      data: splTransferCheckedData(amounts[1], decimals),
    },
  ]);
  return buildBundle([
    makeNonceAdvanceIx(),
    makeCreateIx(createData),
    makeApproveIx(member),
  ]);
}

// ---------------------------------------------------------------------------
// decodeVaultSolTransaction (wrapper) — the state Home.tsx gates approval on
// ---------------------------------------------------------------------------

describe('decodeVaultSolTransaction', () => {
  test('native SOL bundle decodes to create with matching payload (no mismatch)', async () => {
    const bundle = buildNativeBundle(5000000000n, 5000n);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: recipient.toBase58(), amount: '5000000000' }],
    });
    expect(result.kind).toBe('create');
    expect(result.mismatch).toBe(false);
    expect(result.mismatchReasons).toEqual([]);
    expect(result.decoded.sender).toBe(vaultPda.toBase58());
    expect(result.decoded.recipients).toEqual([
      { address: recipient.toBase58(), amount: '5000000000' },
    ]);
    expect(result.decoded.fee).toBe('5000'); // paymaster transfer = fee
    expect(result.decoded.error).toBeUndefined();
    expect(result.decoded.tokenContract).toBeUndefined(); // native
  });

  test('SPL TransferChecked bundle verifies the recipient ATA against the expected owner', async () => {
    const owner = recipient;
    const bundle = buildSplBundle(owner, 1000000n, 6);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: owner.toBase58(), amount: '1000000' }],
      tokenMint: mint.toBase58(),
      tokenSymbol: 'USDC',
      tokenDecimals: 6,
    });
    expect(result.kind).toBe('create');
    expect(result.mismatch).toBe(false);
    // ATA verified → address resolved to the owner
    expect(result.decoded.recipients).toEqual([
      { address: owner.toBase58(), amount: '1000000' },
    ]);
    expect(result.decoded.tokenContract).toBe(mint.toBase58());
    expect(result.decoded.tokenDecimals).toBe(6); // decimals from bytes
    expect(result.decoded.tokenSymbol).toBe('USDC');
  });

  test('SPL TransferChecked bundle with TWO recipient owners resolves BOTH ATAs to owners (no mismatch)', async () => {
    const ownerA = recipient;
    const ownerB = recipientB;
    const bundle = buildMultiSplBundle(
      [ownerA, ownerB],
      [1000000n, 2500000n],
      6,
    );
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [
        { address: ownerA.toBase58(), amount: '1000000' },
        { address: ownerB.toBase58(), amount: '2500000' },
      ],
      tokenMint: mint.toBase58(),
      tokenSymbol: 'USDC',
      tokenDecimals: 6,
    });
    expect(result.kind).toBe('create');
    expect(result.mismatch).toBe(false);
    expect(result.mismatchReasons).toEqual([]);
    // BOTH ATAs verified → addresses resolved to the owners, not the ATAs
    expect(result.decoded.recipients).toEqual([
      { address: ownerA.toBase58(), amount: '1000000' },
      { address: ownerB.toBase58(), amount: '2500000' },
    ]);
    const decodedAddresses = result.decoded.recipients.map((r) => r.address);
    expect(decodedAddresses).not.toContain(
      deriveAssociatedTokenAddress(ownerA, mint).toBase58(),
    );
    expect(decodedAddresses).not.toContain(
      deriveAssociatedTokenAddress(ownerB, mint).toBase58(),
    );
    expect(result.decoded.tokenContract).toBe(mint.toBase58());
    expect(result.decoded.tokenDecimals).toBe(6);
    expect(result.decoded.tokenSymbol).toBe('USDC');
  });

  test('SPL bundle paying a DIFFERENT owner than expected → mismatch (hard-block state)', async () => {
    const bundle = buildSplBundle(attacker, 1000000n, 6);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: recipient.toBase58(), amount: '1000000' }],
      tokenMint: mint.toBase58(),
      tokenSymbol: 'USDC',
      tokenDecimals: 6,
    });
    expect(result.kind).toBe('create');
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.length).toBeGreaterThan(0);
  });

  test('tampered native recipient (bytes pay attacker, payload claims legit) → mismatch', async () => {
    const bundle = buildNativeBundle(5000000000n, 5000n, attacker);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: recipient.toBase58(), amount: '5000000000' }],
    });
    expect(result.kind).toBe('create');
    expect(result.mismatch).toBe(true);
    expect(
      result.mismatchReasons.some((r) => r.includes(recipient.toBase58())),
    ).toBe(true);
    expect(
      result.mismatchReasons.some((r) => r.includes(attacker.toBase58())),
    ).toBe(true);
  });

  test('tampered amount (bytes move more than payload claims) → mismatch', async () => {
    const bundle = buildNativeBundle(9000000000n, 5000n);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: recipient.toBase58(), amount: '5000000000' }],
    });
    expect(result.kind).toBe('create');
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.length).toBeGreaterThan(0);
  });

  test('approve-only tx (nonceAdvance + approve) → kind approve, payload recipients displayed', async () => {
    const bundle = buildBundle([makeNonceAdvanceIx(), makeApproveIx(member)]);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: recipient.toBase58(), amount: '5000000000' }],
    });
    expect(result.kind).toBe('approve');
    expect(result.mismatch).toBe(false);
    // Amounts are not verifiable from approve bytes — proposal record shown
    expect(result.decoded.recipients).toEqual([
      { address: recipient.toBase58(), amount: '5000000000' },
    ]);
  });

  test('foreign outer instruction (leaf-key drain attempt) → mismatch', async () => {
    const drainIx = SystemProgram.transfer({
      fromPubkey: member,
      toPubkey: attacker,
      lamports: 123456789,
    });
    const bundle = buildBundle([
      makeNonceAdvanceIx(),
      makeApproveIx(member),
      drainIx,
    ]);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: recipient.toBase58(), amount: '5000000000' }],
    });
    expect(result.kind).toBe('approve');
    expect(result.mismatch).toBe(true);
    expect(
      result.mismatchReasons.some((r) => r.includes('unknown outer program')),
    ).toBe(true);
  });

  test('garbage base64 → kind undecodable, error set, no mismatch (warn-only state)', async () => {
    const result = await decodeVaultSolTransaction(
      'dGhpcyBpcyBub3QgYSB0cmFuc2FjdGlvbg==',
      'solDevnet',
      { recipients: [] },
    );
    expect(result.kind).toBe('undecodable');
    expect(result.mismatch).toBe(false);
    expect(result.decoded.error).toBeTruthy();
    expect(result.decoded.recipients).toEqual([]);
  });

  test('chain without a programId → kind undecodable (never throws)', async () => {
    const bundle = buildNativeBundle(1n, 1n);
    const result = await decodeVaultSolTransaction(bundle, 'btc', {
      recipients: [],
    });
    expect(result.kind).toBe('undecodable');
    expect(result.decoded.error).toContain('programId');
  });
});

// ---------------------------------------------------------------------------
// Decoder-level checks (@runonflux/solana-multisig SDK decoder)
// ---------------------------------------------------------------------------

describe('decodeVaultSolanaTransaction (SDK decoder)', () => {
  test('unknown inner instruction is counted (fail-closed)', () => {
    const accountKeys = [
      vaultPda,
      recipient,
      paymaster,
      SystemProgram.programId,
    ];
    const createData = serializeCreateData(0, accountKeys, [
      {
        programIdIndex: 3,
        accountIndexes: [0, 1],
        data: Buffer.from([9, 9, 9]), // unclassifiable SystemProgram data
      },
    ]);
    const bundle = buildBundle([
      makeNonceAdvanceIx(),
      makeCreateIx(createData),
    ]);
    const decoded = decodeVaultSolanaTransaction(bundle, PROGRAM_ID);
    expect(decoded.kind).toBe('create');
    if (decoded.kind === 'create') {
      expect(decoded.unknownInnerInstructionCount).toBe(1);
      const compared = compareDecodedToExpected(decoded, { recipients: [] });
      expect(compared.ok).toBe(false);
    }
  });

  test('reports multisig PDAs, creator and approvers from the create bundle', () => {
    const bundle = buildNativeBundle(1000n, 10n);
    const decoded = decodeVaultSolanaTransaction(bundle, PROGRAM_ID);
    expect(decoded.kind).toBe('create');
    if (decoded.kind === 'create') {
      expect(decoded.multisigPda).toBe(multisigPda.toBase58());
      expect(decoded.transactionPda).toBe(transactionPda.toBase58());
      expect(decoded.creator).toBe(creator.toBase58());
      expect(decoded.approvers).toEqual([member.toBase58()]);
      expect(decoded.unknownOuterPrograms).toEqual([]);
      expect(decoded.vaultIndex).toBe(0);
    }
  });

  test('truncated create_transaction data → undecodable', () => {
    const accountKeys = [vaultPda, recipient, SystemProgram.programId];
    const createData = serializeCreateData(0, accountKeys, [
      {
        programIdIndex: 2,
        accountIndexes: [0, 1],
        data: systemTransferData(1000n),
      },
    ]).subarray(0, 30); // truncate mid account-keys
    const bundle = buildBundle([makeCreateIx(Buffer.from(createData))]);
    const decoded = decodeVaultSolanaTransaction(bundle, PROGRAM_ID);
    expect(decoded.kind).toBe('undecodable');
  });
});
