import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
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
  wkIdentity,
  requesterInfo,
  actionStatus,
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);

  // Truncate identity for display
  const truncatedIdentity = useMemo(() => {
    if (wkIdentity.length > 20) {
      return `${wkIdentity.substring(0, 10)}...${wkIdentity.substring(wkIdentity.length - 10)}`;
    }
    return wkIdentity;
  }, [wkIdentity]);

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
        <Icon name="shield" size={60} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            Gutters.smallMargin,
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
                borderWidth: 1,
                borderColor: Colors.textGray200,
                width: '90%',
              },
            ]}
          >
            {/* Icon and Site Name (if provided - this comes from website, could be spoofed) */}
            {requesterInfo.siteName && (
              <View style={[Layout.row, Layout.alignItemsCenter, { marginBottom: 8 }]}>
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
                  style={[
                    Fonts.textSmall,
                    Fonts.textBold,
                    { color: Colors.textGray800, flex: 1 },
                  ]}
                  numberOfLines={1}
                >
                  {requesterInfo.siteName}
                </Text>
              </View>
            )}
            {/* Origin - ALWAYS shown prominently (verified, can't be faked) */}
            <View
              style={{
                backgroundColor: Colors.white,
                borderRadius: 4,
                padding: 8,
                borderWidth: 1,
                borderColor: Colors.textGray200,
                marginBottom: requesterInfo.description ? 8 : 0,
              }}
            >
              <Text
                style={[
                  Fonts.textTiny,
                  { color: Colors.textGray400, marginBottom: 2 },
                ]}
              >
                {t('home:verified_origin')}:
              </Text>
              <Text
                style={[
                  Fonts.textSmall,
                  Fonts.textBold,
                  { fontFamily: 'monospace', color: Colors.textGray800 },
                ]}
                selectable={true}
              >
                {requesterInfo.origin}
              </Text>
            </View>
            {/* Description */}
            {requesterInfo.description && (
              <Text
                style={[
                  Fonts.textSmall,
                  { color: Colors.textGray800 },
                ]}
              >
                {requesterInfo.description}
              </Text>
            )}
          </View>
        )}

        {/* Identity Information */}
        <View style={[Gutters.regularTMargin, Layout.alignItemsCenter]}>
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              { color: Colors.textGray400, marginBottom: 4 },
            ]}
          >
            {t('home:ssp_identity')}:
          </Text>
          <Text
            style={[
              Fonts.textTiny,
              Fonts.textCenter,
              Fonts.textBold,
              {
                fontFamily: 'monospace',
                color: Colors.textGray800,
                lineHeight: 16,
                paddingHorizontal: 20,
              },
            ]}
            selectable={true}
          >
            {truncatedIdentity}
          </Text>
        </View>

        {/* Message to Sign */}
        <View style={[Gutters.regularTMargin, Layout.alignItemsCenter]}>
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              { color: Colors.textGray400, marginBottom: 4 },
            ]}
          >
            {t('home:message_to_sign')}:
          </Text>
        </View>
        <View
          style={[
            {
              height: 100,
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
