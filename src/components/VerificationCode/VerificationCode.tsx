import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { CircleCheck, Shield, TriangleAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { useTheme } from '../../hooks';
import { changeTheme } from '../../store/theme';
import BlurOverlay from '../../BlurOverlay';
import VerificationWords from '../VerificationWords/VerificationWords';
import Scanner from '../Scanner/Scanner';
import { verificationMatches } from '../../lib/pairingVerification';

/**
 * Unified pairing verification screen — shows the ONE out-of-band verification
 * code covering every chain synced this session so the user can confirm it
 * matches the same code on SSP Wallet.
 *
 * Two ways to verify, both out-of-band:
 *   1. Scan-to-verify (frictionless): scan the wallet's verification QR; this
 *      device recomputes its OWN code and compares locally (string equality).
 *      A clear ✓/✗ result gives the user a trustworthy signal.
 *   2. Manual: eyeball the 6 words against the wallet.
 * The comparison is device-local (no relay). SSP Wallet is where continuation
 * is gated. NEVER log the words or the scanned payload.
 */
const VerificationCode = (props: {
  words: string[];
  actionStatus: (status: boolean) => void;
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const dispatch = useDispatch();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<'match' | 'mismatch' | null>(null);

  const close = () => {
    props.actionStatus(false);
  };

  // Scanner forces darkMode: true on mount and the theme slice is
  // redux-persisted — without this restore (the same one Home's scanner
  // paths do) a light-theme user would be stuck in dark mode for good.
  const restoreTheme = () => {
    dispatch(changeTheme({ theme: 'default', darkMode: null }));
  };

  const onScanned = (scanned: string) => {
    setScanning(false);
    restoreTheme();
    // Recompute-free local check: compare the scanned wallet code against THIS
    // device's own words. Equal ⇒ the two devices derived the same keys.
    setResult(verificationMatches(props.words, scanned) ? 'match' : 'mismatch');
  };

  if (scanning) {
    // Full-screen Modal so the camera surface covers the viewport — rendered
    // inline it would only fill Home's inner scroll content view.
    return (
      <Modal
        animationType="fade"
        transparent={false}
        visible={true}
        onRequestClose={() => {
          setScanning(false);
          restoreTheme();
        }}
      >
        <Scanner
          onRead={onScanned}
          onClose={() => {
            setScanning(false);
            restoreTheme();
          }}
        />
      </Modal>
    );
  }

  const resultBanner =
    result === 'match' ? (
      <View
        style={[
          styles.banner,
          { backgroundColor: Colors.success },
          Gutters.smallBMargin,
        ]}
        accessibilityLiveRegion="polite"
      >
        <CircleCheck size={22} color={Colors.textOnPrimary} />
        <Text
          style={[
            Fonts.textSmall,
            styles.bannerText,
            { color: Colors.textOnPrimary },
          ]}
        >
          {t('home:verify_scan_match')}
        </Text>
      </View>
    ) : result === 'mismatch' ? (
      <View
        style={[
          styles.banner,
          { backgroundColor: Colors.error },
          Gutters.smallBMargin,
        ]}
        accessibilityLiveRegion="assertive"
      >
        {/* Black on #EF4444 (5.6:1) — white fails AA at 3.76:1. Matches the
            match banner (black on green) and the black-on-amber rule family. */}
        <TriangleAlert size={22} color={Colors.textOnPrimary} />
        <Text
          style={[
            Fonts.textSmall,
            styles.bannerText,
            { color: Colors.textOnPrimary },
          ]}
        >
          {t('home:verify_scan_mismatch')}
        </Text>
      </View>
    ) : null;

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => close()}
    >
      <BlurOverlay />
      <ScrollView
        keyboardShouldPersistTaps="always"
        style={[Layout.fill, Common.modalBackdrop]}
        contentInset={{ bottom: 80 }}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
        ]}
      >
        <View style={[Layout.fill, Common.modalView]}>
          <View
            style={[
              Layout.fill,
              Layout.relative,
              Layout.fullWidth,
              Layout.justifyContentCenter,
              Layout.alignItemsCenter,
            ]}
          >
            <Shield size={60} color={Colors.textGray400} />
            <View style={[Gutters.smallTMargin, { width: '100%' }]}>
              <VerificationWords
                heading={t('home:verify_words_heading_key')}
                body={t('home:verify_words_body_key')}
                words={props.words}
              />
            </View>
          </View>
          <View style={[Layout.justifyContentEnd, Layout.fullWidth]}>
            {resultBanner}
            <TouchableOpacity
              accessibilityRole="button"
              style={[
                Common.button.rounded,
                Common.button.outline,
                Gutters.smallBMargin,
              ]}
              onPress={() => {
                setResult(null);
                setScanning(true);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
            >
              <Text style={[Fonts.textRegular, Fonts.textPrimary]}>
                {t('home:verify_scan_button')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              style={[
                Common.button.rounded,
                Common.button.primary,
                Gutters.regularBMargin,
              ]}
              onPress={() => close()}
              hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
            >
              <Text style={[Fonts.textRegular, Fonts.textOnPrimary]}>
                {t('home:verify_words_done')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  bannerText: {
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
  },
});

export default VerificationCode;
