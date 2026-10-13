import React, { useEffect, useRef, useState } from 'react';
import { MONOSPACE_FONT } from '../../lib/typography';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Authentication from '../Authentication/Authentication';
import { Shield } from 'lucide-react-native';
import { blockchains } from '../../storage/blockchains';
import type { cryptos } from '../../types';
import type { VaultDecodedTx } from '../../lib/transactions';
import type { ProposalSimulation } from '../../lib/vaultSimulation';
import {
  armVaultApproval,
  disarmVaultApproval,
  requestDigestOfDecoded,
} from '../../lib/vaultApprovalBinding';
import VaultRiskStrip from './VaultRiskStrip';
import VaultPinConfirm from '../VaultPinConfirm/VaultPinConfirm';
import {
  isVaultPinStaged,
  readLatestVaultVerdict,
  readVaultVerdict,
  stageVaultPinConfirmation,
  useVaultPinStoreVersion,
} from '../../lib/vaultPins';
import {
  setVaultRejectionCode,
  vaultRejectionCode,
  type VaultDescriptorVerdict,
} from '../../lib/vaultDescriptorGate';

import { Card } from '../ui';
import { SlideToApprove } from '../request';
/**
 * Format a base-unit amount (satoshis/wei) to human-readable using chain decimals.
 */
function formatAmount(amount: string, decimals: number): string {
  try {
    const raw = BigInt(amount);
    const divisor = 10n ** BigInt(decimals);
    const wholePart = raw / divisor;
    const fracPart = raw % divisor;
    if (fracPart === 0n) {
      return wholePart.toString();
    }
    const fracStr = fracPart.toString().padStart(decimals, '0');
    const trimmed = fracStr.replace(/0+$/, '');
    return `${wholePart.toString()}.${trimmed}`;
  } catch {
    return amount;
  }
}

interface VaultSignRequestProps {
  activityStatus: boolean;
  recipients: Array<{ address: string; amount: string; label?: string }>;
  /** Relay-supplied fee. NEVER displayed: the fee shown is the decoded one. */
  fee: string;
  feeLabel?: string;
  memo?: string;
  chain: string;
  vaultName?: string;
  orgName?: string;
  actionStatus: (status: boolean) => void;
  // Relay-supplied token metadata. NEVER used for display (H-14): the token
  // contract/mint, decimals and symbol come only from decodedTx, i.e. from
  // the signed bytes and this device's own token list.
  tokenContract?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  // Source vault address for display
  sourceAddress?: string;
  // Decoded transaction data — trustless verification from raw TX
  decodedTx?: VaultDecodedTx | null;
  // Server-computed simulation / risk preview — ADVISORY only, never gates signing
  simulation?: ProposalSimulation | null;
  // Solana byte-decode vs relay-payload verdict (see lib/vaultSolanaDecode).
  // kind 'create' + mismatch = active-attack indicator → approval hard-blocked.
  solDecodeMismatch?: boolean;
  solDecodeKind?: string;
  solMismatchReasons?: string[];
  // True while the async sol byte-decode has not produced a verdict yet —
  // approval stays disabled (fail closed) until the decode resolves.
  solDecodePending?: boolean;
  // WalletConnect Phase 2 — vault MESSAGE signing (personal_sign). When set, this
  // is a message signature (not a transaction): show the message text + dApp
  // instead of recipients/amounts. Signing math is identical (signs the digest).
  signMessage?: string;
  dappOrigin?: string;
}

const VaultSignRequest: React.FC<VaultSignRequestProps> = ({
  activityStatus,
  memo,
  chain,
  vaultName,
  orgName,
  actionStatus,
  decodedTx,
  simulation,
  solDecodeMismatch,
  solDecodeKind,
  solMismatchReasons,
  solDecodePending,
  signMessage,
  dappOrigin,
}) => {
  const { t } = useTranslation(['home', 'common']);
  // A message request is one that carries a message at all — an empty
  // message still signs hashMessage(''), so it must not render as a
  // transaction screen.
  const isMessageSign = signMessage !== undefined;
  const { Fonts, Gutters, Layout, Colors } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const chainConfig = blockchains[chain as keyof cryptos];
  const chainDisplay = chainConfig
    ? `${chainConfig.name} (${chainConfig.symbol})`
    : chain;
  const chainDecimals = chainConfig?.decimals ?? 8;
  const chainSymbol = chainConfig?.symbol ?? chain.toUpperCase();
  // chainType exists only on some chain specs; read it through a narrow cast.
  const chainType = (chainConfig as { chainType?: string } | undefined)
    ?.chainType;
  const isSolChain = chainType === 'sol';

  // H-14: amounts are labelled only from what this device established
  // itself. A token transfer always shows its contract/mint. Decimals come
  // from the signed bytes (Solana TransferChecked) or this device's token
  // list (EVM); the symbol only from that list. Without known decimals the
  // amount is shown in raw base units, and any token the device does not
  // know carries an "unverified token" banner. The relay's tokenSymbol /
  // tokenDecimals are never used.
  const tokenContractShown = isMessageSign
    ? undefined
    : decodedTx?.tokenContract || undefined;
  const tokenDecimalsKnown = typeof decodedTx?.tokenDecimals === 'number';
  const unverifiedToken =
    !!tokenContractShown && (!tokenDecimalsKnown || !decodedTx?.tokenSymbol);
  const formatRecipientAmount = (amount: string): string => {
    if (!tokenContractShown) {
      return `${formatAmount(amount, chainDecimals)} ${chainSymbol}`;
    }
    if (!tokenDecimalsKnown || decodedTx?.tokenDecimals === undefined) {
      return `${amount} ${t('home:vault_sign_base_units')}`;
    }
    return `${formatAmount(amount, decodedTx.tokenDecimals)} ${
      decodedTx.tokenSymbol || t('home:vault_sign_unknown_token')
    }`;
  };

  // Use decoded recipients/fee/sender — trustless verification only
  const displayRecipients = decodedTx?.recipients ?? [];
  // Never the relay-supplied fee: until this device decoded (and, for UTXO
  // vaults, verified the input amounts of) the request, no fee is shown.
  const displayFee = decodedTx?.fee;
  const displaySender = decodedTx?.sender ?? '';

  // Solana byte-decode verdict: a successful decode that contradicts the
  // relay payload is an active-attack indicator → HARD-BLOCK approval.
  // Undecodable bytes block too (SOL-4); approve-only txs show the proposal
  // this device read from chain and decoded (H-13).
  const solBlocked = solDecodeMismatch === true;
  const solUndecodable = solDecodeKind === 'undecodable';
  // Fail closed: while the async byte-decode is still pending there is no
  // verdict yet, so Approve stays disabled (no banner, just disabled) until the
  // decode resolves.
  const solPending = solDecodePending === true;
  // Fail closed on ANY decode error, matching TransactionRequest: nothing this
  // device cannot read is approvable. Reject stays reachable.
  const decodeBlocked = !!decodedTx?.error;
  // CHN-5: message signing exists only for EVM vaults.
  const messageUnsupported = isMessageSign && chainType !== 'evm';
  // CHN-5: the request this screen shows. A decoded view not bound to a
  // request (or none yet) is not approvable.
  const requestDigest = requestDigestOfDecoded(decodedTx);
  // VD-3: the vault descriptor verdict of exactly this request (published at
  // receipt). No verdict, a refusal, or a first-sight vault the user has not
  // confirmed yet blocks approval.
  useVaultPinStoreVersion();
  const descriptorVerdict = readVaultVerdict<VaultDescriptorVerdict>(
    'vaultsign',
    requestDigest,
  );
  const latestVerdict =
    readLatestVaultVerdict<VaultDescriptorVerdict>('vaultsign');
  const pinToConfirm =
    latestVerdict?.kind === 'needs_pin' &&
    !isVaultPinStaged(latestVerdict.pinKey, latestVerdict.hash)
      ? latestVerdict
      : null;
  const descriptorRefused =
    descriptorVerdict?.kind === 'refused' ? descriptorVerdict : null;
  const descriptorBlocked =
    !descriptorVerdict ||
    descriptorVerdict.kind === 'refused' ||
    (descriptorVerdict.kind === 'needs_pin' &&
      !isVaultPinStaged(descriptorVerdict.pinKey, descriptorVerdict.hash));
  const approvalBlocked =
    solBlocked ||
    solPending ||
    solUndecodable ||
    decodeBlocked ||
    messageUnsupported ||
    descriptorBlocked ||
    !requestDigest;
  // The request on screen when the user started approving.
  const approvingDigest = useRef<string | undefined>(undefined);

  // A different request (the relay replaced it, or its decode changed)
  // while authentication is open: close authentication. The user has not
  // seen this one yet and must review and approve it again.
  useEffect(() => {
    if (
      approvingDigest.current !== undefined &&
      approvingDigest.current !== requestDigest
    ) {
      approvingDigest.current = undefined;
      disarmVaultApproval();
      setAuthenticationOpen(false);
    }
  }, [requestDigest]);

  const approve = () => {
    // Single choke point for the Authentication callback: a verdict that
    // turned blocking, or a request that changed, while authentication was
    // open never approves.
    const approving = approvingDigest.current;
    approvingDigest.current = undefined;
    if (approvalBlocked || !approving || approving !== requestDigest) {
      disarmVaultApproval();
      return;
    }
    // The sign action signs only the request with this digest.
    armVaultApproval(approving);
    actionStatus(true);
  };

  const openAuthentication = () => {
    if (approvalBlocked || !requestDigest) {
      return;
    }
    approvingDigest.current = requestDigest;
    setAuthenticationOpen(true);
  };

  const reject = () => {
    approvingDigest.current = undefined;
    disarmVaultApproval();
    // A request refused because of its vault descriptor is rejected with a
    // machine-readable code (forwarded by SSP Wallet to the app).
    setVaultRejectionCode(
      descriptorRefused ? vaultRejectionCode(descriptorRefused.code) : null,
    );
    actionStatus(false);
  };

  const declinePin = () => {
    approvingDigest.current = undefined;
    disarmVaultApproval();
    setVaultRejectionCode('VAULT_PIN_REFUSED');
    actionStatus(false);
  };

  const handleAuthenticationOpen = (status: boolean) => {
    setAuthenticationOpen(false);
    if (status === true) {
      approve();
    } else {
      approvingDigest.current = undefined;
    }
  };

  // VD-3 first sight: the vault's signer set must be confirmed before the
  // request itself is shown or can be approved. Cancel refuses the request.
  if (pinToConfirm) {
    return (
      <VaultPinConfirm
        descriptor={pinToConfirm.descriptor}
        vaultName={vaultName}
        disabled={activityStatus}
        onConfirm={() =>
          stageVaultPinConfirmation(pinToConfirm.pinKey, pinToConfirm.hash)
        }
        onCancel={() => declinePin()}
      />
    );
  }

  return (
    <>
      <ScrollView
        style={[Layout.fill, Layout.fullWidth]}
        contentContainerStyle={[
          Layout.alignItemsCenter,
          Gutters.tinyHPadding,
          { paddingTop: 20, paddingBottom: 20 },
        ]}
        showsVerticalScrollIndicator={true}
      >
        {/* Header */}
        <Shield size={36} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            { marginTop: 8, marginBottom: 4 },
          ]}
        >
          {t('home:vault_sign_request')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            {
              color: Colors.textGray400,
              paddingHorizontal: 24,
              marginBottom: 16,
            },
          ]}
        >
          {t('home:vault_sign_request_info')}
        </Text>

        {/* Vault & Org Card */}
        {(vaultName || orgName) && (
          <Card style={styles.card}>
            {vaultName && (
              <View style={{ marginBottom: orgName ? 8 : 0 }}>
                <Text style={[styles.label, { color: Colors.textGray400 }]}>
                  {t('home:vault')}
                </Text>
                <Text style={[Fonts.textSmall, Fonts.textBold]}>
                  {vaultName}
                </Text>
              </View>
            )}
            {orgName && (
              <View>
                <Text style={[styles.label, { color: Colors.textGray400 }]}>
                  {t('home:organization')}
                </Text>
                <Text style={[Fonts.textSmall, Fonts.textBold]}>{orgName}</Text>
              </View>
            )}
          </Card>
        )}

        {/* Chain Card */}
        <Card style={styles.card}>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:chain')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold]} selectable={true}>
            {chainDisplay}
          </Text>
        </Card>

        {/* Decoded data notice — provenance depends on the sol decode kind:
            'approve' values come from the on-chain proposal this device
            fetched and decoded; 'undecodable' shows nothing and blocks. */}
        {solDecodeKind === 'approve' ? (
          <Card style={styles.card}>
            <Text
              style={[
                Fonts.textTiny,
                { color: Colors.textGray400, textAlign: 'center' },
              ]}
            >
              {t('home:vault_sign_sol_approve_only')}
            </Text>
          </Card>
        ) : solUndecodable ? (
          <Card style={[styles.card, { borderColor: Colors.error }]}>
            <Text
              style={[
                Fonts.textTiny,
                Fonts.textBold,
                { color: Colors.error, textAlign: 'center' },
              ]}
            >
              {t('home:vault_sign_sol_undecodable')}
            </Text>
            {decodedTx?.error ? (
              <Text
                style={[
                  Fonts.textTiny,
                  { color: Colors.error, textAlign: 'center', marginTop: 4 },
                ]}
              >
                {decodedTx.error}
              </Text>
            ) : null}
          </Card>
        ) : (
          <Text
            style={[
              Fonts.textTiny,
              {
                color: Colors.textGray400,
                textAlign: 'center',
                paddingHorizontal: 24,
                marginBottom: 12,
              },
            ]}
          >
            {t('home:vault_sign_decoded_notice')}
          </Text>
        )}

        {/* VD-3: vault descriptor refused — approval is hard-blocked */}
        {descriptorRefused ? (
          <Card style={[styles.card, { borderColor: Colors.error }]}>
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textBold,
                { color: Colors.error, textAlign: 'center' },
              ]}
            >
              {descriptorRefused.code === 'missing'
                ? t('home:vault_descriptor_missing_title')
                : descriptorRefused.code === 'mismatch'
                  ? t('home:vault_descriptor_changed_title')
                  : t('home:vault_descriptor_invalid_title')}
            </Text>
            <Text
              style={[
                Fonts.textTiny,
                { color: Colors.error, textAlign: 'center', marginTop: 4 },
              ]}
            >
              {descriptorRefused.code === 'missing'
                ? t('home:vault_descriptor_missing_info')
                : descriptorRefused.code === 'mismatch'
                  ? t('home:vault_descriptor_changed_info')
                  : descriptorRefused.reason}
            </Text>
          </Card>
        ) : null}

        {/* Sol byte-decode vs payload mismatch — approval is hard-blocked */}
        {solBlocked && (
          <Card style={[styles.card, { borderColor: Colors.error }]}>
            <Text
              style={[
                Fonts.textTiny,
                Fonts.textBold,
                { color: Colors.error, textAlign: 'center' },
              ]}
            >
              {t('home:vault_sign_sol_decode_mismatch')}
            </Text>
            {(solMismatchReasons ?? []).map((reason, index) => (
              <Text
                key={index}
                style={[
                  Fonts.textTiny,
                  { color: Colors.error, textAlign: 'center', marginTop: 4 },
                ]}
              >
                {reason}
              </Text>
            ))}
          </Card>
        )}

        {/* Decode error — approval is blocked */}
        {decodedTx?.error && !solUndecodable && !descriptorRefused ? (
          <Card style={[styles.card, { borderColor: Colors.error }]}>
            <Text
              style={[
                Fonts.textTiny,
                Fonts.textBold,
                {
                  color: Colors.error,
                  textAlign: 'center',
                },
              ]}
            >
              {t('home:vault_sign_decode_error')}
            </Text>
            <Text
              style={[
                Fonts.textTiny,
                { color: Colors.error, textAlign: 'center', marginTop: 4 },
              ]}
            >
              {decodedTx.error}
            </Text>
          </Card>
        ) : null}

        {/* Message signing on a non-EVM chain — approval is blocked */}
        {messageUnsupported ? (
          <Card style={[styles.card, { borderColor: Colors.error }]}>
            <Text
              style={[
                Fonts.textTiny,
                Fonts.textBold,
                { color: Colors.error, textAlign: 'center' },
              ]}
            >
              {t('home:vault_sign_message_unsupported')}
            </Text>
          </Card>
        ) : null}

        {/* Token not known to this device — amounts cannot be labelled */}
        {unverifiedToken ? (
          <Card style={[styles.card, { borderColor: Colors.warning }]}>
            <Text
              style={[
                Fonts.textTiny,
                Fonts.textBold,
                { color: Colors.warning, textAlign: 'center' },
              ]}
            >
              {t('home:vault_sign_unverified_token')}
            </Text>
          </Card>
        ) : null}

        {/* Token contract / mint — always shown for a token transfer */}
        {tokenContractShown ? (
          <Card style={styles.card}>
            <Text style={[styles.label, { color: Colors.textGray400 }]}>
              {isSolChain
                ? t('home:vault_sign_token_mint')
                : t('home:token_contract')}
            </Text>
            <Text
              style={[
                Fonts.textTiny,
                Fonts.textBold,
                { fontFamily: MONOSPACE_FONT, lineHeight: 18, marginTop: 2 },
              ]}
              selectable={true}
            >
              {tokenContractShown}
            </Text>
          </Card>
        ) : null}

        {/* Source Address — decoded from raw transaction */}
        {displaySender ? (
          <Card style={styles.card}>
            <Text style={[styles.label, { color: Colors.textGray400 }]}>
              {t('home:vault_sign_source_address')}
            </Text>
            <Text
              style={[
                Fonts.textTiny,
                {
                  fontFamily: MONOSPACE_FONT,
                  lineHeight: 18,
                  marginTop: 2,
                },
              ]}
              selectable={true}
            >
              {displaySender}
            </Text>
          </Card>
        ) : null}

        {/* WalletConnect Phase 2 — message signing: show the message + dApp
            instead of recipients/amounts (there is no transaction). */}
        {isMessageSign ? (
          <Card style={styles.card}>
            {dappOrigin ? (
              <>
                <Text style={[styles.label, { color: Colors.textGray400 }]}>
                  {t('home:vault_sign_dapp')}
                </Text>
                <Text
                  style={[Fonts.textSmall, Fonts.textBold, { marginBottom: 8 }]}
                  selectable={true}
                >
                  {dappOrigin}
                </Text>
              </>
            ) : null}
            <Text style={[styles.label, { color: Colors.textGray400 }]}>
              {t('home:vault_sign_message')}
            </Text>
            <Text
              style={[
                Fonts.textTiny,
                { fontFamily: MONOSPACE_FONT, lineHeight: 18, marginTop: 4 },
              ]}
              selectable={true}
            >
              {signMessage}
            </Text>
          </Card>
        ) : null}

        {/* Recipients — decoded from raw transaction */}
        {!isMessageSign &&
          (displayRecipients.length > 0 ? (
            displayRecipients.map((recipient, index) => (
              <Card key={index} style={styles.card}>
                <Text
                  style={[
                    styles.label,
                    { color: Colors.textGray400, marginBottom: 6 },
                  ]}
                >
                  {t('home:vault_sign_recipients')}
                </Text>
                <View style={{ paddingLeft: 10 }}>
                  <Text style={[styles.label, { color: Colors.textGray400 }]}>
                    {t('home:vault_sign_address')}
                  </Text>
                  <Text
                    style={[
                      Fonts.textTiny,
                      Fonts.textBold,
                      {
                        fontFamily: MONOSPACE_FONT,
                        lineHeight: 18,
                        marginTop: 2,
                      },
                    ]}
                    selectable={true}
                  >
                    {recipient.address}
                  </Text>
                  <Text
                    style={[
                      styles.label,
                      { color: Colors.textGray400, marginTop: 8 },
                    ]}
                  >
                    {t('home:vault_sign_amount')}
                  </Text>
                  <Text
                    style={[
                      Fonts.textSmall,
                      Fonts.textBold,
                      styles.tabular,
                      { marginTop: 2 },
                    ]}
                  >
                    {formatRecipientAmount(recipient.amount)}
                  </Text>
                </View>
              </Card>
            ))
          ) : (
            <Card style={styles.card}>
              <Text style={[styles.label, { color: Colors.textGray400 }]}>
                {t('home:vault_sign_recipients')}
              </Text>
              <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
                {t('home:vault_sign_no_recipients')}
              </Text>
            </Card>
          ))}

        {/* Fee Card — decoded from raw transaction (omitted for message signing) */}
        {!isMessageSign && (
          <Card style={styles.card}>
            <Text style={[styles.label, { color: Colors.textGray400 }]}>
              {t('home:vault_sign_fee')}
            </Text>
            <Text style={[Fonts.textSmall, Fonts.textBold, styles.tabular]}>
              {displayFee !== undefined
                ? `${formatAmount(displayFee, chainDecimals)} ${chainSymbol}`
                : '…'}
            </Text>
          </Card>
        )}

        {/* Memo Card — from metadata (not in raw transaction) */}
        {memo && (
          <Card style={styles.card}>
            <Text style={[styles.label, { color: Colors.textGray400 }]}>
              {t('home:vault_sign_memo')}
            </Text>
            <Text style={[Fonts.textSmall]}>{memo}</Text>
          </Card>
        )}

        {/* Risk strip — ADVISORY. Critical/high warnings render as prominent
            banners the user must scroll past before the approve control. NEVER
            disables the approve button; the device decode above stays primary. */}
        <VaultRiskStrip simulation={simulation} decodedTx={decodedTx} />

        {/* Partial signature note */}
        <Text
          style={[
            Fonts.textTiny,
            Fonts.textCenter,
            { color: Colors.textGray400, paddingHorizontal: 24, marginTop: 4 },
          ]}
        >
          {t('home:vault_sign_partial_note')}
        </Text>
      </ScrollView>

      {/* Action Buttons — fixed at bottom */}
      <View
        style={[
          Layout.selfStretch,
          Layout.justifyContentEnd,
          Gutters.tinyHMargin,
        ]}
      >
        <SlideToApprove
          label={t('home:slide_to_approve')}
          accessibilityLabel={t('home:approve_request')}
          style={[
            Gutters.regularBMargin,
            Gutters.smallTMargin,
            approvalBlocked ? { opacity: 0.4 } : {},
          ]}
          disabled={authenticationOpen || activityStatus || approvalBlocked}
          loading={authenticationOpen || activityStatus}
          onComplete={() => openAuthentication()}
        />
        <TouchableOpacity
          accessibilityRole="button"
          disabled={authenticationOpen || activityStatus}
          onPress={() => reject()}
          hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textPrimary,
              Gutters.regularBMargin,
              Fonts.textCenter,
            ]}
          >
            {t('home:reject')}
          </Text>
        </TouchableOpacity>
      </View>

      {authenticationOpen && (
        <Authentication
          actionStatus={handleAuthenticationOpen}
          type="vaultsigning"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    marginBottom: 2,
  },
  card: {
    // Screen owns the side gutter — see request/ActionCard.
    alignSelf: 'stretch',
    marginBottom: 12,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});

export default VaultSignRequest;
