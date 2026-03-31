import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Authentication from '../Authentication/Authentication';
import Icon from 'react-native-vector-icons/Feather';
import { blockchains } from '../../storage/blockchains';
import type { cryptos } from '../../types';

interface FluxNodeStartRequestProps {
  activityStatus: boolean;
  chain: string;
  nodeName: string;
  collateralAmount: string;
  delegates: string[];
  actionStatus: (status: boolean) => void;
}

const FluxNodeStartRequest: React.FC<FluxNodeStartRequestProps> = ({
  activityStatus,
  chain,
  nodeName,
  collateralAmount,
  delegates,
  actionStatus,
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const chainConfig = blockchains[chain as keyof cryptos];
  const chainDisplay = chainConfig
    ? `${chainConfig.name} (${chainConfig.symbol})`
    : chain;

  const amountFlux = collateralAmount
    ? (parseInt(collateralAmount, 10) / 1e8).toFixed(2)
    : '?';

  const cardStyle = {
    backgroundColor: Colors.inputBackground,
    borderRadius: 8,
    padding: 12,
    width: '90%' as const,
    borderWidth: 1,
    borderColor: Colors.textGray200,
  };

  const approve = () => {
    actionStatus(true);
  };

  const openAuthentication = () => {
    setAuthenticationOpen(true);
  };

  const reject = () => {
    actionStatus(false);
  };

  const handleAuthenticationOpen = (status: boolean) => {
    setAuthenticationOpen(false);
    if (status === true) {
      approve();
    }
  };

  return (
    <>
      <ScrollView
        style={[Layout.fill, Layout.fullWidth]}
        contentContainerStyle={[
          Layout.alignItemsCenter,
          { paddingTop: 20, paddingBottom: 20 },
        ]}
        showsVerticalScrollIndicator={true}
      >
        {/* Header */}
        <Icon name="server" size={36} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            { marginTop: 8, marginBottom: 4 },
          ]}
        >
          {t('home:flux_node_start_title')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            {
              color: Colors.textGray400,
              paddingHorizontal: 24,
              marginBottom: 16,
            },
          ]}
        >
          {t('home:flux_node_start_info')}
        </Text>

        {/* Node Name Card */}
        <View style={[cardStyle, { marginBottom: 12 }]}>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:flux_node_start_node')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold]}>
            {nodeName || 'Unknown'}
          </Text>
        </View>

        {/* Chain Card */}
        <View style={[cardStyle, { marginBottom: 12 }]}>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:flux_node_start_chain')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold]} selectable={true}>
            {chainDisplay}
          </Text>
        </View>

        {/* Collateral Card */}
        <View style={[cardStyle, { marginBottom: 12 }]}>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:flux_node_start_collateral')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold]}>
            {amountFlux} FLUX
          </Text>
        </View>

        {/* Delegates Card */}
        {delegates.length > 0 && (
          <View style={[cardStyle, { marginBottom: 12 }]}>
            <Text style={[styles.label, { color: Colors.textGray400 }]}>
              {t('home:flux_node_start_delegates')}
            </Text>
            <Text style={[Fonts.textSmall, Fonts.textBold]}>
              {delegates.length}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Action Buttons */}
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
          type="fluxnodestart"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    marginBottom: 2,
  },
});

export default FluxNodeStartRequest;
