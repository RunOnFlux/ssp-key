import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Icon from 'react-native-vector-icons/Feather';
import IconB from 'react-native-vector-icons/MaterialCommunityIcons';
import Divider from '../../components/Divider/Divider';

import { useAppSelector } from '../../hooks';

type Props = {
  navigation: any;
};

function Home({ navigation }: Props) {
  const { t } = useTranslation(['welcome', 'common']);
  const { Fonts, Gutters, Layout, Images, Colors, Common } = useTheme();

  const { seedPhrase } = useAppSelector((state) => state.ssp);
  console.log('seedPhrase', seedPhrase);
  // if seedPhrse does not exist, navigate to Welcome page
  if (!seedPhrase) {
    navigation.navigate('Welcome');
    return <></>;
  }

  const openHelp = () => {
    console.log('help');
  };
  const openSettings = () => {
    console.log('settings');
  };
  const scanCode = () => {
    console.log('scan code');
  };
  const handleRefresh = () => {
    console.log('refresh');
  };
  // refresh for pending actions needed
  // on click refresh pending actions
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
          Gutters.smallHPadding,
        ]}
      >
        <Image
          style={{ width: 35, height: 35 }}
          source={Images.ssp.logo}
          resizeMode={'contain'}
        />
        <View style={[Layout.row, Gutters.tinyTMargin]}>
          <TouchableOpacity
            onPress={() => openHelp()}
            style={[Gutters.smallRMargin]}
          >
            <Icon name="help-circle" size={22} color={Colors.textGray400} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => openSettings()} style={[]}>
            <Icon name="settings" size={22} color={Colors.textGray400} />
          </TouchableOpacity>
        </View>
      </View>
      <Divider color={Colors.textGray200} />
      <View
        style={[
          Layout.fill,
          Layout.relative,
          Layout.fullWidth,
          Layout.justifyContentCenter,
          Layout.alignItemsCenter,
        ]}
      >
        <Icon name="key" size={60} color={Colors.textGray400} />
        <Text style={[Fonts.textBold, Fonts.textRegular, Gutters.smallMargin]}>
          No pending actions.
        </Text>
        <TouchableOpacity
          onPress={() => handleRefresh()}
          style={[Layout.row, Gutters.regularMargin]}
        >
          <IconB name="gesture-tap" size={30} color={Colors.bluePrimary} />
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              Fonts.textBluePrimary,
              Gutters.tinyTMargin,
              Gutters.tinyLMargin,
            ]}
          >
            Refresh
          </Text>
        </TouchableOpacity>
      </View>
      <View>
        <TouchableOpacity
          style={[
            Common.button.outlineRounded,
            Common.button.secondaryButton,
            Layout.fullWidth,
          ]}
          onPress={() => scanCode()}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBluePrimary,
              Gutters.regularHPadding,
            ]}
          >
            Scan code
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

export default Home;
