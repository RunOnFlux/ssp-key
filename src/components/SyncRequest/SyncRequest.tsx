import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

const SyncRequest = (props: {
  chain: string; // if chain not provided, default to flux
  actionStatus: (status: boolean) => void;
}) => {
  // so we need our xpubkey, then generate address and show user the address. If not the same, tell user to restore or create wallet from scratch.
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();

  const approve = () => {
    console.log('Approve');
    props.actionStatus(true);
  };
  const reject = () => {
    console.log('Reject');
    props.actionStatus(false);
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
        <Icon name="link" size={60} color={Colors.textGray400} />
        <Text style={[Fonts.textBold, Fonts.textRegular, Gutters.smallMargin]}>
          {t('home:sync_request')}
        </Text>
        <Text style={[Fonts.textSmall, Fonts.textCenter]}>
          SSP Wallet would like to link and synchronise{' '}
          {props.chain.toUpperCase()} chain to your SSP Key.
        </Text>
      </View>
      <View>
        <TouchableOpacity
          style={[
            Common.button.outlineRounded,
            Common.button.secondaryButton,
            Layout.fullWidth,
            Gutters.regularBMargin,
          ]}
          onPress={() => approve()}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBluePrimary,
              Gutters.regularHPadding,
            ]}
          >
            {t('home:approve_sync')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => reject()}>
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
    </>
  );
};

export default SyncRequest;
