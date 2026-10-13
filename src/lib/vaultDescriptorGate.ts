/**
 * Per-request vault descriptor checks (VD-3 / VD-4).
 *
 * Every enterprise vault request (sign, message sign, Flux node start) must
 * carry the vault descriptor and its hash. The Key:
 *
 * 1. verifies the descriptor (vaultDescriptor.verifyVaultDescriptor) and that
 *    the request names the same chain, organisation, vault and mode;
 * 2. checks the pin: first sight needs the user's confirmation, a different
 *    descriptor for a pinned vault is a hard refusal;
 * 3. re-derives what it signs from the descriptor: every UTXO input script,
 *    the change outputs (everything else is a displayed recipient), the EVM
 *    account (userOp.sender) and Schnorr signer keys, the Solana multisig and
 *    vault PDA, and the Flux node collateral script.
 *
 * Receipt runs these without this device's own vault xpub (the seed is
 * locked); the sign action runs them again with it, persists a confirmed pin
 * only then, and signs only after every check passed.
 */
import { Buffer } from 'buffer';
import utxolib from '@runonflux/utxo-lib';
import { toCashAddress } from 'bchaddrjs';
import { blockchains } from '@storage/blockchains';
import type { cryptos } from '../types';
import { isHdIndex, parseInputDetails } from './enterpriseGuards';
import {
  chainFamily,
  deriveVaultAddress,
  verifyVaultDescriptor,
  type DerivedVaultAddress,
  type VaultDescriptor,
} from './vaultDescriptor';
import {
  VaultPinStoreError,
  clearStagedVaultPin,
  findConflictingSlotPin,
  getVaultPin,
  isVaultPinStaged,
  pinVaultDescriptor,
  vaultPinKey,
  vaultSlotsOf,
} from './vaultPins';
import type { VaultSolBinding } from './vaultSolanaDecode';

export type VaultDescriptorRefusal =
  | 'missing' // old app: no descriptor at all
  | 'invalid' // does not verify, or does not match the request
  | 'mismatch' // differs from the pinned descriptor of this vault
  | 'unconfirmed'; // first sight, the user has not confirmed the pin

export type VaultDescriptorVerdict =
  | {
      kind: 'ok';
      descriptor: VaultDescriptor;
      hash: string;
      pinKey: string;
      /** False while the pin is only confirmed on screen (not yet saved). */
      persisted: boolean;
    }
  | {
      kind: 'needs_pin';
      descriptor: VaultDescriptor;
      hash: string;
      pinKey: string;
    }
  | { kind: 'refused'; code: VaultDescriptorRefusal; reason: string };

export class VaultDescriptorError extends Error {
  readonly code: VaultDescriptorRefusal;
  constructor(code: VaultDescriptorRefusal, message: string) {
    super(message);
    this.name = 'VaultDescriptorError';
    this.code = code;
  }
}

/** What this device knows about itself. */
export interface OwnVaultIdentity {
  /** This device's WK identity (sspWalletKeyInternalIdentity). */
  wkIdentity: string;
  /** This device's identity pubkey (the Key's /10/0 key), when known. */
  identityPubKey?: string | null;
  /**
   * This device's own account xpub for the vault chain and org (Solana: its
   * JSON array of 20 leaves for the vault). Null at receipt time.
   */
  accountXpub: string | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The descriptor + hash a request carries (object or JSON string). */
function readDescriptorFields(
  request: Record<string, unknown>,
): { descriptor: unknown; hash: unknown } | null {
  let descriptor: unknown = request.vaultDescriptor;
  const hash = request.vaultDescriptorHash;
  if (
    descriptor === undefined ||
    descriptor === null ||
    descriptor === '' ||
    hash === undefined ||
    hash === null ||
    hash === ''
  ) {
    return null;
  }
  if (typeof descriptor === 'string') {
    try {
      descriptor = JSON.parse(descriptor);
    } catch {
      descriptor = undefined;
    }
  }
  return { descriptor, hash };
}

/**
 * The request must name the descriptor's chain, organisation and vault
 * (and, when it names them, the same org/vault ids and signing mode).
 * Returns the reason it does not, or null.
 */
export function checkRequestMatchesDescriptor(
  request: Record<string, unknown>,
  descriptor: VaultDescriptor,
): string | null {
  if (request.chain !== descriptor.chain) {
    return 'the request names a different chain than the vault';
  }
  if (request.orgIndex !== descriptor.orgIndex) {
    return 'the request names a different organisation index than the vault';
  }
  if (request.vaultIndex !== descriptor.vaultIndex) {
    return 'the request names a different vault index than the vault';
  }
  if (
    request.orgId !== undefined &&
    request.orgId !== null &&
    request.orgId !== descriptor.orgId
  ) {
    return 'the request names a different organisation than the vault';
  }
  if (
    request.vaultId !== undefined &&
    request.vaultId !== null &&
    request.vaultId !== descriptor.vaultId
  ) {
    return 'the request names a different vault than the descriptor';
  }
  const mode = request.signingMode;
  if (mode !== undefined && mode !== null && mode !== '') {
    if (mode !== descriptor.signingMode) {
      return 'the request names a different signing mode than the vault';
    }
  }
  return null;
}

/**
 * VD-3 for one request: descriptor present, verified, matching the request,
 * and its pin state. Never throws.
 */
export function evaluateVaultDescriptor(
  request: unknown,
  own: OwnVaultIdentity,
): VaultDescriptorVerdict {
  if (!isPlainObject(request)) {
    return { kind: 'refused', code: 'invalid', reason: 'malformed request' };
  }
  const fields = readDescriptorFields(request);
  if (!fields) {
    return {
      kind: 'refused',
      code: 'missing',
      reason: 'Update required: vault descriptor missing',
    };
  }
  if (!own.wkIdentity) {
    return {
      kind: 'refused',
      code: 'invalid',
      reason: 'this device has no WK identity',
    };
  }
  const verified = verifyVaultDescriptor(
    fields.descriptor,
    fields.hash,
    own.wkIdentity,
    'key',
    own.accountXpub,
    { ownIdentityPubKey: own.identityPubKey ?? null },
  );
  if (!verified.ok) {
    return { kind: 'refused', code: 'invalid', reason: verified.reason };
  }
  const { descriptor, hash } = verified;
  const bindingProblem = checkRequestMatchesDescriptor(request, descriptor);
  if (bindingProblem) {
    return { kind: 'refused', code: 'invalid', reason: bindingProblem };
  }
  const pinKey = vaultPinKey(descriptor.orgId, descriptor.vaultId);
  let pinnedHash: string | null;
  let slotConflict: boolean;
  try {
    pinnedHash = getVaultPin(pinKey)?.hash ?? null;
    // The same slot — (orgId, chain, orgIndex, vaultIndex), or the orgId-free
    // key slot (chain, orgIndex, vaultIndex) — pinned to another descriptor,
    // e.g. a different signer set under a NEW vaultId or a NEW orgId, is the
    // same hard refusal as a changed descriptor, never a first-sight prompt.
    slotConflict =
      findConflictingSlotPin(vaultSlotsOf(descriptor), hash) !== null;
  } catch (error) {
    return {
      kind: 'refused',
      code: 'invalid',
      reason:
        error instanceof VaultPinStoreError
          ? error.message
          : 'vault pins are unreadable',
    };
  }
  if ((pinnedHash !== null && pinnedHash !== hash) || slotConflict) {
    return {
      kind: 'refused',
      code: 'mismatch',
      reason:
        'The configuration of this vault changed since you confirmed it on this device',
    };
  }
  if (pinnedHash !== null) {
    return { kind: 'ok', descriptor, hash, pinKey, persisted: true };
  }
  if (isVaultPinStaged(pinKey, hash)) {
    return { kind: 'ok', descriptor, hash, pinKey, persisted: false };
  }
  return { kind: 'needs_pin', descriptor, hash, pinKey };
}

/**
 * Sign-time gate: the verdict must be `ok` (pinned, or confirmed on screen)
 * or this throws a VaultDescriptorError. Returns the verified descriptor.
 */
export function requireVaultDescriptor(
  request: unknown,
  own: OwnVaultIdentity,
): Extract<VaultDescriptorVerdict, { kind: 'ok' }> {
  const verdict = evaluateVaultDescriptor(request, own);
  if (verdict.kind === 'ok') {
    return verdict;
  }
  if (verdict.kind === 'needs_pin') {
    throw new VaultDescriptorError(
      'unconfirmed',
      'This vault has not been confirmed on this device',
    );
  }
  throw new VaultDescriptorError(verdict.code, verdict.reason);
}

/**
 * Persists a pin the user confirmed on screen. Called by the sign action
 * after the full verification (own xpub included) and before any signature.
 * Throws when the pin cannot be saved.
 */
export function commitVaultPin(
  verdict: Extract<VaultDescriptorVerdict, { kind: 'ok' }>,
  vaultName?: string,
): void {
  if (verdict.persisted) {
    return;
  }
  try {
    pinVaultDescriptor(verdict.descriptor, verdict.hash, vaultName);
  } catch (error) {
    throw new VaultDescriptorError(
      'mismatch',
      error instanceof Error ? error.message : 'Failed to save the vault pin',
    );
  }
  clearStagedVaultPin(verdict.pinKey);
}

// ---------------------------------------------------------------------------
// VD-4 checks
// ---------------------------------------------------------------------------

/** Derived vault address at the vault's own type index. Throws. */
export function deriveVaultAddressAt(
  descriptor: VaultDescriptor,
  addressIndex: number,
): DerivedVaultAddress {
  return deriveVaultAddress(descriptor, descriptor.vaultIndex, addressIndex);
}

const sameHex = (a: unknown, b: string | undefined): boolean =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.toLowerCase() === b.toLowerCase();

const absentScript = (value: unknown): boolean =>
  value === undefined || value === null || value === '';

export interface VaultUtxoInputScripts {
  addressIndex: number;
  witnessScript?: string;
  redeemScript?: string;
  /** Output script of the derived vault address this input spends (hex). */
  scriptPubKey: string;
}

export type VaultUtxoCheck =
  | {
      ok: true;
      /** Address of the first input (the vault address being spent). */
      sender: string;
      /** Every output that is not change: what the user must see. */
      recipients: Array<{ address: string; amount: string }>;
      /** Derived scripts per input, in input order. */
      inputs: VaultUtxoInputScripts[];
    }
  | { ok: false; reason: string };

/**
 * UTXO (VD-4): every input's scripts (inputDetails) equal the scripts derived
 * from the descriptor at that input's address index; an output paying a
 * derived vault address at a change index the builder uses (the inputs'
 * address indices, or index 0) is change; every other output is a recipient.
 * Zero-value OP_RETURN outputs carry data (memo) and move nothing.
 */
export function checkVaultUtxoTransaction(
  descriptor: VaultDescriptor,
  rawTxHex: unknown,
  rawInputDetails: unknown,
): VaultUtxoCheck {
  try {
    if (chainFamily(descriptor.chain) !== 'utxo') {
      return { ok: false, reason: 'not a UTXO vault' };
    }
    if (typeof rawTxHex !== 'string' || !rawTxHex) {
      return { ok: false, reason: 'no transaction to verify' };
    }
    const config = blockchains[descriptor.chain as keyof cryptos];
    const network = utxolib.networks[config.libid];
    const tx = utxolib.Transaction.fromHex(rawTxHex, network) as {
      ins: unknown[];
      outs: Array<{ value: number; script: Buffer }>;
    };
    const entries = parseInputDetails(rawInputDetails);
    if (entries.length === 0 || entries.length !== tx.ins.length) {
      return {
        ok: false,
        reason: 'the input details do not match the transaction inputs',
      };
    }
    const derivedAt = new Map<number, DerivedVaultAddress>();
    const derive = (index: number) => {
      let derived = derivedAt.get(index);
      if (!derived) {
        derived = deriveVaultAddressAt(descriptor, index);
        derivedAt.set(index, derived);
      }
      return derived;
    };
    const inputs: VaultUtxoInputScripts[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!isHdIndex(entry.addressIndex)) {
        return { ok: false, reason: `input ${i} has no valid address index` };
      }
      const derived = derive(entry.addressIndex);
      const witnessOk = derived.witnessScript
        ? sameHex(entry.witnessScript, derived.witnessScript)
        : absentScript(entry.witnessScript);
      const redeemOk = derived.redeemScript
        ? sameHex(entry.redeemScript, derived.redeemScript)
        : absentScript(entry.redeemScript);
      if (!witnessOk || !redeemOk) {
        return {
          ok: false,
          reason: `input ${i} does not spend a vault address derived from the vault's keys`,
        };
      }
      if (!derived.scriptPubKey) {
        return {
          ok: false,
          reason: `input ${i} has no derivable vault script`,
        };
      }
      inputs.push({
        addressIndex: entry.addressIndex,
        witnessScript: derived.witnessScript,
        redeemScript: derived.redeemScript,
        scriptPubKey: derived.scriptPubKey,
      });
    }
    const changeScripts = new Set<string>();
    [...new Set([...inputs.map((input) => input.addressIndex), 0])].forEach(
      (index) => {
        const script = derive(index).scriptPubKey;
        if (script) {
          changeScripts.add(script.toLowerCase());
        }
      },
    );
    const recipients: Array<{ address: string; amount: string }> = [];
    for (const out of tx.outs) {
      const scriptHex = Buffer.from(out.script).toString('hex').toLowerCase();
      if (changeScripts.has(scriptHex)) {
        continue;
      }
      if (out.script.length > 0 && out.script[0] === 0x6a) {
        if (Number(out.value) !== 0) {
          return {
            ok: false,
            reason: 'an OP_RETURN output burns funds',
          };
        }
        continue;
      }
      let address: string;
      try {
        address = utxolib.address.fromOutputScript(out.script, network);
      } catch {
        return {
          ok: false,
          reason: 'an output pays a script this device cannot display',
        };
      }
      if (config.cashaddr) {
        address = toCashAddress(address);
      }
      recipients.push({ address, amount: String(out.value) });
    }
    return {
      ok: true,
      sender: derive(inputs[0].addressIndex).address,
      recipients,
      inputs,
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? `could not verify the transaction: ${error.message}`
          : 'could not verify the transaction',
    };
  }
}

/** Normalises allSignerKeys (JSON string or array) to a string array. */
function parseSignerKeys(raw: unknown): string[] | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || !value.every((k) => typeof k === 'string')) {
    return null;
  }
  return value;
}

/**
 * EVM (VD-4): `sender` (when given) is the vault account derived at this
 * address index, and every Schnorr signer key the request supplies is one of
 * the vault's keys at that index, with no duplicates. When this device is
 * about to sign (`ownSignerKey` given), the signer list must be present and
 * contain its OWN key (wallet parity). Returns the reason to refuse, or null.
 */
export function checkVaultEvmAccount(
  descriptor: VaultDescriptor,
  addressIndex: number,
  sender: unknown,
  allSignerKeys: unknown,
  ownSignerKey?: string,
): string | null {
  try {
    if (chainFamily(descriptor.chain) !== 'evm') {
      return 'not an EVM vault';
    }
    const derived = deriveVaultAddressAt(descriptor, addressIndex);
    if (sender !== undefined) {
      if (
        typeof sender !== 'string' ||
        sender.toLowerCase() !== derived.address.toLowerCase()
      ) {
        return 'the operation is not sent from this vault account';
      }
    }
    if (ownSignerKey !== undefined) {
      if (allSignerKeys === undefined || allSignerKeys === null) {
        return 'the request names no signer keys';
      }
    }
    if (allSignerKeys !== undefined && allSignerKeys !== null) {
      const keys = parseSignerKeys(allSignerKeys);
      if (!keys) {
        return 'malformed signer key list';
      }
      const vaultKeys = new Set(derived.pubKeys.map((k) => k.toLowerCase()));
      const seen = new Set<string>();
      for (const key of keys) {
        const lower = key.toLowerCase();
        if (!vaultKeys.has(lower) || seen.has(lower)) {
          return 'a signer key is not a key of this vault';
        }
        seen.add(lower);
      }
      if (ownSignerKey !== undefined && !seen.has(ownSignerKey.toLowerCase())) {
        return "this device's key is not one of the request's signer keys";
      }
    }
    return null;
  } catch (error) {
    return error instanceof Error
      ? `could not derive the vault account: ${error.message}`
      : 'could not derive the vault account';
  }
}

/** Solana (VD-4): the multisig + vault PDA and members of the pinned vault. */
export function vaultSolBinding(
  descriptor: VaultDescriptor,
  addressIndex: number,
): VaultSolBinding {
  const derived = deriveVaultAddressAt(descriptor, addressIndex);
  if (
    derived.family !== 'sol' ||
    !derived.multisigPda ||
    !derived.vaultPda ||
    derived.threshold === undefined
  ) {
    throw new Error('not a Solana vault');
  }
  return {
    multisigPda: derived.multisigPda,
    vaultPda: derived.vaultPda,
    members: derived.pubKeys,
    threshold: derived.threshold,
  };
}

/**
 * Flux node start (VD-4): the collateral redeem script (and address, when the
 * request names it) is the vault address derived at this address index.
 */
export function checkFluxNodeCollateral(
  descriptor: VaultDescriptor,
  addressIndex: number,
  redeemScript: unknown,
  collateralAddress: unknown,
): string | null {
  try {
    const derived = deriveVaultAddressAt(descriptor, addressIndex);
    if (derived.family !== 'utxo' || !derived.redeemScript) {
      return 'not a P2SH vault';
    }
    if (!sameHex(redeemScript, derived.redeemScript)) {
      return 'the collateral script is not this vault address';
    }
    if (
      collateralAddress !== undefined &&
      collateralAddress !== null &&
      collateralAddress !== '' &&
      collateralAddress !== derived.address
    ) {
      return 'the collateral address is not this vault address';
    }
    return null;
  } catch (error) {
    return error instanceof Error
      ? `could not derive the collateral address: ${error.message}`
      : 'could not derive the collateral address';
  }
}

/**
 * The fields the Flux node approval screen shows, exactly as Home passes
 * them (HomeRequests), so receipt and screen agree on which request a
 * verdict belongs to.
 */
export function fluxNodeFingerprint(fields: {
  chain: string;
  nodeName: string;
  collateralAmount: string;
  collateralAddress?: string;
  collateralTxid?: string;
  collateralVout?: number;
  delegates: string[];
}): string {
  return JSON.stringify([
    fields.chain,
    fields.nodeName,
    fields.collateralAmount,
    fields.collateralAddress,
    fields.collateralTxid,
    fields.collateralVout,
    fields.delegates,
  ]);
}

/** fluxNodeFingerprint of a raw request, with HomeRequests' prop mapping. */
export function fluxNodeRequestFingerprint(
  data: Record<string, unknown>,
): string {
  return fluxNodeFingerprint({
    chain: (data.chain as string) || '',
    nodeName: (data.nodeName as string) || '',
    collateralAmount: (data.collateralAmount as string) || '',
    collateralAddress: (data.collateralAddress as string) || undefined,
    collateralTxid: (data.collateralTxid as string) || undefined,
    collateralVout:
      typeof data.collateralVout === 'number' ? data.collateralVout : undefined,
    delegates: (data.delegates as string[]) || [],
  });
}

// ---------------------------------------------------------------------------
// Machine-readable refusal codes (forwarded by SSP Wallet to the app)
// ---------------------------------------------------------------------------

export type VaultRejectionCode =
  | 'VAULT_DESCRIPTOR_CHANGED' // pinned hash mismatch
  | 'VAULT_DESCRIPTOR_MISSING' // update required
  | 'VAULT_PIN_REFUSED' // the user declined (or never gave) the pin confirmation
  | 'VAULT_DESCRIPTOR_INVALID'; // verification failed

export function vaultRejectionCode(
  code: VaultDescriptorRefusal,
): VaultRejectionCode {
  switch (code) {
    case 'mismatch':
      return 'VAULT_DESCRIPTOR_CHANGED';
    case 'missing':
      return 'VAULT_DESCRIPTOR_MISSING';
    case 'unconfirmed':
      return 'VAULT_PIN_REFUSED';
    default:
      return 'VAULT_DESCRIPTOR_INVALID';
  }
}

let pendingRejectionCode: VaultRejectionCode | null = null;

/**
 * Set by an approval screen right before it rejects a request because of
 * the vault descriptor (or the declined pin confirmation), so the code that
 * posts the rejection can include it. Null clears it (a plain rejection).
 */
export function setVaultRejectionCode(code: VaultRejectionCode | null): void {
  pendingRejectionCode = code;
}

/** The pending rejection code, if any. Single-use. */
export function consumeVaultRejectionCode(): VaultRejectionCode | null {
  const code = pendingRejectionCode;
  pendingRejectionCode = null;
  return code;
}

// ---------------------------------------------------------------------------
// Rejection payloads posted to SSP Wallet
// ---------------------------------------------------------------------------
//
// The machine-readable code travels as `errorCode` (the field SSP Wallet
// reads and forwards to SSP Enterprise). Any other refusal carries no
// errorCode; SSP Wallet then answers the app with KEY_REJECTED.

/** Payload of `enterprisevaultsignrejected` (JSON.stringify it). */
export function vaultSignRejectionPayload(
  requestId: unknown,
  errorCode: VaultRejectionCode | null,
  error?: string,
): Record<string, unknown> {
  return {
    requestId: typeof requestId === 'string' ? requestId : '',
    ...(errorCode ? { errorCode } : {}),
    ...(error ? { error } : {}),
  };
}

/** Refusal payload of `enterprisefluxnodestarted` (JSON.stringify it). */
export function fluxNodeRejectionPayload(
  requestId: unknown,
  error: string,
  errorCode: VaultRejectionCode | null,
): Record<string, unknown> {
  return {
    requestId: typeof requestId === 'string' ? requestId : '',
    error,
    ...(errorCode ? { errorCode } : {}),
  };
}
