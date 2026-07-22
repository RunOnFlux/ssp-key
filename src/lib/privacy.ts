// Privacy mode — mask sensitive identifiers on passive (non-signing) screens.
//
// Ported from ssp-wallet's PrivacyContext concept (blur-on-web → mask-on-RN).
// The SSP Key is a co-signing device: it displays NO balances or amounts outside
// active signing/approval flows, and amounts INSIDE those flows are deliberately
// never masked (the signer must verify exactly what they sign — masking there
// would be a safety regression). What privacy mode protects here is the passive
// surface the Key does have: the local signing-history log (wallet identities,
// transaction references).
//
// Invariants (SSP_DESIGN_OVERHAUL_PLAN.md Part 1):
//  - Zero crypto/signing changes — pure presentation.
//  - Append-only storage: a NEW MMKV key; never reads/renames/rewrites existing
//    keys (language, sspConfig, backends, redux persist root).

/** NEW MMKV key for the persisted privacy-mode preference. Append-only. */
export const PRIVACY_MODE_STORAGE_KEY = 'privacyMode';

/**
 * Fixed-length mask. Constant length on purpose: even the length of the hidden
 * value must not leak to a shoulder-surfer.
 */
export const PRIVACY_MASK = '••••••';

/** Returns the value untouched, or the fixed mask when privacy mode is on. */
export function maskSensitive(value: string, hidden: boolean): string {
  return hidden ? PRIVACY_MASK : value;
}
