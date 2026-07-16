import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Authentication from '../Authentication/Authentication';

import { blockchains } from '@storage/blockchains';

import { cryptos } from '../../types';
import { chainSyncSymbols } from '../../lib/chainSyncRequest';

import {
  RequestHeader,
  ActionCard,
  RiskBanner,
  SlideToApprove,
} from '../request';
import { Card } from '../ui';

/**
 * Batch chain activation approval — ONE approval naming all requested
 * chains. On approve (slide + Authentication) the caller derives each
 * chain's xpub sequentially with visible progress and answers through the
 * existing per-chain sync mechanism.
 */
const ChainSyncRequest = (props: {
  chains: (keyof cryptos)[];
  identity?: string;
  activityStatus: boolean;
  actionStatus: (status: boolean) => void;
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);

  const approve = () => {
    props.actionStatus(true);
  };
  const openAuthentication = () => {
    setAuthenticationOpen(true);
  };
  const reject = () => {
    props.actionStatus(false);
  };

  const handleAuthenticationOpen = (status: boolean) => {
    setAuthenticationOpen(false);
    if (status === true) {
      approve();
    }
  };

  return (
    <>
      <ScrollView
        style={[Layout.fullWidth]}
        contentContainerStyle={[Layout.alignItemsCenter]}
      >
        <RequestHeader
          title={t('home:chainsync_request')}
          identity={props.identity}
        />
        <ActionCard
          action={t('home:chainsync_action', {
            count: props.chains.length,
            symbols: chainSyncSymbols(props.chains),
          })}
        />
        <Card style={styles.chainListCard}>
          {props.chains.map((chain) => {
            const config = blockchains[chain];
            return (
              <View key={String(chain)} style={styles.chainRow}>
                <Text style={[Fonts.textTiny, Fonts.textBold]}>
                  {config?.symbol ?? String(chain)}
                </Text>
                <Text
                  style={[
                    Fonts.textTiny,
                    { color: Colors.textGray400, marginLeft: 8, flexShrink: 1 },
                  ]}
                  numberOfLines={1}
                >
                  {config?.name ?? ''}
                </Text>
              </View>
            );
          })}
        </Card>
        <RiskBanner
          severity="info"
          title={t('home:chainsync_info_title')}
          messages={[t('home:chainsync_info_msg')]}
        />
      </ScrollView>
      <View style={[Layout.justifyContentEnd]}>
        <SlideToApprove
          label={t('home:slide_to_approve')}
          accessibilityLabel={t('home:approve_chainsync')}
          style={[Gutters.regularBMargin, Gutters.smallTMargin]}
          disabled={authenticationOpen || props.activityStatus}
          loading={authenticationOpen || props.activityStatus}
          onComplete={() => openAuthentication()}
        />
        <TouchableOpacity
          accessibilityRole="button"
          disabled={authenticationOpen || props.activityStatus}
          onPress={() => reject()}
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
            {t('home:reject')}
          </Text>
        </TouchableOpacity>
      </View>
      {authenticationOpen && (
        <Authentication
          actionStatus={handleAuthenticationOpen}
          type="sync"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  chainListCard: {
    width: '90%',
    marginBottom: 12,
  },
  chainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
});

export default ChainSyncRequest;
