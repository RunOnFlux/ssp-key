import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Authentication from '../Authentication/Authentication';

const SyncRequest = (props: {
  chain: string; // if chain not provided, default to flux
  actionStatus: (status: boolean) => void;
}) => {
  // so we need our xpubkey, then generate address and show user the address. If not the same, tell user to restore or create wallet from scratch.
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);

  const approve = () => {
    console.log('Approve');
    props.actionStatus(true);
  };
  const openAuthentication = () => {
    console.log('Open Authentication');
    setAuthenticationOpen(true);
  };
  const reject = () => {
    console.log('Reject');
    props.actionStatus(false);
  };

  const handleAuthenticationOpen = (status: boolean) => {
    console.log(status);
    console.log('authentication modal close.');
    setAuthenticationOpen(false);
    if (status === true) {
      approve();
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
        <Icon name="link" size={60} color={Colors.textGray400} />
        <Text style={[Fonts.textBold, Fonts.textRegular, Gutters.smallMargin]}>
          {t('home:sync_request')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            Gutters.smallLMargin,
            Gutters.smallRMargin,
          ]}
        >
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
          onPress={() => openAuthentication()}
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
      {authenticationOpen && (
        <Authentication actionStatus={handleAuthenticationOpen} type="sync" />
      )}
    </>
  );
};

export default SyncRequest;
