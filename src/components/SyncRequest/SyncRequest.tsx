import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Link } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Authentication from '../Authentication/Authentication';

import { blockchains } from '@storage/blockchains';

import { cryptos } from '../../types';

import { SlideToApprove } from '../request';
const SyncRequest = (props: {
  chain: keyof cryptos;
  activityStatus: boolean;
  actionStatus: (status: boolean) => void;
}) => {
  // so we need our xpubkey, then generate address and show user the address. If not the same, tell user to restore or create wallet from scratch.
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);

  const blockchainConfig = blockchains[props.chain];

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
        <Link size={60} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            Gutters.smallMargin,
          ]}
        >
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
          {t('home:ssp_sync_request', {
            chain: blockchainConfig.name,
            symbol: blockchainConfig.symbol,
          })}
        </Text>
      </View>
      <View style={[Layout.justifyContentEnd]}>
        <SlideToApprove
          label={t('home:slide_to_approve')}
          accessibilityLabel={t('home:approve_sync')}
          style={[Gutters.regularBMargin, Gutters.smallTMargin]}
          disabled={authenticationOpen || props.activityStatus}
          loading={authenticationOpen || props.activityStatus}
          onComplete={() => openAuthentication()}
        />
        <TouchableOpacity
          accessibilityRole="button"
          disabled={authenticationOpen || props.activityStatus}
          onPress={() => reject()}
          hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textPrimary,
              Gutters.regularBMargin,
              Fonts.textCenter,
            ]}
          >
            {t('home:reject')}
          </Text>
        </TouchableOpacity>
      </View>
      {authenticationOpen && (
        <Authentication
          actionStatus={handleAuthenticationOpen}
          type="sync"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

export default SyncRequest;
