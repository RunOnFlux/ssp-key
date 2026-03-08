import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Icon from 'react-native-vector-icons/Feather';

interface KeyNonceSyncRequestProps {
  activityStatus: boolean;
  actionStatus: (status: boolean) => void;
}

const KeyNonceSyncRequest: React.FC<KeyNonceSyncRequestProps> = ({
  activityStatus,
  actionStatus,
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();

  return (
    <View
      style={[
        Layout.fill,
        Layout.relative,
        Layout.fullWidth,
        Layout.justifyContentCenter,
        Layout.alignItemsCenter,
      ]}
    >
      <Icon name="refresh-cw" size={40} color={Colors.textGray400} />
      <Text
        style={[
          Fonts.textBold,
          Fonts.textCenter,
          Fonts.textRegular,
          Gutters.smallTMargin,
          Gutters.smallBMargin,
        ]}
      >
        {t('home:enterprise_nonce_sync_request')}
      </Text>
      <Text
        style={[
          Fonts.textSmall,
          Fonts.textCenter,
          Gutters.regularLMargin,
          Gutters.regularRMargin,
        ]}
      >
        {t('home:enterprise_nonce_sync_request_info')}
      </Text>

      <View
        style={[
          Layout.justifyContentEnd,
          Gutters.regularLMargin,
          Gutters.regularRMargin,
          Gutters.regularTMargin,
          Layout.fullWidth,
        ]}
      >
        <TouchableOpacity
          style={[
            Common.button.rounded,
            Common.button.bluePrimary,
            Gutters.regularBMargin,
            Gutters.smallTMargin,
          ]}
          disabled={activityStatus}
          onPressIn={() => actionStatus(true)}
        >
          {activityStatus && (
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
          disabled={activityStatus}
          onPressIn={() => actionStatus(false)}
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
    </View>
  );
};

export default KeyNonceSyncRequest;
