import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import { Eye, EyeOff, FingerprintPattern } from 'lucide-react-native';
import * as CryptoJS from 'crypto-js';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import * as Keychain from 'react-native-keychain';
import { useTheme } from '../../hooks';
import ToastNotif from '../Toast/Toast';
import BlurOverlay from '../../BlurOverlay';
import { PrimaryButton } from '../ui';

// Copy maps — per-request-type prompt copy. Unknown types fall back to the
// generic "sensitive information" wording, matching the previous ternaries.
const BIOMETRIC_PROMPT_KEY = {
  tx: 'home:auth_confirm_sign_send',
  sync: 'home:auth_confirm_sync',
  pubnonces: 'home:auth_confirm_public_nonces',
  evmsigning: 'home:auth_confirm_evm_signing',
  wksigning: 'home:auth_confirm_wk_signing',
  vaultxpub: 'home:auth_confirm_vault_xpub',
  vaultsigning: 'home:auth_confirm_vault_signing',
  noncesync: 'home:auth_confirm_nonce_sync',
  recovery: 'home:auth_confirm_recovery',
} as const;

const INFO_KEY = {
  tx: 'home:auth_sign_tx',
  sync: 'home:auth_sync_ssp',
  pubnonces: 'home:auth_sync_pub_nonces',
  evmsigning: 'home:auth_sync_evm_signing',
  wksigning: 'home:auth_sync_wk_signing',
  vaultxpub: 'home:auth_confirm_vault_xpub_info',
  vaultsigning: 'home:auth_confirm_vault_signing_info',
  noncesync: 'home:auth_confirm_nonce_sync_info',
  delete: 'home:auth_delete_ssp_key_data',
} as const;

// Types whose second line says "Confirm with password." — every other type
// (sensitive access etc.) says "Grant access with password."
const CONFIRM_PW_KEY = {
  tx: 'home:auth_confirm_with_pw',
  sync: 'home:auth_confirm_with_pw',
  pubnonces: 'home:auth_confirm_with_pw',
  evmsigning: 'home:auth_confirm_with_pw',
  wksigning: 'home:auth_confirm_with_pw',
  vaultxpub: 'home:auth_confirm_with_pw',
  vaultsigning: 'home:auth_confirm_with_pw',
  noncesync: 'home:auth_confirm_with_pw',
} as const;

const Authentication = (props: {
  actionStatus: (status: boolean) => void;
  type: string;
  biomatricsAllowed: boolean;
}) => {
  // focusability of inputs
  const textInputA = useRef<TextInput | null>(null);
  const { t } = useTranslation(['home', 'common', 'cr']);
  const { darkMode, Fonts, Gutters, Layout, Common, Colors } = useTheme();
  const [password, setPassword] = useState('');
  const [passwordVisibility, setPasswordVisibility] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [setupBiometrics, setSetupBiometrics] = useState(false);
  const [modalVisible, setModalVisible] = useState(true);
  // Guards against the success setTimeout (queued before the user tapped
  // cancel) firing after a cancel propagation already started, which
  // would otherwise call actionStatus(true) seconds after actionStatus(false).
  const propagated = useRef(false);

  // Fade out the modal before the parent unmounts us. Without this, an
  // abrupt unmount during the same render commit (e.g. Home setting
  // submittingTransaction=true on approve) leaves iOS Fabric to take an
  // empty snapshot of the dismissed view, blanketing the screen with a
  // black overlay that can also block touches until the app is restarted.
  const propagate = (status: boolean) => {
    if (propagated.current) return;
    propagated.current = true;
    setModalVisible(false);
    setTimeout(() => {
      props.actionStatus(status);
    }, 300);
  };

  useEffect(() => {
    if (!props.biomatricsAllowed) {
      return;
    }
    console.log('entered auth');
    Keychain.getSupportedBiometryType()
      .then(async (resultObject) => {
        if (resultObject) {
          console.log('Biometrics is supported');
          // check if we have it
          const bioExists = await Keychain.hasGenericPassword({
            service: 'sspkey_pw_bio',
          });
          if (bioExists) {
            setBiometricsAvailable(true);
            // keep timeout
            // iOS freezes if we call biometrics right away
            // toggle biometrics immediately? reevaluate
            setTimeout(() => {
              initiateFingerprint();
            }, 250);
          } else {
            console.log('Biometrics not set');
            setBiometricsAvailable(false);
          }
        } else {
          console.log('Biometrics not supported');
          setBiometricsAvailable(false);
        }
      })
      .catch((error) => {
        console.log(error);
      });
  }, []);

  const initiateFingerprint = () => {
    const textForPrompt = t(
      BIOMETRIC_PROMPT_KEY[props.type as keyof typeof BIOMETRIC_PROMPT_KEY] ??
        'home:auth_sensitive_information',
    );
    console.log('Initiate Fingerprint');
    // if success continue, if fail, show error message and only allow password authentication
    // get from keychain
    const options = {
      service: 'sspkey_pw_bio',
      authenticationPrompt: {
        title: textForPrompt,
        // subtitle: textForPrompt, // android only
        // description: textForPrompt, // android only
        cancel: t('common:cancel'),
      },
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET, // all  recognized by Android as a requirement for Biometric enabled storage (Till we got a better implementation);. On android only prompts biometrics, does not check for updates of biometrics. Face not supported.
    };

    Keychain.getGenericPassword(options) // This does NOT work in simulator, library issues, direct access may be granted in simulator but not on real device!
      .then((data) => {
        setTimeout(() => {
          if (data && data.password) {
            setPassword('');
            setPasswordVisibility(false);
            propagate(true);
          } else {
            // biometrics failed, were tempered with, disable biometrics option and only allow for password authentication
            setPassword('');
            setPasswordVisibility(false);
            displayMessage('error', t('home:err_auth_biometrics_pw_needed'));
            setSetupBiometrics(true);
          }
        }, 250);
      })
      .catch((error) => {
        // some other failure, cancellation of biometrics
        setPassword('');
        setPasswordVisibility(false);
        // setSetupBiometrics(true); // do not setup again, it is already setup. If enabled it forces android users to authenticate again.
        console.log(error);
      });
  };
  const displayMessage = (type: string, content: string) => {
    Toast.show({
      type,
      text1: content,
    });
  };

  const close = () => {
    console.log('Close');
    setPassword('');
    setPasswordVisibility(false);
    propagate(false);
  };

  const grantAccess = async () => {
    try {
      console.log('Grant Access');
      // get from keychain
      const passwordHash = await Keychain.getGenericPassword({
        service: 'sspkey_pw_hash',
      });
      // get salt
      const saltData = await Keychain.getGenericPassword({
        service: 'salt',
      });
      // from user password create hash
      if (!passwordHash || !saltData) {
        throw new Error('Unable to decrypt stored data');
      }
      // generate hash of our password
      const key256Bits1000Iterations = CryptoJS.PBKDF2(
        password,
        saltData.password,
        {
          keySize: 256 / 32,
          iterations: 1000, // more is too slow, favor performance, this is already 0.1 seconds
        },
      );
      const pwHash = key256Bits1000Iterations.toString();
      if (passwordHash.password !== pwHash) {
        displayMessage('error', t('home:err_auth_pw_incorrect'));
        return;
      }
      let isBioSet = false;
      // check if we have it
      try {
        const bioExists = await Keychain.hasGenericPassword({
          service: 'sspkey_pw_bio',
        });
        console.log('passwordData', bioExists);
        if (bioExists) {
          isBioSet = true;
        }
      } catch (error) {
        console.log(error);
      }
      // if we do not have biometrics or we want to setup biometrics, we can try to set it
      if (setupBiometrics || !isBioSet) {
        try {
          // if we authenticated with password, check if biometrics is available and store the secret so bio can be used next time
          const isBiometricsSupported =
            await Keychain.getSupportedBiometryType();
          if (isBiometricsSupported) {
            const passwordData = await Keychain.getGenericPassword({
              service: 'sspkey_pw',
            });
            if (passwordData) {
              await Keychain.setGenericPassword(
                'sspkey_pw_bio',
                passwordData.password,
                {
                  service: 'sspkey_pw_bio',
                  storage: Keychain.STORAGE_TYPE.AES_GCM, // force biometrics encryption, on android setGenericPassword PROMPTS for biometric inputs using AES_GCM, RSA does not prompt for it. iOS does not prompt.
                  accessible:
                    Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY, // iOS only
                  accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET, // all  recognized by Android as a requirement for Biometric enabled storage (Till we got a better implementation);. On android only prompts biometrics, does not check for updates of biometrics. Face not supported.
                  securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE, // android only, default is any
                  authenticationPrompt: {
                    title: t('cr:setup_biometrics'),
                    // subtitle: textForPrompt, // android only
                    // description: textForPrompt, // android only
                    cancel: t('common:cancel'),
                  },
                },
              );
            }
          }
        } catch (error) {
          console.log(error); // catch error to still allow password authentication as this is not crucial
        }
      }
      setPassword('');
      setPasswordVisibility(false);
      setSetupBiometrics(false);
      propagate(true);
    } catch (error) {
      console.log(error);
      displayMessage('error', t('home:err_auth_pw_check'));
    }
  };

  const onChangePassword = (text: string) => {
    setPassword(text);
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={modalVisible}
      onRequestClose={() => close()}
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
            Layout.justifyContentCenter,
          ]}
        >
          <View style={[Common.modalView, styles.modalView]}>
            <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
              {t('home:confirm_password_pin')}
            </Text>
            <View
              style={[
                Layout.fill,
                Layout.relative,
                Layout.fullWidth,
                Layout.alignItemsCenter,
                Gutters.smallTMargin,
              ]}
            >
              <Text
                style={[
                  Fonts.textBold,
                  Fonts.textSmall,
                  Fonts.textCenter,
                  Gutters.smallTMargin,
                ]}
              >
                {t(
                  INFO_KEY[props.type as keyof typeof INFO_KEY] ??
                    'home:auth_sensitive_inf',
                )}
              </Text>
              {props.type !== 'delete' && (
                <Text
                  style={[
                    Fonts.textBold,
                    Fonts.textSmall,
                    Fonts.textCenter,
                    Gutters.smallTMargin,
                  ]}
                >
                  {t(
                    CONFIRM_PW_KEY[props.type as keyof typeof CONFIRM_PW_KEY] ??
                      'home:auth_grant_access_pw',
                  )}
                </Text>
              )}

              {biometricsAvailable && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('common:use_biometrics')}
                  onPress={() => initiateFingerprint()}
                  style={[{ alignSelf: 'center' }, Gutters.regularTMargin]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <FingerprintPattern size={50} color={Colors.primary} />
                </TouchableOpacity>
              )}
              {!biometricsAvailable && <View style={[Gutters.smallMargin]} />}
              <View
                style={[
                  Layout.rowCenter,
                  Common.inputWithButtonBgModalColors,
                  styles.inputWithButton,
                ]}
              >
                <TextInput
                  style={[Common.textInput, Common.textInputBgModal]}
                  autoComplete="new-password"
                  textContentType="password"
                  autoCapitalize="none"
                  placeholder={t('cr:confirm_key_pin')}
                  placeholderTextColor={darkMode ? '#777' : '#c7c7c7'}
                  secureTextEntry={passwordVisibility ? false : true}
                  onChangeText={onChangePassword}
                  value={password}
                  autoCorrect={false}
                  ref={textInputA}
                  onPressIn={() => textInputA.current?.focus()}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    passwordVisibility
                      ? 'common:hide_password'
                      : 'common:show_password',
                  )}
                  onPress={() => setPasswordVisibility(!passwordVisibility)}
                  style={Common.inputIcon}
                >
                  {passwordVisibility ? (
                    <Eye size={20} color={Colors.primary} />
                  ) : (
                    <EyeOff size={20} color={Colors.primary} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
            <View style={[Layout.justifyContentEnd]}>
              <PrimaryButton
                label={
                  props.type === 'sensitive'
                    ? t('home:grant_access')
                    : t('common:confirm')
                }
                style={[Gutters.regularBMargin, Gutters.smallTMargin]}
                onPress={() => grantAccess()}
              />
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => close()}
                hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
              >
                <Text
                  style={[Fonts.textSmall, Fonts.textPrimary, Fonts.textCenter]}
                >
                  {t('common:cancel')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ToastNotif />
    </Modal>
  );
};

export default Authentication;

const styles = StyleSheet.create({
  modalView: {
    justifyContent: 'center',
    left: 0,
    right: 0,
    minHeight: 480,
    bottom: 40,
  },
  inputWithButton: {
    marginTop: 30,
    width: '100%',
    // design tokens: radius 8 for controls
    borderRadius: 8,
  },
});
