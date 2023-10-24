import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { storage } from '../../store/index'; // mmkv

import {
  backends,
  backendsOriginal,
  loadBackendsConfig,
} from '@storage/backends';
import { sspConfig, sspConfigOriginal, loadSSPConfig } from '@storage/ssp';
import { cryptos } from '../../types';
import { useAppSelector } from '../../hooks';

import { blockchains } from '@storage/blockchains';

const backendsOriginalConfig = backendsOriginal();
const originalConfig = sspConfigOriginal();

const SettingsSection = (props: {
  actionStatus: (status: boolean) => void;
  navigation: any;
}) => {
  // focusability of inputs
  const textInputA = useRef<TextInput | null>(null);
  const textInputB = useRef<TextInput | null>(null);
  const { identityChain } = useAppSelector((state) => state.ssp);
  const [selectedChain] = useState<keyof cryptos>(identityChain);
  const FNC = backends()[selectedChain].node;
  const SSPR = sspConfig().relay;
  console.log(SSPR);
  const [sspConfigRelay, setSspConfigRelay] = useState(SSPR);
  const [chainNodeConfig, setChainNodeConfig] = useState(FNC);
  const { t } = useTranslation(['home', 'common']);
  const { darkMode, Fonts, Gutters, Layout, Common, Colors } = useTheme();
  const blockchainConfig = blockchains[selectedChain];

  const handleCancel = () => {
    console.log('Close');
    if (SSPR !== sspConfigRelay) {
      setSspConfigRelay(SSPR);
    }
    if (FNC !== chainNodeConfig) {
      setChainNodeConfig(FNC);
    }
    loadBackendsConfig();
    loadSSPConfig();
    props.actionStatus(false);
  };

  const handleSave = () => {
    // adjust ssp
    if (originalConfig.relay !== sspConfigRelay) {
      const sspConf = {
        relay: sspConfigRelay,
      };
      storage.set('sspConfig', JSON.stringify(sspConf));
    } else {
      // remove if present on mmkv
      // storage.delete('sspConfig'); // why this does not work??? It gets readded somewhere somehow???
      // workaround
      storage.set('sspConfig', JSON.stringify(originalConfig));
    }
    // adjust chain node
    if (backendsOriginalConfig[selectedChain].node !== chainNodeConfig) {
      const backendsConfig = {
        [selectedChain]: {
          node: chainNodeConfig,
        },
      };
      storage.set('backends', JSON.stringify(backendsConfig));
    } else {
      // remove if present on mmkv
      // storage.delete('backends'); // this does not work??? It gets readded somewhere somehow???
      // workaround
      storage.set('backends', JSON.stringify(backendsOriginalConfig));
    }
    // apply configuration
    loadBackendsConfig();
    loadSSPConfig();
    props.actionStatus(false);
  };

  const handleRestore = () => {
    props.navigation.navigate('Restore');
    props.actionStatus(false);
  };

  const resetSSPRelay = () => {
    console.log('Reset SSP Relay');
    console.log(originalConfig.relay);
    setSspConfigRelay(originalConfig.relay);
  };

  const resetChainNodeService = () => {
    console.log('Reset Chain Node Service');
    setChainNodeConfig(backendsOriginalConfig[selectedChain].node);
  };

  const onChangeSSPrelay = (text: string) => {
    setSspConfigRelay(text);
  };

  const onChangeChainNodeService = (text: string) => {
    setChainNodeConfig(text);
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => handleCancel()}
    >
      <KeyboardAwareScrollView
        enableOnAndroid={true}
        extraScrollHeight={20}
        style={[Layout.fill, Common.modalBackdrop]}
        contentInset={{ bottom: 80 }}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
        ]}
      >
        <View style={[Layout.fill, Common.modalView]}>
          <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
            {t('common:settings')}
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
            <View style={[Gutters.regularTMargin, Gutters.smallBMargin]}>
              <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
                {t('home:change_pw')}
              </Text>
              <TouchableOpacity
                style={[
                  Common.button.outlineRounded,
                  Common.button.secondaryButton,
                  Gutters.smallTMargin,
                ]}
                onPressIn={() => handleRestore()}
              >
                <Text
                  style={[
                    Fonts.textTiny,
                    Fonts.textBluePrimary,
                    Gutters.tinyVPadding,
                  ]}
                >
                  {t('home:change_pw_restore')}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={[Gutters.regularTMargin, Gutters.smallBMargin]}>
              <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
                {t('home:ssp_relay_server')}
              </Text>
              <View
                style={[
                  Layout.rowCenter,
                  Common.inputWithButtonBgModalColors,
                  styles.inputWithButton,
                ]}
              >
                <TextInput
                  style={[Common.textInput, Common.textInputBgModal]}
                  autoCapitalize="none"
                  placeholder={originalConfig.relay}
                  placeholderTextColor={darkMode ? '#777' : '#c7c7c7'}
                  onChangeText={onChangeSSPrelay}
                  value={sspConfigRelay}
                  autoCorrect={false}
                  ref={textInputA}
                  onPressIn={() => textInputA.current?.focus()}
                />
                <TouchableOpacity
                  onPressIn={resetSSPRelay}
                  style={Common.inputIcon}
                >
                  <Icon name="x" size={20} color={Colors.bluePrimary} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={[Gutters.regularTMargin, Gutters.smallBMargin]}>
              <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
                {t('home:chain_node_service', { chain: blockchainConfig.name })}
              </Text>
              <View
                style={[
                  Layout.rowCenter,
                  Common.inputWithButtonBgModalColors,
                  styles.inputWithButton,
                ]}
              >
                <TextInput
                  style={[Common.textInput, Common.textInputBgModal]}
                  autoCapitalize="none"
                  placeholder={backendsOriginalConfig[selectedChain].node}
                  placeholderTextColor={darkMode ? '#777' : '#c7c7c7'}
                  onChangeText={onChangeChainNodeService}
                  value={chainNodeConfig}
                  autoCorrect={false}
                  ref={textInputB}
                  onPressIn={() => textInputB.current?.focus()}
                />
                <TouchableOpacity
                  onPressIn={resetChainNodeService}
                  style={Common.inputIcon}
                >
                  <Icon name="x" size={20} color={Colors.bluePrimary} />
                </TouchableOpacity>
              </View>
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
              onPressIn={() => handleSave()}
            >
              <Text style={[Fonts.textRegular, Fonts.textWhite]}>
                {t('common:save')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPressIn={() => handleCancel()}>
              <Text
                style={[
                  Fonts.textSmall,
                  Fonts.textBluePrimary,
                  Fonts.textCenter,
                ]}
              >
                {t('common:cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </Modal>
  );
};

export default SettingsSection;

const styles = StyleSheet.create({
  inputWithButton: {
    marginTop: 12,
    width: '100%',
    borderRadius: 10,
  },
});
