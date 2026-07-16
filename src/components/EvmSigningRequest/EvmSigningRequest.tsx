import React, { useState, useEffect, useMemo } from 'react';
import { MONOSPACE_FONT } from '../../lib/typography';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { useAppSelector } from '../../hooks';
import { blockchains } from '../../storage/blockchains';
import { generateMultisigAddress } from '../../lib/wallet';
import { decodeEvmSigningData } from '../../lib/transactions';
import type { DecodedEvmSigningData } from '../../lib/transactions';
import * as Keychain from 'react-native-keychain';
import CryptoJS from 'crypto-js';
import { cryptos } from '../../types';
import Authentication from '../Authentication/Authentication';

import { SlideToApprove } from '../request';
interface EvmSigningRequestProps {
  activityStatus: boolean;
  dataToSign: string;
  chain: keyof cryptos;
  walletInUse: string;
  actionStatus: (status: boolean) => void;
}

const EvmSigningRequest: React.FC<EvmSigningRequestProps> = ({
  activityStatus,
  dataToSign,
  chain,
  walletInUse,
  actionStatus,
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const [signingAddress, setSigningAddress] = useState<string>('');
  const [loadingAddress, setLoadingAddress] = useState(true);
  const [showRawData, setShowRawData] = useState(false);

  // Display-only decode of the requested data — never affects what is signed.
  const decoded: DecodedEvmSigningData = useMemo(
    () => decodeEvmSigningData(dataToSign, chain),
    [dataToSign, chain],
  );

  // Get encrypted keys from Redux
  const { xpubWallet, xpubKey } = useAppSelector((state) => state[chain]);

  // Get blockchain configuration
  const blockchainConfig = blockchains[chain];

  // Generate the signing address on component mount
  useEffect(() => {
    const generateSigningAddress = async () => {
      try {
        if (!xpubWallet || !xpubKey || !walletInUse) {
          setLoadingAddress(false);
          return;
        }

        // Get decryption keys from keychain
        const encryptionKey = await Keychain.getGenericPassword({
          service: 'enc_key',
        });
        const passwordData = await Keychain.getGenericPassword({
          service: 'sspkey_pw',
        });

        if (!passwordData || !encryptionKey) {
          console.warn('Unable to decrypt stored data for address generation');
          setLoadingAddress(false);
          return;
        }

        // Decrypt password
        const passwordDecrypted = CryptoJS.AES.decrypt(
          passwordData.password,
          encryptionKey.password,
        );
        const passwordDecryptedString = passwordDecrypted.toString(
          CryptoJS.enc.Utf8,
        );
        const pwForEncryption =
          encryptionKey.password + passwordDecryptedString;

        // Decrypt xpub keys
        const xpubWalletDecrypted = CryptoJS.AES.decrypt(
          xpubWallet,
          pwForEncryption,
        ).toString(CryptoJS.enc.Utf8);
        const xpubKeyDecrypted = CryptoJS.AES.decrypt(
          xpubKey,
          pwForEncryption,
        ).toString(CryptoJS.enc.Utf8);

        // Parse wallet path
        const splittedDerPath = walletInUse.split('-');
        const typeIndex = Number(splittedDerPath[0]) as 0 | 1;
        const addressIndex = Number(splittedDerPath[1]);

        // Generate address
        const addrInfo = generateMultisigAddress(
          xpubWalletDecrypted,
          xpubKeyDecrypted,
          typeIndex,
          addressIndex,
          chain,
        );

        if (addrInfo?.address) {
          setSigningAddress(addrInfo.address);
        }
      } catch (error) {
        console.error('Error generating signing address:', error);
      } finally {
        setLoadingAddress(false);
      }
    };

    generateSigningAddress();
  }, [xpubWallet, xpubKey, walletInUse, chain]);

  const approve = () => {
    console.log('Approve EVM signing request');
    actionStatus(true);
  };

  const openAuthentication = () => {
    console.log('Open Authentication for EVM signing');
    setAuthenticationOpen(true);
  };

  const reject = () => {
    console.log('Reject EVM signing request');
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
          Layout.justifyContentCenter,
          Layout.alignItemsCenter,
        ]}
      >
        <Icon name="edit" size={60} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            Gutters.smallTMargin,
            Gutters.smallBMargin,
          ]}
        >
          {t('home:evm_signing_request')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            Gutters.regularLMargin,
            Gutters.regularRMargin,
          ]}
        >
          {t('home:evm_signing_request_info')}
        </Text>

        {/* Chain Information */}
        <View style={[Gutters.regularTMargin, Layout.alignItemsCenter]}>
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              { color: Colors.textGray400, marginBottom: 4 },
            ]}
          >
            {t('home:chain')}:
          </Text>
          <Text
            style={[
              Fonts.textRegular,
              Fonts.textBold,
              { color: Colors.textGray800 },
            ]}
          >
            {blockchainConfig.name} ({blockchainConfig.symbol})
          </Text>
        </View>

        {/* Signing Address Information */}
        <View style={[Gutters.regularTMargin, Layout.alignItemsCenter]}>
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              { color: Colors.textGray400, marginBottom: 4 },
            ]}
          >
            {t('home:signing_address')}:
          </Text>
          {loadingAddress ? (
            <ActivityIndicator size="small" color={Colors.textGray400} />
          ) : signingAddress ? (
            <Text
              style={[
                Fonts.textTiny,
                Fonts.textCenter,
                Fonts.textBold,
                {
                  fontFamily: MONOSPACE_FONT,
                  color: Colors.textGray800,
                  lineHeight: 16,
                  paddingHorizontal: 20,
                },
              ]}
              selectable={true}
            >
              {signingAddress}
            </Text>
          ) : (
            <Text style={[Fonts.textSmall, { color: Colors.textGray400 }]}>
              {t('home:address_unavailable')}
            </Text>
          )}
        </View>

        {/* Decoded summary of the data to sign */}
        <View style={[Gutters.regularTMargin, Layout.alignItemsCenter]}>
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              { color: Colors.textGray400, marginBottom: 4 },
            ]}
          >
            {t('home:data_to_sign')}:
          </Text>
        </View>

        {decoded.summary ? (
          <View
            style={[
              {
                backgroundColor: Colors.inputBackground,
                borderRadius: 8,
                padding: 12,
                borderWidth: 1,
                borderColor: Colors.textGray200,
                width: '90%',
              },
            ]}
          >
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textBold,
                { color: Colors.textGray800 },
              ]}
              selectable={true}
            >
              {decoded.summary}
            </Text>

            {decoded.recipient ? (
              <View style={{ marginTop: 8 }}>
                <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
                  {t('home:evm_sign_recipient')}
                </Text>
                <Text
                  style={[
                    Fonts.textTiny,
                    { fontFamily: MONOSPACE_FONT, color: Colors.textGray800 },
                  ]}
                  selectable={true}
                >
                  {decoded.recipient}
                </Text>
              </View>
            ) : null}

            {decoded.amount ? (
              <View style={{ marginTop: 8 }}>
                <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
                  {t('home:evm_sign_amount')}
                </Text>
                <Text
                  style={[
                    Fonts.textTiny,
                    Fonts.textBold,
                    { color: Colors.textGray800 },
                  ]}
                  selectable={true}
                >
                  {decoded.amount}
                  {decoded.tokenSymbol ? ` ${decoded.tokenSymbol}` : ''}
                </Text>
              </View>
            ) : null}

            {decoded.message ? (
              <View style={{ marginTop: 8 }}>
                <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
                  {t('home:evm_sign_message')}
                </Text>
                <Text
                  style={[Fonts.textTiny, { color: Colors.textGray800 }]}
                  selectable={true}
                >
                  {decoded.message}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Warning when the payload could not be confidently recognized */}
        {!decoded.recognized && (
          <View
            style={{
              width: '90%',
              marginTop: 10,
              backgroundColor: Colors.inputBackground,
              borderRadius: 8,
              padding: 10,
              borderWidth: 1,
              borderColor: Colors.error,
            }}
          >
            <Text
              style={[
                Fonts.textTiny,
                { color: Colors.error, textAlign: 'center' },
              ]}
            >
              {t('home:evm_sign_unrecognized')}
            </Text>
          </View>
        )}

        {/* Raw hex — collapsed behind a toggle */}
        <TouchableOpacity
          onPress={() => setShowRawData((prev) => !prev)}
          style={{ marginTop: 10 }}
        >
          <Text style={[Fonts.textTiny, Fonts.textPrimary]}>
            {showRawData
              ? t('home:evm_sign_hide_raw')
              : t('home:evm_sign_show_raw')}
          </Text>
        </TouchableOpacity>

        {showRawData && (
          <View
            style={[
              {
                height: 100,
                maxHeight: 100,
                marginTop: 8,
                backgroundColor: Colors.inputBackground,
                borderRadius: 8,
                padding: 10,
                borderWidth: 1,
                borderColor: Colors.textGray200,
                width: '90%',
              },
            ]}
          >
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
            >
              <Text
                style={[
                  Fonts.textTiny,
                  {
                    fontFamily: MONOSPACE_FONT,
                    lineHeight: 16,
                    color: Colors.textGray800,
                  },
                ]}
                selectable={true}
              >
                {dataToSign}
              </Text>
            </ScrollView>
          </View>
        )}
      </View>
      <View
        style={[
          Layout.justifyContentEnd,
          Gutters.regularLMargin,
          Gutters.regularRMargin,
        ]}
      >
        <SlideToApprove
          label={t('home:slide_to_approve')}
          accessibilityLabel={t('home:approve_request')}
          style={[Gutters.regularBMargin, Gutters.smallTMargin]}
          disabled={authenticationOpen || activityStatus}
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
          type="evmsigning"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

export default EvmSigningRequest;
