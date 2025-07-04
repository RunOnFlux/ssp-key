import React, { useState, useEffect } from 'react';
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
import * as Keychain from 'react-native-keychain';
import CryptoJS from 'crypto-js';
import { cryptos } from '../../types';
import Authentication from '../Authentication/Authentication';

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
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const [signingAddress, setSigningAddress] = useState<string>('');
  const [loadingAddress, setLoadingAddress] = useState(true);

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
          rules: Keychain.SECURITY_RULES.NONE,
        });
        const passwordData = await Keychain.getGenericPassword({
          service: 'sspkey_pw',
          rules: Keychain.SECURITY_RULES.NONE,
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
            Gutters.smallMargin,
          ]}
        >
          {t('home:evm_signing_request')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            Gutters.smallLMargin,
            Gutters.smallRMargin,
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
                  fontFamily: 'monospace',
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

        {/* Data to Sign */}
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
        <View
          style={[
            {
              height: 100,
              maxHeight: 100,
              backgroundColor: Colors.inputBackground,
              borderRadius: 8,
              padding: 10,
              borderWidth: 1,
              borderColor: Colors.textGray200,
            },
            Gutters.smallLMargin,
            Gutters.smallRMargin,
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
                  fontFamily: 'monospace',
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
      </View>
      <View style={[Layout.justifyContentEnd]}>
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
          type="evmsigning"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

export default EvmSigningRequest;
