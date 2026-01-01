import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Image,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Authentication from '../Authentication/Authentication';

interface WkSignRequesterInfo {
  origin: string;
  siteName?: string;
  description?: string;
  iconUrl?: string;
}

interface WkSigningRequestProps {
  activityStatus: boolean;
  message: string; // plain text message to sign
  wkIdentity: string;
  requesterInfo?: WkSignRequesterInfo;
  actionStatus: (status: boolean) => void;
}

const WkSigningRequest: React.FC<WkSigningRequestProps> = ({
  activityStatus,
  message,
  requesterInfo,
  actionStatus,
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);

  const approve = () => {
    console.log('Approve WK signing request');
    actionStatus(true);
  };

  const openAuthentication = () => {
    console.log('Open Authentication for WK signing');
    setAuthenticationOpen(true);
  };

  const reject = () => {
    console.log('Reject WK signing request');
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
        <Text
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            Gutters.smallBMargin,
          ]}
        >
          {t('home:wk_signing_request')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            Gutters.smallLMargin,
            Gutters.smallRMargin,
          ]}
        >
          {t('home:wk_signing_request_info')}
        </Text>

        {/* Requester Info */}
        {requesterInfo && (
          <View
            style={[
              Gutters.regularTMargin,
              Gutters.smallLMargin,
              Gutters.smallRMargin,
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
            {/* Icon and Site Name */}
            {requesterInfo.siteName && (
              <View
                style={[
                  Layout.row,
                  Layout.alignItemsCenter,
                  { marginBottom: 8 },
                ]}
              >
                {requesterInfo.iconUrl && (
                  <Image
                    source={{ uri: requesterInfo.iconUrl }}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 4,
                      marginRight: 8,
                    }}
                    resizeMode="contain"
                  />
                )}
                <Text
                  style={[Fonts.textSmall, Fonts.textBold, { flex: 1 }]}
                  numberOfLines={1}
                >
                  {requesterInfo.siteName}
                </Text>
              </View>
            )}
            {/* Origin */}
            <View
              style={{
                backgroundColor: Colors.bgInputAreaModalColor,
                borderRadius: 4,
                padding: 8,
                marginBottom: requesterInfo.description ? 8 : 0,
              }}
            >
              <Text
                style={[
                  Fonts.textTiny,
                  { color: Colors.textGray400, marginBottom: 2 },
                ]}
              >
                {t('home:origin')}
              </Text>
              <Text
                style={[
                  Fonts.textSmall,
                  Fonts.textBold,
                  { fontFamily: 'monospace' },
                ]}
                selectable={true}
              >
                {requesterInfo.origin}
              </Text>
            </View>
            {/* Description */}
            {requesterInfo.description && (
              <Text style={[Fonts.textSmall]}>{requesterInfo.description}</Text>
            )}
          </View>
        )}

        {/* Message to Sign */}
        <View style={[Gutters.regularTMargin, Layout.alignItemsCenter]}>
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              { color: Colors.textGray400, marginBottom: 4 },
            ]}
          >
            {t('home:message_to_sign')}
          </Text>
        </View>
        <View
          style={{
            height: 80,
            maxHeight: 80,
            backgroundColor: Colors.inputBackground,
            borderRadius: 8,
            padding: 10,
            width: '90%',
            borderWidth: 1,
            borderColor: Colors.textGray200,
          }}
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
                },
              ]}
              selectable={true}
            >
              {message}
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
          type="wksigning"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

export default WkSigningRequest;
