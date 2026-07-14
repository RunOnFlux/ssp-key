import React, { useState } from 'react';
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
import Icon from 'react-native-vector-icons/Feather';
import { blockchains } from '../../storage/blockchains';
import type { cryptos } from '../../types';
import type { VaultDecodedTx } from '../../lib/transactions';
import type { ProposalSimulation } from '../../lib/vaultSimulation';
import VaultRiskStrip from './VaultRiskStrip';

import { Card, PrimaryButton } from '../ui';
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
  fee: string;
  feeLabel?: string;
  memo?: string;
  chain: string;
  vaultName?: string;
  orgName?: string;
  actionStatus: (status: boolean) => void;
  // ERC-20 token metadata (EVM only, omit for native currency)
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
  fee,
  memo,
  chain,
  vaultName,
  orgName,
  actionStatus,
  tokenSymbol,
  tokenDecimals,
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
  const isMessageSign = !!signMessage;
  const { Fonts, Gutters, Layout, Colors } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const chainConfig = blockchains[chain as keyof cryptos];
  const chainDisplay = chainConfig
    ? `${chainConfig.name} (${chainConfig.symbol})`
    : chain;
  const chainDecimals = chainConfig?.decimals ?? 8;
  const chainSymbol = chainConfig?.symbol ?? chain.toUpperCase();
  const amountDecimals =
    decodedTx?.tokenDecimals ??
    (tokenDecimals != null ? tokenDecimals : chainDecimals);
  const amountSymbol = decodedTx?.tokenSymbol || tokenSymbol || chainSymbol;

  // Use decoded recipients/fee/sender — trustless verification only
  const displayRecipients = decodedTx?.recipients ?? [];
  const displayFee = decodedTx?.fee ?? fee;
  const displaySender = decodedTx?.sender ?? '';

  // Solana byte-decode verdict: a successful decode that contradicts the
  // relay payload is an active-attack indicator → HARD-BLOCK approval.
  // Undecodable bytes only warn (never-strand-funds); approve-only txs carry
  // proposal-record amounts (verified at creation).
  const solBlocked = solDecodeMismatch === true;
  // Fail closed: while the async byte-decode is still pending there is no
  // verdict yet — keep Approve disabled (no attack banner, just disabled)
  // until the decode resolves.
  const solPending = solDecodePending === true;

  const approve = () => {
    actionStatus(true);
  };

  const openAuthentication = () => {
    setAuthenticationOpen(true);
  };

  const reject = () => {
    actionStatus(false);
  };

  const handleAuthenticationOpen = (status: boolean) => {
    setAuthenticationOpen(false);
    if (status === true) {
      approve();
    }
  };

  return (
    <>
      <ScrollView
        style={[Layout.fill, Layout.fullWidth]}
        contentContainerStyle={[
          Layout.alignItemsCenter,
          { paddingTop: 20, paddingBottom: 20 },
        ]}
        showsVerticalScrollIndicator={true}
      >
        {/* Header */}
        <Icon name="shield" size={36} color={Colors.textGray400} />
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
            'approve' amounts come from the proposal record, 'undecodable'
            amounts come from the relay unverified. */}
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
        ) : solDecodeKind === 'undecodable' ? (
          <Card style={[styles.card, { borderColor: Colors.warning }]}>
            <Text
              style={[
                Fonts.textTiny,
                { color: Colors.warning, textAlign: 'center' },
              ]}
            >
              {t('home:vault_sign_sol_undecodable')}
            </Text>
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

        {/* Decode error warning */}
        {decodedTx?.error && (
          <Card style={[styles.card, { borderColor: Colors.error }]}>
            <Text
              style={[
                Fonts.textTiny,
                {
                  color: Colors.error,
                  textAlign: 'center',
                },
              ]}
            >
              {t('home:vault_sign_decode_error')}
            </Text>
          </Card>
        )}

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
                  fontFamily: 'monospace',
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
                { fontFamily: 'monospace', lineHeight: 18, marginTop: 4 },
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
                        fontFamily: 'monospace',
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
                    style={[Fonts.textSmall, Fonts.textBold, { marginTop: 2 }]}
                  >
                    {formatAmount(recipient.amount, amountDecimals)}{' '}
                    {amountSymbol}
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
            <Text style={[Fonts.textSmall, Fonts.textBold]}>
              {formatAmount(displayFee, chainDecimals)} {chainSymbol}
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
          Layout.justifyContentEnd,
          Gutters.regularLMargin,
          Gutters.regularRMargin,
        ]}
      >
        <PrimaryButton
          label={t('home:approve_request')}
          style={[
            Gutters.regularBMargin,
            Gutters.smallTMargin,
            solBlocked || solPending ? { opacity: 0.4 } : {},
          ]}
          disabled={
            authenticationOpen || activityStatus || solBlocked || solPending
          }
          loading={authenticationOpen || activityStatus}
          onPress={() => openAuthentication()}
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
    width: '90%',
    marginBottom: 12,
  },
});

export default VaultSignRequest;
