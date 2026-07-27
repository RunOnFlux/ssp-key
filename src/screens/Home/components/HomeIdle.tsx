import React from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Key, QrCode, RefreshCw } from 'lucide-react-native';
import { useTheme } from '../../../hooks';
import PillarMark from '../../../components/PillarMark/PillarMark';
import BackupCheckupCard from '../../../components/BackupCheckupCard/BackupCheckupCard';
import { PrimaryButton } from '../../../components/ui';

/** Matches the Navbar's glyph touch targets — 30pt rows reach 44pt with this. */
const ICON_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

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
  const { Fonts, Gutters, Layout, Colors, darkMode } = useTheme();
  // Amber accent for text/glyphs sitting directly on the page fill. Brand amber
  // is only 1.6:1 there in light mode, so light uses the deep amber step
  // (6.8:1) and dark keeps the brand amber (11.8:1).
  const accent = darkMode ? Colors.primary : Colors.circleButtonColor;

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('common:receive')}
        onPress={() => openReceive()}
        hitSlop={ICON_HIT_SLOP}
        style={[
          Layout.row,
          Layout.alignItemsCenter,
          { height: 30, marginTop: -30 },
        ]}
      >
        <QrCode size={20} color={Colors.textGray400} />
        <Text
          style={[Fonts.textSmall, Fonts.textBold, Gutters.tinyTinyLMargin]}
        >
          {t('common:receive')}
        </Text>
      </TouchableOpacity>
      {/* Periodic backup checkup — routine, due-gated; hidden by default. */}
      <BackupCheckupCard />
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
        {/* Screen heading — the title color token, so every H1 in the app
            reads in one color instead of the body-copy gray. */}
        <Text
          style={[
            Fonts.textBold,
            Fonts.textRegular,
            Gutters.smallMargin,
            { color: Colors.textGray800 },
          ]}
        >
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
              accessibilityRole="link"
              accessibilityLabel={t('home:dont_have_ssp_wallet')}
              hitSlop={ICON_HIT_SLOP}
              onPress={() => Linking.openURL('https://sspwallet.io/guide')}
            >
              {/* Opens an external guide — link color + underline so it does
                  not read as one more line of body copy. */}
              <Text
                style={[
                  Fonts.textTinyTiny,
                  Fonts.textCenter,
                  Gutters.regularTMargin,
                  Gutters.smallLMargin,
                  Gutters.smallRMargin,
                  { color: accent, textDecorationLine: 'underline' },
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
            accessibilityRole="button"
            accessibilityLabel={t('common:refresh')}
            onPress={() => handleRefresh()}
            hitSlop={ICON_HIT_SLOP}
            style={[
              Layout.row,
              Layout.alignItemsCenter,
              Gutters.regularVMargin,
              { height: 30 },
            ]}
          >
            {/* RefreshCw is the app's reload glyph (History, nonce sync,
                recovery) — a pointing hand reads as "tap here", not "reload". */}
            <RefreshCw size={20} color={accent} />
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textBold,
                Gutters.tinyLMargin,
                { color: accent },
              ]}
            >
              {t('common:refresh')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      {/* Same action, same hierarchy as the Sync Needed sheet: the shared
          primary primitive, so padding and a11y traits come from one place. */}
      <View style={[Layout.fullWidth, Gutters.regularHPadding]}>
        <PrimaryButton
          label={t('home:scan_code')}
          style={Gutters.smallBMargin}
          onPress={() => scanCode()}
        />
      </View>
    </>
  );
};

export default HomeIdle;
