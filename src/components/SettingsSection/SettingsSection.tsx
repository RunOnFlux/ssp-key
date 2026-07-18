import React, { useState, useEffect } from 'react';
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
  Settings,
  I18nManager,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import {
  X,
  Languages,
  EyeOff,
  KeyRound,
  Trash2,
  ShieldCheck,
  ListChecks,
  SlidersHorizontal,
  Server,
  Info,
  ChevronDown,
  ChevronRight,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { storage } from '../../store/index'; // mmkv
import Authentication from '../Authentication/Authentication';
import VerifyBackupModal from '../VerifyBackup/VerifyBackupModal';
import { setSSPInitialState } from '../../store/ssp';

import { setInitialStateForAllChains } from '../../store';

import { useAppDispatch } from '../../hooks';

import {
  backends,
  backendsOriginal,
  loadBackendsConfig,
} from '@storage/backends';
import { sspConfig, sspConfigOriginal, loadSSPConfig } from '@storage/ssp';
import { cryptos } from '../../types';
import { useAppSelector } from '../../hooks';

import { blockchains } from '@storage/blockchains';

import * as resources from '../../translations/resources';
import BlurOverlay from '../../BlurOverlay';
import { usePrivacyMode } from '../../contexts/PrivacyContext';
import { Card } from '../ui';
import PoweredByFlux from '../PoweredByFlux/PoweredByFlux';
import packageJson from '../../../package.json';

const backendsOriginalConfig = backendsOriginal();
const originalConfig = sspConfigOriginal();

const SettingsSection = (props: {
  actionStatus: (status: boolean) => void;
  navigation: any;
}) => {
  const { identityChain } = useAppSelector((state) => state.ssp);
  const [isMainModalOpen, setIsMainModalOpen] = useState(true);
  const [isChainSelectOpen, setIsChainSelectOpen] = useState(false);
  const [isLanguageSelectOpen, setIsLanguageSelectOpen] = useState(false);
  // Advanced (network plumbing) starts collapsed so the everyday user sees a
  // clean Preferences + Security modal.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [versionTapCount, setVersionTapCount] = useState(0);
  const [selectedChain, setSelectedChain] =
    useState<keyof cryptos>(identityChain);
  const currentLanguage = storage.getString('language');
  const [selectedLanguage, setSelectedLanguage] = useState(
    currentLanguage ?? 'system',
  );
  const NC = backends()[selectedChain].node;
  const API = backends()[selectedChain].api;
  const EXPLORER = backends()[selectedChain].explorer;
  const SSPR = sspConfig().relay;
  const [sspConfigRelay, setSspConfigRelay] = useState(SSPR);
  const [nodeConfig, setNodeConfig] = useState(NC);
  const [apiConfig, setApiConfig] = useState(API);
  const [explorerConfig, setExplorerConfig] = useState(EXPLORER);
  const { t } = useTranslation(['home', 'common']);
  const { i18n } = useTranslation();
  const { darkMode, Fonts, Gutters, Layout, Common, Colors } = useTheme();
  const blockchainConfig = blockchains[selectedChain];
  // Original endpoint defaults for the active chain — a stable const identifier
  // so the presence checks below narrow each field to a defined string.
  const chainOriginal = backendsOriginalConfig[selectedChain];
  const nodeDefault = chainOriginal.node;
  const apiDefault = chainOriginal.api;
  const explorerDefault = chainOriginal.explorer;
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const [verifyBackupOpen, setVerifyBackupOpen] = useState(false);
  const deviceLanguage =
    Platform.OS === 'ios'
      ? Settings.get('AppleLocale') || Settings.get('AppleLanguages')[0]
      : I18nManager.getConstants().localeIdentifier;
  const dispatch = useAppDispatch();
  // Privacy mode preference — persisted independently (own MMKV key), purely
  // presentational, never affects signing/approval displays.
  const { hidden: privacyHidden, togglePrivacy } = usePrivacyMode();

  const deviceLanguageShort = deviceLanguage.split('_')[0].split('-')[0];

  const languages = [
    { value: 'en', label: 'en', desc: 'English' },
    { value: 'af', label: 'af', desc: 'Afrikaans' },
    { value: 'id', label: 'id', desc: 'Bahasa Indonesia' },
    { value: 'ms', label: 'ms', desc: 'Bahasa Melayu' },
    { value: 'ca', label: 'ca', desc: 'Català' },
    { value: 'bg', label: 'bg', desc: 'Български' },
    { value: 'bn', label: 'bn', desc: 'বাংলা' },
    { value: 'zh', label: 'zh', desc: '简体中文' },
    { value: 'zh_TW', label: 'zh_TW', desc: '繁体中文' },
    { value: 'cs', label: 'cs', desc: 'Čeština' },
    { value: 'de', label: 'de', desc: 'Deutsch' },
    { value: 'nl', label: 'nl', desc: 'Dutch' },
    { value: 'es', label: 'es', desc: 'Español' },
    { value: 'fi', label: 'fi', desc: 'Suomen kieli' },
    { value: 'sl', label: 'sl', desc: 'Slovenščina' },
    { value: 'fil', label: 'fil', desc: 'Filipino' },
    { value: 'fr', label: 'fr', desc: 'Français' },
    { value: 'el', label: 'el', desc: 'Ελληνικά' },
    { value: 'hi', label: 'hi', desc: 'हिन्दी' },
    { value: 'hr', label: 'hr', desc: 'Hrvatski' },
    { value: 'it', label: 'it', desc: 'Italiano' },
    { value: 'ko', label: 'ko', desc: '한국어' },
    { value: 'hu', label: 'hu', desc: 'Magyar' },
    { value: 'no', label: 'no', desc: 'Norwegian' },
    { value: 'ja', label: 'ja', desc: '日本語' },
    { value: 'pl', label: 'pl', desc: 'Polish' },
    { value: 'pt', label: 'pt', desc: 'Português' },
    { value: 'ru', label: 'ru', desc: 'Русский' },
    { value: 'ro', label: 'ro', desc: 'Romanian' },
    { value: 'sk', label: 'sk', desc: 'Slovak' },
    { value: 'sv', label: 'sv', desc: 'Swedish' },
    { value: 'uk', label: 'uk', desc: 'Українська' },
    { value: 'ta', label: 'ta', desc: 'தமிழ்' },
    { value: 'th', label: 'th', desc: 'ไทย' },
    { value: 'vi', label: 'vi', desc: 'Tiếng Việt' },
    ...(Object.keys(resources).includes(deviceLanguageShort)
      ? [
          {
            value: 'system',
            label: deviceLanguageShort,
            desc: t('home:use_system_language'),
          },
        ]
      : []),
  ];

  useEffect(() => {
    const NCnew = backends()[selectedChain].node;
    setNodeConfig(NCnew);
    const APInew = backends()[selectedChain].api;
    setApiConfig(APInew);
    const EXPLORERnew = backends()[selectedChain].explorer;
    setExplorerConfig(EXPLORERnew);
  }, [selectedChain]);

  useEffect(() => {
    void (async function () {
      if (selectedLanguage === 'system') {
        await i18n.changeLanguage(deviceLanguageShort);
      } else {
        await i18n.changeLanguage(selectedLanguage);
      }
      storage.set('language', selectedLanguage);
    })();
  }, [selectedLanguage]);

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
      storage.remove('sspConfig');
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
      storage.remove('backends');
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

  const handleBeginDeletion = () => {
    setIsMainModalOpen(false);
    setTimeout(() => {
      setAuthenticationOpen(true);
    }, 100);
  };

  const handleDelete = () => {
    dispatch(setSSPInitialState());
    setInitialStateForAllChains();
    setTimeout(() => {
      // navigate to welcome screen where keychain is reset
      props.navigation.navigate('Welcome');
    }, 100);
  };

  const handleAuthenticationOpen = (status: boolean) => {
    setAuthenticationOpen(false);
    if (status === true) {
      handleDelete();
    } else {
      setIsMainModalOpen(true);
    }
  };

  // On-demand seed backup verification — close the settings modal first so the
  // verify flow's own auth + word-challenge modals present cleanly, then reopen
  // settings when it finishes (matching the delete-flow modal handoff).
  const handleOpenVerifyBackup = () => {
    setIsMainModalOpen(false);
    setTimeout(() => {
      setVerifyBackupOpen(true);
    }, 100);
  };

  const handleVerifyBackupClose = () => {
    setVerifyBackupOpen(false);
    setTimeout(() => {
      setIsMainModalOpen(true);
    }, 100);
  };

  // Hidden security-test trigger — 5 taps on the version caption, mirroring
  // the Help/About surface. Closes the modal first, then navigates.
  const handleVersionTap = () => {
    const newCount = versionTapCount + 1;
    setVersionTapCount(newCount);
    if (newCount >= 5) {
      setVersionTapCount(0);
      props.actionStatus(false);
      setTimeout(() => {
        props.navigation.navigate('LavaMoatTest');
      }, 100);
    }
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

  const openLanguageSelect = () => {
    console.log('Open language select');
    setIsMainModalOpen(false);
    setTimeout(() => {
      setIsLanguageSelectOpen(true);
    });
  };

  const closeLanguageSelect = () => {
    console.log('Close language select');
    setIsLanguageSelectOpen(false);
    setTimeout(() => {
      setIsMainModalOpen(true);
    });
  };

  // Concise trailing value for the Language row. When the system default is
  // active we show a short "System" chip instead of the long "Use System
  // Language" string (which used to truncate); otherwise the picked language's
  // own native name (e.g. "English", "Deutsch").
  const pickedLanguageDesc = languages.find(
    (language) => language.value === selectedLanguage,
  )?.desc;
  const languageValue =
    selectedLanguage === 'system'
      ? t('home:settings_language_system')
      : (pickedLanguageDesc ?? t('home:settings_language_system'));

  // Endpoint field surface — a subtly recessed well that reads identically in
  // both themes (light: warm-stone tint on white; dark: a shade below the card
  // fill), fenced by a hairline so the input never dissolves into the card.
  const fieldBg = darkMode ? '#1F1D1C' : Colors.bgInputAreaModalColor;
  const fieldBorder = Colors.borderSecondary;

  // One relay/node/API/explorer endpoint: an uppercase gray sub-label (matching
  // the outer section headers' type scale) above a recessed input+reset field,
  // inset to the same column rhythm as the polished rows above.
  const endpointField = (
    label: string,
    value: string | undefined,
    placeholder: string,
    onChangeText: (text: string) => void,
    onReset: () => void,
  ) => (
    <View style={styles.endpointGroup}>
      <Text
        style={[styles.endpointLabel, { color: Colors.textGray400 }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View
        style={[
          styles.endpointField,
          { backgroundColor: fieldBg, borderColor: fieldBorder },
        ]}
      >
        <TextInput
          style={[styles.endpointInput, { color: Colors.textInput }]}
          autoCapitalize="none"
          placeholder={placeholder}
          placeholderTextColor={darkMode ? '#777' : '#c7c7c7'}
          onChangeText={onChangeText}
          value={value}
          autoCorrect={false}
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('common:reset')}
          onPress={onReset}
          style={styles.endpointReset}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <X size={18} color={Colors.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );

  // iOS grouped-list section header — muted, uppercase, letter-spaced label
  // with a small leading glyph, rendered ABOVE its card (native convention).
  const groupHeader = (icon: React.ReactNode, label: string) => (
    <View style={styles.groupHeader}>
      {icon}
      <Text style={[styles.groupHeaderText, { color: Colors.textGray400 }]}>
        {label}
      </Text>
    </View>
  );

  // Hairline divider between rows inside a card, inset to the label column so
  // the leading icons "float" free of the rule — matches iOS inset lists.
  const rowDivider = (
    <View style={[styles.divider, { backgroundColor: Colors.border }]} />
  );

  return (
    <>
      <Modal
        animationType="fade"
        transparent={true}
        visible={isMainModalOpen}
        onRequestClose={() => handleCancel()}
      >
        <BlurOverlay />
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
              <Text
                style={[Fonts.titleSmall, Fonts.textCenter, styles.modalTitle]}
              >
                {t('common:settings')}
              </Text>

              {/* PREFERENCES — everyday inline controls: language + privacy. */}
              {groupHeader(
                <SlidersHorizontal size={14} color={Colors.textGray400} />,
                t('home:settings_preferences'),
              )}
              <Card style={styles.card}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('home:language')}
                  style={styles.row}
                  onPress={() => openLanguageSelect()}
                >
                  <View style={styles.rowLeft}>
                    <View style={styles.rowIcon}>
                      <Languages size={20} color={Colors.textGray400} />
                    </View>
                    <Text
                      style={[
                        Fonts.textSmall,
                        styles.rowLabelText,
                        { color: Colors.textGray800 },
                      ]}
                      numberOfLines={1}
                    >
                      {t('home:language')}
                    </Text>
                  </View>
                  <View style={styles.rowTrailing}>
                    <Text
                      style={[
                        Fonts.textTiny,
                        styles.rowValueText,
                        { color: Colors.textGray400 },
                      ]}
                      numberOfLines={1}
                    >
                      {languageValue}
                    </Text>
                    <ChevronRight
                      size={18}
                      color={Colors.textGray200}
                      style={styles.chevron}
                    />
                  </View>
                </TouchableOpacity>
                {rowDivider}
                <View style={styles.row}>
                  <View style={styles.rowLeft}>
                    <View style={styles.rowIcon}>
                      <EyeOff size={20} color={Colors.textGray400} />
                    </View>
                    <Text
                      style={[
                        Fonts.textSmall,
                        styles.rowLabelText,
                        { color: Colors.textGray800 },
                      ]}
                      numberOfLines={1}
                    >
                      {t('home:privacy_mode')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    accessibilityRole="switch"
                    accessibilityLabel={t('home:privacy_mode')}
                    accessibilityState={{ checked: privacyHidden }}
                    activeOpacity={0.8}
                    onPress={togglePrivacy}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={[
                      styles.toggleTrack,
                      {
                        backgroundColor: privacyHidden
                          ? Colors.primary
                          : Colors.borderSecondary,
                        alignItems: privacyHidden ? 'flex-end' : 'flex-start',
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.toggleKnob,
                        {
                          backgroundColor: privacyHidden
                            ? Colors.textOnPrimary
                            : Colors.white,
                        },
                      ]}
                    />
                  </TouchableOpacity>
                </View>
              </Card>
              <View style={styles.footnote}>
                <Text
                  style={[
                    Fonts.textTinyTiny,
                    styles.footnoteText,
                    { color: Colors.textGray400 },
                  ]}
                >
                  {t('home:privacy_mode_desc')}
                </Text>
              </View>

              {/* SECURITY — change password, then the destructive delete. */}
              {groupHeader(
                <ShieldCheck size={14} color={Colors.textGray400} />,
                t('home:settings_security'),
              )}
              <Card style={styles.card}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('home:change_pw')}
                  style={styles.row}
                  onPress={() => handleRestore()}
                >
                  <View style={styles.rowLeft}>
                    <View style={styles.rowIcon}>
                      <KeyRound size={20} color={Colors.textGray400} />
                    </View>
                    <Text
                      style={[
                        Fonts.textSmall,
                        styles.rowLabelText,
                        { color: Colors.textGray800 },
                      ]}
                      numberOfLines={1}
                    >
                      {t('home:change_pw')}
                    </Text>
                  </View>
                  <ChevronRight
                    size={18}
                    color={Colors.textGray200}
                    style={styles.chevron}
                  />
                </TouchableOpacity>
                {rowDivider}
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('home:backup_checkup_settings_row')}
                  style={styles.row}
                  onPress={() => handleOpenVerifyBackup()}
                >
                  <View style={styles.rowLeft}>
                    <View style={styles.rowIcon}>
                      <ListChecks size={20} color={Colors.textGray400} />
                    </View>
                    <Text
                      style={[
                        Fonts.textSmall,
                        styles.rowLabelText,
                        { color: Colors.textGray800 },
                      ]}
                      numberOfLines={1}
                    >
                      {t('home:backup_checkup_settings_row')}
                    </Text>
                  </View>
                  <ChevronRight
                    size={18}
                    color={Colors.textGray200}
                    style={styles.chevron}
                  />
                </TouchableOpacity>
                {rowDivider}
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('home:delete_ssp_key')}
                  // destructive action — semantic error, never amber
                  style={styles.row}
                  onPress={() => handleBeginDeletion()}
                >
                  <View style={styles.rowLeft}>
                    <View style={styles.rowIcon}>
                      <Trash2 size={20} color={Colors.error} />
                    </View>
                    <Text
                      style={[
                        Fonts.textSmall,
                        styles.rowLabelText,
                        { color: Colors.error },
                      ]}
                      numberOfLines={1}
                    >
                      {t('home:delete_ssp_key_data')}
                    </Text>
                  </View>
                  <ChevronRight
                    size={18}
                    color={Colors.error}
                    style={styles.chevron}
                  />
                </TouchableOpacity>
              </Card>
              <View style={styles.footnote}>
                <Text
                  style={[
                    Fonts.textTinyTiny,
                    styles.footnoteText,
                    { color: Colors.textGray400 },
                  ]}
                >
                  {t('home:delete_ssp_key_data_desc')}
                </Text>
              </View>

              {/* ADVANCED — collapsed-by-default expander: relay + per-chain
                  node/API/explorer endpoints + chain selector. Header-less (the
                  disclosure row is its own header, mirroring the wallet Menu) so
                  the everyday user sees a clean two-line "Advanced" affordance. */}
              <View style={styles.groupSpacer} />
              <Card style={styles.card}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('home:advanced')}
                  accessibilityState={{ expanded: advancedOpen }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.row}
                  onPress={() => setAdvancedOpen((previous) => !previous)}
                >
                  <View style={styles.rowLeft}>
                    <View style={styles.rowIcon}>
                      <Server size={20} color={Colors.textGray400} />
                    </View>
                    <View style={styles.rowLabelText}>
                      <Text
                        style={[Fonts.textSmall, { color: Colors.textGray800 }]}
                        numberOfLines={1}
                      >
                        {t('home:advanced')}
                      </Text>
                      <Text
                        style={[
                          Fonts.textTinyTiny,
                          styles.rowSubLabel,
                          { color: Colors.textGray400 },
                        ]}
                        numberOfLines={1}
                      >
                        {t('home:settings_advanced_hint')}
                      </Text>
                    </View>
                  </View>
                  {advancedOpen ? (
                    <ChevronDown
                      size={18}
                      color={Colors.textGray200}
                      style={styles.chevron}
                    />
                  ) : (
                    <ChevronRight
                      size={18}
                      color={Colors.textGray200}
                      style={styles.chevron}
                    />
                  )}
                </TouchableOpacity>
                {advancedOpen && rowDivider}
                {advancedOpen && (
                  <View style={styles.expanderBody}>
                    {endpointField(
                      t('home:ssp_relay_server'),
                      sspConfigRelay,
                      originalConfig.relay,
                      onChangeSSPrelay,
                      resetSSPRelay,
                    )}
                    {nodeDefault
                      ? endpointField(
                          t('home:chain_node_service', {
                            chain: blockchainConfig.name,
                          }),
                          nodeConfig,
                          nodeDefault,
                          onChangeChainNodeService,
                          resetChainNodeService,
                        )
                      : null}
                    {apiDefault
                      ? endpointField(
                          t('home:chain_api_service', {
                            chain: blockchainConfig.name,
                          }),
                          apiConfig,
                          apiDefault,
                          onChangeChainApiService,
                          resetChainApiService,
                        )
                      : null}
                    {explorerDefault
                      ? endpointField(
                          t('home:chain_explorer_service', {
                            chain: blockchainConfig.name,
                          }),
                          explorerConfig,
                          explorerDefault,
                          onChangeChainExplorerService,
                          resetChainExplorerService,
                        )
                      : null}
                    <TouchableOpacity
                      style={[
                        Common.button.outlineRounded,
                        Common.button.secondaryButton,
                        styles.selectChainButton,
                      ]}
                      onPress={() => openChainSelect()}
                    >
                      <Text style={[Fonts.textSmall, Fonts.textPrimary]}>
                        {t('home:select_chain')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Card>

              {/* ABOUT — version + Powered by Flux. */}
              {groupHeader(
                <Info size={14} color={Colors.textGray400} />,
                t('home:settings_about'),
              )}
              <Card style={styles.card}>
                <View style={styles.aboutFooter}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`v${packageJson.version}`}
                    onPress={handleVersionTap}
                  >
                    <Text
                      style={[
                        Fonts.textTiny,
                        Fonts.textCenter,
                        Gutters.tinyBMargin,
                      ]}
                    >
                      v{packageJson.version}
                    </Text>
                  </TouchableOpacity>
                  <PoweredByFlux about isClickeable />
                </View>
              </Card>

              <View style={[Layout.justifyContentEnd]}>
                <TouchableOpacity
                  style={[
                    Common.button.rounded,
                    Common.button.primary,
                    Gutters.regularBMargin,
                    Gutters.largeTMargin,
                  ]}
                  onPress={() => handleSave()}
                >
                  <Text style={[Fonts.textRegular, Fonts.textOnPrimary]}>
                    {t('common:save')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleCancel()}>
                  <Text
                    style={[
                      Fonts.textSmall,
                      Fonts.textPrimary,
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
        <BlurOverlay />
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
                    Fonts.textPrimary,
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
      <Modal
        animationType="fade"
        transparent={true}
        visible={isLanguageSelectOpen}
        onRequestClose={() => setIsLanguageSelectOpen(false)}
      >
        <BlurOverlay />
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
              {t('home:change_language')}
            </Text>
            <View style={[Gutters.regularTMargin]}>
              <Picker
                selectedValue={selectedLanguage}
                onValueChange={(itemValue) => setSelectedLanguage(itemValue)}
              >
                {languages.map((language) => (
                  <Picker.Item
                    label={language.desc}
                    color={Colors.textInput}
                    value={language.value}
                    key={language.value}
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
                onPress={() => closeLanguageSelect()}
              >
                <Text
                  style={[
                    Fonts.textSmall,
                    Fonts.textPrimary,
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
      {authenticationOpen && (
        <Authentication
          actionStatus={handleAuthenticationOpen}
          type="delete"
          biomatricsAllowed={false}
        />
      )}
      <VerifyBackupModal
        open={verifyBackupOpen}
        onClose={handleVerifyBackupClose}
      />
    </>
  );
};

export default SettingsSection;

// Leading column geometry — the icon well and the gap before the label, reused
// to inset the row dividers so they align to the label text (iOS convention).
const ROW_PAD_H = 16;
const ROW_ICON_WELL = 26;
const ROW_LABEL_GAP = 12;

const styles = StyleSheet.create({
  modalTitle: {
    marginBottom: 4,
  },
  // Muted, uppercase section header rendered ABOVE its card.
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 7,
    paddingHorizontal: 6,
  },
  groupHeaderText: {
    marginLeft: 7,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // Card override: no inner padding so rows can span edge-to-edge and dividers
  // sit flush; corners clip the inset rules cleanly.
  card: {
    width: '100%',
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    width: '100%',
    paddingHorizontal: ROW_PAD_H,
    paddingVertical: 9,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  rowIcon: {
    width: ROW_ICON_WELL,
    alignItems: 'center',
  },
  rowLabelText: {
    marginLeft: ROW_LABEL_GAP,
    flexShrink: 1,
  },
  rowSubLabel: {
    marginTop: 1,
  },
  // Vertical gap standing in for a section header on the header-less Advanced
  // card, so its top margin matches the other groups' rhythm.
  groupSpacer: {
    height: 16,
  },
  rowTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    marginLeft: 10,
  },
  rowValueText: {
    flexShrink: 1,
  },
  chevron: {
    marginLeft: 4,
  },
  // Compact, brand-tinted toggle — a bespoke amber pill (on = amber track,
  // black knob per the black-on-amber rule) sized to sit as a refined control
  // in the row rather than the oversized native RN Switch it replaces.
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    padding: 3,
    justifyContent: 'center',
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  // Hairline row divider, inset to the label column.
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: ROW_PAD_H + ROW_ICON_WELL + ROW_LABEL_GAP,
  },
  // Footnote below a card — the quiet secondary caption (iOS grouped list).
  footnote: {
    marginTop: 7,
    paddingHorizontal: 6,
  },
  footnoteText: {
    lineHeight: 17,
    textAlign: 'left',
  },
  expanderBody: {
    width: '100%',
    paddingHorizontal: ROW_PAD_H,
    paddingTop: 14,
    paddingBottom: 16,
  },
  // One endpoint block (sub-label + field), spaced to the card's row rhythm.
  endpointGroup: {
    marginBottom: 14,
  },
  // Sub-section label — same muted, uppercase, letter-spaced type scale as the
  // outer PREFERENCES / SECURITY / ABOUT headers, left-aligned for coherence.
  endpointLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  // Recessed input well — bg + hairline supplied inline so both themes match.
  endpointField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
    paddingLeft: 12,
    paddingRight: 2,
  },
  endpointInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 11,
    paddingRight: 4,
  },
  endpointReset: {
    padding: 6,
  },
  // Chain selector — full width to the field grid with clear breathing room
  // above so it reads as the closing action of the endpoint list.
  selectChainButton: {
    width: '100%',
    marginTop: 6,
  },
  aboutFooter: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 18,
  },
});
