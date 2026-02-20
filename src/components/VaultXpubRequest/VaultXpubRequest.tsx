import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Authentication from '../Authentication/Authentication';
import Icon from 'react-native-vector-icons/Feather';
import { blockchains } from '../../storage/blockchains';
import type { cryptos } from '../../types';

interface VaultXpubRequestProps {
  activityStatus: boolean;
  vaultName: string;
  orgName: string;
  chain: string;
  actionStatus: (status: boolean) => void;
}

const VaultXpubRequest: React.FC<VaultXpubRequestProps> = ({
  activityStatus,
  vaultName,
  orgName,
  chain,
  actionStatus,
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const chainConfig = blockchains[chain as keyof cryptos];
  const chainDisplay = chainConfig
    ? `${chainConfig.name} (${chainConfig.symbol})`
    : chain;

  const approve = () => {
    console.log('Approve vault xpub request');
    actionStatus(true);
  };

  const openAuthentication = () => {
    console.log('Open Authentication for vault xpub');
    setAuthenticationOpen(true);
  };

  const reject = () => {
    console.log('Reject vault xpub request');
    actionStatus(false);
  };

  const handleAuthenticationOpen = (status: boolean) => {
    console.log('Authentication result:', status);
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
        {/* Vault Icon */}
        <Icon name="lock" size={40} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            Gutters.smallTMargin,
            Gutters.smallBMargin,
          ]}
        >
          {t('home:vault_xpub_request')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            Gutters.regularLMargin,
            Gutters.regularRMargin,
          ]}
        >
          {t('home:vault_xpub_request_info', { vaultName, orgName })}
        </Text>

        {/* Chain Info */}
        <View
          style={[
            Gutters.regularTMargin,
            Gutters.regularLMargin,
            Gutters.regularRMargin,
            Layout.alignItemsCenter,
          ]}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              { color: Colors.textGray400, marginBottom: 4 },
            ]}
          >
            {t('home:vault_xpub_requested_chain')}:
          </Text>
        </View>
        <View
          style={[
            Gutters.regularLMargin,
            Gutters.regularRMargin,
            {
              backgroundColor: Colors.inputBackground,
              borderRadius: 8,
              padding: 12,
              width: '90%',
              borderWidth: 1,
              borderColor: Colors.textGray200,
            },
          ]}
        >
          <Text
            style={[Fonts.textSmall, Fonts.textBold, Fonts.textCenter]}
            selectable={true}
          >
            {chainDisplay}
          </Text>
        </View>
      </View>

      <View
        style={[
          Layout.justifyContentEnd,
          Gutters.regularLMargin,
          Gutters.regularRMargin,
        ]}
      >
        <TouchableOpacity
          style={[
            Common.button.rounded,
            Common.button.bluePrimary,
            Gutters.regularBMargin,
            Gutters.smallTMargin,
          ]}
          disabled={authenticationOpen || activityStatus}
          onPressIn={() => openAuthentication()}
        >
          {(authenticationOpen || activityStatus) && (
            <ActivityIndicator
              size={'large'}
              style={[{ position: 'absolute' }]}
            />
          )}
          <Text style={[Fonts.textRegular, Fonts.textWhite]}>
            {t('home:approve_request')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={authenticationOpen || activityStatus}
          onPressIn={() => reject()}
        >
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
        <Authentication
          actionStatus={handleAuthenticationOpen}
          type="vaultxpub"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

export default VaultXpubRequest;
