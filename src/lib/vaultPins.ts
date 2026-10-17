/**
 * Vault descriptor pins (VD-3 item 6).
 *
 * The first time this device sees a vault it shows the vault's signer set and
 * asks the user to confirm it (trust on first use). The confirmed descriptor
 * hash is pinned under `${orgId}:${vaultId}`; every later request for that
 * vault must carry exactly the pinned descriptor. A different descriptor is a
 * hard refusal until the user resets the pin in Settings.
 *
 * Pins are ALSO indexed by two slots (exact formats shared with SSP Wallet):
 *  - `${orgId}:${chain}:${orgIndex}:${vaultIndex}`, and
 *  - the orgId-free key slot `${chain}:${orgIndex}:${vaultIndex}` — it names
 *    the key material (m/48'/coin'/orgIndex'/script'/vaultIndex). orgIndex is
 *    server-unique and immutable, so an honest server never reuses it under
 *    another orgId.
 * A server presenting a different signer set for an occupied slot — under a
 * NEW vaultId, or even a NEW orgId — is the same hard refusal as a changed
 * descriptor, not a fresh first-sight prompt. Both slots are stored with every
 * pin; records without them derive them from their stored
 * orgId/chain/orgIndex/vaultIndex (migration on read), and a record lacking
 * those fields is slot-less.
 *
 * Pins live in their own MMKV store (public data: hashes and vault metadata).
 * A confirmation given on the pin screen is only STAGED in memory; the sign
 * action persists it after it has verified the descriptor completely,
 * including this device's own vault xpub, which needs the unlocked seed.
 *
 * Also holds the small verdict store the approval screens read (the screens
 * receive only display fields from Home, not the request itself).
 */
import { useSyncExternalStore } from 'react';
import { createMMKV } from 'react-native-mmkv';
import type { VaultDescriptor } from './vaultDescriptor';

const PINS_KEY = 'vaultDescriptorPins';

export interface VaultPinRecord {
  hash: string;
  orgId: string;
  vaultId: string;
  chain: string;
  orgIndex: number;
  vaultIndex: number;
  signingMode: string;
  requiredSigners: number;
  totalSigners: number;
  /** Name the enterprise app claimed when the pin was confirmed. */
  vaultName?: string;
  pinnedAt: number;
  /** `${orgId}:${chain}:${orgIndex}:${vaultIndex}` (see vaultSlotKey). */
  slot?: string;
  /** `${chain}:${orgIndex}:${vaultIndex}` (see vaultKeySlotKey). */
  keySlot?: string;
}

export class VaultPinStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultPinStoreError';
  }
}

let pinStore: ReturnType<typeof createMMKV> | null = null;
const pins = () => {
  if (!pinStore) {
    pinStore = createMMKV({ id: 'ssp-vault-descriptor-pins' });
  }
  return pinStore;
};

export const vaultPinKey = (orgId: string, vaultId: string): string =>
  `${orgId}:${vaultId}`;

/** The vault's org slot. Same format as SSP Wallet. */
export const vaultSlotKey = (
  orgId: string,
  chain: string,
  orgIndex: number,
  vaultIndex: number,
): string => `${orgId}:${chain}:${orgIndex}:${vaultIndex}`;

/** The vault's orgId-free key slot. Same format as SSP Wallet. */
export const vaultKeySlotKey = (
  chain: string,
  orgIndex: number,
  vaultIndex: number,
): string => `${chain}:${orgIndex}:${vaultIndex}`;

export interface VaultSlots {
  slot: string;
  keySlot: string;
}

/** Both slots of a descriptor. */
export function vaultSlotsOf(descriptor: {
  orgId: string;
  chain: string;
  orgIndex: number;
  vaultIndex: number;
}): VaultSlots {
  return {
    slot: vaultSlotKey(
      descriptor.orgId,
      descriptor.chain,
      descriptor.orgIndex,
      descriptor.vaultIndex,
    ),
    keySlot: vaultKeySlotKey(
      descriptor.chain,
      descriptor.orgIndex,
      descriptor.vaultIndex,
    ),
  };
}

const hasSlotFields = (record: VaultPinRecord): boolean =>
  typeof record.chain === 'string' &&
  Number.isInteger(record.orgIndex) &&
  Number.isInteger(record.vaultIndex);

/** Org slot of a stored pin: stored, else derived from its fields, else null. */
export function pinRecordSlot(record: VaultPinRecord): string | null {
  if (typeof record.slot === 'string' && record.slot) {
    return record.slot;
  }
  if (typeof record.orgId === 'string' && hasSlotFields(record)) {
    return vaultSlotKey(
      record.orgId,
      record.chain,
      record.orgIndex,
      record.vaultIndex,
    );
  }
  return null;
}

/** orgId-free key slot of a stored pin: stored, else derived, else null. */
export function pinRecordKeySlot(record: VaultPinRecord): string | null {
  if (typeof record.keySlot === 'string' && record.keySlot) {
    return record.keySlot;
  }
  if (hasSlotFields(record)) {
    return vaultKeySlotKey(record.chain, record.orgIndex, record.vaultIndex);
  }
  return null;
}

/**
 * A pin occupying either slot with a different descriptor hash, under any pin
 * key — or null. Throws VaultPinStoreError when the store is unreadable.
 */
export function findConflictingSlotPin(
  slots: VaultSlots,
  hash: string,
): { pinKey: string; record: VaultPinRecord } | null {
  for (const [pinKey, record] of Object.entries(readVaultPins())) {
    if (record.hash === hash) {
      continue;
    }
    if (
      pinRecordSlot(record) === slots.slot ||
      pinRecordKeySlot(record) === slots.keySlot
    ) {
      return { pinKey, record };
    }
  }
  return null;
}

const isPinRecord = (value: unknown): value is VaultPinRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const r = value as Record<string, unknown>;
  return (
    typeof r.hash === 'string' &&
    typeof r.orgId === 'string' &&
    typeof r.vaultId === 'string' &&
    typeof r.chain === 'string' &&
    typeof r.pinnedAt === 'number' &&
    (r.slot === undefined || typeof r.slot === 'string') &&
    (r.keySlot === undefined || typeof r.keySlot === 'string')
  );
};

/**
 * Every pin, by pin key. Throws VaultPinStoreError when the store cannot be
 * read — a corrupt store must never read as "nothing pinned" (that would turn
 * every vault into first sight).
 */
export function readVaultPins(): Record<string, VaultPinRecord> {
  const raw = pins().getString(PINS_KEY);
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VaultPinStoreError('Vault pins are unreadable');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new VaultPinStoreError('Vault pins are unreadable');
  }
  const out: Record<string, VaultPinRecord> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isPinRecord(value)) {
      throw new VaultPinStoreError('Vault pins are unreadable');
    }
    out[key] = value;
  }
  return out;
}

/** The pin for this vault, or null. Throws when the store is unreadable. */
export function getVaultPin(pinKey: string): VaultPinRecord | null {
  return readVaultPins()[pinKey] ?? null;
}

function writeVaultPins(all: Record<string, VaultPinRecord>): void {
  pins().set(PINS_KEY, JSON.stringify(all));
  emit();
}

/**
 * Pins a descriptor. Synchronous and verified: throws unless the pin reads
 * back, so a caller that proceeds to sign knows the pin is on disk. Refuses
 * to overwrite a different existing pin (re-pinning is a Settings reset).
 */
export function pinVaultDescriptor(
  descriptor: VaultDescriptor,
  hash: string,
  vaultName?: string,
): VaultPinRecord {
  const key = vaultPinKey(descriptor.orgId, descriptor.vaultId);
  const slots = vaultSlotsOf(descriptor);
  const all = readVaultPins();
  const existing = all[key];
  if (existing) {
    if (existing.hash !== hash) {
      throw new VaultPinStoreError(
        'This vault is pinned to a different configuration',
      );
    }
    return existing;
  }
  if (findConflictingSlotPin(slots, hash)) {
    throw new VaultPinStoreError(
      'This vault slot is pinned to a different configuration',
    );
  }
  const record: VaultPinRecord = {
    hash,
    orgId: descriptor.orgId,
    vaultId: descriptor.vaultId,
    chain: descriptor.chain,
    orgIndex: descriptor.orgIndex,
    vaultIndex: descriptor.vaultIndex,
    signingMode: descriptor.signingMode,
    requiredSigners: descriptor.requiredSigners,
    totalSigners: descriptor.members.length,
    ...(vaultName ? { vaultName: vaultName.slice(0, 100) } : {}),
    pinnedAt: Date.now(),
    slot: slots.slot,
    keySlot: slots.keySlot,
  };
  writeVaultPins({ ...all, [key]: record });
  if (getVaultPin(key)?.hash !== hash) {
    throw new VaultPinStoreError('Failed to save the vault pin');
  }
  return record;
}

/** Removes one pin (Settings → Reset vault pin, behind a confirmation). */
export function resetVaultPin(pinKey: string): void {
  const all = readVaultPins();
  if (!all[pinKey]) {
    return;
  }
  const rest = { ...all };
  delete rest[pinKey];
  writeVaultPins(rest);
  stagedPins.delete(pinKey);
}

/** Removes every pin, including an unreadable store (Settings, confirmed). */
export function resetAllVaultPins(): void {
  pins().set(PINS_KEY, JSON.stringify({}));
  stagedPins.clear();
  emit();
}

// ---------------------------------------------------------------------------
// Staged confirmations (pin screen → sign action), in memory only
// ---------------------------------------------------------------------------

const stagedPins = new Map<string, string>();

/** The user confirmed this descriptor on the pin screen. */
export function stageVaultPinConfirmation(pinKey: string, hash: string): void {
  stagedPins.set(pinKey, hash);
  emit();
}

/** True when the user confirmed exactly this descriptor for this vault. */
export function isVaultPinStaged(pinKey: string, hash: string): boolean {
  return stagedPins.get(pinKey) === hash;
}

/** Drops a staged confirmation (persisted, or the request went away). */
export function clearStagedVaultPin(pinKey: string): void {
  if (stagedPins.delete(pinKey)) {
    emit();
  }
}

// ---------------------------------------------------------------------------
// Tiny subscription store: pins, staged confirmations and screen verdicts
// ---------------------------------------------------------------------------

let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;

/** Re-renders the caller whenever pins, confirmations or verdicts change. */
export function useVaultPinStoreVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

export type VaultVerdictScope = 'vaultsign' | 'fluxnode';

const verdicts = new Map<VaultVerdictScope, { key: string; value: unknown }>();

/** Publishes the descriptor verdict of the request a screen is showing. */
export function publishVaultVerdict<T>(
  scope: VaultVerdictScope,
  key: string,
  value: T,
): void {
  verdicts.set(scope, { key, value });
  emit();
}

/** Clears a scope's verdict (the request was answered or replaced). */
export function clearVaultVerdict(scope: VaultVerdictScope): void {
  if (verdicts.delete(scope)) {
    emit();
  }
}

/**
 * The scope's request went away (rejected, cancelled, answered, failed):
 * drop the pin confirmation staged for its vault — a confirmation lives only
 * as long as the request it was given for — then its verdict. A successful
 * sign has already saved the pin and cleared the confirmation.
 */
export function clearVaultRequestState(scope: VaultVerdictScope): void {
  const value = verdicts.get(scope)?.value as { pinKey?: unknown } | undefined;
  if (value && typeof value.pinKey === 'string') {
    clearStagedVaultPin(value.pinKey);
  }
  clearVaultVerdict(scope);
}

/** The verdict published for exactly this request key, if any. */
export function readVaultVerdict<T>(
  scope: VaultVerdictScope,
  key: string | undefined,
): T | undefined {
  const entry = verdicts.get(scope);
  return entry && key !== undefined && entry.key === key
    ? (entry.value as T)
    : undefined;
}

/**
 * The latest verdict of a scope whatever request it belongs to. Display-only
 * (the pin confirmation can show while a Solana decode is still running);
 * approval always uses readVaultVerdict with the exact request key.
 */
export function readLatestVaultVerdict<T>(
  scope: VaultVerdictScope,
): T | undefined {
  return verdicts.get(scope)?.value as T | undefined;
}
