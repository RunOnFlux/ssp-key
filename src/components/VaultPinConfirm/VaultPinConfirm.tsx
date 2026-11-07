import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react-native';
import { useAppSelector, useTheme } from '../../hooks';
import { blockchains } from '../../storage/blockchains';
import type { cryptos } from '../../types';
import { MONOSPACE_FONT } from '../../lib/typography';
import {
  shortWkIdentity,
  type VaultDescriptor,
} from '../../lib/vaultDescriptor';
import { Card, PrimaryButton } from '../ui';

interface VaultPinConfirmProps {
  /** The verified descriptor of the vault seen for the first time. */
  descriptor: VaultDescriptor;
  /** Name the enterprise app gave the vault (not verified). */
  vaultName?: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

/**
 * VD-3 item 6 — first sight of a vault on this device (trust on first use).
 *
 * Shows what this device verified about the vault: chain, signing mode,
 * M-of-N and every signer's WK identity (short, full value on tap), with the
 * note that future requests must match exactly. Confirming stages the pin;
 * the sign action saves it after verifying this device's own vault key and
 * before it signs. Cancelling refuses the request.
 */
const VaultPinConfirm: React.FC<VaultPinConfirmProps> = ({
  descriptor,
  vaultName,
  onConfirm,
  onCancel,
  disabled,
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors } = useTheme();
  const { sspWalletKeyInternalIdentity } = useAppSelector((state) => state.ssp);
  const [expanded, setExpanded] = useState<string | null>(null);
  const chainConfig = blockchains[descriptor.chain as keyof cryptos];
  const chainDisplay = chainConfig
    ? `${chainConfig.name} (${chainConfig.symbol})`
    : descriptor.chain;

  return (
    <>
      <ScrollView
        style={[Layout.fill, Layout.fullWidth]}
        contentContainerStyle={[
          Layout.alignItemsCenter,
          Gutters.tinyHPadding,
          styles.content,
        ]}
        showsVerticalScrollIndicator={true}
      >
        <ShieldCheck size={36} color={Colors.textGray400} />
        <Text style={[Fonts.textBold, Fonts.textCenter, styles.title]}>
          {t('home:vault_pin_title')}
        </Text>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textCenter,
            styles.info,
            { color: Colors.textGray400 },
          ]}
        >
          {t('home:vault_pin_info')}
        </Text>

        {vaultName ? (
          <Card style={styles.card}>
            <Text style={[styles.label, { color: Colors.textGray400 }]}>
              {t('home:vault_pin_vault_name')}
            </Text>
            <Text style={[Fonts.textSmall, Fonts.textBold]}>{vaultName}</Text>
          </Card>
        ) : null}

        <Card style={styles.card}>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:chain')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold, styles.rowGap]}>
            {chainDisplay}
          </Text>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:vault_pin_mode')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold, styles.rowGap]}>
            {t(`home:vault_pin_mode_${descriptor.signingMode}`)}
          </Text>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:vault_pin_threshold')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold]}>
            {t('home:vault_pin_threshold_value', {
              required: descriptor.requiredSigners,
              total: descriptor.members.length,
            })}
          </Text>
        </Card>

        <Card style={styles.card}>
          <Text style={[styles.label, { color: Colors.textGray400 }]}>
            {t('home:vault_pin_members')}
          </Text>
          {descriptor.members.map((member) => {
            const isOwn = member.wkIdentity === sspWalletKeyInternalIdentity;
            const isExpanded = expanded === member.wkIdentity;
            return (
              <TouchableOpacity
                key={member.wkIdentity}
                accessibilityRole="button"
                accessibilityLabel={member.wkIdentity}
                onPress={() =>
                  setExpanded(isExpanded ? null : member.wkIdentity)
                }
                style={styles.member}
              >
                <Text
                  style={[Fonts.textTiny, Fonts.textBold, styles.mono]}
                  selectable={isExpanded}
                >
                  {isExpanded
                    ? member.wkIdentity
                    : shortWkIdentity(member.wkIdentity)}
                </Text>
                {isOwn ? (
                  <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
                    {t('home:vault_pin_this_device')}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
          <Text
            style={[Fonts.textTiny, styles.hint, { color: Colors.textGray400 }]}
          >
            {t('home:vault_pin_tap_full')}
          </Text>
        </Card>

        <Card style={[styles.card, { borderColor: Colors.warning }]}>
          <Text style={[Fonts.textSmall, Fonts.textBold, Fonts.textCenter]}>
            {t('home:vault_pin_note')}
          </Text>
        </Card>
      </ScrollView>

      <View
        style={[
          Layout.selfStretch,
          Layout.justifyContentEnd,
          Gutters.tinyHMargin,
        ]}
      >
        <PrimaryButton
          label={t('home:vault_pin_confirm')}
          onPress={onConfirm}
          disabled={disabled}
          style={[Gutters.regularBMargin, Gutters.smallTMargin]}
        />
        <TouchableOpacity
          accessibilityRole="button"
          disabled={disabled}
          onPress={onCancel}
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
            {t('home:vault_pin_cancel')}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingTop: 20,
    paddingBottom: 20,
  },
  title: {
    marginTop: 8,
    marginBottom: 4,
  },
  info: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  card: {
    alignSelf: 'stretch',
    marginBottom: 12,
  },
  label: {
    fontSize: 11,
    marginBottom: 2,
  },
  rowGap: {
    marginBottom: 8,
  },
  member: {
    paddingVertical: 6,
  },
  mono: {
    fontFamily: MONOSPACE_FONT,
    lineHeight: 18,
  },
  hint: {
    marginTop: 4,
  },
});

export default VaultPinConfirm;
