import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Authentication from '../Authentication/Authentication';

const EvmSigningRequest = (props: {
  activityStatus: boolean;
  dataToSign: string;
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
        <Icon name="edit" size={60} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            Gutters.smallMargin,
          ]}
        >
          {t('home:evm_signing_request')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            Gutters.smallLMargin,
            Gutters.smallRMargin,
          ]}
        >
          {t('home:evm_signing_request_info')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            Gutters.smallLMargin,
            Gutters.smallRMargin,
            Gutters.regularTMargin,
          ]}
        >
          {t('home:data_to_sign')}:
        </Text>
        <View
          style={[
            {
              height: 100, // Approximately 5 lines
              maxHeight: 100,
              backgroundColor: Colors.inputBackground,
              borderRadius: 8,
              padding: 10,
              borderWidth: 1,
              borderColor: Colors.textGray200,
            },
            Gutters.smallLMargin,
            Gutters.smallRMargin,
          ]}
        >
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
          >
            <Text
              style={[
                Fonts.textTiny,
                {
                  fontFamily: 'monospace',
                  lineHeight: 16,
                  color: Colors.textGray800,
                },
              ]}
              selectable={true}
            >
              {props.dataToSign}
            </Text>
          </ScrollView>
        </View>
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
          type="evmsigning"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

export default EvmSigningRequest;
