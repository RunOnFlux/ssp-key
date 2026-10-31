import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import {
  cryptos,
  utxo,
  evmSigningRequest,
  wkSigningRequest,
  vaultXpubRequest,
  vaultSigningRequest,
} from '../../../types';
import { blockchains } from '@storage/blockchains';
import {
  decodeVaultTransaction,
  type VaultDecodedTx,
} from '../../../lib/transactions';
import {
  applyVaultSolDecode,
  VaultSolDecodeState,
} from '../../../lib/vaultSolanaDecode';
import {
  checkVaultEvmUserOp,
  fluxNodeAddressIndex,
  primaryAddressIndex,
  validateFluxNodeStartRequest,
  validateVaultSigningRequest,
  validateVaultXpubRequest,
} from '../../../lib/enterpriseGuards';
import {
  checkFluxNodeCollateral,
  checkVaultEvmAccount,
  checkVaultUtxoTransaction,
  evaluateVaultDescriptor,
  fluxNodeRequestFingerprint,
  vaultSolBinding,
  type OwnVaultIdentity,
  type VaultDescriptorVerdict,
} from '../../../lib/vaultDescriptorGate';
import {
  clearVaultRequestState,
  publishVaultVerdict,
} from '../../../lib/vaultPins';
import { verifyVaultUtxoAmounts } from '../../../lib/vaultUtxoAmounts';
import type { VaultSolBinding } from '../../../lib/vaultSolanaDecode';
import { store } from '../../../store';
import {
  bindDecodedToRequest,
  vaultRequestDigest,
} from '../../../lib/vaultApprovalBinding';
import {
  messageDigestMatches,
  userOpHashMatches,
} from '../../../lib/userOpVerify';
import { useSocket } from '../../../hooks/useSocket';
import type { RecoveryRequestPayload } from '../../../lib/recoveryHandler';

/**
 * True when `chain` is a chain this build actually registers. The redux
 * store creates exactly one slice per key of `blockchains`, so an unknown
 * chain id makes `state[chain]` undefined — and Home (plus EvmSigningRequest,
 * SyncSuccess, ...) destructure that slice straight in the render body, which
 * throws and, with no ErrorBoundary in the app, takes the screen down for as
 * long as the request state lives. Every chain that arrives from the relay
 * MUST pass this before it is written to state.
 */
export const isSupportedChain = (chain: unknown): chain is keyof cryptos =>
  typeof chain === 'string' &&
  Object.prototype.hasOwnProperty.call(blockchains, chain);

/** The pending-request kinds that carry a chain from the relay. */
export type PendingRequestKind = 'tx' | 'publicnonces' | 'evmsigning' | 'sync';

/** One action as delivered by the relay (socket event or GET /v1/action). */
export interface RelayActionEnvelope {
  action?: unknown;
  payload?: unknown;
  chain?: unknown;
  path?: unknown;
  utxos?: unknown;
}

/**
 * Every Key-directed relay action, in the order routeRelayAction handles
 * them. SocketContext listens for exactly this set — tests/lib/
 * relayActionRouting.test.ts asserts the two cannot drift apart again.
 */
export const KEY_RELAY_ACTIONS = [
  'tx',
  'publicnoncesrequest',
  'evmsigningrequest',
  'wksigningrequest',
  'enterprisevaultsign',
  'enterprisevaultxpub',
  'enterprisefluxnodestart',
  'enterprisekeynoncesync',
  'recoveryrequest',
  'chainsyncrequest',
] as const;

export type KeyRelayAction = (typeof KEY_RELAY_ACTIONS)[number];

/**
 * What a routed relay action is handed to. Home wires these to the
 * pending-request setters; tests wire them to spies.
 */
export interface RelayActionHandlers {
  onTx: (payload: string, chain: string, path: string, utxos: utxo[]) => void;
  onPublicNoncesRequest: (chain: string) => void;
  onEvmSigningRequest: (data: evmSigningRequest) => void;
  onWkSigningRequest: (data: wkSigningRequest) => void;
  onVaultSigningRequest: (data: vaultSigningRequest) => void;
  onVaultXpubRequest: (data: vaultXpubRequest) => void;
  onFluxNodeStartRequest: (data: Record<string, unknown>) => void;
  onKeyNonceSyncRequest: () => void;
  onRecoveryRequest: (data: RecoveryRequestPayload) => void;
  onChainSyncRequest: (payload: string) => void;
  onInvalidPayload: () => void;
}

const parseActionPayload = <T>(payload: unknown): T | null => {
  if (typeof payload !== 'string' || !payload) {
    return null;
  }
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
};

const asActionString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

/**
 * Validates a recoveryrequest payload exactly the way SocketContext does, so the
 * socket and poll transports agree on what a well-formed request is.
 *
 * `recoveryIndex` is required: it tells this device which key of the recovery
 * account the requester's envelope is sealed to. A request without it is asking
 * for something this build does not produce, so it is dropped here rather than
 * put in front of the user — approving it could only end in a failure on the
 * requesting side.
 */
export const parseRecoveryRequestPayload = (
  payload: unknown,
): RecoveryRequestPayload | null => {
  const parsed = parseActionPayload<RecoveryRequestPayload>(payload);
  if (
    !parsed ||
    typeof parsed.pkEph !== 'string' ||
    typeof parsed.nonce !== 'string' ||
    typeof parsed.timestamp !== 'number' ||
    typeof parsed.recoveryIndex !== 'number'
  ) {
    return null;
  }
  return parsed;
};

/**
 * Routes ONE relay action envelope to the matching handler. Home's
 * `GET /v1/action` poll (handleRefresh, also the notification-open handler)
 * goes through here so it answers every action the socket transport does —
 * it used to silently drop `recoveryrequest` and `enterprisefluxnodestart`,
 * which left a tapped push notification opening an idle Home screen.
 *
 * Returns false when the action is not one this screen answers, so the
 * caller can log it instead of idling.
 */
export const routeRelayAction = (
  envelope: RelayActionEnvelope,
  handlers: RelayActionHandlers,
): boolean => {
  const { action, payload } = envelope;
  switch (action) {
    case 'tx': {
      if (typeof payload !== 'string' || !payload) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onTx(
        payload,
        asActionString(envelope.chain),
        asActionString(envelope.path),
        // relay-supplied; shape is validated downstream when the tx is signed
        Array.isArray(envelope.utxos) ? (envelope.utxos as utxo[]) : [],
      );
      return true;
    }
    case 'publicnoncesrequest': {
      handlers.onPublicNoncesRequest(asActionString(envelope.chain));
      return true;
    }
    case 'evmsigningrequest': {
      const data = parseActionPayload<evmSigningRequest>(payload);
      if (!data) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onEvmSigningRequest(data);
      return true;
    }
    case 'wksigningrequest': {
      const data = parseActionPayload<wkSigningRequest>(payload);
      if (!data) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onWkSigningRequest(data);
      return true;
    }
    // Enterprise requests are validated at receipt (H-1): an org index
    // outside 100–99999 (0' is the consumer account, 99' the recovery
    // account), a non-integer vault/address index, or message signing on a
    // non-EVM chain never reaches the screen. The sign actions re-check.
    case 'enterprisevaultsign': {
      const data = parseActionPayload<vaultSigningRequest>(payload);
      if (!data || validateVaultSigningRequest(data) !== null) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onVaultSigningRequest(data);
      return true;
    }
    case 'enterprisevaultxpub': {
      const data = parseActionPayload<vaultXpubRequest>(payload);
      if (!data || validateVaultXpubRequest(data) !== null) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onVaultXpubRequest(data);
      return true;
    }
    case 'enterprisefluxnodestart': {
      const data = parseActionPayload<Record<string, unknown>>(payload);
      if (
        !data ||
        typeof data !== 'object' ||
        validateFluxNodeStartRequest(data) !== null
      ) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onFluxNodeStartRequest(data);
      return true;
    }
    case 'enterprisekeynoncesync': {
      handlers.onKeyNonceSyncRequest();
      return true;
    }
    case 'recoveryrequest': {
      const data = parseRecoveryRequestPayload(payload);
      if (!data) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onRecoveryRequest(data);
      return true;
    }
    case 'chainsyncrequest': {
      if (typeof payload !== 'string' || !payload) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onChainSyncRequest(payload);
      return true;
    }
    default:
      return false;
  }
};

/**
 * Owns the pending-request state of the Home screen and the socket ->
 * pending-request state mapping effects. This is a MECHANICAL relocation
 * from Home.tsx — state variable names, types, setter semantics and effect
 * bodies are kept exactly as they were in Home. The socket subscription
 * itself stays untouched in SocketContext; this hook only consumes the
 * same context values Home consumed before (useSocket is a plain
 * useContext read, so reading it here and in Home yields identical
 * values).
 *
 * Deliberately NOT moved here (left in Home, see refactor notes):
 * - the chainsyncrequest socket effect + handleChainSyncRequestPayload
 *   (entangled with postAction/relay auth and the pairing-verification
 *   session refs which live in Home),
 * - handleRefresh (HTTP-poll counterpart; it ingests requests through the
 *   functions this hook returns).
 *
 * @param onUnsupportedChain called when a request names a chain this build
 *   does not register. The request is already dropped by then; Home uses this
 *   to post the matching `*rejected` action so SSP Wallet is not left waiting
 *   for its timeout (posting needs relay auth, which lives in Home).
 */
export function usePendingRequests(
  identityChain: keyof cryptos,
  onUnsupportedChain?: (kind: PendingRequestKind, chain: string) => void,
) {
  const { t } = useTranslation(['home', 'common']);
  // VD-3: this device's identity, for the vault descriptor checks at
  // receipt (read when the request arrives).
  const ownVault = (): OwnVaultIdentity => {
    const { sspWalletKeyInternalIdentity, sspWalletKeyInternalIdentityPubKey } =
      store.getState().ssp;
    return {
      wkIdentity: sspWalletKeyInternalIdentity,
      identityPubKey: sspWalletKeyInternalIdentityPubKey || null,
      // The seed stays locked at receipt; the sign action re-runs the checks
      // with this device's own vault xpub before it signs.
      accountXpub: null,
    };
  };
  const [rawTx, setRawTx] = useState('');
  const [activeChain, setActiveChain] = useState<keyof cryptos>(identityChain);
  const [txPath, setTxPath] = useState('');
  const [txUtxos, setTxUtxos] = useState<utxo[]>([]);
  const [syncReq, setSyncReq] = useState('');
  const [publicNoncesReq, setPublicNoncesReq] = useState('');
  const [evmSigningData, setEvmSigningData] =
    useState<evmSigningRequest | null>(null);
  const [wkSigningData, setWkSigningData] = useState<wkSigningRequest | null>(
    null,
  );
  const [vaultXpubData, setVaultXpubData] = useState<vaultXpubRequest | null>(
    null,
  );
  const [vaultSigningData, setVaultSigningData] =
    useState<vaultSigningRequest | null>(null);
  const [decodedVaultTx, setDecodedVaultTx] = useState<VaultDecodedTx | null>(
    null,
  );
  const [solDecodeState, setSolDecodeState] =
    useState<VaultSolDecodeState | null>(null);
  // Monotonic token guarding the async sol decode — a decode started for an
  // older vault payload must never overwrite the verdict of a newer one
  // (bumped on every new request and on reject/completion cleanup).
  const solDecodeSeqRef = useRef(0);
  const [fluxNodeStartData, setFluxNodeStartDataState] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [keyNonceSyncDialogOpen, setKeyNonceSyncDialogOpen] = useState(false);
  // Recovery requests that arrived over the GET /v1/action poll. The socket
  // transport keeps its own copy in SocketContext (which exposes no setter),
  // so Home merges the two sources.
  const [recoveryRequestData, setRecoveryRequestData] =
    useState<RecoveryRequestPayload | null>(null);

  const {
    newTx,
    clearTx,
    publicNoncesRequest,
    evmSigningRequest,
    clearPublicNoncesRequest,
    wkSigningRequest: socketWkSigningRequest,
    vaultXpubRequest: socketVaultXpubRequest,
    clearVaultXpubRequest,
    vaultSigningRequest: socketVaultSigningRequest,
    keyNonceSyncRequest: socketKeyNonceSyncRequest,
    fluxNodeStartRequest: socketFluxNodeStartRequest,
    clearFluxNodeStartRequest,
  } = useSocket();

  const displayMessage = (
    type: string,
    content: string,
    visibilityTime?: number,
  ) => {
    Toast.show({
      type,
      text1: content,
      visibilityTime: visibilityTime,
    });
  };

  // An unknown chain is dropped BEFORE it reaches state — activeChain indexes
  // the store and every consumer destructures that slice. `chain` is typed as
  // a plain string on the ingestion functions on purpose: it arrives from the
  // relay / a scanned QR, so it is not a keyof cryptos until checked here.
  const rejectUnsupportedChain = (kind: PendingRequestKind, chain: unknown) => {
    const chainName = asActionString(chain);
    console.log(
      '[Pending Requests] Unsupported chain, dropping request:',
      kind,
      chainName,
    );
    displayMessage('error', t('home:err_invalid_request'), 5000);
    onUnsupportedChain?.(kind, chainName);
  };

  const handleTxRequest = (
    rawTransaction: string,
    chain: string,
    path: string,
    utxos: utxo[] = [],
  ) => {
    if (!isSupportedChain(chain)) {
      rejectUnsupportedChain('tx', chain);
      return;
    }
    setActiveChain(chain);
    if (utxos) {
      setTxUtxos(utxos);
    }
    setRawTx(rawTransaction);
    setTxPath(path);
  };
  const handlePublicNoncesRequest = (chain: string) => {
    console.log(chain);
    if (!isSupportedChain(chain)) {
      rejectUnsupportedChain('publicnonces', chain);
      return;
    }
    setActiveChain(chain);
    setPublicNoncesReq(chain);
  };
  const handleEvmSigningRequest = (data: evmSigningRequest) => {
    // never log the request body — it carries the wallet's partial signature
    console.log('[EVM Signing] request received:', data.chain);
    if (!isSupportedChain(data.chain)) {
      rejectUnsupportedChain('evmsigning', data.chain);
      return;
    }
    setActiveChain(data.chain);
    setEvmSigningData(data);
  };
  const handleWkSigningRequest = (data: wkSigningRequest) => {
    console.log('[WK Sign] request received');
    setWkSigningData(data);
  };
  const handleSyncRequest = (xpubw: string, chain: string) => {
    if (!isSupportedChain(chain)) {
      rejectUnsupportedChain('sync', chain);
      return;
    }
    setActiveChain(chain);
    setSyncReq(xpubw);
  };

  // Shared vault-signing-request ingestion used by BOTH the socket effect
  // below and Home's handleRefresh poll path. The two former copies in Home
  // were verbatim-identical apart from the recipients console.log label
  // (kept as a parameter) — consolidation verified by textual diff during
  // the refactor.
  const ingestVaultSigningRequest = (
    incoming: vaultSigningRequest,
    recipientsLogLabel: string,
  ) => {
    // Defensively parse fields that may arrive as JSON strings
    // (matching the refresh/action path parsing at handleRefresh)
    const data = { ...incoming };
    console.log(
      recipientsLogLabel,
      typeof data.recipients,
      'isArray:',
      Array.isArray(data.recipients),
      'length:',
      Array.isArray(data.recipients) ? data.recipients.length : 'N/A',
    );
    if (typeof data.recipients === 'string') {
      data.recipients = JSON.parse(data.recipients);
    }
    if (!Array.isArray(data.recipients)) {
      data.recipients = [];
    }
    if (typeof data.inputDetails === 'string') {
      data.inputDetails = JSON.parse(data.inputDetails);
    }
    if (typeof data.allSignerKeys === 'string') {
      data.allSignerKeys = JSON.parse(data.allSignerKeys);
    }
    if (typeof data.allSignerNonces === 'string') {
      data.allSignerNonces = JSON.parse(data.allSignerNonces);
    }
    // H-1 / CHN-5 at receipt: a request for a non-organisation account (0',
    // 99', …), with non-integer indices, or asking for a message signature on
    // a non-EVM chain is refused before it is ever shown. Any request already
    // on screen stays as it is.
    const requestProblem = validateVaultSigningRequest(data);
    if (requestProblem !== null) {
      console.log('[Vault Signing] Refusing request:', requestProblem);
      displayMessage('error', t('home:err_vault_request_invalid'), 6000);
      return;
    }
    // CHN-5: every decoded view handed to the approval screen is bound to
    // the digest of the exact request it was decoded from; the screen arms
    // that digest on approval and the sign action refuses any other request.
    const requestDigest = vaultRequestDigest(data);
    const bind = (tx: VaultDecodedTx) =>
      bindDecodedToRequest(tx, requestDigest);
    const failed = (error: string): VaultDecodedTx =>
      bind({ sender: '', recipients: [], fee: '0', error });
    // VD-3 at receipt: the vault descriptor must be present, verify, name
    // this vault and match its pin. The verdict is published for the screen
    // (first sight → pin confirmation; refused → blocked with the reason);
    // the descriptor is part of the request digest, so the sign action signs
    // only the request — and the vault — that was confirmed on screen.
    const verdict: VaultDescriptorVerdict = evaluateVaultDescriptor(
      data,
      ownVault(),
    );
    publishVaultVerdict('vaultsign', requestDigest, verdict);
    setVaultSigningData(data);
    // Every incoming request must start from a clean decode state — never
    // render a stale sol verdict or stale decoded values from a previous
    // request. The seq token discards any still-in-flight async sol
    // decode started for an older payload.
    solDecodeSeqRef.current += 1;
    const decodeSeq = solDecodeSeqRef.current;
    setDecodedVaultTx(null);
    setSolDecodeState(null);
    if (verdict.kind === 'refused') {
      console.log('[Vault Signing] Vault descriptor refused:', verdict.code);
      setDecodedVaultTx(failed(verdict.reason));
      return;
    }
    const vaultDescriptor = verdict.descriptor;
    let vaultAddressIndex: number;
    try {
      vaultAddressIndex = primaryAddressIndex(data.inputDetails);
    } catch {
      setDecodedVaultTx(failed('invalid address index'));
      return;
    }
    // Decode independently for trustless verification. Every branch ends in
    // a bound decoded view: either a successful decode, or one carrying the
    // error that blocks approval.
    const chain = data.chain as keyof cryptos;
    const chainType = blockchains[chain].chainType;
    if (chainType === 'evm') {
      if (data.signMessage !== undefined) {
        // Vault MESSAGE signing: rawUnsignedTx is the EIP-191 digest of the
        // displayed text. Check the binding now so a mismatch is visible
        // (and blocking) before the user approves; the sign action re-checks.
        // VD-4: every Schnorr signer key is a key of the pinned vault.
        const signerProblem = checkVaultEvmAccount(
          vaultDescriptor,
          vaultAddressIndex,
          undefined,
          data.allSignerKeys,
        );
        setDecodedVaultTx(
          signerProblem
            ? failed(signerProblem)
            : messageDigestMatches(data.signMessage, data.rawUnsignedTx)
              ? bind({ sender: '', recipients: [], fee: '0' })
              : failed('The message digest does not match the message shown'),
        );
      } else if (data.evmUserOp) {
        // EVM: rawUnsignedTx is a hash, decode from evmUserOp instead —
        // after the call-safety rules, and only if the hash is the hash of
        // this very operation (computed with this device's EntryPoint and
        // chainId).
        const safety = checkVaultEvmUserOp(data.evmUserOp);
        if (!safety.ok) {
          setDecodedVaultTx(failed(safety.reason));
        } else {
          const decoded = decodeVaultTransaction(
            JSON.stringify({ userOpRequest: safety.userOp }),
            chain,
          );
          if (
            !decoded.error &&
            !userOpHashMatches(safety.userOp, chain, data.rawUnsignedTx)
          ) {
            decoded.error =
              'The operation hash does not match the operation shown';
          }
          // VD-4: the sender is the vault account derived from the pinned
          // descriptor at this address index.
          const accountProblem = checkVaultEvmAccount(
            vaultDescriptor,
            vaultAddressIndex,
            safety.userOp.sender,
            data.allSignerKeys,
          );
          if (!decoded.error && accountProblem) {
            decoded.error = accountProblem;
          }
          setDecodedVaultTx(bind(decoded));
        }
      } else {
        setDecodedVaultTx(failed('The request carries no operation to verify'));
      }
    } else if (chainType === 'sol') {
      // Solana: trustlessly decode the raw base64 bundle bytes and
      // compare against the relay-supplied payload (shared helper —
      // used by the socket effect and the pull-to-refresh path). Any
      // verdict other than a complete verification blocks approval in
      // VaultSignRequest. Setters are seq-guarded so a decode that
      // resolves after a newer request arrived is discarded.
      // VD-4: the bytes must act on the multisig + vault PDA derived from
      // the pinned descriptor (its member set replaces any relay-supplied
      // solMembers / solThreshold).
      let vaultBinding: VaultSolBinding;
      try {
        vaultBinding = vaultSolBinding(vaultDescriptor, vaultAddressIndex);
      } catch (error) {
        setDecodedVaultTx(
          failed(
            error instanceof Error
              ? error.message
              : 'could not derive the vault address',
          ),
        );
        return;
      }
      void applyVaultSolDecode(
        data,
        (tx) => {
          if (solDecodeSeqRef.current === decodeSeq) {
            setDecodedVaultTx(bind(tx));
          }
        },
        (state) => {
          if (solDecodeSeqRef.current === decodeSeq) {
            setSolDecodeState(state);
          }
        },
        { requestDigest, vaultBinding },
      );
    } else {
      // UTXO: decode from raw TX hex, pass first input scripts for sender derivation
      const inputs = Array.isArray(data.inputDetails) ? data.inputDetails : [];
      const inputAmounts = inputs.map(
        (inp: { amount?: string }) => inp.amount || '0',
      );
      const firstInput = inputs[0] as
        | { witnessScript?: string; redeemScript?: string }
        | undefined;
      const decoded = decodeVaultTransaction(
        data.rawUnsignedTx,
        chain,
        inputAmounts,
        firstInput,
      );
      // VD-4: every input spends a vault address derived from the pinned
      // descriptor; change is only an output back to the vault; every other
      // output is a recipient and is shown.
      const utxoCheck = checkVaultUtxoTransaction(
        vaultDescriptor,
        data.rawUnsignedTx,
        data.inputDetails,
      );
      if (!utxoCheck.ok) {
        decoded.error = decoded.error ?? utxoCheck.reason;
      } else if (!decoded.error) {
        decoded.sender = utxoCheck.sender;
        decoded.recipients = utxoCheck.recipients;
      }
      if (decoded.error || !utxoCheck.ok) {
        setDecodedVaultTx(bind(decoded));
        return;
      }
      // The relay's input amounts make the fee: on DOGE/RVN each one is
      // checked against its hash-verified previous transaction, and the fee
      // is capped on every chain. Until that resolves nothing is shown as
      // decoded, so approval stays disabled; a newer request discards it.
      void verifyVaultUtxoAmounts(
        chain,
        data.rawUnsignedTx,
        data.inputDetails,
        utxoCheck.inputs,
      ).then((amountCheck) => {
        if (solDecodeSeqRef.current !== decodeSeq) {
          return;
        }
        if (amountCheck.ok) {
          decoded.fee = amountCheck.fee;
        } else {
          decoded.error = amountCheck.reason;
        }
        setDecodedVaultTx(bind(decoded));
      });
    }
  };

  // Flux node start requests: every ingestion path (socket effect below and
  // Home's poll path) goes through this setter, so the vault descriptor
  // verdict (VD-3) and the collateral check (VD-4) are published for the
  // approval screen before the request is shown.
  const setFluxNodeStartData = (data: Record<string, unknown> | null) => {
    if (data) {
      let verdict: VaultDescriptorVerdict = evaluateVaultDescriptor(
        data,
        ownVault(),
      );
      if (verdict.kind !== 'refused') {
        let problem: string | null;
        try {
          problem = checkFluxNodeCollateral(
            verdict.descriptor,
            fluxNodeAddressIndex(data),
            data.redeemScript,
            data.collateralAddress,
          );
        } catch {
          problem = 'invalid address index';
        }
        if (problem) {
          verdict = { kind: 'refused', code: 'invalid', reason: problem };
        }
      }
      publishVaultVerdict(
        'fluxnode',
        fluxNodeRequestFingerprint(data),
        verdict,
      );
    } else {
      // also drops a pin confirmation staged for this request (VD-3)
      clearVaultRequestState('fluxnode');
    }
    setFluxNodeStartDataState(data);
  };

  // Clears the vault-signing pending state. Exact statement sequence the
  // reject path and the sign-completion finally block in Home used inline.
  const clearVaultSigningState = () => {
    // also drops a pin confirmation staged for this request (VD-3)
    clearVaultRequestState('vaultsign');
    solDecodeSeqRef.current += 1; // discard any in-flight sol decode
    setVaultSigningData(null);
    setDecodedVaultTx(null);
    setSolDecodeState(null);
  };

  useEffect(() => {
    if (newTx.rawTx) {
      handleTxRequest(newTx.rawTx, newTx.chain, newTx.path, newTx.utxos);
      clearTx?.();
    }
  }, [newTx.rawTx]);

  useEffect(() => {
    if (publicNoncesRequest) {
      handlePublicNoncesRequest(identityChain);
      clearPublicNoncesRequest?.();
    }
  }, [publicNoncesRequest]);

  useEffect(() => {
    if (evmSigningRequest) {
      // Routed through handleEvmSigningRequest so the socket path gets the
      // same chain validation as the poll path (and so the request body,
      // which carries the wallet's partial signature, is not logged).
      handleEvmSigningRequest(evmSigningRequest);
    }
  }, [evmSigningRequest]);

  useEffect(() => {
    if (socketWkSigningRequest) {
      console.log('[WK Signing] Received request:', socketWkSigningRequest);
      setWkSigningData(socketWkSigningRequest);
    }
  }, [socketWkSigningRequest]);

  useEffect(() => {
    if (socketVaultXpubRequest) {
      console.log('[Vault Xpub] Received request:', socketVaultXpubRequest);
      // H-1 at receipt: never show an xpub request for a non-organisation
      // account (consumer 0', recovery 99').
      const requestProblem = validateVaultXpubRequest(socketVaultXpubRequest);
      if (requestProblem !== null) {
        console.log('[Vault Xpub] Refusing request:', requestProblem);
        displayMessage('error', t('home:err_vault_request_invalid'), 6000);
        clearVaultXpubRequest?.();
        return;
      }
      setVaultXpubData(socketVaultXpubRequest);
    }
  }, [socketVaultXpubRequest]);

  useEffect(() => {
    if (socketVaultSigningRequest) {
      console.log(
        '[Vault Signing] Received request for chain:',
        socketVaultSigningRequest.chain,
      );
      try {
        ingestVaultSigningRequest(
          socketVaultSigningRequest,
          '[Vault Signing] Recipients type:',
        );
      } catch {
        displayMessage('error', t('home:err_invalid_request'), 5000);
      }
    }
  }, [socketVaultSigningRequest]);

  useEffect(() => {
    if (socketKeyNonceSyncRequest) {
      console.log('[Enterprise Nonces] Key nonce sync request received');
      setKeyNonceSyncDialogOpen(true);
    }
  }, [socketKeyNonceSyncRequest]);

  // Handle Enterprise Flux Node Start request
  useEffect(() => {
    if (socketFluxNodeStartRequest) {
      console.log('[Enterprise Flux Node] Start request received');
      // H-1 at receipt: organisation index, vault/address indices.
      const requestProblem = validateFluxNodeStartRequest(
        socketFluxNodeStartRequest,
      );
      if (requestProblem !== null) {
        console.log('[Enterprise Flux Node] Refusing request:', requestProblem);
        displayMessage('error', t('home:err_vault_request_invalid'), 6000);
      } else {
        setFluxNodeStartData(socketFluxNodeStartRequest);
      }
      clearFluxNodeStartRequest?.();
    }
  }, [socketFluxNodeStartRequest]);

  return {
    // pending-request state (names identical to the former Home.tsx state)
    rawTx,
    setRawTx,
    activeChain,
    setActiveChain,
    txPath,
    setTxPath,
    txUtxos,
    setTxUtxos,
    syncReq,
    setSyncReq,
    publicNoncesReq,
    setPublicNoncesReq,
    evmSigningData,
    setEvmSigningData,
    wkSigningData,
    setWkSigningData,
    vaultXpubData,
    setVaultXpubData,
    vaultSigningData,
    decodedVaultTx,
    solDecodeState,
    fluxNodeStartData,
    setFluxNodeStartData,
    keyNonceSyncDialogOpen,
    setKeyNonceSyncDialogOpen,
    recoveryRequestData,
    setRecoveryRequestData,
    // request ingestion helpers (same bodies as the former Home.tsx ones)
    handleTxRequest,
    handlePublicNoncesRequest,
    handleEvmSigningRequest,
    handleWkSigningRequest,
    handleSyncRequest,
    ingestVaultSigningRequest,
    clearVaultSigningState,
  };
}
