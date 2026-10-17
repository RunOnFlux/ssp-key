/**
 * Vault descriptor v1 (SECURITY_FIX_CONTRACT "VD: vault descriptor pinning").
 *
 * The relay is not trusted for an enterprise vault's scripts or addresses. The
 * enterprise app fetches the vault descriptor (every signer's WK identity
 * keys, the vault xpubs as submitted, and the xpub attestations as stored by
 * relay-enterprise `vaultService.submitXpub`) and passes it with every vault
 * request. This module:
 *
 * - serialises the descriptor canonically and hashes it (VD-1) — mirrored
 *   byte-for-byte from relay-enterprise `vaultDescriptorService.canonicalJson`
 *   / `computeDescriptorHash`;
 * - verifies it cryptographically (VD-3 items 1–5): hash, shape, each member's
 *   WK identity, each used xpub's attestation, and this device's own entry;
 * - derives vault addresses from it (VD-4), replicating relay-enterprise
 *   `vaultAddressService` exactly: chain family, signing mode, key order.
 *
 * Pure: no storage, no UI. Pinning lives in vaultPins.ts, the per-request
 * checks in vaultDescriptorGate.ts.
 */
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import utxolib from '@runonflux/utxo-lib';
import * as aaSchnorrMultisig from '@runonflux/aa-schnorr-multisig-sdk';
import { HDKey } from '@scure/bip32';
import { toCashAddress } from 'bchaddrjs';
import { PublicKey } from '@solana/web3.js';
import {
  deriveMultisigAddress as deriveSolanaMultisigPda,
  deriveVaultAddress as deriveSolanaVaultPda,
} from '@runonflux/solana-multisig';
import { SigningKey } from 'ethers';
import { blockchains } from '@storage/blockchains';
import type { cryptos } from '../types';
import { isEnterpriseOrgIndex, isHdIndex } from './enterpriseGuards';
import { verifyBitcoinMessageSignature } from './wkMessage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultDescriptorMember {
  wkIdentity: string;
  walletPubKey: string;
  keyPubKey: string;
  xpubWallet: string | null;
  xpubKey: string | null;
  walletXpubSignature: string | null;
  keyXpubSignature: string | null;
}

export type UtxoEvmSigningMode = 'dual' | 'key_only' | 'wallet_only';
export type SolSigningMode = 'sol_dual' | 'sol_single';
export type VaultDescriptorSigningMode = UtxoEvmSigningMode | SolSigningMode;

export interface VaultDescriptor {
  v: 1;
  orgId: string;
  vaultId: string;
  orgIndex: number;
  vaultIndex: number;
  chain: string;
  signingMode: VaultDescriptorSigningMode;
  requiredSigners: number;
  members: VaultDescriptorMember[];
}

export type VaultDescriptorRole = 'wallet' | 'key';

export type VaultChainFamily = 'utxo' | 'evm' | 'sol';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VAULT_DESCRIPTOR_VERSION = 1;

/** Descriptor keys, in canonical order (VD-1). */
const DESCRIPTOR_KEYS = [
  'v',
  'orgId',
  'vaultId',
  'orgIndex',
  'vaultIndex',
  'chain',
  'signingMode',
  'requiredSigners',
  'members',
] as const;

/** Member keys, in canonical order (VD-1). */
const MEMBER_KEYS = [
  'wkIdentity',
  'walletPubKey',
  'keyPubKey',
  'xpubWallet',
  'xpubKey',
  'walletXpubSignature',
  'keyXpubSignature',
] as const;

/**
 * Signer limits of relay-enterprise vaultService.createVault (absolute caps;
 * subscription tiers can only lower them).
 */
const MAX_SIGNERS_DUAL_UTXO = 7;
const MAX_SIGNERS_DUAL_EVM = 4;
const MAX_SIGNERS_SINGLE_EVM = 8;
const MAX_SIGNERS_SINGLE_UTXO = 15;
const MAX_SIGNERS_SOL = 15;

/** Solana vault "xpubs" are JSON arrays of this many ed25519 leaves. */
export const SOL_PUBKEY_ARRAY_LENGTH = 20;

/**
 * The prefix relay-enterprise `submitXpub` verifies attestations with
 * (identityAuth.verifyBitcoinSignature default), whatever the vault chain.
 */
const BITCOIN_MESSAGE_PREFIX = '\u0018Bitcoin Signed Message:\n';

/**
 * org/vault ids: lowercase 24-hex Mongo ObjectIds (shared vectors rule, as
 * SSP Wallet enforces it). Also keeps ':' out of the pin key.
 */
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/;
const COMPRESSED_PUBKEY_HEX = /^0[23][0-9a-fA-F]{64}$/;
const HASH_HEX = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Canonical JSON + hash (VD-1) — byte-for-byte with relay-enterprise
// ---------------------------------------------------------------------------

/**
 * One scalar: standard JSON for strings and finite numbers, `null` for null
 * or undefined. Anything else is refused (throws).
 */
function canonicalScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  throw new Error(`canonicalJson: unsupported value type ${typeof value}`);
}

/**
 * Canonical JSON of a descriptor: keys in exactly the documented order,
 * members in the order given, no whitespace, standard JSON escaping, `null`
 * for missing values. Unknown keys are not serialised. Throws on a value that
 * is not a string, a finite number or null.
 */
export function canonicalDescriptorJson(descriptor: unknown): string {
  const record = (
    descriptor && typeof descriptor === 'object' ? descriptor : {}
  ) as Record<string, unknown>;
  const parts = DESCRIPTOR_KEYS.map((key) => {
    if (key === 'members') {
      const members = Array.isArray(record.members) ? record.members : [];
      const serialized = members.map((member: unknown) => {
        const m = (
          member && typeof member === 'object' ? member : {}
        ) as Record<string, unknown>;
        return `{${MEMBER_KEYS.map(
          (mk) => `${JSON.stringify(mk)}:${canonicalScalar(m[mk])}`,
        ).join(',')}}`;
      });
      return `${JSON.stringify(key)}:[${serialized.join(',')}]`;
    }
    return `${JSON.stringify(key)}:${canonicalScalar(record[key])}`;
  });
  return `{${parts.join(',')}}`;
}

/** sha256 (lowercase hex) of the UTF-8 bytes of the canonical JSON. */
export function vaultDescriptorHash(descriptor: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalDescriptorJson(descriptor))));
}

// ---------------------------------------------------------------------------
// Chain / mode helpers
// ---------------------------------------------------------------------------

export function chainFamily(chain: string): VaultChainFamily | null {
  if (!Object.prototype.hasOwnProperty.call(blockchains, chain)) {
    return null;
  }
  const config = blockchains[chain as keyof cryptos] as {
    chainType?: string;
    scriptType?: string;
  };
  if (config.chainType === 'evm') {
    return 'evm';
  }
  if (config.chainType === 'sol') {
    return 'sol';
  }
  if (config.chainType) {
    return null; // a chain family this module does not derive
  }
  return ['p2sh', 'p2sh-p2wsh', 'p2wsh'].includes(config.scriptType ?? '')
    ? 'utxo'
    : null;
}

/** Which xpubs (and attestations) a signing mode derives addresses from. */
export function modeUsesXpubs(mode: VaultDescriptorSigningMode): {
  wallet: boolean;
  key: boolean;
} {
  switch (mode) {
    case 'key_only':
      return { wallet: false, key: true };
    case 'wallet_only':
    case 'sol_single':
      return { wallet: true, key: false };
    default:
      return { wallet: true, key: true };
  }
}

function maxSigners(
  family: VaultChainFamily,
  mode: VaultDescriptorSigningMode,
): number {
  if (family === 'sol') {
    return MAX_SIGNERS_SOL;
  }
  const single = mode === 'key_only' || mode === 'wallet_only';
  if (family === 'evm') {
    return single ? MAX_SIGNERS_SINGLE_EVM : MAX_SIGNERS_DUAL_EVM;
  }
  return single ? MAX_SIGNERS_SINGLE_UTXO : MAX_SIGNERS_DUAL_UTXO;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nullableString = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.length > 0);

// ---------------------------------------------------------------------------
// Shape (VD-3 item 2)
// ---------------------------------------------------------------------------

/**
 * Returns the typed descriptor, or the reason its shape is refused. Does not
 * look at signatures or keys beyond their syntax.
 */
export function parseVaultDescriptorShape(
  value: unknown,
): { ok: true; descriptor: VaultDescriptor } | { ok: false; reason: string } {
  if (!isPlainObject(value)) {
    return { ok: false, reason: 'descriptor is not an object' };
  }
  // Only the canonical fields: what is hashed is exactly what is used, and
  // SSP Wallet refuses the same descriptors.
  const unknownKey = Object.keys(value).find(
    (key) => !(DESCRIPTOR_KEYS as readonly string[]).includes(key),
  );
  if (unknownKey !== undefined) {
    return { ok: false, reason: `unexpected descriptor field ${unknownKey}` };
  }
  if (value.v !== VAULT_DESCRIPTOR_VERSION) {
    return { ok: false, reason: 'unsupported descriptor version' };
  }
  const { orgId, vaultId, orgIndex, vaultIndex, chain, signingMode } = value;
  if (typeof orgId !== 'string' || !OBJECT_ID_HEX.test(orgId)) {
    return { ok: false, reason: 'invalid organisation id' };
  }
  if (typeof vaultId !== 'string' || !OBJECT_ID_HEX.test(vaultId)) {
    return { ok: false, reason: 'invalid vault id' };
  }
  if (!isEnterpriseOrgIndex(orgIndex)) {
    return {
      ok: false,
      reason: 'organisation index must be an integer between 100 and 99999',
    };
  }
  if (!isHdIndex(vaultIndex)) {
    return {
      ok: false,
      reason: 'vault index must be an integer between 0 and 2^31 - 1',
    };
  }
  if (typeof chain !== 'string') {
    return { ok: false, reason: 'invalid chain' };
  }
  const family = chainFamily(chain);
  if (!family) {
    return { ok: false, reason: `unsupported vault chain ${chain}` };
  }
  const modeOk =
    family === 'sol'
      ? signingMode === 'sol_dual' || signingMode === 'sol_single'
      : signingMode === 'dual' ||
        signingMode === 'key_only' ||
        signingMode === 'wallet_only';
  if (!modeOk) {
    return { ok: false, reason: 'invalid signing mode for this chain' };
  }
  const mode = signingMode as VaultDescriptorSigningMode;
  const { members } = value;
  if (!Array.isArray(members) || members.length === 0) {
    return { ok: false, reason: 'descriptor has no signers' };
  }
  const limit = maxSigners(family, mode);
  if (members.length > limit) {
    return {
      ok: false,
      reason: `${members.length} signers exceeds the limit of ${limit} for this vault type`,
    };
  }
  const { requiredSigners } = value;
  if (
    typeof requiredSigners !== 'number' ||
    !Number.isInteger(requiredSigners) ||
    requiredSigners < 1 ||
    requiredSigners > members.length
  ) {
    return { ok: false, reason: 'invalid required signer count' };
  }
  // Solana (validateSolanaCaps): N in [2, 15], M in [2, N]; the vault PDA
  // seed is a u8.
  if (
    family === 'sol' &&
    (members.length < 2 || requiredSigners < 2 || vaultIndex > 255)
  ) {
    return { ok: false, reason: 'outside the Solana vault limits' };
  }
  const typedMembers: VaultDescriptorMember[] = [];
  for (let i = 0; i < members.length; i++) {
    const m: unknown = members[i];
    if (!isPlainObject(m)) {
      return { ok: false, reason: 'malformed signer entry' };
    }
    if (
      Object.keys(m).some(
        (key) => !(MEMBER_KEYS as readonly string[]).includes(key),
      )
    ) {
      return { ok: false, reason: 'unexpected signer entry field' };
    }
    if (typeof m.wkIdentity !== 'string' || !m.wkIdentity) {
      return { ok: false, reason: 'signer without a WK identity' };
    }
    if (i > 0 && !(typedMembers[i - 1].wkIdentity < m.wkIdentity)) {
      return {
        ok: false,
        reason: 'signers are not sorted and unique by WK identity',
      };
    }
    if (
      typeof m.walletPubKey !== 'string' ||
      typeof m.keyPubKey !== 'string' ||
      !nullableString(m.xpubWallet) ||
      !nullableString(m.xpubKey) ||
      !nullableString(m.walletXpubSignature) ||
      !nullableString(m.keyXpubSignature)
    ) {
      return { ok: false, reason: 'malformed signer entry' };
    }
    typedMembers.push({
      wkIdentity: m.wkIdentity,
      walletPubKey: m.walletPubKey,
      keyPubKey: m.keyPubKey,
      xpubWallet: m.xpubWallet,
      xpubKey: m.xpubKey,
      walletXpubSignature: m.walletXpubSignature,
      keyXpubSignature: m.keyXpubSignature,
    });
  }
  return {
    ok: true,
    descriptor: {
      v: VAULT_DESCRIPTOR_VERSION,
      orgId,
      vaultId,
      orgIndex,
      vaultIndex,
      chain,
      signingMode: mode,
      requiredSigners,
      members: typedMembers,
    },
  };
}

// ---------------------------------------------------------------------------
// WK identity (VD-3 item 3)
// ---------------------------------------------------------------------------

/** True for a valid compressed secp256k1 point (hex). */
export function isValidCompressedPubKey(hex: string): boolean {
  if (!COMPRESSED_PUBKEY_HEX.test(hex)) {
    return false;
  }
  try {
    SigningKey.computePublicKey(`0x${hex}`, true);
    return true;
  } catch {
    return false;
  }
}

/**
 * The WK identity of a wallet/key identity pubkey pair: P2WSH of the 2-of-2
 * with the two keys sorted as hex (how SSP Wallet and SSP Key build it). The
 * network follows the relay's rule: `tb1…` identities are testnet.
 */
export function wkIdentityOf(
  walletPubKey: string,
  keyPubKey: string,
  testnet: boolean,
): string {
  const sorted = [walletPubKey.toLowerCase(), keyPubKey.toLowerCase()].sort();
  const witnessScript = utxolib.script.multisig.output.encode(
    2,
    sorted.map((hex) => Buffer.from(hex, 'hex')),
  );
  const scriptPubKey = utxolib.script.witnessScriptHash.output.encode(
    utxolib.crypto.sha256(witnessScript),
  );
  return utxolib.address.fromOutputScript(
    scriptPubKey,
    testnet ? utxolib.networks.testnet : utxolib.networks.bitcoin,
  );
}

// ---------------------------------------------------------------------------
// Attestations (VD-3 item 4)
// ---------------------------------------------------------------------------

/** The exact message relay-enterprise submitXpub verifies. */
export function xpubAttestationMessage(
  role: VaultDescriptorRole,
  xpub: string,
  chain: string,
  orgIndex: number,
): string {
  return `SSP_VAULT_XPUB:${role}:${xpub}:${chain}:${String(orgIndex)}`;
}

// ---------------------------------------------------------------------------
// xpub parsing + bounded derivation cache (public data only)
// ---------------------------------------------------------------------------

const CHILD_CACHE_LIMIT = 256;
const childCache = new Map<string, HDKey>();

/** HD key of an xpub, with the server's version fallback for UTXO chains. */
function parseXpub(xpub: string, chain: string, allowFallback: boolean): HDKey {
  const config = blockchains[chain as keyof cryptos];
  try {
    return HDKey.fromExtendedKey(xpub, config.bip32);
  } catch (error) {
    if (!allowFallback) {
      throw error;
    }
    const networkBip32 = utxolib.networks[config.libid]?.bip32;
    return HDKey.fromExtendedKey(xpub, networkBip32);
  }
}

/** The compressed child pubkey xpub/typeIndex/addressIndex (hex). */
function deriveChildPubKeyHex(
  xpub: string,
  chain: string,
  typeIndex: number,
  addressIndex: number,
  allowFallback: boolean,
): string {
  const cacheKey = `${chain}|${allowFallback ? 1 : 0}|${typeIndex}|${xpub}`;
  let typeChild = childCache.get(cacheKey);
  if (!typeChild) {
    typeChild = parseXpub(xpub, chain, allowFallback).deriveChild(typeIndex);
    if (childCache.size >= CHILD_CACHE_LIMIT) {
      childCache.clear();
    }
    childCache.set(cacheKey, typeChild);
  }
  const child = typeChild.deriveChild(addressIndex);
  if (!child.publicKey) {
    throw new Error('Failed to derive public key from xpub');
  }
  return Buffer.from(child.publicKey).toString('hex');
}

/** Parses a Solana pubkey array (JSON, 20 distinct base58 keys). Throws. */
export function parseSolPubkeyArray(json: string): string[] {
  let arr: unknown;
  try {
    arr = JSON.parse(json);
  } catch {
    throw new Error('Invalid pubkey array (not JSON)');
  }
  if (!Array.isArray(arr) || arr.length !== SOL_PUBKEY_ARRAY_LENGTH) {
    throw new Error('Invalid pubkey array length');
  }
  const seen = new Set<string>();
  return arr.map((p: unknown) => {
    if (typeof p !== 'string') {
      throw new Error('pubkey array entries must be strings');
    }
    const canonical = new PublicKey(p).toBase58();
    if (canonical !== p || seen.has(p)) {
      throw new Error('Invalid or duplicate pubkey in array');
    }
    seen.add(p);
    return p;
  });
}

/** True when two vault "xpubs" denote the same keys for this chain. */
function sameAccountXpub(chain: string, a: string, b: string): boolean {
  if (chainFamily(chain) !== 'sol') {
    return a === b;
  }
  try {
    const left = parseSolPubkeyArray(a);
    const right = parseSolPubkeyArray(b);
    return left.every((key, i) => key === right[i]);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Verification (VD-3 items 1–5)
// ---------------------------------------------------------------------------

export interface VerifyVaultDescriptorOptions {
  /**
   * This device's identity pubkey for its role (hex). When given, the own
   * member's pubkey for that role must equal it.
   */
  ownIdentityPubKey?: string | null;
}

export type VaultDescriptorVerification =
  | {
      ok: true;
      descriptor: VaultDescriptor;
      hash: string;
      ownMember: VaultDescriptorMember;
      /** False when item 5's xpub comparison was not run (no own xpub). */
      ownXpubChecked: boolean;
    }
  | { ok: false; reason: string };

/**
 * VD-3: refuses unless the hash, shape, every member's WK identity, every
 * used xpub's attestation and this device's own entry all check out.
 *
 * `ownAccountXpub` is this device's own account xpub at
 * m/48'/coin'/orgIndex'/script' (UTXO/EVM), or its own JSON array of 20
 * ed25519 leaves at [vaultIndex][0..19] (Solana) — computed by the device
 * itself. Pass null only where the seed is not unlocked (receipt time): item
 * 5's xpub comparison is then skipped and `ownXpubChecked` is false; every
 * signing path must call again with the xpub.
 */
export function verifyVaultDescriptor(
  descriptorValue: unknown,
  hash: unknown,
  ownWkIdentity: string,
  ownRole: VaultDescriptorRole,
  ownAccountXpub: string | null,
  options: VerifyVaultDescriptorOptions = {},
): VaultDescriptorVerification {
  // 1. Hash
  if (typeof hash !== 'string' || !HASH_HEX.test(hash)) {
    return { ok: false, reason: 'missing or malformed descriptor hash' };
  }
  let computed: string;
  try {
    computed = vaultDescriptorHash(descriptorValue);
  } catch {
    return { ok: false, reason: 'descriptor cannot be serialised' };
  }
  if (computed !== hash) {
    return { ok: false, reason: 'descriptor hash does not match' };
  }

  // 2. Shape
  const shape = parseVaultDescriptorShape(descriptorValue);
  if (!shape.ok) {
    return shape;
  }
  const descriptor = shape.descriptor;
  const family = chainFamily(descriptor.chain) as VaultChainFamily;
  const uses = modeUsesXpubs(descriptor.signingMode);

  const usedXpubs = new Set<string>();
  const usedSolLeaves = new Set<string>();
  for (const member of descriptor.members) {
    const label = `${member.wkIdentity.slice(0, 12)}…`;
    // 3. Identity
    if (
      !isValidCompressedPubKey(member.walletPubKey) ||
      !isValidCompressedPubKey(member.keyPubKey)
    ) {
      return {
        ok: false,
        reason: `signer ${label} has an invalid identity public key`,
      };
    }
    if (member.walletPubKey.toLowerCase() === member.keyPubKey.toLowerCase()) {
      return {
        ok: false,
        reason: `signer ${label} uses the same key for wallet and key`,
      };
    }
    let derivedIdentity: string;
    try {
      derivedIdentity = wkIdentityOf(
        member.walletPubKey,
        member.keyPubKey,
        member.wkIdentity.startsWith('tb1'),
      );
    } catch {
      derivedIdentity = '';
    }
    if (derivedIdentity !== member.wkIdentity) {
      return {
        ok: false,
        reason: `signer ${label}: identity keys do not match the WK identity`,
      };
    }

    // 4. Attestations of every xpub the mode uses
    const roles: Array<[VaultDescriptorRole, boolean]> = [
      ['wallet', uses.wallet],
      ['key', uses.key],
    ];
    for (const [role, used] of roles) {
      if (!used) {
        continue;
      }
      const xpub = role === 'wallet' ? member.xpubWallet : member.xpubKey;
      const signature =
        role === 'wallet'
          ? member.walletXpubSignature
          : member.keyXpubSignature;
      const signerPubKey =
        role === 'wallet' ? member.walletPubKey : member.keyPubKey;
      if (!xpub || !signature) {
        return {
          ok: false,
          reason: `signer ${label} has no attested ${role} xpub`,
        };
      }
      if (
        !verifyBitcoinMessageSignature(
          xpubAttestationMessage(
            role,
            xpub,
            descriptor.chain,
            descriptor.orgIndex,
          ),
          signature,
          signerPubKey.toLowerCase(),
          BITCOIN_MESSAGE_PREFIX,
        )
      ) {
        return {
          ok: false,
          reason: `signer ${label}: the ${role} xpub attestation does not verify`,
        };
      }
      try {
        if (family === 'sol') {
          parseSolPubkeyArray(xpub).forEach((leaf) => {
            if (usedSolLeaves.has(leaf)) {
              throw new Error('duplicate leaf');
            }
            usedSolLeaves.add(leaf);
          });
        } else {
          parseXpub(xpub, descriptor.chain, family === 'utxo');
        }
      } catch {
        return {
          ok: false,
          reason: `signer ${label} has an invalid or duplicated ${role} xpub`,
        };
      }
      if (usedXpubs.has(xpub)) {
        return {
          ok: false,
          reason: `signer ${label} reuses an xpub of another vault key`,
        };
      }
      usedXpubs.add(xpub);
    }
  }

  // 5. Own entry
  const ownMember = descriptor.members.find(
    (m) => m.wkIdentity === ownWkIdentity,
  );
  if (!ownMember) {
    return { ok: false, reason: 'this device is not a signer of this vault' };
  }
  const ownPub = options.ownIdentityPubKey;
  if (ownPub) {
    const memberPub =
      ownRole === 'key' ? ownMember.keyPubKey : ownMember.walletPubKey;
    if (memberPub.toLowerCase() !== ownPub.toLowerCase()) {
      return {
        ok: false,
        reason: "the vault lists another identity key for this device's role",
      };
    }
  }
  if (ownAccountXpub !== null) {
    const memberXpub =
      ownRole === 'key' ? ownMember.xpubKey : ownMember.xpubWallet;
    const usedByMode = ownRole === 'key' ? uses.key : uses.wallet;
    if (usedByMode || memberXpub !== null) {
      if (
        !memberXpub ||
        !sameAccountXpub(descriptor.chain, memberXpub, ownAccountXpub)
      ) {
        return {
          ok: false,
          reason: "the vault's key for this device is not this device's key",
        };
      }
    }
  }

  return {
    ok: true,
    descriptor,
    hash,
    ownMember,
    ownXpubChecked: ownAccountXpub !== null,
  };
}

// ---------------------------------------------------------------------------
// Derivation (VD-4) — replicates relay-enterprise vaultAddressService
// ---------------------------------------------------------------------------

export interface DerivedVaultAddress {
  family: VaultChainFamily;
  /** UTXO/EVM address, or the Solana vault PDA (the deposit address). */
  address: string;
  /**
   * The vault's keys at this index: compressed hex in signer order (UTXO,
   * EVM), or the sorted ed25519 member leaves (Solana).
   */
  pubKeys: string[];
  /** UTXO only: the output script paying this address (hex). */
  scriptPubKey?: string;
  witnessScript?: string;
  redeemScript?: string;
  /** Solana only. */
  multisigPda?: string;
  vaultPda?: string;
  threshold?: number;
}

function toCashAddrIfNeeded(chain: string, address: string): string {
  if (!blockchains[chain as keyof cryptos].cashaddr || !address) {
    return address;
  }
  try {
    return toCashAddress(address);
  } catch {
    return address;
  }
}

/** Threshold check of vaultAddressService.assertValidThreshold. */
function assertValidThreshold(requiredSigners: number, signerCount: number) {
  if (
    !Number.isInteger(requiredSigners) ||
    requiredSigners < 1 ||
    requiredSigners > signerCount
  ) {
    throw new Error(
      `Invalid requiredSigners ${String(requiredSigners)} for ${signerCount} signers`,
    );
  }
}

/** Child pubkeys of every key the mode uses, in signer order (wallet, key). */
function deriveModePubKeys(
  descriptor: VaultDescriptor,
  typeIndex: number,
  addressIndex: number,
  allowFallback: boolean,
): string[] {
  const mode = descriptor.signingMode;
  const out: string[] = [];
  for (const member of descriptor.members) {
    if (mode !== 'key_only') {
      if (!member.xpubWallet) {
        throw new Error('signer is missing its wallet xpub');
      }
      out.push(
        deriveChildPubKeyHex(
          member.xpubWallet,
          descriptor.chain,
          typeIndex,
          addressIndex,
          allowFallback,
        ),
      );
    }
    if (mode !== 'wallet_only') {
      if (!member.xpubKey) {
        throw new Error('signer is missing its key xpub');
      }
      out.push(
        deriveChildPubKeyHex(
          member.xpubKey,
          descriptor.chain,
          typeIndex,
          addressIndex,
          allowFallback,
        ),
      );
    }
  }
  return out;
}

function deriveUtxo(
  descriptor: VaultDescriptor,
  typeIndex: number,
  addressIndex: number,
): DerivedVaultAddress {
  const chain = descriptor.chain;
  const config = blockchains[chain as keyof cryptos];
  assertValidThreshold(descriptor.requiredSigners, descriptor.members.length);
  const network = utxolib.networks[config.libid];
  const single =
    descriptor.signingMode === 'key_only' ||
    descriptor.signingMode === 'wallet_only';
  const m = single
    ? descriptor.requiredSigners
    : descriptor.requiredSigners * 2;
  const pubKeys = deriveModePubKeys(descriptor, typeIndex, addressIndex, true);
  const sorted = [...pubKeys].sort().map((hex) => Buffer.from(hex, 'hex'));
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

  if (config.scriptType === 'p2wsh') {
    const witnessScript = utxolib.script.multisig.output.encode(m, sorted);
    const scriptPubKey = utxolib.script.witnessScriptHash.output.encode(
      utxolib.crypto.sha256(witnessScript),
    );
    return {
      family: 'utxo',
      address: toCashAddrIfNeeded(
        chain,
        utxolib.address.fromOutputScript(scriptPubKey, network),
      ),
      pubKeys,
      scriptPubKey: hex(scriptPubKey),
      witnessScript: hex(witnessScript),
    };
  }
  if (config.scriptType === 'p2sh-p2wsh') {
    const witnessScript = utxolib.script.multisig.output.encode(m, sorted);
    const redeemScript = utxolib.script.witnessScriptHash.output.encode(
      utxolib.crypto.sha256(witnessScript),
    );
    const scriptPubKey = utxolib.script.scriptHash.output.encode(
      utxolib.crypto.hash160(redeemScript),
    );
    return {
      family: 'utxo',
      address: toCashAddrIfNeeded(
        chain,
        utxolib.address.fromOutputScript(scriptPubKey, network),
      ),
      pubKeys,
      scriptPubKey: hex(scriptPubKey),
      witnessScript: hex(witnessScript),
      redeemScript: hex(redeemScript),
    };
  }
  const redeemScript = utxolib.script.multisig.output.encode(m, sorted);
  const scriptPubKey = utxolib.script.scriptHash.output.encode(
    utxolib.crypto.hash160(redeemScript),
  );
  return {
    family: 'utxo',
    address: toCashAddrIfNeeded(
      chain,
      utxolib.address.fromOutputScript(scriptPubKey, network),
    ),
    pubKeys,
    scriptPubKey: hex(scriptPubKey),
    redeemScript: hex(redeemScript),
  };
}

function deriveEvm(
  descriptor: VaultDescriptor,
  typeIndex: number,
  addressIndex: number,
): DerivedVaultAddress {
  const config = blockchains[descriptor.chain as keyof cryptos];
  const { accountSalt, factorySalt, factoryAddress, entrypointAddress } =
    config;
  if (!accountSalt || !factorySalt || !factoryAddress || !entrypointAddress) {
    throw new Error(`Missing EVM configuration for chain ${descriptor.chain}`);
  }
  assertValidThreshold(descriptor.requiredSigners, descriptor.members.length);
  const single =
    descriptor.signingMode === 'key_only' ||
    descriptor.signingMode === 'wallet_only';
  const m = single
    ? descriptor.requiredSigners
    : descriptor.requiredSigners * 2;
  const pubKeys = deriveModePubKeys(descriptor, typeIndex, addressIndex, false);
  const keys = pubKeys.map(
    (hex) => new aaSchnorrMultisig.types.Key(Buffer.from(hex, 'hex')),
  );
  const combined =
    aaSchnorrMultisig.helpers.SchnorrHelpers.getAllCombinedAddrFromKeysStrict(
      keys,
      m,
    );
  const implementation =
    aaSchnorrMultisig.helpers.create2Helpers.predictAccountImplementationAddrOffchain(
      factorySalt,
      factoryAddress,
      entrypointAddress,
    );
  const address =
    aaSchnorrMultisig.helpers.create2Helpers.predictAccountAddrOffchain(
      factoryAddress,
      implementation,
      combined,
      accountSalt,
    );
  return { family: 'evm', address, pubKeys };
}

function deriveSol(
  descriptor: VaultDescriptor,
  typeIndex: number,
  addressIndex: number,
): DerivedVaultAddress {
  const config = blockchains[descriptor.chain as keyof cryptos];
  if (!config.programId) {
    throw new Error(`Solana program id not configured for ${descriptor.chain}`);
  }
  assertValidThreshold(descriptor.requiredSigners, descriptor.members.length);
  if (addressIndex >= SOL_PUBKEY_ARRAY_LENGTH) {
    throw new Error(`Solana address index ${addressIndex} out of range`);
  }
  const programId = new PublicKey(config.programId);
  const dual = descriptor.signingMode === 'sol_dual';
  const leaves: string[] = [];
  for (const member of descriptor.members) {
    if (!member.xpubWallet) {
      throw new Error('signer is missing its wallet pubkeys');
    }
    leaves.push(parseSolPubkeyArray(member.xpubWallet)[addressIndex]);
    if (dual) {
      if (!member.xpubKey) {
        throw new Error('sol_dual mode requires key pubkeys for every signer');
      }
      leaves.push(parseSolPubkeyArray(member.xpubKey)[addressIndex]);
    }
  }
  const threshold = dual
    ? descriptor.requiredSigners * 2
    : descriptor.requiredSigners;
  // Lexicographic by raw 32 bytes — the program's sort_members.
  const sorted = [...leaves].sort((a, b) =>
    Buffer.compare(
      Buffer.from(new PublicKey(a).toBytes()),
      Buffer.from(new PublicKey(b).toBytes()),
    ),
  );
  const [multisigPda] = deriveSolanaMultisigPda(
    sorted.map((p) => new PublicKey(p)),
    threshold,
    programId,
  );
  const [vaultPda] = deriveSolanaVaultPda(multisigPda, typeIndex, programId);
  return {
    family: 'sol',
    address: vaultPda.toBase58(),
    pubKeys: sorted,
    multisigPda: multisigPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    threshold,
  };
}

/**
 * VD-4: the vault address at (typeIndex, addressIndex), exactly as
 * relay-enterprise vaultAddressService derives it. For every vault address
 * the server derives, `typeIndex` is the descriptor's vaultIndex (it occupies
 * the BIP-48 type level for UTXO/EVM and is the vault PDA index on Solana).
 * Throws on anything it cannot derive.
 */
export function deriveVaultAddress(
  descriptor: VaultDescriptor,
  typeIndex: number,
  addressIndex: number,
): DerivedVaultAddress {
  if (!isHdIndex(typeIndex) || !isHdIndex(addressIndex)) {
    throw new Error('derivation index must be an integer in [0, 2^31)');
  }
  const family = chainFamily(descriptor.chain);
  switch (family) {
    case 'utxo':
      return deriveUtxo(descriptor, typeIndex, addressIndex);
    case 'evm':
      return deriveEvm(descriptor, typeIndex, addressIndex);
    case 'sol':
      return deriveSol(descriptor, typeIndex, addressIndex);
    default:
      throw new Error(`unsupported vault chain ${descriptor.chain}`);
  }
}

/** Short display form of a WK identity: first 10 … last 6 characters. */
export function shortWkIdentity(wkIdentity: string): string {
  return wkIdentity.length > 20
    ? `${wkIdentity.slice(0, 10)}…${wkIdentity.slice(-6)}`
    : wkIdentity;
}
