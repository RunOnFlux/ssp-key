/**
 * Device-side guards for enterprise (vault) requests.
 *
 * Every enterprise request arrives from the relay, which this device does not
 * trust. These checks run when a request is received (so a malformed request
 * is never shown) and again right before any key is derived or anything is
 * signed (so nothing that slipped past receipt reaches a signature).
 *
 * H-1 (KEY-2 / KAS-1 / CHN-5): the BIP-48 account level of an enterprise key
 * is the organisation index. Account 0' is the consumer wallet and 99' the
 * reserved recovery account, so an enterprise request that names either
 * would make this device sign with consumer or recovery keys under an
 * enterprise label. Only 100'–99999' are organisation accounts. The vault and
 * address indices are the two non-hardened levels below it and must be
 * integers in [0, 2^31). Anything that is not a plain number is refused: the
 * account index is interpolated into the derivation path string, so a string
 * could inject extra path levels.
 *
 * EVM call-safety (C-4 / EVM-1 / AA-5): see checkVaultEvmUserOp.
 */
import { decodeFunctionData } from 'viem';
import * as abi from '@runonflux/aa-schnorr-multisig-sdk/dist/abi';
import { blockchains } from '@storage/blockchains';
import type { cryptos } from '../types';

/** Lowest BIP-48 account index an organisation may use. */
export const ENTERPRISE_ORG_INDEX_MIN = 100;
/** Highest BIP-48 account index an organisation may use. */
export const ENTERPRISE_ORG_INDEX_MAX = 99999;
/** Exclusive upper bound of a non-hardened BIP-32 child index. */
export const HD_INDEX_LIMIT = 2 ** 31;

/** Chains a Flux node start may name (the flux-sdk start format is Flux-only). */
const FLUX_NODE_CHAINS: readonly string[] = ['flux', 'fluxTestnet'];

/** `upgradeToAndCall(address,bytes)` — UUPS upgrade with initializer call. */
export const SELECTOR_UPGRADE_TO_AND_CALL = '0x4f1ef286';
/** `upgradeTo(address)` — legacy UUPS upgrade. */
export const SELECTOR_UPGRADE_TO = '0x3659cfe6';
const UPGRADE_SELECTORS: readonly string[] = [
  SELECTOR_UPGRADE_TO_AND_CALL,
  SELECTOR_UPGRADE_TO,
];

export class EnterpriseRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnterpriseRequestError';
  }
}

/** True only for an integer organisation index in [100, 99999]. */
export function isEnterpriseOrgIndex(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= ENTERPRISE_ORG_INDEX_MIN &&
    value <= ENTERPRISE_ORG_INDEX_MAX
  );
}

/** True only for an integer in [0, 2^31) — a non-hardened BIP-32 index. */
export function isHdIndex(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < HD_INDEX_LIMIT
  );
}

/**
 * Throws unless (orgIndex, vaultIndex, every addressIndex) is a valid
 * enterprise derivation. Called right before every enterprise key derivation.
 */
export function assertEnterpriseDerivation(
  orgIndex: unknown,
  vaultIndex: unknown,
  addressIndexes: readonly unknown[] = [],
): void {
  if (!isEnterpriseOrgIndex(orgIndex)) {
    throw new EnterpriseRequestError(
      `Refusing enterprise request: organisation index must be an integer between ${ENTERPRISE_ORG_INDEX_MIN} and ${ENTERPRISE_ORG_INDEX_MAX}`,
    );
  }
  if (!isHdIndex(vaultIndex)) {
    throw new EnterpriseRequestError(
      'Refusing enterprise request: vault index must be an integer between 0 and 2^31 - 1',
    );
  }
  addressIndexes.forEach((addressIndex) => {
    if (!isHdIndex(addressIndex)) {
      throw new EnterpriseRequestError(
        'Refusing enterprise request: address index must be an integer between 0 and 2^31 - 1',
      );
    }
  });
}

const isSupportedChainName = (chain: unknown): chain is keyof cryptos =>
  typeof chain === 'string' &&
  Object.prototype.hasOwnProperty.call(blockchains, chain);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Normalises a relay `inputDetails` field (JSON string or array) to an array
 * of entries. Absent → []. Anything else malformed throws.
 */
export function parseInputDetails(
  raw: unknown,
): Array<Record<string, unknown>> {
  if (raw === undefined || raw === null || raw === '') {
    return [];
  }
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new EnterpriseRequestError('Malformed input details');
    }
  }
  if (!Array.isArray(value) || !value.every(isPlainObject)) {
    throw new EnterpriseRequestError('Malformed input details');
  }
  return value;
}

/**
 * Every `addressIndex` named by the request's input details, each validated.
 * An entry without a valid integer addressIndex throws — a request never
 * silently falls back to index 0 when it named something else.
 */
export function inputAddressIndexes(rawInputDetails: unknown): number[] {
  return parseInputDetails(rawInputDetails).map((entry) => {
    if (!isHdIndex(entry.addressIndex)) {
      throw new EnterpriseRequestError(
        'Refusing enterprise request: address index must be an integer between 0 and 2^31 - 1',
      );
    }
    return entry.addressIndex;
  });
}

/**
 * The single address index an EVM / Solana vault request signs at: the first
 * input detail's index, or 0 when the request carries no input details.
 */
export function primaryAddressIndex(rawInputDetails: unknown): number {
  const indexes = inputAddressIndexes(rawInputDetails);
  return indexes.length > 0 ? indexes[0] : 0;
}

/**
 * Receipt-time validation of an `enterprisevaultsign` request. Returns null
 * when the request may be shown, otherwise the reason it is refused.
 */
export function validateVaultSigningRequest(request: unknown): string | null {
  try {
    if (!isPlainObject(request)) {
      return 'request is not an object';
    }
    const { chain } = request;
    if (!isSupportedChainName(chain)) {
      return 'unsupported chain';
    }
    const chainType = blockchains[chain].chainType;
    const addressIndexes = inputAddressIndexes(request.inputDetails);
    assertEnterpriseDerivation(
      request.orgIndex,
      request.vaultIndex,
      addressIndexes,
    );
    if (chainType !== 'evm' && chainType !== 'sol' && !addressIndexes.length) {
      return 'UTXO vault request carries no input details';
    }
    if (typeof request.rawUnsignedTx !== 'string' || !request.rawUnsignedTx) {
      return 'request carries no transaction to verify';
    }
    if (request.signMessage !== undefined) {
      // CHN-5: message signing exists only for EVM vaults (personal_sign over
      // a smart account). On any other chain the device would show a message
      // while signing the fund-moving bytes in rawUnsignedTx.
      if (chainType !== 'evm') {
        return 'message signing is only supported for EVM vaults';
      }
      if (typeof request.signMessage !== 'string') {
        return 'message to sign is not text';
      }
      if (request.evmUserOp !== undefined && request.evmUserOp !== null) {
        return 'request carries both a message and an operation';
      }
    }
    if (
      request.evmUserOp !== undefined &&
      request.evmUserOp !== null &&
      chainType !== 'evm'
    ) {
      return 'EVM operation on a non-EVM chain';
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid request';
  }
}

/** Receipt-time validation of an `enterprisevaultxpub` request. */
export function validateVaultXpubRequest(request: unknown): string | null {
  try {
    if (!isPlainObject(request)) {
      return 'request is not an object';
    }
    if (!isSupportedChainName(request.chain)) {
      return 'unsupported chain';
    }
    assertEnterpriseDerivation(request.orgIndex, request.vaultIndex);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid request';
  }
}

/**
 * The address index of a Flux node start. Absent → 0 (the field is optional
 * in the wallet's payload); present but invalid → throws.
 */
export function fluxNodeAddressIndex(request: Record<string, unknown>): number {
  const { addressIndex } = request;
  if (addressIndex === undefined || addressIndex === null) {
    return 0;
  }
  if (!isHdIndex(addressIndex)) {
    throw new EnterpriseRequestError(
      'Refusing enterprise request: address index must be an integer between 0 and 2^31 - 1',
    );
  }
  return addressIndex;
}

/** Receipt-time validation of an `enterprisefluxnodestart` request. */
export function validateFluxNodeStartRequest(request: unknown): string | null {
  try {
    if (!isPlainObject(request)) {
      return 'request is not an object';
    }
    const { chain } = request;
    if (!isSupportedChainName(chain) || !FLUX_NODE_CHAINS.includes(chain)) {
      return 'unsupported chain';
    }
    assertEnterpriseDerivation(request.orgIndex, request.vaultIndex, [
      fluxNodeAddressIndex(request),
    ]);
    if (
      typeof request.collateralVout !== 'number' ||
      !Number.isInteger(request.collateralVout) ||
      request.collateralVout < 0
    ) {
      return 'collateral output index must be a non-negative integer';
    }
    if (
      request.delegates !== undefined &&
      request.delegates !== null &&
      (!Array.isArray(request.delegates) ||
        !request.delegates.every((d) => typeof d === 'string'))
    ) {
      return 'delegates must be a list of public keys';
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid request';
  }
}

export type VaultEvmUserOpCheck =
  | { ok: true; userOp: Record<string, unknown> }
  | { ok: false; reason: string };

const isHexString = (value: unknown): value is `0x${string}` =>
  typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value);

/**
 * Parses a vault `evmUserOp` (JSON string or object) and applies the EVM
 * call-safety rules (SECURITY_FIX_CONTRACT, "EVM call-safety rules"):
 *
 * - exactly one shape: a flat UserOperation. A payload that also nests a
 *   `userOpRequest` is refused, so the hash check and the display can never
 *   read two different operations;
 * - the account call must be `execute(target, value, data)`. `executeBatch`
 *   and anything else are refused — this device cannot show them call by call;
 * - a call whose target is the account itself is refused (self-calls reach
 *   the account's own admin surface: upgrades, deposits, roles);
 * - `upgradeToAndCall` / `upgradeTo` are refused on any target;
 * - native value together with calldata is a payable contract call, which
 *   this screen cannot represent — it would show it as a plain native send.
 *   Refused.
 */
export function checkVaultEvmUserOp(evmUserOp: unknown): VaultEvmUserOpCheck {
  let parsed: unknown = evmUserOp;
  if (typeof evmUserOp === 'string') {
    try {
      parsed = JSON.parse(evmUserOp);
    } catch {
      return { ok: false, reason: 'Operation is not valid JSON' };
    }
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: 'Operation is not an object' };
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'userOpRequest')) {
    return {
      ok: false,
      reason: 'Operation carries two different shapes; refusing to sign',
    };
  }
  const { sender, callData } = parsed;
  if (typeof sender !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(sender)) {
    return { ok: false, reason: 'Operation has no valid sender' };
  }
  if (!isHexString(callData) || callData.length < 10) {
    return { ok: false, reason: 'Operation has no account call' };
  }
  let decoded: { functionName: string; args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({
      abi: abi.MultiSigSmartAccount_abi,
      data: callData,
    });
  } catch {
    return { ok: false, reason: 'Could not decode the account call' };
  }
  if (decoded.functionName !== 'execute') {
    return {
      ok: false,
      reason: `Account call ${decoded.functionName} cannot be verified on this device`,
    };
  }
  const args = decoded.args ?? [];
  const target = args[0];
  const value = args[1];
  const data = args[2];
  if (
    typeof target !== 'string' ||
    typeof value !== 'bigint' ||
    !isHexString(data)
  ) {
    return { ok: false, reason: 'Could not decode the account call' };
  }
  if (target.toLowerCase() === sender.toLowerCase()) {
    return {
      ok: false,
      reason: 'The operation calls the vault account itself; refusing to sign',
    };
  }
  const hasCalldata = data.length > 2;
  if (hasCalldata) {
    const selector = data.slice(0, 10).toLowerCase();
    if (UPGRADE_SELECTORS.includes(selector)) {
      return {
        ok: false,
        reason: 'The operation upgrades a contract; refusing to sign',
      };
    }
    if (value > 0n) {
      return {
        ok: false,
        reason:
          'The operation sends native value with a contract call, which this device cannot display; refusing to sign',
      };
    }
  }
  return { ok: true, userOp: parsed };
}
