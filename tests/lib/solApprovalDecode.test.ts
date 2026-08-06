// @ts-nocheck test suite
import { Buffer } from 'buffer';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { decodeTransactionForApproval } from '../../src/lib/transactions';
import { blockchains } from '../../src/storage/blockchains';

/**
 * Contract for the Solana APPROVAL decoder (decodeSOLTransactionForApproval,
 * reached through decodeTransactionForApproval).
 *
 * The approval screen has to describe the WHOLE proposal, so the decoder
 * accumulates across every non-paymaster transfer instruction — matching how the
 * paymaster branch above it sums its fee:
 *   - the receiver reported for a multi-output proposal covers all of them,
 *   - the total is the sum of what is being signed,
 *   - `recipientCount` is returned, so the warn_multi_recipient banner applies
 *     to Solana too.
 *
 * These tests build proposal bundles in the same wire format the relay does.
 * NOTE: the fixture builders below are deliberately a local copy of the ones in
 * vaultSolanaDecode.test.ts — that file tests a DIFFERENT decoder
 * (vaultSolanaDecode.ts). Worth extracting into a shared test fixture module.
 */

const TOKEN_PROGRAM = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);
const CHAIN = 'solDevnet';
const PROGRAM_ID = new PublicKey(blockchains[CHAIN].programId);
const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';
const LAMPORTS_DECIMALS = blockchains[CHAIN].decimals;

const paymaster = Keypair.generate().publicKey;
const vaultPda = Keypair.generate().publicKey;
const multisigPda = Keypair.generate().publicKey;
const transactionPda = Keypair.generate().publicKey;
const recipientA = Keypair.generate().publicKey;
const recipientB = Keypair.generate().publicKey;
const recipientC = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;

/**
 * Derived exactly as the decoder derives it, so the fixture and the code under
 * test always agree. Note `crypto` is aliased to react-native-quick-crypto in
 * this project's babel config and mocked under jest, so under test BOTH sides
 * produce the same placeholder digest. These tests therefore exercise the
 * PARSING and ACCUMULATION logic, not the real discriminator value — that is an
 * on-device/integration concern and is not what regressed here.
 */
const CREATE_TRANSACTION_DISCRIMINATOR = (() => {
  const { createHash } = require('crypto');
  return Buffer.from(
    createHash('sha256').update('global:create_transaction').digest(),
  ).subarray(0, 8);
})();

function serializeCreateData(vaultIndex, accountKeys, instructions) {
  const parts = [];
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

function systemTransferData(lamports) {
  const d = Buffer.alloc(12);
  d.writeUInt32LE(2, 0); // SystemProgram transfer tag
  d.writeBigUInt64LE(lamports, 4);
  return d;
}

function splTransferCheckedData(amount, decimals) {
  const d = Buffer.alloc(10);
  d[0] = 12; // TransferChecked tag
  d.writeBigUInt64LE(amount, 1);
  d[9] = decimals;
  return d;
}

/** Serialize an unsigned bundle with feePayer = paymaster, as the relay does. */
function buildBundle(createData) {
  const createIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: multisigPda, isSigner: false, isWritable: true },
      { pubkey: transactionPda, isSigner: false, isWritable: true },
      { pubkey: paymaster, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: createData,
  });
  const tx = new Transaction();
  tx.feePayer = paymaster;
  tx.recentBlockhash = BLOCKHASH;
  tx.add(createIx);
  return tx.serialize({ requireAllSignatures: false }).toString('base64');
}

/** accountKeys layout the decoder expects: [vault, ...others, systemProgram] */
function nativeProposal(transfers) {
  // index 0 must be the vault (decoder convention), then each recipient
  const accountKeys = [
    vaultPda,
    ...transfers.map((t) => t.to),
    SystemProgram.programId,
  ];
  const systemIdx = accountKeys.length - 1;
  const instructions = transfers.map((t, i) => ({
    programIdIndex: systemIdx,
    accountIndexes: [0, i + 1],
    data: systemTransferData(BigInt(t.lamports)),
  }));
  return buildBundle(serializeCreateData(0, accountKeys, instructions));
}

const toSol = (lamports) => String(lamports / 10 ** LAMPORTS_DECIMALS);

describe('Solana approval decode — multi-output proposals', () => {
  it('sums every recipient instead of showing only the last', async () => {
    const raw = nativeProposal([
      { to: recipientA, lamports: 1_000_000 },
      { to: recipientB, lamports: 2_000_000 },
      { to: recipientC, lamports: 3_000_000 },
    ]);
    const res = await decodeTransactionForApproval(raw, CHAIN);

    // Before the fix this was 3_000_000 (the LAST transfer) alone.
    expect(res.amount).toBe(toSol(6_000_000));
    expect(res.recipientCount).toBe(3);
    // First recipient is shown, with the count signalling there are more.
    expect(res.receiver).toBe(recipientA.toBase58());
  });

  it('reports recipientCount so the multi-recipient warning can fire', async () => {
    const single = await decodeTransactionForApproval(
      nativeProposal([{ to: recipientA, lamports: 5_000 }]),
      CHAIN,
    );
    expect(single.recipientCount).toBe(1);

    const multi = await decodeTransactionForApproval(
      nativeProposal([
        { to: recipientA, lamports: 5_000 },
        { to: recipientB, lamports: 5_000 },
      ]),
      CHAIN,
    );
    // TransactionRequest raises warn_multi_recipient on > 1; this was
    // permanently undefined for sol before the fix.
    expect(multi.recipientCount).toBe(2);
  });

  it('excludes the paymaster transfer from the recipient total', async () => {
    // A transfer to the fee payer is the sponsored network fee, not a payment.
    const accountKeys = [
      vaultPda,
      recipientA,
      paymaster,
      SystemProgram.programId,
    ];
    const systemIdx = 3;
    const raw = buildBundle(
      serializeCreateData(0, accountKeys, [
        {
          programIdIndex: systemIdx,
          accountIndexes: [0, 1],
          data: systemTransferData(7_000_000n),
        },
        {
          programIdIndex: systemIdx,
          accountIndexes: [0, 2],
          data: systemTransferData(500_000n),
        },
      ]),
    );
    const res = await decodeTransactionForApproval(raw, CHAIN);
    expect(res.amount).toBe(toSol(7_000_000));
    expect(res.recipientCount).toBe(1);
    expect(res.fee).toBe(toSol(500_000));
  });

  it('fails closed when a proposal mixes native and SPL transfers', async () => {
    // One amount + one symbol cannot honestly represent both, so the decoder
    // must refuse rather than display one and sign both.
    const accountKeys = [
      vaultPda,
      recipientA,
      mint,
      recipientB,
      TOKEN_PROGRAM,
      SystemProgram.programId,
    ];
    const raw = buildBundle(
      serializeCreateData(0, accountKeys, [
        {
          programIdIndex: 5, // SystemProgram
          accountIndexes: [0, 1],
          data: systemTransferData(1_000_000n),
        },
        {
          programIdIndex: 4, // Token program
          accountIndexes: [0, 2, 3, 0], // [source, mint, dest, authority]
          data: splTransferCheckedData(1_000n, 6),
        },
      ]),
    );
    const res = await decodeTransactionForApproval(raw, CHAIN);
    expect(res.amount).toBe('decodingError');
    expect(res.receiver).toBe('decodingError');
  });
});
