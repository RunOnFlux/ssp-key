import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MONOSPACE_FONT } from '../../lib/typography';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Switch,
} from 'react-native';
import { SquarePen } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { useAppSelector } from '../../hooks';
import { blockchains } from '../../storage/blockchains';
import { generateMultisigAddress } from '../../lib/wallet';
import {
  parseConsumerDerivationPath,
  parseEip191Preimage,
} from '../../lib/consumerGuards';
import * as Keychain from '../../lib/keychain';
import CryptoJS from 'crypto-js';
import { cryptos } from '../../types';
import Authentication from '../Authentication/Authentication';
import {
  armEvmSigningApproval,
  disarmEvmSigningApproval,
} from '../../lib/evmSigningApproval';
import {
  parseTypedData,
  typedDataMatchesChain,
  typedDataRisk,
  type Eip712Payload,
} from '../../lib/typedData';

import { SlideToApprove } from '../request';
interface EvmSigningRequestProps {
  activityStatus: boolean;
  dataToSign: string;
  /** 'eip712': dataToSign is typed-data JSON; absent: a personal message. */
  messageType?: string;
  chain: keyof cryptos;
  walletInUse: string;
  /** evmSigningRequestDigest of the request shown (Home also keys on it). */
  requestDigest: string;
  actionStatus: (status: boolean) => void;
}

const EvmSigningRequest: React.FC<EvmSigningRequestProps> = ({
  activityStatus,
  dataToSign,
  messageType,
  chain,
  walletInUse,
  requestDigest,
  actionStatus,
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const [signingAddress, setSigningAddress] = useState<string>('');
  const [loadingAddress, setLoadingAddress] = useState(true);
  const [showRawData, setShowRawData] = useState(false);

  // Typed data can authorise spending: the user confirms they understand.
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);

  // Get blockchain configuration
  const blockchainConfig = blockchains[chain];

  // AA-2: the key co-signs EIP-191 personal messages and EIP-712 typed data.
  // The text shown here is parsed from the exact preimage, and signing
  // rebuilds the preimage from this same text; typed data is parsed from the
  // same JSON the signing action recomputes the digest from. Anything else,
  // and typed data for another chain, is refused (no approve control).
  const personalMessage: string | null = useMemo(() => {
    if (messageType !== undefined) return null;
    try {
      return parseEip191Preimage(dataToSign);
    } catch {
      return null;
    }
  }, [dataToSign, messageType]);
  const typedData: Eip712Payload | null = useMemo(() => {
    if (messageType !== 'eip712') return null;
    try {
      const payload = parseTypedData(dataToSign);
      // chainId exists only on EVM chain configs
      const { chainId } = blockchainConfig as { chainId?: string };
      return typedDataMatchesChain(payload, chainId) ? payload : null;
    } catch {
      return null;
    }
  }, [dataToSign, messageType, blockchainConfig]);
  const typedRisk = typedData ? typedDataRisk(typedData) : null;
  const isRefused = personalMessage === null && typedData === null;
  const approvalBlocked = typedData !== null && !riskAcknowledged;

  // Get encrypted keys from Redux
  const { xpubWallet, xpubKey } = useAppSelector((state) => state[chain]);

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

        // Parse wallet path (KEY-8: consumer branches 0 / 1 only)
        const { typeIndex, addressIndex } =
          parseConsumerDerivationPath(walletInUse);

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

  // The request on screen when the user started approving (item 4).
  const approvingDigest = useRef<string | undefined>(undefined);

  // A different request while authentication is open: close it. The user has
  // not seen the new one and must review and approve it again.
  useEffect(() => {
    if (
      approvingDigest.current !== undefined &&
      approvingDigest.current !== requestDigest
    ) {
      approvingDigest.current = undefined;
      disarmEvmSigningApproval();
      setAuthenticationOpen(false);
    }
  }, [requestDigest]);

  const approve = () => {
    console.log('Approve EVM signing request');
    const approving = approvingDigest.current;
    approvingDigest.current = undefined;
    if (
      isRefused ||
      approvalBlocked ||
      !approving ||
      approving !== requestDigest
    ) {
      disarmEvmSigningApproval();
      return; // never approvable — the signing action refuses it too
    }
    // The sign action signs only the request with this digest.
    armEvmSigningApproval(approving);
    actionStatus(true);
  };

  const openAuthentication = () => {
    console.log('Open Authentication for EVM signing');
    if (isRefused || approvalBlocked || !requestDigest) {
      return;
    }
    approvingDigest.current = requestDigest;
    setAuthenticationOpen(true);
  };

  const reject = () => {
    console.log('Reject EVM signing request');
    approvingDigest.current = undefined;
    disarmEvmSigningApproval();
    actionStatus(false);
  };

  const handleAuthenticationOpen = (status: boolean) => {
    console.log('Authentication result:', status);
    setAuthenticationOpen(false);
    if (status === true) {
      approve();
    } else {
      approvingDigest.current = undefined;
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
        <SquarePen size={60} color={Colors.textGray400} />
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

        {personalMessage !== null ? (
          <View
            style={[
              Gutters.tinyHMargin,
              {
                backgroundColor: Colors.inputBackground,
                borderRadius: 8,
                padding: 12,
                borderWidth: 1,
                borderColor: Colors.textGray200,
                alignSelf: 'stretch',
              },
            ]}
          >
            <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
              {t('home:evm_sign_message')}
            </Text>
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textBold,
                { color: Colors.textGray800, marginTop: 4 },
              ]}
              selectable={true}
            >
              {personalMessage}
            </Text>
          </View>
        ) : typedData !== null ? (
          <View style={{ alignSelf: 'stretch' }}>
            <View
              style={[
                Gutters.tinyHMargin,
                {
                  backgroundColor: Colors.inputBackground,
                  borderRadius: 8,
                  padding: 10,
                  borderWidth: 1,
                  borderColor: typedRisk ? Colors.error : Colors.warning,
                },
              ]}
            >
              <Text
                style={[
                  Fonts.textSmall,
                  Fonts.textBold,
                  { color: typedRisk ? Colors.error : Colors.textGray800 },
                ]}
              >
                {t('home:evm_typed_data_warning_title')}
              </Text>
              {typedRisk === 'approval' && (
                <Text
                  style={[
                    Fonts.textTiny,
                    Fonts.textBold,
                    { color: Colors.error, marginTop: 4 },
                  ]}
                >
                  {t('home:evm_typed_data_approval_warning')}
                </Text>
              )}
              {typedRisk === 'order' && (
                <Text
                  style={[
                    Fonts.textTiny,
                    Fonts.textBold,
                    { color: Colors.error, marginTop: 4 },
                  ]}
                >
                  {t('home:evm_typed_data_order_warning')}
                </Text>
              )}
              <Text
                style={[
                  Fonts.textTiny,
                  { color: Colors.textGray800, marginTop: 4 },
                ]}
              >
                {t('home:evm_typed_data_warning_desc')}
              </Text>
            </View>
            <View
              style={[
                Gutters.tinyHMargin,
                {
                  marginTop: 8,
                  backgroundColor: Colors.inputBackground,
                  borderRadius: 8,
                  padding: 10,
                  borderWidth: 1,
                  borderColor: Colors.textGray200,
                },
              ]}
            >
              {typeof typedData.domain.name === 'string' && (
                <Text style={[Fonts.textTiny, { color: Colors.textGray800 }]}>
                  {t('home:evm_typed_data_domain')}:{' '}
                  <Text style={Fonts.textBold}>{typedData.domain.name}</Text>
                </Text>
              )}
              {typeof typedData.domain.verifyingContract === 'string' && (
                <Text
                  style={[
                    Fonts.textTiny,
                    { color: Colors.textGray800, marginTop: 2 },
                  ]}
                  selectable={true}
                >
                  {t('home:evm_typed_data_contract')}:{' '}
                  <Text style={{ fontFamily: MONOSPACE_FONT }}>
                    {typedData.domain.verifyingContract}
                  </Text>
                </Text>
              )}
              <Text
                style={[
                  Fonts.textTiny,
                  { color: Colors.textGray800, marginTop: 2 },
                ]}
              >
                {t('home:evm_typed_data_type')}:{' '}
                <Text style={{ fontFamily: MONOSPACE_FONT }}>
                  {typedData.primaryType}
                </Text>
              </Text>
              <ScrollView
                style={{ maxHeight: 160, marginTop: 6 }}
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
                  {JSON.stringify(typedData.message, null, 2)}
                </Text>
              </ScrollView>
            </View>
            <View
              style={[
                Layout.row,
                Layout.alignItemsCenter,
                Gutters.tinyHMargin,
                { marginTop: 8 },
              ]}
            >
              <Switch
                onValueChange={setRiskAcknowledged}
                value={riskAcknowledged}
                trackColor={{ true: Colors.primary }}
                thumbColor={riskAcknowledged ? Colors.textOnPrimary : undefined}
                accessibilityLabel={t('home:evm_typed_data_acknowledge')}
              />
              <Text style={[Fonts.textTiny, Gutters.smallLMargin, Layout.fill]}>
                {t('home:evm_typed_data_acknowledge')}
              </Text>
            </View>
          </View>
        ) : (
          <View
            style={[
              Gutters.tinyHMargin,
              {
                alignSelf: 'stretch',
                marginTop: 10,
                backgroundColor: Colors.inputBackground,
                borderRadius: 8,
                padding: 10,
                borderWidth: 1,
                borderColor: Colors.error,
              },
            ]}
          >
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textBold,
                { color: Colors.error, textAlign: 'center' },
              ]}
            >
              {t('home:evm_sign_refused_title')}
            </Text>
            <Text
              style={[
                Fonts.textTiny,
                { color: Colors.error, textAlign: 'center', marginTop: 4 },
              ]}
            >
              {t('home:evm_sign_refused_desc')}
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
              Gutters.tinyHMargin,
              {
                height: 100,
                maxHeight: 100,
                marginTop: 8,
                backgroundColor: Colors.inputBackground,
                borderRadius: 8,
                padding: 10,
                borderWidth: 1,
                borderColor: Colors.textGray200,
                alignSelf: 'stretch',
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
          Layout.selfStretch,
          Layout.justifyContentEnd,
          Gutters.tinyHMargin,
        ]}
      >
        {!isRefused && (
          <SlideToApprove
            label={t('home:slide_to_approve')}
            accessibilityLabel={t('home:approve_request')}
            style={[Gutters.regularBMargin, Gutters.smallTMargin]}
            disabled={authenticationOpen || activityStatus || approvalBlocked}
            loading={authenticationOpen || activityStatus}
            onComplete={() => openAuthentication()}
          />
        )}
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
