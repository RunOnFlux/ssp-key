import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { getUniqueId } from 'react-native-device-info';
import EncryptedStorage from 'react-native-encrypted-storage';
import { generateAddressKeypair } from '../../lib/wallet';
import { useAppSelector } from '../../hooks';

const CryptoJS = require('crypto-js');

const AddressDetails = (props: { actionStatus: (status: boolean) => void }) => {
  const { wallets, xprivKey } = useAppSelector((state) => state.flux);
  const [decryptedRedeemScript, setDecryptedRedeemScript] = useState('');
  const [decryptedPrivateKey, setDecryptedPrivateKey] = useState('');
  const [redeemScriptVisible, setRedeemScriptVisible] = useState(false);
  const [privateKeyVisible, setPrivateKeyVisible] = useState(false);
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();

  useEffect(() => {
    getUniqueId()
      .then(async (id) => {
        console.log('here');
        // clean up password from encrypted storage
        const password = await EncryptedStorage.getItem('ssp_key_pw');
        const pwForEncryption = id + password;
        const xpk = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
        const xprivKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);
        const rds = CryptoJS.AES.decrypt(
          wallets['0-0']?.redeemScript,
          pwForEncryption,
        );
        const redeemScriptDecrypted = rds.toString(CryptoJS.enc.Utf8);
        setDecryptedRedeemScript(redeemScriptDecrypted);

        const keyPair = generateAddressKeypair(xprivKeyDecrypted, 0, 0, 'flux');
        const pricateKey = keyPair.privKey;
        setDecryptedPrivateKey(pricateKey);
      })
      .catch((error) => {
        console.log(error.message);
      });
  }, []);

  const close = () => {
    console.log('Close');
    setPrivateKeyVisible(false);
    setRedeemScriptVisible(false);
    setDecryptedPrivateKey('');
    setDecryptedRedeemScript('');
    props.actionStatus(false);
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => close()}
    >
      <ScrollView
        style={[Layout.fill, Common.modalBackdrop]}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
          Common.modalView,
        ]}
      >
        <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
          {t('home:flux_addr_details')}
        </Text>
        <View
          style={[
            Layout.fill,
            Layout.relative,
            Layout.fullWidth,
            Layout.alignItemsCenter,
            Gutters.regularTMargin,
          ]}
        >
          <View style={[Gutters.regularTMargin]}>
            <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
              {t('home:wallet_address')}:
            </Text>
            <Text
              selectable={true}
              style={[Fonts.textTiny, Fonts.textCenter, Gutters.smallMargin]}
            >
              {wallets['0-0']?.address}
            </Text>
          </View>
          <View>
            <View style={[Layout.rowCenter, Gutters.tinyRMargin]}>
              <TouchableOpacity
                onPressIn={() => setRedeemScriptVisible(!redeemScriptVisible)}
                style={Common.inputIcon}
              >
                <Icon
                  name={redeemScriptVisible ? 'eye' : 'eye-off'}
                  size={20}
                  color={Colors.bluePrimary}
                />
              </TouchableOpacity>
              <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
                {t('home:wallet_redeem_script')}:
              </Text>
            </View>
            <View>
              <Text
                selectable={true}
                style={[Fonts.textTiny, Fonts.textCenter, Gutters.smallMargin]}
              >
                {redeemScriptVisible
                  ? decryptedRedeemScript
                  : '*** *** *** *** *** ***'}
              </Text>
            </View>
          </View>
          <View>
            <View style={[Layout.rowCenter, Gutters.tinyRMargin]}>
              <TouchableOpacity
                onPressIn={() => setPrivateKeyVisible(!privateKeyVisible)}
                style={Common.inputIcon}
              >
                <Icon
                  name={privateKeyVisible ? 'eye' : 'eye-off'}
                  size={20}
                  color={Colors.bluePrimary}
                />
              </TouchableOpacity>
              <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
                {t('home:wallet_private_key')}:
              </Text>
            </View>
            <View>
              <Text
                selectable={true}
                style={[Fonts.textTiny, Fonts.textCenter, Gutters.smallMargin]}
              >
                {privateKeyVisible
                  ? decryptedPrivateKey
                  : '*** *** *** *** *** ***'}
              </Text>
            </View>
          </View>
        </View>
        <View style={[Layout.justifyContentEnd]}>
          <TouchableOpacity
            style={[
              Common.button.outlineRounded,
              Common.button.secondaryButton,
              Layout.fullWidth,
              Gutters.regularTMargin,
            ]}
            onPressIn={() => close()}
          >
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textBluePrimary,
                Gutters.regularHPadding,
              ]}
            >
              {t('common:ok')}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
};

export default AddressDetails;
