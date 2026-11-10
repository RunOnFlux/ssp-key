import React from 'react';
import { View, Text, Modal, ScrollView, StyleSheet } from 'react-native';
import { ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import BlurOverlay from '../../BlurOverlay';
import { Card, PrimaryButton } from '../ui';

/**
 * Shown when an EVM co-sign is refused because SSP Wallet built the user
 * operation around public nonces this Key does not hold (or the Key has none
 * left). Nothing was signed; the cure is a public-nonce sync that SSP Wallet
 * starts (Settings → Advanced → Public Nonces) and this Key approves. Replaces
 * the bare "nonces do not match" toast, which users read as frozen funds.
 */
const PublicNoncesOutOfSync = (props: {
  reason: 'missing' | 'mismatch';
  actionStatus: () => void;
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();

  const path = [
    t('home:public_nonces_help_path_settings'),
    t('home:public_nonces_help_path_advanced'),
    t('home:public_nonces_help_path_nonces'),
  ];
  const steps = [
    t('home:public_nonces_help_step_open'),
    t('home:public_nonces_help_step_sync'),
    t('home:public_nonces_help_step_approve'),
    t('home:public_nonces_help_step_retry'),
  ];

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => props.actionStatus()}
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
            style={[Layout.fill, Layout.fullWidth, Layout.alignItemsCenter]}
          >
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: Colors.circleButtonBackground },
              ]}
            >
              <RefreshCw size={26} color={Colors.circleButtonColor} />
            </View>
            <Text
              accessibilityRole="header"
              style={[
                Fonts.textRegular,
                Fonts.textBold,
                Fonts.textCenter,
                styles.title,
                { color: Colors.textGray800 },
              ]}
            >
              {t('home:public_nonces_help_title')}
            </Text>
            <View
              style={[
                styles.safePill,
                {
                  backgroundColor: 'rgba(34,197,94,0.12)',
                  borderColor: 'rgba(34,197,94,0.35)',
                },
              ]}
            >
              <ShieldCheck size={16} color={Colors.success} />
              <Text
                style={[
                  Fonts.textTinyTiny,
                  Fonts.textBold,
                  styles.safeText,
                  { color: Colors.success },
                ]}
              >
                {t('home:public_nonces_help_safe')}
              </Text>
            </View>
            <Text
              style={[
                Fonts.textTiny,
                Fonts.textCenter,
                styles.explain,
                { color: Colors.textGray400 },
              ]}
            >
              {props.reason === 'missing'
                ? t('home:public_nonces_help_missing')
                : t('home:public_nonces_help_mismatch')}
            </Text>

            <Card style={[Layout.fullWidth, styles.stepsCard]}>
              <Text
                style={[
                  Fonts.textTinyTiny,
                  Fonts.textBold,
                  styles.stepsHeading,
                  { color: Colors.textGray400 },
                ]}
              >
                {t('home:public_nonces_help_how_to_fix')}
              </Text>
              {steps.map((step, i) => (
                <View key={step} style={styles.stepRow}>
                  <View
                    style={[
                      styles.stepBadge,
                      { backgroundColor: Colors.primary },
                    ]}
                  >
                    <Text
                      style={[
                        Fonts.textTinyTiny,
                        Fonts.textBold,
                        { color: Colors.textOnPrimary },
                      ]}
                    >
                      {i + 1}
                    </Text>
                  </View>
                  <View style={styles.stepBody}>
                    <Text
                      style={[Fonts.textTiny, { color: Colors.textGray800 }]}
                    >
                      {step}
                    </Text>
                    {i === 0 && (
                      <View style={styles.pathRow}>
                        {path.map((segment, j) => (
                          <View key={segment} style={styles.pathSegment}>
                            <View
                              style={[
                                styles.chip,
                                {
                                  backgroundColor: Colors.modalBackground,
                                  borderColor: Colors.borderSecondary,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  Fonts.textTinyTiny,
                                  Fonts.textBold,
                                  { color: Colors.textGray800 },
                                ]}
                              >
                                {segment}
                              </Text>
                            </View>
                            {j < path.length - 1 && (
                              <ChevronRight
                                size={14}
                                color={Colors.textGray200}
                              />
                            )}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </Card>
          </View>
          <View style={[Layout.justifyContentEnd]}>
            <PrimaryButton
              label={t('home:public_nonces_help_ok')}
              style={[Gutters.regularBMargin, Gutters.regularTMargin]}
              onPress={() => props.actionStatus()}
            />
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  title: {
    marginTop: 12,
  },
  safePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  safeText: {
    marginLeft: 6,
  },
  explain: {
    marginTop: 12,
    lineHeight: 20,
  },
  stepsCard: {
    marginTop: 16,
    padding: 16,
  },
  stepsHeading: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 1,
  },
  stepBody: {
    flex: 1,
  },
  pathRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 8,
  },
  pathSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginRight: 4,
  },
});

export default PublicNoncesOutOfSync;
