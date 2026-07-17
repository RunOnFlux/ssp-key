import React from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Key, Pointer, QrCode } from 'lucide-react-native';
import { useTheme } from '../../../hooks';
import PillarMark from '../../../components/PillarMark/PillarMark';

/**
 * The idle (no pending action) section of the Home screen: receive link,
 * key icon with sync-needed / no-pending-actions message, refresh control
 * and the scan button. JSX relocated verbatim from Home.tsx; the outer
 * visibility gate (no request in flight) stays in Home.
 */
const HomeIdle = (props: {
  sspWalletKeyInternalIdentity: string;
  sspWalletInternalIdentity: string;
  isRefreshing: boolean;
  openReceive: () => void;
  handleRefresh: () => void;
  scanCode: () => void;
}) => {
  const {
    sspWalletKeyInternalIdentity,
    sspWalletInternalIdentity,
    isRefreshing,
    openReceive,
    handleRefresh,
    scanCode,
  } = props;
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();

  return (
    <>
      <TouchableOpacity
        onPress={() => openReceive()}
        style={[Layout.row, { height: 30, marginTop: -30 }]}
      >
        <QrCode size={30} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textBold,
            Gutters.tinyTinyTMargin,
            Gutters.tinyTinyLMargin,
          ]}
        >
          {t('common:receive')}
        </Text>
      </TouchableOpacity>
      <View
        style={[
          Layout.fill,
          Layout.relative,
          Layout.fullWidth,
          Layout.justifyContentCenter,
          Layout.alignItemsCenter,
        ]}
      >
        <Key size={60} color={Colors.textGray400} />
        <Text style={[Fonts.textBold, Fonts.textRegular, Gutters.smallMargin]}>
          {!sspWalletKeyInternalIdentity || !sspWalletInternalIdentity ? (
            <>{t('home:sync_needed')}!</>
          ) : (
            t('home:no_pending_actions')
          )}
        </Text>
        {(!sspWalletKeyInternalIdentity || !sspWalletInternalIdentity) && (
          <>
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textCenter,
                Gutters.smallLMargin,
                Gutters.smallRMargin,
              ]}
            >
              {t('home:sync_qr_needed')}
            </Text>
            <TouchableOpacity
              onPress={() => Linking.openURL('https://sspwallet.io/guide')}
            >
              <Text
                style={[
                  Fonts.textTiny,
                  Fonts.textCenter,
                  Gutters.regularTMargin,
                  Gutters.smallLMargin,
                  Gutters.smallRMargin,
                ]}
              >
                {t('home:dont_have_ssp_wallet')}
              </Text>
            </TouchableOpacity>
          </>
        )}
        {isRefreshing && (
          <PillarMark size={30} pulse={true} style={Gutters.regularVMargin} />
        )}
        {!isRefreshing && (
          <TouchableOpacity
            onPress={() => handleRefresh()}
            style={[Layout.row, Gutters.regularVMargin, { height: 30 }]}
          >
            <Pointer size={30} color={Colors.primary} />
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textBold,
                Fonts.textPrimary,
                Gutters.tinyTMargin,
                Gutters.tinyLMargin,
              ]}
            >
              {t('common:refresh')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <View>
        <TouchableOpacity
          style={[
            Common.button.outlineRounded,
            Common.button.secondaryButton,
            Gutters.smallBMargin,
          ]}
          onPress={() => scanCode()}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textPrimary,
              Gutters.regularHPadding,
            ]}
          >
            {t('home:scan_code')}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );
};

export default HomeIdle;
