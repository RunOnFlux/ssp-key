import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
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
  const [isMainModalOpen, setIsMainModalOpen] = useState(true);
  const [isChainSelectOpen, setIsChainSelectOpen] = useState(false);
  const [selectedChain, setSelectedChain] =
    useState<keyof cryptos>(identityChain);
  const NC = backends()[selectedChain].node;
  const API = backends()[selectedChain].api;
  const EXPLORER = backends()[selectedChain].explorer;
  const SSPR = sspConfig().relay;
  const [sspConfigRelay, setSspConfigRelay] = useState(SSPR);
  const [nodeConfig, setNodeConfig] = useState(NC);
  const [apiConfig, setApiConfig] = useState(API);
  const [explorerConfig, setExplorerConfig] = useState(EXPLORER);
  const { t } = useTranslation(['home', 'common']);
  const { darkMode, Fonts, Gutters, Layout, Common, Colors } = useTheme();
  const blockchainConfig = blockchains[selectedChain];

  useEffect(() => {
    const NCnew = backends()[selectedChain].node;
    setNodeConfig(NCnew);
    const APInew = backends()[selectedChain].api;
    setApiConfig(APInew);
    const EXPLORERnew = backends()[selectedChain].explorer;
    setExplorerConfig(EXPLORERnew);
  }, [selectedChain]);

  const handleCancel = () => {
    if (SSPR !== sspConfigRelay) {
      setSspConfigRelay(SSPR);
    }
    if (NC !== nodeConfig) {
      setNodeConfig(NC);
    }
    if (API !== apiConfig) {
      setApiConfig(API);
    }
    if (EXPLORER !== explorerConfig) {
      setExplorerConfig(EXPLORER);
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
      storage.delete('sspConfig');
    }

    // adjust node, api, explorer
    const backendStorageString = storage.getString('backends'); // load our backends
    console.log(backendStorageString);
    let storedBackends: backends = {};
    if (backendStorageString) {
      storedBackends = JSON.parse(backendStorageString);
    }
    if (!storedBackends[selectedChain]) {
      storedBackends[selectedChain] = {
        ...backendsOriginalConfig[selectedChain],
      };
    } // if this coin is not present, add it
    // adjust node
    if (storedBackends?.[selectedChain]?.node !== nodeConfig) {
      storedBackends[selectedChain].node = nodeConfig;
    }
    // adjust api
    if (storedBackends?.[selectedChain]?.api !== apiConfig) {
      storedBackends[selectedChain].api = apiConfig;
    }
    // adjust explorer
    if (storedBackends?.[selectedChain]?.explorer !== explorerConfig) {
      storedBackends[selectedChain].explorer = explorerConfig;
    }
    // if any config or backend is the same as original, remove it
    if (
      storedBackends?.[selectedChain]?.node ===
      backendsOriginalConfig[selectedChain].node
    ) {
      delete storedBackends?.[selectedChain]?.node;
    }
    if (
      storedBackends?.[selectedChain]?.api ===
      backendsOriginalConfig[selectedChain].api
    ) {
      delete storedBackends?.[selectedChain]?.api;
    }
    if (
      storedBackends?.[selectedChain]?.explorer ===
      backendsOriginalConfig[selectedChain].explorer
    ) {
      delete storedBackends?.[selectedChain]?.explorer;
    }
    // if config of backend coin is empty, delete it
    if (Object.keys(storedBackends?.[selectedChain]).length === 0) {
      delete storedBackends?.[selectedChain];
    }
    // if entire config of backends is empty, delete it, otherwise save it
    if (Object.keys(storedBackends).length === 0) {
      storage.delete('backends');
    } else {
      console.log('save backends');
      console.log(storedBackends);
      storage.set('backends', JSON.stringify(storedBackends));
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
    setNodeConfig(backendsOriginalConfig[selectedChain].node);
  };

  const resetChainApiService = () => {
    console.log('Reset Chain Api Service');
    setApiConfig(backendsOriginalConfig[selectedChain].api);
  };

  const resetChainExplorerService = () => {
    console.log('Reset Chain Explorer Service');
    setExplorerConfig(backendsOriginalConfig[selectedChain].explorer);
  };

  const onChangeSSPrelay = (text: string) => {
    setSspConfigRelay(text);
  };

  const onChangeChainNodeService = (text: string) => {
    setNodeConfig(text);
  };

  const onChangeChainApiService = (text: string) => {
    setApiConfig(text);
  };

  const onChangeChainExplorerService = (text: string) => {
    setExplorerConfig(text);
  };

  const openChainSelect = () => {
    console.log('Open chain select');
    setIsMainModalOpen(false);
    setTimeout(() => {
      setIsChainSelectOpen(true);
    });
  };

  const closeChainSelect = () => {
    console.log('Close chain select');
    setIsChainSelectOpen(false);
    setTimeout(() => {
      setIsMainModalOpen(true);
    });
  };

  return (
    <>
      <Modal
        animationType="fade"
        transparent={true}
        visible={isMainModalOpen}
        onRequestClose={() => handleCancel()}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[Layout.fill, Common.modalBackdrop]}
        >
          <ScrollView
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
                <View style={[Gutters.smallBMargin]}>
                  <Text
                    style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}
                  >
                    {t('home:change_pw')}
                  </Text>
                  <TouchableOpacity
                    style={[
                      Common.button.outlineRounded,
                      Common.button.secondaryButton,
                      Gutters.smallTMargin,
                    ]}
                    onPress={() => handleRestore()}
                  >
                    <Text
                      style={[
                        Fonts.textTiny,
                        Fonts.textBluePrimary,
                        Gutters.tinyVPadding,
                        Gutters.tinyHPadding,
                      ]}
                    >
                      {t('home:change_pw_restore')}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={[Gutters.regularTMargin, Gutters.smallBMargin]}>
                  <Text
                    style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}
                  >
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
                      onPress={resetSSPRelay}
                      style={Common.inputIcon}
                    >
                      <Icon name="x" size={20} color={Colors.bluePrimary} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={[Gutters.regularTMargin, Gutters.smallBMargin]}>
                  {backendsOriginalConfig[selectedChain].node && (
                    <>
                      <Text
                        style={[
                          Fonts.textBold,
                          Fonts.textSmall,
                          Fonts.textCenter,
                        ]}
                      >
                        {t('home:chain_node_service', {
                          chain: blockchainConfig.name,
                        })}
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
                          placeholder={
                            backendsOriginalConfig[selectedChain].node
                          }
                          placeholderTextColor={darkMode ? '#777' : '#c7c7c7'}
                          onChangeText={onChangeChainNodeService}
                          value={nodeConfig}
                          autoCorrect={false}
                          ref={textInputB}
                          onPressIn={() => textInputB.current?.focus()}
                        />
                        <TouchableOpacity
                          onPress={resetChainNodeService}
                          style={Common.inputIcon}
                        >
                          <Icon name="x" size={20} color={Colors.bluePrimary} />
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                  {backendsOriginalConfig[selectedChain].api && (
                    <>
                      <Text
                        style={[
                          Fonts.textBold,
                          Fonts.textSmall,
                          Fonts.textCenter,
                          Gutters.smallTMargin,
                        ]}
                      >
                        {t('home:chain_api_service', {
                          chain: blockchainConfig.name,
                        })}
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
                          placeholder={
                            backendsOriginalConfig[selectedChain].api
                          }
                          placeholderTextColor={darkMode ? '#777' : '#c7c7c7'}
                          onChangeText={onChangeChainApiService}
                          value={apiConfig}
                          autoCorrect={false}
                          ref={textInputB}
                          onPressIn={() => textInputB.current?.focus()}
                        />
                        <TouchableOpacity
                          onPress={resetChainApiService}
                          style={Common.inputIcon}
                        >
                          <Icon name="x" size={20} color={Colors.bluePrimary} />
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                  {backendsOriginalConfig[selectedChain].explorer && (
                    <>
                      <Text
                        style={[
                          Fonts.textBold,
                          Fonts.textSmall,
                          Fonts.textCenter,
                          Gutters.smallTMargin,
                        ]}
                      >
                        {t('home:chain_explorer_service', {
                          chain: blockchainConfig.name,
                        })}
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
                          placeholder={
                            backendsOriginalConfig[selectedChain].explorer
                          }
                          placeholderTextColor={darkMode ? '#777' : '#c7c7c7'}
                          onChangeText={onChangeChainExplorerService}
                          value={explorerConfig}
                          autoCorrect={false}
                          ref={textInputB}
                          onPressIn={() => textInputB.current?.focus()}
                        />
                        <TouchableOpacity
                          onPress={resetChainExplorerService}
                          style={Common.inputIcon}
                        >
                          <Icon name="x" size={20} color={Colors.bluePrimary} />
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                  <View style={[Gutters.tinyTMargin, Layout.colCenter]}>
                    <TouchableOpacity
                      style={[
                        Common.button.outlineRounded,
                        Common.button.secondaryButton,
                      ]}
                      onPress={() => openChainSelect()}
                    >
                      <Text
                        style={[
                          Fonts.textSmall,
                          Fonts.textBluePrimary,
                          Gutters.regularHPadding,
                        ]}
                      >
                        {t('home:select_chain')}
                      </Text>
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
                    Gutters.largeTMargin,
                  ]}
                  onPress={() => handleSave()}
                >
                  <Text style={[Fonts.textRegular, Fonts.textWhite]}>
                    {t('common:save')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleCancel()}>
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
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        animationType="fade"
        transparent={true}
        visible={isChainSelectOpen}
        onRequestClose={() => setIsChainSelectOpen(false)}
      >
        <ScrollView
          keyboardShouldPersistTaps="always"
          style={[Layout.fill, Common.modalBackdrop]}
          contentInset={{ bottom: 80 }}
          contentContainerStyle={[
            Gutters.smallBPadding,
            Layout.scrollSpaceBetween,
            Layout.justifyContentCenter,
          ]}
        >
          <View style={[Common.modalView]}>
            <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
              {t('home:select_chain')}
            </Text>
            <View style={[Gutters.regularTMargin]}>
              <Picker
                selectedValue={selectedChain}
                onValueChange={(itemValue) => setSelectedChain(itemValue)}
              >
                {Object.keys(blockchains).map((key) => (
                  <Picker.Item
                    label={blockchains[key].name}
                    color={Colors.textInput}
                    value={key}
                    key={key}
                  />
                ))}
              </Picker>
            </View>
            <View style={[Layout.justifyContentEnd]}>
              <TouchableOpacity
                style={[
                  Common.button.outlineRounded,
                  Common.button.secondaryButton,
                  Layout.fullWidth,
                  Gutters.regularTMargin,
                ]}
                onPress={() => closeChainSelect()}
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
          </View>
        </ScrollView>
      </Modal>
    </>
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
