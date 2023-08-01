import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  TextInput,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

import { generateMnemonic } from '../../lib/wallet';

import { setSeedPhrase } from '../../store/ssp';

import { useAppSelector, useAppDispatch } from '../../hooks';

type Props = {
  navigation: any;
};

function Welcome({ navigation }: Props) {
  const dispatch = useAppDispatch();
  const [password, setPassword] = useState('');
  const [passwordVisibility, setPasswordVisibility] = useState(true);
  const [rightIcon, setRightIcon] = useState('eye-off');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordVisibilityConfirm, setPasswordVisibilityConfirm] =
    useState(true);
  const [rightIconConfirm, setRightIconConfirm] = useState('eye-off');
  const { t } = useTranslation(['create', 'common']);
  const { Common, Fonts, Gutters, Layout, Images, Colors } = useTheme();

  const generateMnemonicPhrase = (entValue: 128 | 256) => {
    const generatedMnemonic = generateMnemonic(entValue);
    dispatch(setSeedPhrase(generatedMnemonic));
  };

  const { seedPhrase } = useAppSelector((state) => state.ssp);
  // if seedPhrse exist, navigate to Home page

  if (!seedPhrase) {
    generateMnemonicPhrase(256);
  }
  const onChangePassword = (text: string) => {
    setPassword(text);
  };

  const onChangePasswordConfirm = (text: string) => {
    setPasswordConfirm(text);
  };

  const handlePasswordVisibility = () => {
    if (rightIcon === 'eye') {
      setRightIcon('eye-off');
      setPasswordVisibility(!passwordVisibility);
    } else if (rightIcon === 'eye-off') {
      setRightIcon('eye');
      setPasswordVisibility(!passwordVisibility);
    }
  };

  const handlePasswordVisibilityConfirm = () => {
    if (rightIconConfirm === 'eye') {
      setRightIconConfirm('eye-off');
      setPasswordVisibilityConfirm(!passwordVisibilityConfirm);
    } else if (rightIconConfirm === 'eye-off') {
      setRightIconConfirm('eye');
      setPasswordVisibilityConfirm(!passwordVisibilityConfirm);
    }
  };

  return (
    <ScrollView
      style={Layout.fill}
      contentContainerStyle={[
        Layout.fullSize,
        Layout.fill,
        Layout.colCenter,
        Layout.scrollSpaceBetween,
      ]}
    >
      <View
        style={[
          Layout.row,
          Layout.justifyContentBetween,
          Layout.fullWidth,
          Gutters.smallTMargin,
          Gutters.smallHPadding,
        ]}
      >
        <TouchableOpacity
          onPress={() => navigation.navigate('Welcome')}
          style={[Layout.row]}
        >
          <Icon name="chevron-left" size={20} color={Colors.bluePrimary} />
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBluePrimary,
              Gutters.tinyLPadding,
            ]}
          >
            {t('common:back')}
          </Text>
        </TouchableOpacity>
      </View>
      <View
        style={[
          Layout.fill,
          Layout.relative,
          Layout.fullWidth,
          Layout.justifyContentCenter,
          Layout.alignItemsCenter,
        ]}
      >
        <Image
          style={{ width: 80, height: 160 }}
          source={Images.ssp.logo}
          resizeMode={'contain'}
        />
        <Text style={[Fonts.titleSmall, Gutters.tinyBMargin]}>
          {t('create:secure_key')}
        </Text>
        <View style={styles.passwordSection}>
          <TextInput
            style={styles.input}
            autoComplete="new-password"
            inputMode="email"
            textContentType="password"
            autoCapitalize="none"
            placeholder="Set Key Password"
            secureTextEntry={passwordVisibility ? true : false}
            onChangeText={onChangePassword}
            value={password}
            autoCorrect={false}
          />
          <TouchableOpacity
            onPress={handlePasswordVisibility}
            style={styles.eyeIcon}
          >
            <Icon name={rightIcon} size={20} color={Colors.bluePrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.passwordSection}>
          <TextInput
            style={styles.input}
            autoComplete="new-password"
            inputMode="email"
            textContentType="password"
            autoCapitalize="none"
            placeholder="Confirm Key Password"
            secureTextEntry={passwordVisibilityConfirm ? true : false}
            onChangeText={onChangePasswordConfirm}
            value={passwordConfirm}
            autoCorrect={false}
          />
          <TouchableOpacity
            onPress={handlePasswordVisibilityConfirm}
            style={styles.eyeIcon}
          >
            <Icon
              name={rightIconConfirm}
              size={20}
              color={Colors.bluePrimary}
            />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[
            Common.button.rounded,
            Common.button.bluePrimary,
            Gutters.regularBMargin,
            Gutters.smallTMargin,
          ]}
          onPress={() => Alert.alert('TODO navigate to create page')}
        >
          <Text style={[Fonts.textRegular, Fonts.textWhite]}>
            {t('create:setup_key')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Alert.alert('TODO navigate to restore page')}
        >
          <Text style={[Fonts.textSmall, Fonts.textBluePrimary]}>
            {t('create:restore_key')}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    padding: 12,
    backgroundColor: '#fff',
    color: '#424242',
  },
  passwordSection: {
    width: '80%',
    height: 50,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginTop: 16,
  },
  eyeIcon: {
    padding: 12,
  },
});

export default Welcome;
