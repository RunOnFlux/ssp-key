import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native';
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

const backendsOriginalConfig = backendsOriginal();
const originalConfig = sspConfigOriginal();

const SettingsSection = (props: {
  actionStatus: (status: boolean) => void;
  navigation: any;
}) => {
  const FNC = backends().flux.node;
  const SSPR = sspConfig().relay;
  console.log(SSPR);
  const [sspConfigRelay, setSspConfigRelay] = useState(SSPR);
  const [fluxNodeConfig, setFluxNodeConfig] = useState(FNC);
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Common, Colors } = useTheme();

  const handleCancel = () => {
    console.log('Close');
    if (SSPR !== sspConfigRelay) {
      setSspConfigRelay(SSPR);
    }
    if (FNC !== fluxNodeConfig) {
      setFluxNodeConfig(FNC);
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
    // adjust flux node
    if (backendsOriginalConfig.flux.node !== fluxNodeConfig) {
      const backendsConfig = {
        flux: {
          node: fluxNodeConfig,
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

  const resetFluxNodeService = () => {
    console.log('Reset Flux Node Service');
    setFluxNodeConfig(backendsOriginalConfig.flux.node);
  };

  const onChangeSSPrelay = (text: string) => {
    setSspConfigRelay(text);
  };

  const onChangeFluxNodeService = (text: string) => {
    setFluxNodeConfig(text);
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => handleCancel()}
    >
      <ScrollView
        style={[Layout.fill, styles.modalView]}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
        ]}
      >
        <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
          {t('common:settings')}
        </Text>
        <View
          style={[
            Layout.fill,
            Layout.relative,
            Layout.fullWidth,
            Layout.justifyContentCenter,
            Layout.alignItemsCenter,
          ]}
        >
          <View style={[Gutters.regularTMargin]}>
            <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
              {t('home:change_pw')}
            </Text>
            <Text
              style={[Fonts.textTiny, Fonts.textCenter, Gutters.smallMargin]}
            >
              <TouchableOpacity
                style={[
                  Common.button.outlineRounded,
                  Common.button.secondaryButton,
                  Gutters.regularTMargin,
                ]}
                onPress={() => handleRestore()}
              >
                <Text
                  style={[
                    Fonts.textTiny,
                    Fonts.textBluePrimary,
                    Gutters.tinyHPadding,
                    Gutters.tinyVPadding,
                  ]}
                >
                  {t('home:change_pw_restore')}
                </Text>
              </TouchableOpacity>
            </Text>
          </View>
          <View style={[Gutters.regularTMargin, Gutters.smallBMargin]}>
            <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
              {t('home:ssp_relay_server')}
            </Text>
            <View style={styles.passwordSection}>
              <TextInput
                style={styles.input}
                inputMode="email"
                autoCapitalize="none"
                placeholder="relay.ssp.runonflux.io"
                onChangeText={onChangeSSPrelay}
                value={sspConfigRelay}
                autoCorrect={false}
              />
              <TouchableOpacity onPress={resetSSPRelay} style={styles.eyeIcon}>
                <Icon name="x" size={20} color={Colors.bluePrimary} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={[Gutters.regularTMargin, Gutters.smallBMargin]}>
            <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
              {t('home:flux_node_service')}
            </Text>
            <View style={styles.passwordSection}>
              <TextInput
                style={styles.input}
                inputMode="email"
                autoCapitalize="none"
                placeholder="explorer.runonflux.io"
                onChangeText={onChangeFluxNodeService}
                value={fluxNodeConfig}
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={resetFluxNodeService}
                style={styles.eyeIcon}
              >
                <Icon name="x" size={20} color={Colors.bluePrimary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <View>
          <TouchableOpacity
            style={[
              Common.button.rounded,
              Common.button.bluePrimary,
              Layout.fullWidth,
              Gutters.regularTMargin,
              Gutters.smallBMargin,
            ]}
            onPress={() => handleSave()}
          >
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textWhite,
                Gutters.regularHPadding,
              ]}
            >
              {t('common:save')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleCancel()}>
            <Text
              style={[Fonts.textSmall, Fonts.textBluePrimary, Fonts.textCenter]}
            >
              {t('common:cancel')}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
};

export default SettingsSection;

const styles = StyleSheet.create({
  modalView: {
    backgroundColor: 'white',
    margin: 30,
    marginTop: 60,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  input: {
    flex: 1,
    padding: 12,
    color: '#424242',
    width: '100%',
  },
  eyeIcon: {
    padding: 12,
  },
  passwordSection: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    borderRadius: 10,
    backgroundColor: '#f6f6f6',
  },
});
