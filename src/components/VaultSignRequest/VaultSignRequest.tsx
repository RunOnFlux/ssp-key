import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Authentication from '../Authentication/Authentication';
import Icon from 'react-native-vector-icons/Feather';
import { blockchains } from '../../storage/blockchains';
import type { cryptos } from '../../types';

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
}

const VaultSignRequest: React.FC<VaultSignRequestProps> = ({
  activityStatus,
  recipients,
  fee,
  memo,
  chain,
  vaultName,
  orgName,
  actionStatus,
  tokenSymbol,
  tokenDecimals,
  sourceAddress,
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const chainConfig = blockchains[chain as keyof cryptos];
  const chainDisplay = chainConfig
    ? `${chainConfig.name} (${chainConfig.symbol})`
    : chain;
  const chainDecimals = chainConfig?.decimals ?? 8;
  const chainSymbol = chainConfig?.symbol ?? chain.toUpperCase();
  const amountDecimals = tokenDecimals != null ? tokenDecimals : chainDecimals;
  const amountSymbol = tokenSymbol || chainSymbol;

  const cardStyle = {
    backgroundColor: Colors.inputBackground,
    borderRadius: 8,
    padding: 12,
    width: '90%' as const,
    borderWidth: 1,
    borderColor: Colors.textGray200,
  };

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
          <View style={[cardStyle, { marginBottom: 12 }]}>
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
          </View>
        )}

        {/* Chain Card */}
        <View style={[cardStyle, { marginBottom: 12 }]}>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:chain')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold]} selectable={true}>
            {chainDisplay}
          </Text>
        </View>

        {/* Source Address */}
        {sourceAddress && (
          <View style={[cardStyle, { marginBottom: 12 }]}>
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
              {sourceAddress}
            </Text>
          </View>
        )}

        {/* Recipients */}
        {Array.isArray(recipients) && recipients.length > 0 ? (
          recipients.map((recipient, index) => (
            <View key={index} style={[cardStyle, { marginBottom: 12 }]}>
              <Text
                style={[
                  styles.label,
                  { color: Colors.textGray400, marginBottom: 6 },
                ]}
              >
                {recipient.label || t('home:vault_sign_recipients')}
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
            </View>
          ))
        ) : (
          <View style={[cardStyle, { marginBottom: 12 }]}>
            <Text style={[styles.label, { color: Colors.textGray400 }]}>
              {t('home:vault_sign_recipients')}
            </Text>
            <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
              {t('home:vault_sign_no_recipients')}
            </Text>
          </View>
        )}

        {/* Fee Card */}
        <View style={[cardStyle, { marginBottom: 12 }]}>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:vault_sign_fee')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold]}>
            {formatAmount(fee, chainDecimals)} {chainSymbol}
          </Text>
        </View>

        {/* Memo Card */}
        {memo && (
          <View style={[cardStyle, { marginBottom: 12 }]}>
            <Text style={[styles.label, { color: Colors.textGray400 }]}>
              {t('home:vault_sign_memo')}
            </Text>
            <Text style={[Fonts.textSmall]}>{memo}</Text>
          </View>
        )}

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
        <TouchableOpacity
          style={[
            Common.button.rounded,
            Common.button.bluePrimary,
            Gutters.regularBMargin,
            Gutters.smallTMargin,
          ]}
          disabled={authenticationOpen || activityStatus}
          onPressIn={() => openAuthentication()}
        >
          {(authenticationOpen || activityStatus) && (
            <ActivityIndicator
              size={'large'}
              style={[{ position: 'absolute' }]}
            />
          )}
          <Text style={[Fonts.textRegular, Fonts.textWhite]}>
            {t('home:approve_request')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={authenticationOpen || activityStatus}
          onPressIn={() => reject()}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBluePrimary,
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
});

export default VaultSignRequest;
