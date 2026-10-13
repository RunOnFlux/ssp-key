import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { OctagonAlert } from 'lucide-react-native';
import { useTheme } from '../../hooks';
import { cryptos } from '../../types';
import { chainSyncSymbols } from '../../lib/chainSyncRequest';
import VerificationWords from '../VerificationWords/VerificationWords';
import { RiskBanner, SlideToApprove } from '../request';

/**
 * CS-3 — explicit confirmation before a sync REPLACES an existing pairing.
 *
 * Shown instead of silently overwriting a stored wallet xpub with a different
 * one (a relay can deliver a chain-sync request nobody asked for). Nothing has
 * been saved when this screen is up: the verification words of the NEW
 * pairing are computed from this device's own view first, so the user sees
 * them before deciding. Confirm re-runs the sync with the replacement allowed;
 * cancel saves nothing.
 */
const RePairWarning = (props: {
  chains: (keyof cryptos)[];
  words: string[];
  activityStatus: boolean;
  actionStatus: (confirmed: boolean) => void;
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors } = useTheme();

  return (
    <>
      <ScrollView
        style={[Layout.fullWidth]}
        contentContainerStyle={[Layout.alignItemsCenter, Gutters.tinyHPadding]}
      >
        <OctagonAlert size={40} color={Colors.error} />
        <Text
          testID="repair-title"
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            Gutters.smallBMargin,
            { color: Colors.error },
          ]}
        >
          {t('home:repair_title')}
        </Text>
        <Text
          testID="repair-info"
          style={[Fonts.textSmall, Fonts.textCenter, Gutters.smallBMargin]}
        >
          {t('home:repair_info', { symbols: chainSyncSymbols(props.chains) })}
        </Text>
        <RiskBanner
          severity="critical"
          title={t('home:repair_warning_title')}
          messages={[t('home:repair_warning_msg')]}
        />
        <View style={[Layout.selfStretch, Gutters.smallTMargin]}>
          <VerificationWords
            heading={t('home:repair_words_heading')}
            body={t('home:repair_words_body')}
            words={props.words}
          />
        </View>
      </ScrollView>
      <View
        style={[
          Layout.selfStretch,
          Layout.justifyContentEnd,
          Gutters.tinyHMargin,
        ]}
      >
        <SlideToApprove
          label={t('home:repair_confirm')}
          accessibilityLabel={t('home:repair_confirm_a11y')}
          style={[Gutters.regularBMargin, Gutters.smallTMargin]}
          disabled={props.activityStatus}
          loading={props.activityStatus}
          onComplete={() => props.actionStatus(true)}
        />
        <TouchableOpacity
          testID="repair-cancel"
          accessibilityRole="button"
          disabled={props.activityStatus}
          onPress={() => props.actionStatus(false)}
          hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textPrimary,
              Gutters.regularBMargin,
              Fonts.textCenter,
            ]}
          >
            {t('common:cancel')}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );
};

export default RePairWarning;
