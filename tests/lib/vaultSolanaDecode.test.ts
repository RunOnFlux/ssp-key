import { Buffer } from 'buffer';
import {
  ComputeBudgetProgram,
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
  deriveMultisigAddress,
  deriveVaultAddress,
  decodeVaultSolanaTransaction,
  compareDecodedToExpected,
} from '@runonflux/solana-multisig';
import {
  applyVaultSolDecode,
  decodeVaultSolTransaction,
  parseMultisigAccount,
  parseVaultTransactionAccount,
  type SolAccountFetcher,
  type SolAccountInfo,
  type VaultSolDecodeState,
} from '../../src/lib/vaultSolanaDecode';
import type { VaultDecodedTx } from '../../src/lib/transactions';
import { blockchains } from '../../src/storage/blockchains';

// Must match the chain spec the wrapper resolves the program id from.
const PROGRAM_ID = new PublicKey(blockchains.solDevnet.programId);
const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';

// Fixture keys. The multisig and vault PDAs are DERIVED exactly as on chain
// (the decoder now checks that the source vault belongs to the multisig).
const paymaster = Keypair.generate().publicKey;
const nonceAccount = Keypair.generate().publicKey;
const creator = Keypair.generate().publicKey;
const member = Keypair.generate().publicKey;
const MEMBERS = [creator, member];
const THRESHOLD = 2;
const [multisigPda] = deriveMultisigAddress(MEMBERS, THRESHOLD, PROGRAM_ID);
const [vaultPda] = deriveVaultAddress(multisigPda, 0, PROGRAM_ID);
const recipient = Keypair.generate().publicKey;
const recipientB = Keypair.generate().publicKey;
const attacker = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
// In the Key's own solDevnet token list: TEST-USDC, 6 decimals.
const KNOWN_MINT = new PublicKey(
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
);

const PROPOSAL_INDEX = 7n;
const proposalPda = (multisig: PublicKey, index: bigint): PublicKey => {
  const indexBytes = Buffer.alloc(8);
  indexBytes.writeBigUInt64LE(index);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('transaction'), multisig.toBuffer(), indexBytes],
    PROGRAM_ID,
  )[0];
};
const transactionPda = proposalPda(multisigPda, PROPOSAL_INDEX);

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

function splLegacyTransferData(amount: bigint): Buffer {
  const d = Buffer.alloc(9);
  d[0] = 3; // legacy Transfer tag — no mint, no decimals on the wire
  d.writeBigUInt64LE(amount, 1);
  return d;
}

function makeCreateIx(
  data: Buffer,
  multisig: PublicKey = multisigPda,
  proposal: PublicKey = transactionPda,
): TransactionInstruction {
  // Account order per IDL: multisig, transaction, creator, payer, systemProgram
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: multisig, isSigner: false, isWritable: true },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: creator, isSigner: true, isWritable: false },
      { pubkey: paymaster, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function makeApproveIx(
  approver: PublicKey,
  proposal: PublicKey = transactionPda,
  multisig: PublicKey = multisigPda,
): TransactionInstruction {
  // Account order per IDL: multisig, transaction, member
  const index = Buffer.alloc(8);
  index.writeBigUInt64LE(PROPOSAL_INDEX);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: multisig, isSigner: false, isWritable: true },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: approver, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from(APPROVE_TRANSACTION_DISCRIMINATOR),
      index,
    ]),
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

/** create_transaction data for a native send: vault → dest + vault → paymaster (fee). */
function nativeCreateData(
  lamports: bigint,
  feeLamports: bigint,
  dest: PublicKey = recipient,
  source: PublicKey = vaultPda,
): Buffer {
  const accountKeys = [source, dest, paymaster, SystemProgram.programId];
  return serializeCreateData(0, accountKeys, [
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
}

/** Native SOL bundle: vault → recipient + vault → paymaster (fee). */
function buildNativeBundle(
  lamports: bigint,
  feeLamports: bigint,
  dest: PublicKey = recipient,
): string {
  return buildBundle([
    makeNonceAdvanceIx(),
    makeCreateIx(nativeCreateData(lamports, feeLamports, dest)),
    makeApproveIx(member),
  ]);
}

/** SPL TransferChecked bundle: vault ATA → owner's ATA. */
function buildSplBundle(
  owner: PublicKey,
  amount: bigint,
  decimals: number,
  tokenMint: PublicKey = mint,
): string {
  const sourceAta = deriveAssociatedTokenAddress(vaultPda, tokenMint);
  const destAta = deriveAssociatedTokenAddress(owner, tokenMint);
  const accountKeys = [
    vaultPda,
    sourceAta,
    tokenMint,
    destAta,
    TOKEN_PROGRAM_ID,
  ];
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
// On-chain account fixtures (Anchor layout, see lib.rs)
// ---------------------------------------------------------------------------

const VAULT_TX_DISC = [168, 250, 162, 100, 81, 14, 162, 207];
const MULTISIG_DISC = [224, 116, 121, 186, 68, 161, 79, 236];
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

function vaultTransactionAccountData(opts: {
  createData: Buffer;
  multisig?: PublicKey;
  executed?: boolean;
  index?: bigint;
}): Buffer {
  const createData = opts.createData;
  return Buffer.concat([
    Buffer.from(VAULT_TX_DISC),
    (opts.multisig ?? multisigPda).toBuffer(),
    u64(opts.index ?? PROPOSAL_INDEX),
    creator.toBuffer(),
    paymaster.toBuffer(),
    Buffer.from([255]), // bump
    Buffer.from([createData[8]]), // vault_index
    Buffer.from([254]), // vault_bump
    Buffer.from([opts.executed ? 1 : 0]),
    u32(1),
    creator.toBuffer(), // approvals: [creator]
    createData.subarray(9), // the stored TransactionMessage
    Buffer.alloc(64), // allocated-but-unused account space
  ]);
}

function multisigAccountData(
  members: PublicKey[] = MEMBERS,
  threshold = THRESHOLD,
): Buffer {
  return Buffer.concat([
    Buffer.from(MULTISIG_DISC),
    u32(members.length),
    ...members.map((m) => m.toBuffer()),
    Buffer.from([threshold]),
    u64(PROPOSAL_INDEX),
    Buffer.from([253]),
  ]);
}

const programAccount = (data: Buffer): SolAccountInfo => ({
  owner: PROGRAM_ID.toBase58(),
  data,
});

/** A fetcher serving fixed accounts by address. */
const fetcherFor =
  (accounts: Record<string, SolAccountInfo | null>): SolAccountFetcher =>
  (_chain, addresses) =>
    Promise.resolve(addresses.map((a) => accounts[a] ?? null));

const approveOnlyBundle = (proposal: PublicKey = transactionPda) =>
  buildBundle([makeNonceAdvanceIx(), makeApproveIx(member, proposal)]);

const recipientsPayload = [
  { address: recipient.toBase58(), amount: '5000000000' },
];

// ---------------------------------------------------------------------------
// decodeVaultSolTransaction (wrapper) — the state Home.tsx gates approval on
// ---------------------------------------------------------------------------

describe('decodeVaultSolTransaction — create bundles', () => {
  test('native SOL bundle decodes to create with matching payload (no mismatch)', async () => {
    const bundle = buildNativeBundle(5000000000n, 5000n);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: recipientsPayload,
    });
    expect(result.kind).toBe('create');
    expect(result.mismatchReasons).toEqual([]);
    expect(result.mismatch).toBe(false);
    expect(result.decoded.sender).toBe(vaultPda.toBase58());
    expect(result.decoded.recipients).toEqual(recipientsPayload);
    expect(result.decoded.fee).toBe('5000'); // paymaster transfer = fee
    expect(result.decoded.error).toBeUndefined();
    expect(result.decoded.tokenContract).toBeUndefined(); // native
    expect(result.multisigPda).toBe(multisigPda.toBase58());
  });

  test('SPL TransferChecked: owner verified, mint + decimals from the bytes, no relay symbol', async () => {
    const owner = recipient;
    const bundle = buildSplBundle(owner, 1000000n, 6);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: owner.toBase58(), amount: '1000000' }],
      tokenMint: mint.toBase58(),
    });
    expect(result.kind).toBe('create');
    expect(result.mismatch).toBe(false);
    // ATA verified → address resolved to the owner
    expect(result.decoded.recipients).toEqual([
      { address: owner.toBase58(), amount: '1000000' },
    ]);
    expect(result.decoded.tokenContract).toBe(mint.toBase58());
    expect(result.decoded.tokenDecimals).toBe(6); // decimals from bytes
    // unknown mint: no symbol, whatever the relay would have claimed
    expect(result.decoded.tokenSymbol).toBeUndefined();
  });

  test('H-14: the symbol comes from the device token list keyed by the byte mint', async () => {
    const bundle = buildSplBundle(recipient, 2500000n, 6, KNOWN_MINT);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: recipient.toBase58(), amount: '2500000' }],
      // The relay's mint is only an expectation compared against the bytes.
      tokenMint: KNOWN_MINT.toBase58(),
    });
    expect(result.mismatch).toBe(false);
    expect(result.decoded.tokenContract).toBe(KNOWN_MINT.toBase58());
    expect(result.decoded.tokenSymbol).toBe('TEST-USDC');
    expect(result.decoded.tokenDecimals).toBe(6);
  });

  test('an SPL transfer whose payload names no token is refused (asset binding, solana-multisig 0.12.1)', async () => {
    const bundle = buildSplBundle(recipient, 2500000n, 6, KNOWN_MINT);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: recipient.toBase58(), amount: '2500000' }],
    });
    expect(result.mismatch).toBe(true);
  });

  test('H-14: decimals in the bytes that contradict the device token list block approval', async () => {
    const bundle = buildSplBundle(recipient, 2500000n, 9, KNOWN_MINT);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: recipient.toBase58(), amount: '2500000' }],
    });
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.join(' ')).toMatch(/decimals/);
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
    });
    expect(result.kind).toBe('create');
    expect(result.mismatchReasons).toEqual([]);
    expect(result.mismatch).toBe(false);
    // BOTH ATAs verified → addresses resolved to the owners, not the ATAs
    expect(result.decoded.recipients).toEqual([
      { address: ownerA.toBase58(), amount: '1000000' },
      { address: ownerB.toBase58(), amount: '2500000' },
    ]);
    expect(result.decoded.tokenContract).toBe(mint.toBase58());
    expect(result.decoded.tokenDecimals).toBe(6);
  });

  test('SPL bundle paying a DIFFERENT owner than expected → mismatch (hard-block state)', async () => {
    const bundle = buildSplBundle(attacker, 1000000n, 6);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: recipient.toBase58(), amount: '1000000' }],
      tokenMint: mint.toBase58(),
    });
    expect(result.kind).toBe('create');
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.length).toBeGreaterThan(0);
  });

  test("a token account the relay names directly (not an expected owner's ATA) is refused", async () => {
    const bundle = buildSplBundle(attacker, 1000000n, 6);
    const attackerAta = deriveAssociatedTokenAddress(attacker, mint);
    // relay "expects" the raw token account, so the amount comparison passes
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: attackerAta.toBase58(), amount: '1000000' }],
      tokenMint: mint.toBase58(),
    });
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.join(' ')).toMatch(
      /not the associated token account/,
    );
  });

  test('PoC CHN-3: legacy SPL Transfer (tag 3) is refused even when the relay payload agrees', async () => {
    const vaultUsdcAta = deriveAssociatedTokenAddress(vaultPda, mint);
    const attackerAta = deriveAssociatedTokenAddress(attacker, mint);
    const accountKeys = [
      vaultPda,
      vaultUsdcAta,
      attackerAta,
      paymaster,
      TOKEN_PROGRAM_ID,
      SystemProgram.programId,
    ];
    const createData = serializeCreateData(0, accountKeys, [
      {
        programIdIndex: 4,
        accountIndexes: [1, 2, 0], // source, dest, authority
        data: splLegacyTransferData(1_000_000_000_000n), // 1,000,000 USDC
      },
      {
        programIdIndex: 5,
        accountIndexes: [0, 3],
        data: systemTransferData(5000n),
      },
    ]);
    const bundle = buildBundle([
      makeNonceAdvanceIx(),
      makeCreateIx(createData),
      makeApproveIx(member),
    ]);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [
        { address: attackerAta.toBase58(), amount: '1000000000000' },
      ],
      tokenMint: Keypair.generate().publicKey.toBase58(), // "BONK"
    });
    expect(result.kind).toBe('create');
    expect(result.mismatch).toBe(true);
    // solana-multisig 0.12.1 refuses tag 3 itself (counted as unrecognized).
    expect(result.mismatchReasons.join(' ')).toMatch(
      /unrecognized inner instruction/,
    );
  });

  test('a proposal moving native SOL and a token at once is refused', async () => {
    const sourceAta = deriveAssociatedTokenAddress(vaultPda, mint);
    const destAta = deriveAssociatedTokenAddress(recipient, mint);
    const accountKeys = [
      vaultPda,
      sourceAta,
      mint,
      destAta,
      recipient,
      TOKEN_PROGRAM_ID,
      SystemProgram.programId,
    ];
    const createData = serializeCreateData(0, accountKeys, [
      {
        programIdIndex: 5,
        accountIndexes: [1, 2, 3, 0],
        data: splTransferCheckedData(10n, 6),
      },
      {
        programIdIndex: 6,
        accountIndexes: [0, 4],
        data: systemTransferData(10n),
      },
    ]);
    const bundle = buildBundle([
      makeNonceAdvanceIx(),
      makeCreateIx(createData),
      makeApproveIx(member),
    ]);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [
        { address: recipient.toBase58(), amount: '10' },
        { address: recipient.toBase58(), amount: '10' },
      ],
    });
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.join(' ')).toMatch(/more than one asset/);
  });

  test('tampered native recipient (bytes pay attacker, payload claims legit) → mismatch', async () => {
    const bundle = buildNativeBundle(5000000000n, 5000n, attacker);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: recipientsPayload,
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
      recipients: recipientsPayload,
    });
    expect(result.kind).toBe('create');
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.length).toBeGreaterThan(0);
  });

  test('SOL-7: a source that is not the vault of the multisig in the bytes → mismatch', async () => {
    const otherVault = Keypair.generate().publicKey;
    const bundle = buildBundle([
      makeNonceAdvanceIx(),
      makeCreateIx(nativeCreateData(1000n, 10n, recipient, otherVault)),
      makeApproveIx(member),
    ]);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: recipient.toBase58(), amount: '1000' }],
    });
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.join(' ')).toMatch(/is not the vault/);
  });

  test('SOL-7: request-named members + threshold must re-derive to the multisig', async () => {
    const bundle = buildNativeBundle(5000000000n, 5000n);
    const ok = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: recipientsPayload,
      members: [member.toBase58(), creator.toBase58()],
      threshold: THRESHOLD,
    });
    expect(ok.mismatch).toBe(false);
    expect(ok.members).toEqual([member.toBase58(), creator.toBase58()]);

    const wrongThreshold = await decodeVaultSolTransaction(
      bundle,
      'solDevnet',
      {
        recipients: recipientsPayload,
        members: MEMBERS.map((m) => m.toBase58()),
        threshold: 1,
      },
    );
    expect(wrongThreshold.mismatch).toBe(true);

    const invalid = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: recipientsPayload,
      members: ['not-a-key'],
      threshold: 1,
    });
    expect(invalid.mismatch).toBe(true);
  });

  test('foreign outer instruction on a create bundle → mismatch', async () => {
    const drainIx = SystemProgram.transfer({
      fromPubkey: member,
      toPubkey: attacker,
      lamports: 123456789,
    });
    const bundle = buildBundle([
      makeNonceAdvanceIx(),
      makeCreateIx(nativeCreateData(5000000000n, 5000n)),
      makeApproveIx(member),
      drainIx,
    ]);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: recipientsPayload,
    });
    expect(result.mismatch).toBe(true);
  });
});

describe('decodeVaultSolTransaction — undecodable bytes (SOL-4)', () => {
  test('garbage base64 → kind undecodable, error kept (blocks approval)', async () => {
    const result = await decodeVaultSolTransaction(
      'dGhpcyBpcyBub3QgYSB0cmFuc2FjdGlvbg==',
      'solDevnet',
      { recipients: [] },
    );
    expect(result.kind).toBe('undecodable');
    expect(result.decoded.error).toBeTruthy();
    expect(result.decoded.recipients).toEqual([]);
  });

  test('PoC CHN-4: two create_transaction instructions → undecodable with the error kept', async () => {
    const data = nativeCreateData(1n, 1n);
    const bundle = buildBundle([
      makeCreateIx(data),
      makeCreateIx(data, multisigPda, proposalPda(multisigPda, 8n)),
    ]);
    const result = await decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: [{ address: recipient.toBase58(), amount: '1' }],
    });
    expect(result.kind).toBe('undecodable');
    expect(result.decoded.error).toMatch(/multiple create_transaction/);
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

describe('decodeVaultSolTransaction — approve-only bundles (H-13 / SOL-3)', () => {
  const proposalData = vaultTransactionAccountData({
    createData: nativeCreateData(5000000000n, 5000n),
  });
  const chainState = {
    [transactionPda.toBase58()]: programAccount(proposalData),
    [multisigPda.toBase58()]: programAccount(multisigAccountData()),
  };

  test('verifies the on-chain proposal and shows ITS recipients', async () => {
    const result = await decodeVaultSolTransaction(
      approveOnlyBundle(),
      'solDevnet',
      { recipients: recipientsPayload },
      { fetchAccounts: fetcherFor(chainState) },
    );
    expect(result.kind).toBe('approve');
    expect(result.mismatchReasons).toEqual([]);
    expect(result.mismatch).toBe(false);
    expect(result.decoded.recipients).toEqual(recipientsPayload);
    expect(result.decoded.sender).toBe(vaultPda.toBase58());
    expect(result.decoded.fee).toBe('5000');
    expect(result.members).toEqual(MEMBERS.map((m) => m.toBase58()));
    expect(result.multisigPda).toBe(multisigPda.toBase58());
  });

  test('refuses when the on-chain proposal pays someone else than displayed (the SOL-3 steer)', async () => {
    const drain = vaultTransactionAccountData({
      createData: nativeCreateData(5000000000n, 5000n, attacker),
    });
    const result = await decodeVaultSolTransaction(
      approveOnlyBundle(),
      'solDevnet',
      { recipients: recipientsPayload },
      {
        fetchAccounts: fetcherFor({
          ...chainState,
          [transactionPda.toBase58()]: programAccount(drain),
        }),
      },
    );
    expect(result.mismatch).toBe(true);
    expect(result.decoded.recipients).toEqual([
      { address: attacker.toBase58(), amount: '5000000000' },
    ]);
  });

  test('refuses when the proposal cannot be fetched (no fetch, no approval)', async () => {
    const result = await decodeVaultSolTransaction(
      approveOnlyBundle(),
      'solDevnet',
      { recipients: recipientsPayload },
      { fetchAccounts: () => Promise.reject(new Error('network down')) },
    );
    expect(result.kind).toBe('approve');
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.join(' ')).toMatch(/could not fetch/);
  });

  test('refuses a missing, foreign-owned, executed or other-multisig proposal', async () => {
    const run = (accounts: Record<string, SolAccountInfo | null>) =>
      decodeVaultSolTransaction(
        approveOnlyBundle(),
        'solDevnet',
        { recipients: recipientsPayload },
        { fetchAccounts: fetcherFor(accounts) },
      );
    const missing = await run({
      ...chainState,
      [transactionPda.toBase58()]: null,
    });
    expect(missing.mismatch).toBe(true);

    const foreign = await run({
      ...chainState,
      [transactionPda.toBase58()]: {
        owner: SystemProgram.programId.toBase58(),
        data: proposalData,
      },
    });
    expect(foreign.mismatch).toBe(true);

    const executed = await run({
      ...chainState,
      [transactionPda.toBase58()]: programAccount(
        vaultTransactionAccountData({
          createData: nativeCreateData(5000000000n, 5000n),
          executed: true,
        }),
      ),
    });
    expect(executed.mismatch).toBe(true);
    expect(executed.mismatchReasons.join(' ')).toMatch(/already been executed/);

    const otherMultisig = await run({
      ...chainState,
      [transactionPda.toBase58()]: programAccount(
        vaultTransactionAccountData({
          createData: nativeCreateData(5000000000n, 5000n),
          multisig: Keypair.generate().publicKey,
        }),
      ),
    });
    expect(otherMultisig.mismatch).toBe(true);
  });

  test('refuses an approve target that is not the canonical proposal address', async () => {
    const fake = Keypair.generate().publicKey;
    const result = await decodeVaultSolTransaction(
      approveOnlyBundle(fake),
      'solDevnet',
      { recipients: recipientsPayload },
      {
        fetchAccounts: fetcherFor({
          ...chainState,
          [fake.toBase58()]: programAccount(proposalData),
        }),
      },
    );
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.join(' ')).toMatch(/canonical proposal/);
  });

  test('refuses when the request-named members differ from the multisig on chain', async () => {
    const result = await decodeVaultSolTransaction(
      approveOnlyBundle(),
      'solDevnet',
      {
        recipients: recipientsPayload,
        members: [creator.toBase58(), attacker.toBase58()],
        threshold: 2,
      },
      { fetchAccounts: fetcherFor(chainState) },
    );
    expect(result.mismatch).toBe(true);
  });

  test('foreign outer instruction (leaf-key drain attempt) → mismatch without fetching', async () => {
    const fetchAccounts = jest.fn(fetcherFor(chainState));
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
    const result = await decodeVaultSolTransaction(
      bundle,
      'solDevnet',
      { recipients: recipientsPayload },
      { fetchAccounts },
    );
    expect(result.kind).toBe('approve');
    expect(result.mismatch).toBe(true);
    expect(
      result.mismatchReasons.some((r) => r.includes('unknown outer program')),
    ).toBe(true);
    expect(fetchAccounts).not.toHaveBeenCalled();
  });
});

describe('on-chain account parsers', () => {
  test('parse the proposal and multisig layouts and refuse other accounts', () => {
    const createData = nativeCreateData(1n, 1n);
    const parsed = parseVaultTransactionAccount(
      vaultTransactionAccountData({ createData }),
    );
    expect(new PublicKey(parsed.multisig).equals(multisigPda)).toBe(true);
    expect(parsed.transactionIndex).toBe(PROPOSAL_INDEX);
    expect(parsed.executed).toBe(false);
    expect(parsed.messageBytes.equals(createData.subarray(9))).toBe(true);

    const ms = parseMultisigAccount(multisigAccountData());
    expect(ms.threshold).toBe(THRESHOLD);
    expect(ms.members.map((m) => new PublicKey(m).toBase58())).toEqual(
      MEMBERS.map((m) => m.toBase58()),
    );

    expect(() => parseVaultTransactionAccount(multisigAccountData())).toThrow();
    expect(() =>
      parseVaultTransactionAccount(
        vaultTransactionAccountData({ createData }).subarray(0, 90),
      ),
    ).toThrow();
  });
});

describe('applyVaultSolDecode', () => {
  test('an undecodable request shows only its error, never the relay values', async () => {
    let decoded: VaultDecodedTx | null = null;
    let state: VaultSolDecodeState | null = null;
    await applyVaultSolDecode(
      {
        chain: 'solDevnet',
        rawUnsignedTx: 'Zm9v',
        recipients: [{ address: recipient.toBase58(), amount: '1' }],
      },
      (tx) => {
        decoded = tx;
      },
      (s) => {
        state = s;
      },
      { requestDigest: 'digest-1' },
    );
    expect(state).toMatchObject({
      kind: 'undecodable',
      requestDigest: 'digest-1',
    });
    expect(decoded).toMatchObject({ recipients: [], sender: '' });
    expect((decoded as unknown as VaultDecodedTx).error).toBeTruthy();
  });

  test('passes the request members / threshold through to the decode', async () => {
    let state: VaultSolDecodeState | null = null;
    await applyVaultSolDecode(
      {
        chain: 'solDevnet',
        rawUnsignedTx: buildNativeBundle(5000000000n, 5000n),
        recipients: recipientsPayload,
        solMembers: MEMBERS.map((m) => m.toBase58()),
        solThreshold: THRESHOLD,
      },
      () => undefined,
      (s) => {
        state = s;
      },
      { requestDigest: 'digest-2' },
    );
    expect(state).toMatchObject({
      kind: 'create',
      mismatch: false,
      members: MEMBERS.map((m) => m.toBase58()),
      requestDigest: 'digest-2',
    });
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

// ---------------------------------------------------------------------------
// Outer ComputeBudget (mainnet bundles) — same rules and caps as the server's
// verifyOuterComputeBudget (solanaVaultProposalBuilderService).
// ---------------------------------------------------------------------------

describe('decodeVaultSolTransaction — outer ComputeBudget (mainnet bundles)', () => {
  const limitIx = (units: number) =>
    ComputeBudgetProgram.setComputeUnitLimit({ units });
  const priceIx = (microLamports: number) =>
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports });
  const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';

  /** nonceAdvance, <budget>, create, approve — the mainnet builder layout. */
  const mainnetBundle = (budget: TransactionInstruction[]) =>
    buildBundle([
      makeNonceAdvanceIx(),
      ...budget,
      makeCreateIx(nativeCreateData(5000000000n, 5000n)),
      makeApproveIx(member),
    ]);
  const decode = (bundle: string) =>
    decodeVaultSolTransaction(bundle, 'solDevnet', {
      recipients: recipientsPayload,
    });

  test('root cause: the SDK decoder alone flags the builder priority-fee instructions', () => {
    const decoded = decodeVaultSolanaTransaction(
      mainnetBundle([limitIx(200_000), priceIx(50_000)]),
      PROGRAM_ID,
    );
    expect(decoded.kind).toBe('create');
    if (decoded.kind === 'create') {
      expect(decoded.unknownOuterPrograms).toEqual([
        COMPUTE_BUDGET,
        COMPUTE_BUDGET,
      ]);
    }
  });

  test('accepts a bundle with one capped limit and one capped price', async () => {
    const result = await decode(
      mainnetBundle([limitIx(200_000), priceIx(50_000)]),
    );
    expect(result.mismatchReasons).toEqual([]);
    expect(result.mismatch).toBe(false);
    expect(result.decoded.recipients).toEqual(recipientsPayload);
  });

  test('accepts a price-only or a limit-only budget', async () => {
    expect((await decode(mainnetBundle([priceIx(1_000)]))).mismatch).toBe(
      false,
    );
    expect((await decode(mainnetBundle([limitIx(300_000)]))).mismatch).toBe(
      false,
    );
  });

  test('accepts a capped budget on an approve-only bundle (verified on chain)', async () => {
    const proposalData = vaultTransactionAccountData({
      createData: nativeCreateData(5000000000n, 5000n),
    });
    const bundle = buildBundle([
      makeNonceAdvanceIx(),
      limitIx(200_000),
      priceIx(50_000),
      makeApproveIx(member),
    ]);
    const result = await decodeVaultSolTransaction(
      bundle,
      'solDevnet',
      { recipients: recipientsPayload },
      {
        fetchAccounts: fetcherFor({
          [transactionPda.toBase58()]: programAccount(proposalData),
          [multisigPda.toBase58()]: programAccount(multisigAccountData()),
        }),
      },
    );
    expect(result.kind).toBe('approve');
    expect(result.mismatchReasons).toEqual([]);
    expect(result.mismatch).toBe(false);
  });

  test('refuses a unit price above the cap', async () => {
    const result = await decode(
      mainnetBundle([limitIx(200_000), priceIx(1_000_001)]),
    );
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.join(' ')).toMatch(/ComputeBudget/);
  });

  test('refuses a unit limit above the cap', async () => {
    const result = await decode(mainnetBundle([limitIx(1_400_001)]));
    expect(result.mismatch).toBe(true);
  });

  test('refuses a total priority fee above the lamport cap', async () => {
    // 1.4M CU x 1M µlamports = 1.4M lamports > 50k cap
    const result = await decode(
      mainnetBundle([limitIx(1_400_000), priceIx(1_000_000)]),
    );
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.join(' ')).toMatch(/priority fee/);
  });

  test('refuses a duplicate ComputeBudget instruction', async () => {
    const result = await decode(
      mainnetBundle([priceIx(1_000), priceIx(2_000)]),
    );
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.join(' ')).toMatch(/duplicate/);
  });

  test('refuses a ComputeBudget instruction that takes accounts', async () => {
    const withAccount = new TransactionInstruction({
      programId: new PublicKey(COMPUTE_BUDGET),
      keys: [{ pubkey: attacker, isSigner: false, isWritable: true }],
      data: priceIx(1_000).data,
    });
    const result = await decode(mainnetBundle([withAccount]));
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.join(' ')).toMatch(/accounts/);
  });

  test('refuses ComputeBudget at instruction 0 (the nonce advance slot)', async () => {
    const bundle = buildBundle([
      priceIx(1_000),
      makeNonceAdvanceIx(),
      makeCreateIx(nativeCreateData(5000000000n, 5000n)),
      makeApproveIx(member),
    ]);
    const result = await decode(bundle);
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.join(' ')).toMatch(/instruction\[0\]/);
  });

  test('refuses malformed or non-allowlisted ComputeBudget instructions', async () => {
    const wrongLength = new TransactionInstruction({
      programId: new PublicKey(COMPUTE_BUDGET),
      keys: [],
      data: Buffer.concat([priceIx(1_000).data, Buffer.from([0])]),
    });
    const heap = ComputeBudgetProgram.requestHeapFrame({ bytes: 64 * 1024 });
    for (const ix of [wrongLength, heap]) {
      const result = await decode(mainnetBundle([ix]));
      expect(result.mismatch).toBe(true);
    }
  });

  test('never exempts an outer Memo or a foreign instruction next to a valid budget', async () => {
    const memo = new TransactionInstruction({
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      keys: [],
      data: Buffer.from('hello', 'utf8'),
    });
    const foreign = SystemProgram.transfer({
      fromPubkey: member,
      toPubkey: attacker,
      lamports: 1n,
    });
    for (const extra of [memo, foreign]) {
      const result = await decode(
        mainnetBundle([limitIx(200_000), priceIx(50_000), extra]),
      );
      expect(result.mismatch).toBe(true);
      expect(result.mismatchReasons.join(' ')).toMatch(/unknown outer program/);
    }
  });
});

// ---------------------------------------------------------------------------
// VD-4: the multisig derived from the pinned vault descriptor
// ---------------------------------------------------------------------------

describe('decodeVaultSolTransaction — pinned vault binding (VD-4)', () => {
  const binding = {
    multisigPda: multisigPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    members: MEMBERS.map((m) => m.toBase58()),
    threshold: THRESHOLD,
  };

  test('accepts bytes acting on the pinned vault, whatever the relay claims', async () => {
    const result = await decodeVaultSolTransaction(
      buildNativeBundle(5000000000n, 5000n),
      'solDevnet',
      {
        recipients: recipientsPayload,
        // a relay-supplied member set is ignored when the binding is given
        members: [attacker.toBase58()],
        threshold: 1,
        vaultBinding: binding,
      },
    );
    expect(result.mismatchReasons).toEqual([]);
    expect(result.members).toEqual(binding.members);
  });

  test('refuses bytes acting on another multisig than the pinned vault', async () => {
    const otherMembers = [creator, attacker];
    const [otherMultisig] = deriveMultisigAddress(
      otherMembers,
      THRESHOLD,
      PROGRAM_ID,
    );
    const [otherVault] = deriveVaultAddress(otherMultisig, 0, PROGRAM_ID);
    const result = await decodeVaultSolTransaction(
      buildNativeBundle(5000000000n, 5000n),
      'solDevnet',
      {
        recipients: recipientsPayload,
        vaultBinding: {
          multisigPda: otherMultisig.toBase58(),
          vaultPda: otherVault.toBase58(),
          members: otherMembers.map((m) => m.toBase58()),
          threshold: THRESHOLD,
        },
      },
    );
    expect(result.mismatch).toBe(true);
    expect(result.mismatchReasons.join(' ')).toMatch(/pinned vault/);
  });

  test('approve-only: the on-chain multisig must be the pinned vault', async () => {
    const proposalData = vaultTransactionAccountData({
      createData: nativeCreateData(5000000000n, 5000n),
    });
    const chain = {
      [transactionPda.toBase58()]: programAccount(proposalData),
      [multisigPda.toBase58()]: programAccount(multisigAccountData()),
    };
    const ok = await decodeVaultSolTransaction(
      approveOnlyBundle(),
      'solDevnet',
      { recipients: recipientsPayload, vaultBinding: binding },
      { fetchAccounts: fetcherFor(chain) },
    );
    expect(ok.mismatchReasons).toEqual([]);
    const wrong = await decodeVaultSolTransaction(
      approveOnlyBundle(),
      'solDevnet',
      {
        recipients: recipientsPayload,
        vaultBinding: { ...binding, multisigPda: attacker.toBase58() },
      },
      { fetchAccounts: fetcherFor(chain) },
    );
    expect(wrong.mismatch).toBe(true);
  });
});
