// ============================================================
// Transaction simulation / risk preview — SHARED TYPES (mirror)
//
// READ-ONLY, ADVISORY layer. The server computes this on the proposal
// (ssp-relay-enterprise) and ships it in the relay action/sync payload. The
// device renders it as an early-warning strip ON TOP OF its own trustless
// decode (VaultDecodedTx). It NEVER gates signing — a missing, failed, or
// even a critical-mismatch simulation must leave the proposal fully signable
// (the never-strand-funds invariant). The device's own decode stays the
// PRIMARY, authoritative display of what is being signed.
//
// The enums below are MIRRORED VERBATIM from
// ssp-relay-enterprise/src/types/vault.ts and
// ssp-enterprise-app/src/types/vault.ts — keep them identical across repos.
// ============================================================

import type { VaultDecodedTx } from './transactions';

export type SimWarningSeverity = 'critical' | 'high' | 'medium' | 'info';

export type SimWarningCode =
  // approvals
  | 'UNLIMITED_APPROVAL' // critical — approve()/setApprovalForAll with max/unbounded allowance
  | 'NON_ZERO_APPROVAL' // high — any token spend approval to a non-allowlisted spender
  | 'APPROVAL_TO_EOA' // high — approving an EOA (not a contract) is almost always a scam
  // recipients
  | 'RECIPIENT_NOT_ALLOWLISTED' // medium — recipient not in contacts/whitelist (info if whitelist disabled)
  | 'ADDRESS_POISONING' // critical — recipient look-alike of a known address (prefix+suffix match)
  | 'NEW_RECIPIENT' // info — vault has never sent to this address before
  // contract risk
  | 'UNVERIFIED_CONTRACT' // medium — destination contract source unverified / no known ABI
  | 'NEW_CONTRACT' // medium — contract deployed very recently (< 7d)
  | 'VALUE_TO_CONTRACT' // info — native value sent to a contract (may be intended)
  | 'KNOWN_MALICIOUS' // critical — provider flags address/contract as malicious
  // execution
  | 'SIMULATION_REVERTED' // high — tx reverts in simulation; will fail on-chain (waste fee / stuck nonce)
  | 'BALANCE_MISMATCH' // high — simulated outflow != proposal's stated recipients/amounts
  | 'SIMULATION_DECODE_MISMATCH' // critical — server sim disagrees with device's own trustless decode
  // degradation
  | 'SIMULATION_UNAVAILABLE'; // info — could not simulate; preview is best-effort

export interface SimWarning {
  code: SimWarningCode;
  severity: SimWarningSeverity;
  message: string; // English fallback; i18n key on the client
  detail?: string; // e.g. the look-alike address, the spender, the revert reason
  provider?: string; // which engine raised it
}

/**
 * One asset's before/after for the SOURCE smart account / vault address.
 * All amounts are smallest-unit decimal strings (wei/satoshi/token base unit).
 */
export interface SimBalanceChange {
  asset: string; // 'native' | erc20 contract | token symbol
  symbol: string;
  decimals: number;
  address?: string; // contract address for tokens
  beforeRaw: string; // smallest unit
  afterRaw: string; // smallest unit
  deltaRaw: string; // signed, smallest unit
  deltaUsd?: number;
  direction: 'out' | 'in';
}

/**
 * Decoded top-level call (EVM) for "what this does in English". Args are
 * stringified for transport. Carries NO secrets.
 */
export interface SimDecodedCall {
  standard?:
    | 'erc20'
    | 'erc721'
    | 'erc1155'
    | 'router'
    | 'entrypoint'
    | 'unknown';
  method?: string; // 'transfer' | 'approve' | 'setApprovalForAll' | ...
  args?: Record<string, string>; // stringified for transport (e.g. spender, amount)
  target?: string; // contract being called
  targetVerified?: boolean;
}

/**
 * Embedded subdocument on the proposal. Travels with the proposal in the relay
 * sign payload. Carries no signing-sensitive material. Advisory only.
 */
export interface ProposalSimulation {
  status: 'pending' | 'ok' | 'reverted' | 'unavailable';
  provider?: string;
  simulatedAt?: string;
  chainStateBlock?: number;
  balanceChanges: SimBalanceChange[];
  decodedCall?: SimDecodedCall;
  warnings: SimWarning[];
  revertReason?: string;
}

/**
 * Normalize the `simulation` field off the relay payload into a typed object.
 * It may arrive as a parsed object, a JSON string, or be absent (legacy
 * proposals / sim disabled). Returns null on absence or parse failure so the
 * UI degrades gracefully (no risk strip) — never throws into the sign flow.
 */
export function parseProposalSimulation(
  raw: ProposalSimulation | string | null | undefined,
): ProposalSimulation | null {
  if (raw == null) return null;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const candidate = obj as Partial<ProposalSimulation>;
  // Minimal shape validation: a valid status + array warnings.
  const status = candidate.status;
  if (
    status !== 'pending' &&
    status !== 'ok' &&
    status !== 'reverted' &&
    status !== 'unavailable'
  ) {
    return null;
  }
  return {
    status,
    provider: candidate.provider,
    simulatedAt: candidate.simulatedAt,
    chainStateBlock: candidate.chainStateBlock,
    balanceChanges: Array.isArray(candidate.balanceChanges)
      ? candidate.balanceChanges
      : [],
    decodedCall: candidate.decodedCall,
    warnings: Array.isArray(candidate.warnings) ? candidate.warnings : [],
    revertReason: candidate.revertReason,
  };
}

// Severity ordering (critical first) for stable warning sorting.
const SEVERITY_ORDER: Record<SimWarningSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
};

/** Sort warnings critical → info (stable within a severity). */
export function sortWarnings(warnings: SimWarning[]): SimWarning[] {
  return [...warnings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

/** Normalize an address for case-insensitive comparison. */
function normAddress(addr: string): string {
  return (addr || '').trim().toLowerCase();
}

/**
 * Parse a decimal amount string to a bigint, tolerating leading '-' and
 * surrounding whitespace. Returns null when the string is not a plain integer
 * (e.g. a token-formatted "1.5" — those are NOT base-unit and we skip them).
 */
function toBaseUnitBigInt(amount: string | undefined): bigint | null {
  if (amount == null) return null;
  const trimmed = amount.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  try {
    const v = BigInt(trimmed);
    return v < 0n ? -v : v;
  } catch {
    return null;
  }
}

/**
 * Build the set of {address, amount} pairs the SERVER simulation claims as
 * outgoing recipients. We read them from `decodedCall.args` (ERC-20
 * transfer/approve recipient+amount). This is a best-effort projection used
 * only to detect divergence from the device's own decode — it never feeds the
 * signed bytes.
 *
 * EVM-ONLY: this projection relies on `decodedCall`, which only the EVM
 * provider populates. UTXO/native providers emit a single aggregate
 * `balanceChanges` entry with no per-recipient `address`, so there is nothing
 * to project for those chains and this returns an empty set. Decode-mismatch
 * detection is therefore EVM-only by construction; for UTXO chains the device's
 * own authoritative trustless decode (VaultDecodedTx) is the sole protection
 * against a lying relay (design §6). See TX_SIMULATION_DESIGN.md §6/§7.2.
 */
export function serverRecipientsFromSimulation(
  simulation: ProposalSimulation,
): Array<{ address: string; amount: bigint | null }> {
  const out: Array<{ address: string; amount: bigint | null }> = [];

  const args = simulation.decodedCall?.args;
  if (args) {
    const recipient = args.recipient || args.to;
    const spender = args.spender;
    const operator = args.operator;
    const amount = toBaseUnitBigInt(args.amount);
    if (recipient) {
      out.push({ address: normAddress(recipient), amount });
    } else if (spender) {
      // approve(): the "recipient" of the grant is the spender.
      out.push({ address: normAddress(spender), amount });
    } else if (operator) {
      // setApprovalForAll(): the operator is who gains control.
      out.push({ address: normAddress(operator), amount: null });
    }
  }

  return out;
}

export interface DecodeMismatchResult {
  mismatch: boolean;
  /** Short, English, human-readable reason for the mismatch banner detail. */
  reason?: string;
}

/**
 * SIMULATION_DECODE_MISMATCH — client-side comparison.
 *
 * Compares the SERVER simulation's recipients/amounts (from decodedCall.args)
 * against the DEVICE's own trustless decode (VaultDecodedTx). On divergence we
 * surface a critical mismatch banner and downrank the server preview — but the
 * user can ALWAYS still sign. The device decode is authoritative; this only
 * guards against a compromised relay lying about effects.
 *
 * EVM-ONLY: because the projection depends on `decodedCall` (EVM provider only),
 * this guard does not fire for UTXO/native chains — those rely solely on the
 * device's authoritative VaultDecodedTx (design §6). See serverRecipientsFromSimulation.
 *
 * Conservative by design: we only assert a mismatch when we can confidently
 * compare. Absent/ambiguous server data → NO mismatch (graceful), because the
 * server preview is merely advisory and must never block on missing fields.
 */
export function detectDecodeMismatch(
  simulation: ProposalSimulation | undefined,
  decoded: VaultDecodedTx | null | undefined,
): DecodeMismatchResult {
  // Only meaningful when the sim actually produced a verdict. We compare on
  // both 'ok' and 'reverted' — a reverted sim can still carry a decodedCall
  // whose recipient contradicts the device decode (a lying relay), and both
  // co-signer devices must reach the same verdict (design §2). This gate is
  // kept identical to ssp-wallet's detectDecodeMismatch.
  if (
    !simulation ||
    (simulation.status !== 'ok' && simulation.status !== 'reverted')
  ) {
    return { mismatch: false };
  }
  // Without a confident device decode there is nothing authoritative to compare
  // against — do not raise a mismatch (the decode-error notice covers that).
  if (!decoded || decoded.error) return { mismatch: false };

  const serverRecipients = serverRecipientsFromSimulation(simulation);
  if (serverRecipients.length === 0) return { mismatch: false };

  const deviceAddrs = new Set(
    (decoded.recipients || []).map((r) => normAddress(r.address)),
  );

  // 1) Recipient-set divergence: a server-claimed recipient/spender that the
  //    device's decoded outputs do not contain.
  for (const sr of serverRecipients) {
    if (!sr.address) continue;
    if (!deviceAddrs.has(sr.address)) {
      return {
        mismatch: true,
        reason: `server recipient ${sr.address} not present in the decoded transaction`,
      };
    }
  }

  // 2) Amount divergence: for a matched recipient, compare base-unit amounts
  //    when BOTH sides expose a comparable integer base-unit amount.
  for (const sr of serverRecipients) {
    if (!sr.address || sr.amount == null) continue;
    const match = (decoded.recipients || []).find(
      (r) => normAddress(r.address) === sr.address,
    );
    if (!match) continue;
    const deviceAmount = toBaseUnitBigInt(match.amount);
    if (deviceAmount == null) continue;
    if (deviceAmount !== sr.amount) {
      return {
        mismatch: true,
        reason: `amount for ${sr.address} differs (decoded ${match.amount} vs server ${sr.amount.toString()})`,
      };
    }
  }

  return { mismatch: false };
}
