import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Authentication from '../Authentication/Authentication';

/**
 * RecoveryRequest — approval UI for a wallet-issued randomParams recovery
 * request. Matches the existing request-component pattern:
 *
 *   1. Render approve / reject buttons with explanatory copy.
 *   2. On approve, open the shared `Authentication` modal (biometric first,
 *      password fallback) with `type="recovery"` to set the prompt text.
 *   3. Only after Authentication reports success do we call `actionStatus(true)`
 *      back to Home.tsx, which runs the actual sk_r derivation + transit
 *      wrap + relay post.
 *
 * Reject flows straight through to `actionStatus(false)` (no auth needed).
 */
const RecoveryRequest = (props: {
  activityStatus: boolean;
  actionStatus: (status: boolean) => void;
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);

  const approve = () => {
    console.log('Approve recovery');
    props.actionStatus(true);
  };
  const openAuthentication = () => {
    console.log('Open Authentication (recovery)');
    setAuthenticationOpen(true);
  };
  const reject = () => {
    console.log('Reject recovery');
    props.actionStatus(false);
  };

  const handleAuthenticationOpen = (status: boolean) => {
    console.log('Recovery auth modal close, status:', status);
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
        <Icon name="refresh-cw" size={60} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            Gutters.smallMargin,
          ]}
        >
          {t('home:recovery_request')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            Gutters.smallLMargin,
            Gutters.smallRMargin,
          ]}
        >
          {t('home:ssp_recovery_request')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            Gutters.smallLMargin,
            Gutters.smallRMargin,
            Gutters.tinyTMargin,
          ]}
        >
          {t('home:ssp_recovery_request_warning')}
        </Text>
      </View>
      <View style={[Layout.justifyContentEnd]}>
        <TouchableOpacity
          style={[
            Common.button.rounded,
            Common.button.bluePrimary,
            Gutters.regularBMargin,
            Gutters.smallTMargin,
          ]}
          disabled={authenticationOpen || props.activityStatus}
          onPressIn={() => openAuthentication()}
        >
          {(authenticationOpen || props.activityStatus) && (
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
          disabled={authenticationOpen || props.activityStatus}
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
          type="recovery"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

export default RecoveryRequest;
