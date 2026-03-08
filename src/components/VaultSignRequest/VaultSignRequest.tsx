import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
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
  // tokenContract is received but not directly used — it's part of the props interface for future use
  tokenSymbol,
  tokenDecimals,
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
  // For token transfers, use token decimals/symbol for amounts; fee always uses chain decimals/symbol
  const amountDecimals = tokenDecimals != null ? tokenDecimals : chainDecimals;
  const amountSymbol = tokenSymbol || chainSymbol;

  const approve = () => {
    console.log('Approve vault signing request');
    actionStatus(true);
  };

  const openAuthentication = () => {
    console.log('Open Authentication for vault signing');
    setAuthenticationOpen(true);
  };

  const reject = () => {
    console.log('Reject vault signing request');
    actionStatus(false);
  };

  const handleAuthenticationOpen = (status: boolean) => {
    console.log('Authentication result:', status);
    setAuthenticationOpen(false);
    if (status === true) {
      approve();
    }
  };

  return (
    <>
      <View
        style={[
          Layout.fill,
          Layout.relative,
          Layout.fullWidth,
          Layout.alignItemsCenter,
          { paddingTop: 20 },
        ]}
      >
        {/* Vault Signing Icon */}
        <Icon name="shield" size={40} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            Gutters.smallTMargin,
            Gutters.smallBMargin,
          ]}
        >
          {t('home:vault_sign_request')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            Gutters.regularLMargin,
            Gutters.regularRMargin,
          ]}
        >
          {t('home:vault_sign_request_info')}
        </Text>

        {/* Vault & Org Info */}
        {(vaultName || orgName) && (
          <View
            style={[
              Gutters.regularTMargin,
              Gutters.regularLMargin,
              Gutters.regularRMargin,
              {
                backgroundColor: Colors.inputBackground,
                borderRadius: 8,
                padding: 12,
                width: '90%',
                borderWidth: 1,
                borderColor: Colors.textGray200,
              },
            ]}
          >
            {vaultName && (
              <View style={{ marginBottom: orgName ? 4 : 0 }}>
                <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
                  {t('home:vault')}
                </Text>
                <Text style={[Fonts.textSmall, Fonts.textBold]}>
                  {vaultName}
                </Text>
              </View>
            )}
            {orgName && (
              <View>
                <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
                  {t('home:organization')}
                </Text>
                <Text style={[Fonts.textSmall, Fonts.textBold]}>{orgName}</Text>
              </View>
            )}
          </View>
        )}

        {/* Chain Info */}
        <View
          style={[
            Gutters.regularTMargin,
            Gutters.regularLMargin,
            Gutters.regularRMargin,
            Layout.alignItemsCenter,
          ]}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              { color: Colors.textGray400, marginBottom: 4 },
            ]}
          >
            {t('home:chain')}:
          </Text>
        </View>
        <View
          style={[
            Gutters.regularLMargin,
            Gutters.regularRMargin,
            {
              backgroundColor: Colors.inputBackground,
              borderRadius: 8,
              padding: 12,
              width: '90%',
              borderWidth: 1,
              borderColor: Colors.textGray200,
            },
          ]}
        >
          <Text
            style={[Fonts.textSmall, Fonts.textBold, Fonts.textCenter]}
            selectable={true}
          >
            {chainDisplay}
          </Text>
        </View>

        {/* Recipients */}
        <View style={[Gutters.regularTMargin, Layout.alignItemsCenter]}>
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              { color: Colors.textGray400, marginBottom: 4 },
            ]}
          >
            {t('home:vault_sign_recipients')}:
          </Text>
        </View>
        <View
          style={{
            maxHeight: 120,
            backgroundColor: Colors.inputBackground,
            borderRadius: 8,
            padding: 10,
            width: '90%',
            borderWidth: 1,
            borderColor: Colors.textGray200,
          }}
        >
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
          >
            {Array.isArray(recipients) && recipients.length > 0 ? (
              recipients.map((recipient, index) => (
                <View
                  key={index}
                  style={{
                    marginBottom: index < recipients.length - 1 ? 8 : 0,
                  }}
                >
                  {recipient.label && (
                    <Text
                      style={[Fonts.textTiny, { color: Colors.textGray400 }]}
                    >
                      {recipient.label}
                    </Text>
                  )}
                  <Text
                    style={[
                      Fonts.textTiny,
                      { fontFamily: 'monospace', lineHeight: 16 },
                    ]}
                    selectable={true}
                    numberOfLines={2}
                    ellipsizeMode="middle"
                  >
                    {recipient.address}
                  </Text>
                  <Text
                    style={[Fonts.textSmall, Fonts.textBold, { marginTop: 2 }]}
                  >
                    {formatAmount(recipient.amount, amountDecimals)}{' '}
                    {amountSymbol}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
                {t('home:vault_sign_no_recipients')}
              </Text>
            )}
          </ScrollView>
        </View>

        {/* Fee */}
        <View style={[Gutters.smallTMargin, Layout.alignItemsCenter]}>
          <Text style={[Fonts.textSmall, { color: Colors.textGray400 }]}>
            {t('home:vault_sign_fee')}: {formatAmount(fee, chainDecimals)}{' '}
            {chainSymbol}
          </Text>
        </View>

        {/* Memo */}
        {memo && (
          <View style={[Gutters.smallTMargin, Layout.alignItemsCenter]}>
            <Text style={[Fonts.textSmall, { color: Colors.textGray400 }]}>
              {t('home:vault_sign_memo')}: {memo}
            </Text>
          </View>
        )}

        {/* Partial signature note */}
        <View style={[Gutters.smallTMargin, Layout.alignItemsCenter]}>
          <Text
            style={[
              Fonts.textTiny,
              Fonts.textCenter,
              { color: Colors.textGray400 },
            ]}
          >
            {t('home:vault_sign_partial_note')}
          </Text>
        </View>
      </View>

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

export default VaultSignRequest;
