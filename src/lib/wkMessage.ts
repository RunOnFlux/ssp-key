/**
 * WK message rules — what SSP Key will sign with its identity key (/10/0) when
 * SSP Wallet relays a `wksigningrequest`.
 *
 * The identity key is the single authenticator for enterprise logins, SSP
 * critical actions, enterprise vault-xpub attestations, recovery-xpub
 * attestations, chain-sync attestations and relay auth. Signing whatever
 * string a request carries therefore turns this screen into a signing oracle
 * for every one of those purposes, all framed as "authentication". So before
 * anything is shown or signed the message is classified by the SAME grammar
 * SSP Wallet applies (ssp-wallet src/lib/wkMessage.ts — keep the two in step):
 *
 *   enterprise_login  `<ts13>:SSP_ENTERPRISE_LOGIN:<nonce32hex>:<origin>`
 *   critical          `<ts13>:SSP_CRITICAL:<action>:<org>:<target>:<nonce>:<origin>`
 *   critical_legacy   the same without the trailing origin (v1)
 *   generic           any other `<ts13>…` message, 45–500 chars, no control
 *                     characters and none of the reserved SSP tags
 *   invalid           everything else — refused, never displayed as signable
 *
 * Also here: verification of the wallet's signature over the message (the Key
 * only co-signs what the PAIRED wallet already signed, which a relay alone
 * cannot forge) and the chain-sync attestation format.
 *
 * Pure functions only: no I/O, no keychain, no logging of message contents.
 */
import { SigningKey, Signature } from 'ethers';
import { sha256 } from '@noble/hashes/sha2.js';
import { HDKey } from '@scure/bip32';

export const WK_MESSAGE_MIN_LENGTH = 45;
export const WK_MESSAGE_MAX_LENGTH = 500;

/**
 * Tags that only SSP itself produces. A message carrying one of them is either
 * the exact grammar below or a forgery attempt — it is never a "generic" sign
 * request.
 */
export const WK_RESERVED_TAGS = [
  'SSP_ENTERPRISE_LOGIN',
  'SSP_CRITICAL',
  'SSP_VAULT_XPUB',
  'SSP_CHAIN_SYNC',
  'SSP_RECOVERY',
] as const;

// Grammar shared with SSP Wallet and ssp-relay-enterprise (contract "WK").
const ENTERPRISE_LOGIN_RE =
  /^(\d{13}):SSP_ENTERPRISE_LOGIN:([0-9a-f]{32}):(https?:\/\/[^\s]+)$/;
const CRITICAL_V2_RE =
  /^(\d{13}):SSP_CRITICAL:([a-z_]+):([^:]*):([^:]*):([0-9a-f]+):(https?:\/\/[^\s]+)$/;
const CRITICAL_V1_RE =
  /^(\d{13}):SSP_CRITICAL:([a-z_]+):([^:]*):([^:]*):([0-9a-f]+)$/;
const TIMESTAMP_PREFIX_RE = /^\d{13}/;

/**
 * C0/C1 controls, DEL, line/paragraph separators and the Unicode bidi
 * embedding/override/isolate controls. Any of these lets a requester make the
 * displayed text differ from the signed bytes, so a message carrying one is
 * refused outright.
 */
const CONTROL_CHARS_RE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/**
 * A bare web origin exactly as `new URL(x).origin` prints it: scheme, lowercase
 * host, optional port — no path, query, fragment or userinfo. Stricter than the
 * shared grammar's `https?://[^\s]+` on purpose: the origin is what the Key
 * shows as "where you are signing in", so `https://enterprise.sspwallet.com@
 * evil.example` or `https://evil.example/enterprise.sspwallet.com` must never
 * reach the screen. SSP Wallet compares the origin to the browser-verified
 * `sender.origin`, which is always bare, so no honest request is lost.
 */
const BARE_ORIGIN_RE =
  /^https?:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/;

export type WkInvalidReason =
  | 'not_string'
  | 'length'
  | 'control_chars'
  | 'json'
  | 'reserved_tag'
  | 'no_timestamp';

export interface WkEnterpriseLoginFields {
  timestamp: number;
  nonce: string;
  origin: string;
}

export interface WkCriticalFields {
  timestamp: number;
  action: string;
  targetOrgId: string;
  targetWkIdentity: string;
  nonce: string;
}

export type WkMessageClassification =
  | { kind: 'enterprise_login'; fields: WkEnterpriseLoginFields }
  | { kind: 'critical'; fields: WkCriticalFields & { origin: string } }
  | { kind: 'critical_legacy'; fields: WkCriticalFields }
  | { kind: 'generic'; fields: { timestamp: number } }
  | { kind: 'invalid'; reason: WkInvalidReason };

export type WkMessageKind = WkMessageClassification['kind'];

/** True when `origin` is a bare, lowercase web origin (see BARE_ORIGIN_RE). */
export function isBareOrigin(origin: string): boolean {
  if (!BARE_ORIGIN_RE.test(origin)) return false;
  const port = origin.match(/:(\d{1,5})$/);
  return !port || Number(port[1]) <= 65535;
}

/** Classify a WK sign message. Never throws. */
export function classifyWkMessage(message: unknown): WkMessageClassification {
  if (typeof message !== 'string') {
    return { kind: 'invalid', reason: 'not_string' };
  }
  if (
    message.length < WK_MESSAGE_MIN_LENGTH ||
    message.length > WK_MESSAGE_MAX_LENGTH
  ) {
    return { kind: 'invalid', reason: 'length' };
  }
  if (CONTROL_CHARS_RE.test(message)) {
    return { kind: 'invalid', reason: 'control_chars' };
  }
  if (message.startsWith('{')) {
    // relay auth payloads are JSON — never signable through this screen
    return { kind: 'invalid', reason: 'json' };
  }

  const login = ENTERPRISE_LOGIN_RE.exec(message);
  if (login && isBareOrigin(login[3])) {
    return {
      kind: 'enterprise_login',
      fields: {
        timestamp: Number(login[1]),
        nonce: login[2],
        origin: login[3],
      },
    };
  }

  const criticalV2 = CRITICAL_V2_RE.exec(message);
  if (criticalV2 && isBareOrigin(criticalV2[6])) {
    return {
      kind: 'critical',
      fields: {
        timestamp: Number(criticalV2[1]),
        action: criticalV2[2],
        targetOrgId: criticalV2[3],
        targetWkIdentity: criticalV2[4],
        nonce: criticalV2[5],
        origin: criticalV2[6],
      },
    };
  }

  const criticalV1 = CRITICAL_V1_RE.exec(message);
  if (criticalV1) {
    return {
      kind: 'critical_legacy',
      fields: {
        timestamp: Number(criticalV1[1]),
        action: criticalV1[2],
        targetOrgId: criticalV1[3],
        targetWkIdentity: criticalV1[4],
        nonce: criticalV1[5],
      },
    };
  }

  // Anything that names an SSP-internal format without matching its grammar
  // exactly is refused — including the enterprise formats with a non-bare
  // origin, vault-xpub / chain-sync attestations and recovery records.
  if (WK_RESERVED_TAGS.some((tag) => message.includes(tag))) {
    return { kind: 'invalid', reason: 'reserved_tag' };
  }

  if (TIMESTAMP_PREFIX_RE.test(message)) {
    return {
      kind: 'generic',
      fields: { timestamp: Number(message.slice(0, 13)) },
    };
  }
  return { kind: 'invalid', reason: 'no_timestamp' };
}

// ---------------------------------------------------------------------------
// Bitcoin signed-message verification
// ---------------------------------------------------------------------------

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Bitcoin CompactSize — all a message length ever needs. */
function varint(value: number): Uint8Array {
  if (value < 0xfd) return Uint8Array.from([value]);
  if (value <= 0xffff) {
    return Uint8Array.from([0xfd, value & 0xff, (value >> 8) & 0xff]);
  }
  return Uint8Array.from([
    0xfe,
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function base64Bytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const binary = globalThis.atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i) & 0xff;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * The Bitcoin signed-message digest: sha256d(prefix || varint(len) || msg).
 * `messagePrefix` is the chain config value, which already carries its own
 * length byte (e.g. '\x18Bitcoin Signed Message:\n').
 */
export function bitcoinMessageDigest(
  message: string,
  messagePrefix: string,
): Uint8Array {
  const msg = utf8Bytes(message);
  const payload = concatBytes(
    utf8Bytes(messagePrefix),
    varint(msg.length),
    msg,
  );
  return sha256(sha256(payload));
}

/**
 * Verify a base64 Bitcoin message signature (the format `signMessage` in
 * lib/relayAuth produces: header 27 + recid + 4 for compressed keys, then r, s)
 * against an expected compressed public key. Returns false on any malformed
 * input — never throws.
 */
export function verifyBitcoinMessageSignature(
  message: string,
  signatureBase64: string,
  expectedPubKeyHex: string,
  messagePrefix: string,
): boolean {
  try {
    if (
      typeof message !== 'string' ||
      typeof signatureBase64 !== 'string' ||
      typeof expectedPubKeyHex !== 'string' ||
      !/^0[23][0-9a-fA-F]{64}$/.test(expectedPubKeyHex)
    ) {
      return false;
    }
    const raw = base64Bytes(signatureBase64);
    if (!raw || raw.length !== 65) return false;
    const flag = raw[0] - 27;
    // 0-3 uncompressed, 4-7 compressed, 8-15 BIP137 segwit variants (also
    // compressed). SSP only ever signs with compressed keys.
    if (flag < 4 || flag > 15) return false;
    const recoveryId = flag & 3;
    if (recoveryId > 1) return false; // r overflow — never produced in practice
    const digest = bitcoinMessageDigest(message, messagePrefix);
    const signature = Signature.from({
      r: `0x${toHex(raw.slice(1, 33))}`,
      s: `0x${toHex(raw.slice(33, 65))}`,
      v: 27 + recoveryId,
    });
    const recovered = SigningKey.computePublicKey(
      SigningKey.recoverPublicKey(digest, signature),
      true,
    );
    return recovered.toLowerCase() === `0x${expectedPubKeyHex.toLowerCase()}`;
  } catch {
    return false;
  }
}

/** Standard BIP32 mainnet version bytes — fallback for plain `xpub` strings. */
const STANDARD_BIP32_VERSIONS = { public: 0x0488b21e, private: 0x0488ade4 };

/**
 * The paired wallet's identity public key m/…/10/0, derived by THIS device
 * from the wallet identity xpub it stored at pairing. Hex, or '' when the
 * xpub does not parse (callers then refuse).
 */
export function deriveIdentityPubKeyFromXpub(
  xpub: string,
  versions: { public: number; private: number },
): string {
  if (!xpub) return '';
  for (const candidate of [versions, STANDARD_BIP32_VERSIONS]) {
    try {
      const child = HDKey.fromExtendedKey(xpub, candidate)
        .deriveChild(10)
        .deriveChild(0);
      if (child.publicKey) return toHex(child.publicKey);
    } catch {
      // try the next version set
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Full request check (classification + paired-wallet signature)
// ---------------------------------------------------------------------------

export type WkRequestRefusal =
  | 'malformed'
  | 'invalid_message'
  | 'wrong_identity'
  | 'wallet_key_mismatch'
  | 'bad_wallet_signature';

export type WkRequestCheck =
  | {
      ok: true;
      classification: Exclude<WkMessageClassification, { kind: 'invalid' }>;
    }
  | { ok: false; reason: WkRequestRefusal };

/**
 * Everything the Key checks before it shows or signs a WK request:
 *  1. the message classifies as something other than `invalid`;
 *  2. the request is for THIS device's wkIdentity;
 *  3. the request's walletPubKey (when present) is the paired wallet's /10/0
 *     identity key, which the Key derives itself from the wallet identity xpub
 *     it stored at pairing — never from the request;
 *  4. walletSignature is a valid signature over the exact message by that key.
 * A relay or any party without the wallet's identity key fails 3/4.
 */
export function checkWkSigningRequest(params: {
  request: {
    message?: unknown;
    walletSignature?: unknown;
    walletPubKey?: unknown;
    wkIdentity?: unknown;
  } | null;
  ownWkIdentity: string;
  pairedWalletIdentityPubKey: string;
  messagePrefix: string;
}): WkRequestCheck {
  const { request, ownWkIdentity, pairedWalletIdentityPubKey, messagePrefix } =
    params;
  if (
    !request ||
    typeof request.message !== 'string' ||
    typeof request.walletSignature !== 'string' ||
    !request.walletSignature
  ) {
    return { ok: false, reason: 'malformed' };
  }
  const classification = classifyWkMessage(request.message);
  if (classification.kind === 'invalid') {
    return { ok: false, reason: 'invalid_message' };
  }
  if (
    !ownWkIdentity ||
    (request.wkIdentity !== undefined && request.wkIdentity !== ownWkIdentity)
  ) {
    return { ok: false, reason: 'wrong_identity' };
  }
  if (
    !pairedWalletIdentityPubKey ||
    (request.walletPubKey !== undefined &&
      (typeof request.walletPubKey !== 'string' ||
        request.walletPubKey.toLowerCase() !==
          pairedWalletIdentityPubKey.toLowerCase()))
  ) {
    return { ok: false, reason: 'wallet_key_mismatch' };
  }
  if (
    !verifyBitcoinMessageSignature(
      request.message,
      request.walletSignature,
      pairedWalletIdentityPubKey,
      messagePrefix,
    )
  ) {
    return { ok: false, reason: 'bad_wallet_signature' };
  }
  return { ok: true, classification };
}

/** Locale keys for the critical actions the enterprise backend issues. */
const WK_CRITICAL_ACTION_COPY = {
  transfer_ownership: {
    label: 'home:wk_critical_action_transfer_ownership',
    effect: 'home:wk_critical_action_transfer_ownership_effect',
  },
  delete_organization: {
    label: 'home:wk_critical_action_delete_organization',
    effect: 'home:wk_critical_action_delete_organization_effect',
  },
  remove_member: {
    label: 'home:wk_critical_action_remove_member',
    effect: 'home:wk_critical_action_remove_member_effect',
  },
  promote_to_admin: {
    label: 'home:wk_critical_action_promote_to_admin',
    effect: 'home:wk_critical_action_promote_to_admin_effect',
  },
  demote_from_admin: {
    label: 'home:wk_critical_action_demote_from_admin',
    effect: 'home:wk_critical_action_demote_from_admin_effect',
  },
  change_enterprise_email: {
    label: 'home:wk_critical_action_change_enterprise_email',
    effect: 'home:wk_critical_action_change_enterprise_email_effect',
  },
  remove_enterprise_email: {
    label: 'home:wk_critical_action_remove_enterprise_email',
    effect: 'home:wk_critical_action_remove_enterprise_email_effect',
  },
  archive_vault: {
    label: 'home:wk_critical_action_archive_vault',
    effect: 'home:wk_critical_action_archive_vault_effect',
  },
  unarchive_vault: {
    label: 'home:wk_critical_action_unarchive_vault',
    effect: 'home:wk_critical_action_unarchive_vault_effect',
  },
  freeze_vault: {
    label: 'home:wk_critical_action_freeze_vault',
    effect: 'home:wk_critical_action_freeze_vault_effect',
  },
  unfreeze_vault: {
    label: 'home:wk_critical_action_unfreeze_vault',
    effect: 'home:wk_critical_action_unfreeze_vault_effect',
  },
  promote_vault_admin: {
    label: 'home:wk_critical_action_promote_vault_admin',
    effect: 'home:wk_critical_action_promote_vault_admin_effect',
  },
  demote_vault_admin: {
    label: 'home:wk_critical_action_demote_vault_admin',
    effect: 'home:wk_critical_action_demote_vault_admin_effect',
  },
} as const;

export type WkCriticalActionCopy =
  (typeof WK_CRITICAL_ACTION_COPY)[keyof typeof WK_CRITICAL_ACTION_COPY];

/**
 * Copy for a known critical action, or undefined for one this build does not
 * know (shown raw). Own-property lookup: `action` is message-supplied and
 * `[a-z_]+` also matches names like `constructor`.
 */
export function criticalActionCopy(
  action: string,
): WkCriticalActionCopy | undefined {
  return Object.prototype.hasOwnProperty.call(WK_CRITICAL_ACTION_COPY, action)
    ? WK_CRITICAL_ACTION_COPY[action as keyof typeof WK_CRITICAL_ACTION_COPY]
    : undefined;
}

/**
 * What a critical challenge's two free fields mean (ssp-relay-enterprise
 * generateCriticalActionChallenge):
 *   org actions            F1 = orgId          F2 = target wkIdentity | 'none'
 *   vault-scoped actions   F1 = orgId/vaultId  F2 = target wkIdentity | 'none'
 *   email actions          F1 = 'user'         F2 = new email | 'none'
 * Legacy (v1) challenges fit the org shape, with empty fields.
 */
export interface WkCriticalScope {
  kind: 'org' | 'vault' | 'user';
  orgId: string;
  vaultId: string;
  /** Target wkIdentity, or the new email for email actions; null = none. */
  target: string | null;
}

export function describeCriticalScope(
  targetOrgId: string,
  targetWkIdentity: string,
): WkCriticalScope {
  const target =
    !targetWkIdentity || targetWkIdentity === 'none' ? null : targetWkIdentity;
  if (targetOrgId === 'user') {
    return { kind: 'user', orgId: '', vaultId: '', target };
  }
  const slash = targetOrgId.indexOf('/');
  if (slash !== -1) {
    return {
      kind: 'vault',
      orgId: targetOrgId.slice(0, slash),
      vaultId: targetOrgId.slice(slash + 1),
      target,
    };
  }
  return { kind: 'org', orgId: targetOrgId, vaultId: '', target };
}
