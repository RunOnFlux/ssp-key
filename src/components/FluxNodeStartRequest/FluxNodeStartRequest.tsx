import React, { useEffect, useRef, useState } from 'react';
import { MONOSPACE_FONT } from '../../lib/typography';
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
import { Server } from 'lucide-react-native';
import { blockchains } from '../../storage/blockchains';
import type { cryptos } from '../../types';

import { SlideToApprove } from '../request';
import { Card } from '../ui';
import VaultPinConfirm from '../VaultPinConfirm/VaultPinConfirm';
import {
  isVaultPinStaged,
  readVaultVerdict,
  stageVaultPinConfirmation,
  useVaultPinStoreVersion,
} from '../../lib/vaultPins';
import {
  fluxNodeFingerprint,
  setVaultRejectionCode,
  vaultRejectionCode,
  type VaultDescriptorVerdict,
} from '../../lib/vaultDescriptorGate';
interface FluxNodeStartRequestProps {
  activityStatus: boolean;
  chain: string;
  nodeName: string;
  collateralAmount: string;
  collateralAddress?: string;
  collateralTxid?: string;
  collateralVout?: number;
  delegates: string[];
  actionStatus: (status: boolean) => void;
}

const FluxNodeStartRequest: React.FC<FluxNodeStartRequestProps> = ({
  activityStatus,
  chain,
  nodeName,
  collateralAmount,
  collateralAddress,
  collateralTxid,
  collateralVout,
  delegates,
  actionStatus,
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const chainConfig = blockchains[chain as keyof cryptos];
  const chainDisplay = chainConfig
    ? `${chainConfig.name} (${chainConfig.symbol})`
    : chain;

  const amountFlux = collateralAmount
    ? (parseInt(collateralAmount, 10) / 1e8).toFixed(2)
    : '?';

  const utxoDisplay = collateralTxid
    ? `${collateralTxid.slice(0, 10)}…${collateralTxid.slice(-8)}:${collateralVout ?? 0}`
    : '';

  const cardStyle = {
    backgroundColor: Colors.inputBackground,
    borderRadius: 8,
    padding: 12,
    // Screen owns the side gutter — see request/ActionCard.
    alignSelf: 'stretch' as const,
    marginHorizontal: 10,
    borderWidth: 1,
    borderColor: Colors.textGray200,
  };

  // The request on screen when the user started approving. A request the
  // relay swaps in while authentication is open closes it and is never
  // approved unseen (CHN-5 pattern).
  const shownRequest = JSON.stringify([
    chain,
    nodeName,
    collateralAmount,
    collateralAddress,
    collateralTxid,
    collateralVout,
    delegates,
  ]);
  const approvingRequest = useRef<string | undefined>(undefined);

  // VD-3 / VD-4: the vault descriptor verdict published when this request
  // arrived. No verdict, a refusal (including a collateral that is not the
  // vault's address), or an unconfirmed first-sight vault blocks approval.
  useVaultPinStoreVersion();
  const verdict = readVaultVerdict<VaultDescriptorVerdict>(
    'fluxnode',
    fluxNodeFingerprint({
      chain,
      nodeName,
      collateralAmount,
      collateralAddress,
      collateralTxid,
      collateralVout,
      delegates,
    }),
  );
  const pinToConfirm =
    verdict?.kind === 'needs_pin' &&
    !isVaultPinStaged(verdict.pinKey, verdict.hash)
      ? verdict
      : null;
  const descriptorRefused = verdict?.kind === 'refused' ? verdict : null;
  const approvalBlocked = !verdict || !!descriptorRefused || !!pinToConfirm;
  useEffect(() => {
    if (
      approvingRequest.current !== undefined &&
      approvingRequest.current !== shownRequest
    ) {
      approvingRequest.current = undefined;
      setAuthenticationOpen(false);
    }
  }, [shownRequest]);

  const approve = () => {
    const approving = approvingRequest.current;
    approvingRequest.current = undefined;
    if (approving !== shownRequest || approvalBlocked) {
      return;
    }
    actionStatus(true);
  };

  const openAuthentication = () => {
    if (approvalBlocked) {
      return;
    }
    approvingRequest.current = shownRequest;
    setAuthenticationOpen(true);
  };

  const reject = () => {
    approvingRequest.current = undefined;
    setVaultRejectionCode(
      descriptorRefused ? vaultRejectionCode(descriptorRefused.code) : null,
    );
    actionStatus(false);
  };

  const declinePin = () => {
    approvingRequest.current = undefined;
    setVaultRejectionCode('VAULT_PIN_REFUSED');
    actionStatus(false);
  };

  const handleAuthenticationOpen = (status: boolean) => {
    setAuthenticationOpen(false);
    if (status === true) {
      approve();
    } else {
      approvingRequest.current = undefined;
    }
  };

  if (pinToConfirm) {
    return (
      <VaultPinConfirm
        descriptor={pinToConfirm.descriptor}
        disabled={activityStatus}
        onConfirm={() =>
          stageVaultPinConfirmation(pinToConfirm.pinKey, pinToConfirm.hash)
        }
        onCancel={() => declinePin()}
      />
    );
  }

  return (
    <>
      <ScrollView
        style={[Layout.fill, Layout.fullWidth]}
        contentContainerStyle={[
          Layout.alignItemsCenter,
          { paddingTop: 20, paddingBottom: 20 },
        ]}
        showsVerticalScrollIndicator={true}
      >
        {/* Header */}
        <Server size={36} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            { marginTop: 8, marginBottom: 4 },
          ]}
        >
          {t('home:flux_node_start_title')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            {
              color: Colors.textGray400,
              paddingHorizontal: 24,
              marginBottom: 16,
            },
          ]}
        >
          {t('home:flux_node_start_info')}
        </Text>

        {/* VD-3: vault descriptor refused — approval is hard-blocked */}
        {descriptorRefused ? (
          <Card style={[styles.blockCard, { borderColor: Colors.error }]}>
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textBold,
                { color: Colors.error, textAlign: 'center' },
              ]}
            >
              {descriptorRefused.code === 'missing'
                ? t('home:vault_descriptor_missing_title')
                : descriptorRefused.code === 'mismatch'
                  ? t('home:vault_descriptor_changed_title')
                  : t('home:vault_descriptor_invalid_title')}
            </Text>
            <Text
              style={[
                Fonts.textTiny,
                { color: Colors.error, textAlign: 'center', marginTop: 4 },
              ]}
            >
              {descriptorRefused.code === 'missing'
                ? t('home:vault_descriptor_missing_info')
                : descriptorRefused.code === 'mismatch'
                  ? t('home:vault_descriptor_changed_info')
                  : descriptorRefused.reason}
            </Text>
          </Card>
        ) : null}

        {/* Node Name Card */}
        <View style={[cardStyle, { marginBottom: 12 }]}>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:flux_node_start_node')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold]}>
            {nodeName || 'Unknown'}
          </Text>
        </View>

        {/* Chain Card */}
        <View style={[cardStyle, { marginBottom: 12 }]}>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:flux_node_start_chain')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold]} selectable={true}>
            {chainDisplay}
          </Text>
        </View>

        {/* Collateral Card */}
        <View style={[cardStyle, { marginBottom: 12 }]}>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:flux_node_start_collateral')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold]}>
            {amountFlux} FLUX
          </Text>
        </View>

        {/* Collateral Address Card */}
        {!!collateralAddress && (
          <View style={[cardStyle, { marginBottom: 12 }]}>
            <Text style={[styles.label, { color: Colors.textGray400 }]}>
              {t('home:flux_node_start_collateral_address')}
            </Text>
            <Text
              style={[Fonts.textSmall, Fonts.textBold, styles.mono]}
              selectable={true}
            >
              {collateralAddress}
            </Text>
          </View>
        )}

        {/* Collateral UTXO Card */}
        {!!utxoDisplay && (
          <View style={[cardStyle, { marginBottom: 12 }]}>
            <Text style={[styles.label, { color: Colors.textGray400 }]}>
              {t('home:flux_node_start_collateral_utxo')}
            </Text>
            <Text
              style={[Fonts.textSmall, Fonts.textBold, styles.mono]}
              selectable={true}
            >
              {utxoDisplay}
            </Text>
          </View>
        )}

        {/* Delegates Card */}
        {delegates.length > 0 && (
          <View style={[cardStyle, { marginBottom: 12 }]}>
            <Text style={[styles.label, { color: Colors.textGray400 }]}>
              {t('home:flux_node_start_delegates')}
            </Text>
            <Text style={[Fonts.textSmall, Fonts.textBold]}>
              {delegates.length}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Action Buttons */}
      <View
        style={[
          Layout.selfStretch,
          Layout.justifyContentEnd,
          Gutters.tinyHMargin,
        ]}
      >
        <SlideToApprove
          label={t('home:slide_to_approve')}
          accessibilityLabel={t('home:approve_request')}
          style={[
            Gutters.regularBMargin,
            Gutters.smallTMargin,
            approvalBlocked ? { opacity: 0.4 } : {},
          ]}
          disabled={authenticationOpen || activityStatus || approvalBlocked}
          loading={authenticationOpen || activityStatus}
          onComplete={() => openAuthentication()}
        />
        <TouchableOpacity
          accessibilityRole="button"
          disabled={authenticationOpen || activityStatus}
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
          type="fluxnodestart"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    marginBottom: 2,
  },
  mono: {
    fontFamily: MONOSPACE_FONT,
  },
  blockCard: {
    alignSelf: 'stretch',
    marginHorizontal: 10,
    marginBottom: 12,
  },
});

export default FluxNodeStartRequest;
