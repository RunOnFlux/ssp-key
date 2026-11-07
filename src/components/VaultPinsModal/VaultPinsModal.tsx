import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import Toast from 'react-native-toast-message';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import BlurOverlay from '../../BlurOverlay';
import Authentication from '../Authentication/Authentication';
import { Card, DangerButton } from '../ui';
import { blockchains } from '../../storage/blockchains';
import type { cryptos } from '../../types';
import {
  readVaultPins,
  resetAllVaultPins,
  resetVaultPin,
  useVaultPinStoreVersion,
  type VaultPinRecord,
} from '../../lib/vaultPins';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** What is being reset: one vault's pin, or every pin. */
type ResetTarget = { kind: 'one'; pinKey: string } | { kind: 'all' };

/**
 * Settings → Security → Vault pins (VD-3 item 6).
 *
 * Lists the vaults confirmed on this device. "Reset vault pin" is the only
 * way to accept a changed vault configuration: it sits behind a confirmation
 * and the device password / biometrics, and the next request for that vault
 * asks the user to confirm its signers again.
 */
function VaultPinsModal({ open, onClose }: Props) {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Common, Colors } = useTheme();
  useVaultPinStoreVersion();
  const [confirming, setConfirming] = useState<ResetTarget | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  if (!open) return null;

  let pins: VaultPinRecord[] = [];
  let unreadable = false;
  try {
    pins = Object.values(readVaultPins()).sort(
      (a, b) => b.pinnedAt - a.pinnedAt,
    );
  } catch {
    unreadable = true;
  }

  const close = () => {
    setConfirming(null);
    setAuthOpen(false);
    onClose();
  };

  const handleAuth = (status: boolean) => {
    setAuthOpen(false);
    const target = confirming;
    setConfirming(null);
    if (!status || !target) {
      return;
    }
    try {
      if (target.kind === 'all') {
        resetAllVaultPins();
      } else {
        resetVaultPin(target.pinKey);
      }
      Toast.show({ type: 'success', text1: t('home:vault_pins_reset_done') });
    } catch {
      Toast.show({ type: 'error', text1: t('home:vault_pins_unreadable') });
    }
  };

  if (authOpen) {
    return (
      <Authentication
        actionStatus={handleAuth}
        type="sensitive"
        biomatricsAllowed={true}
      />
    );
  }

  const chainName = (chain: string) =>
    blockchains[chain as keyof cryptos]?.name ?? chain;

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => close()}
    >
      <BlurOverlay />
      <ScrollView
        style={[Layout.fill, Common.modalBackdrop]}
        contentInset={{ bottom: 80 }}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
        ]}
      >
        <View style={[Layout.fill, Common.modalView]}>
          <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
            {confirming
              ? confirming.kind === 'all'
                ? t('home:vault_pins_reset_all')
                : t('home:vault_pins_reset_confirm_title')
              : t('home:vault_pins_title')}
          </Text>
          {confirming ? (
            <>
              <Text
                style={[
                  Fonts.textSmall,
                  Fonts.textCenter,
                  Gutters.regularTMargin,
                  { color: Colors.textGray400 },
                ]}
              >
                {confirming.kind === 'all'
                  ? t('home:vault_pins_reset_all_confirm')
                  : t('home:vault_pins_reset_confirm')}
              </Text>
              <DangerButton
                label={
                  confirming.kind === 'all'
                    ? t('home:vault_pins_reset_all')
                    : t('home:vault_pins_reset')
                }
                onPress={() => setAuthOpen(true)}
                style={[Gutters.regularTMargin]}
              />
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setConfirming(null)}
                hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
                style={[Gutters.regularTMargin]}
              >
                <Text
                  style={[Fonts.textSmall, Fonts.textPrimary, Fonts.textCenter]}
                >
                  {t('common:cancel')}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text
                style={[
                  Fonts.textSmall,
                  Fonts.textCenter,
                  Gutters.smallTMargin,
                  Gutters.regularBMargin,
                  { color: Colors.textGray400 },
                ]}
              >
                {t('home:vault_pins_info')}
              </Text>
              {unreadable ? (
                <>
                  <Text
                    style={[Fonts.textSmall, Fonts.textCenter, Fonts.textError]}
                  >
                    {t('home:vault_pins_unreadable')}
                  </Text>
                  <DangerButton
                    label={t('home:vault_pins_reset_all')}
                    onPress={() => setConfirming({ kind: 'all' })}
                    style={[Gutters.regularTMargin]}
                  />
                </>
              ) : pins.length === 0 ? (
                <Text
                  style={[
                    Fonts.textSmall,
                    Fonts.textCenter,
                    { color: Colors.textGray400 },
                  ]}
                >
                  {t('home:vault_pins_empty')}
                </Text>
              ) : (
                pins.map((pin) => {
                  const key = `${pin.orgId}:${pin.vaultId}`;
                  return (
                    <Card key={key} style={{ marginBottom: 10 }}>
                      <Text style={[Fonts.textSmall, Fonts.textBold]}>
                        {pin.vaultName || pin.vaultId}
                      </Text>
                      <Text
                        style={[Fonts.textTiny, { color: Colors.textGray400 }]}
                      >
                        {`${chainName(pin.chain)} · ${t(
                          'home:vault_pin_threshold_value',
                          {
                            required: pin.requiredSigners,
                            total: pin.totalSigners,
                          },
                        )}`}
                      </Text>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={t('home:vault_pins_reset')}
                        onPress={() =>
                          setConfirming({ kind: 'one', pinKey: key })
                        }
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{ marginTop: 8 }}
                      >
                        <Text style={[Fonts.textSmall, Fonts.textError]}>
                          {t('home:vault_pins_reset')}
                        </Text>
                      </TouchableOpacity>
                    </Card>
                  );
                })
              )}
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => close()}
                hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
                style={[Gutters.regularTMargin]}
              >
                <Text
                  style={[Fonts.textSmall, Fonts.textPrimary, Fonts.textCenter]}
                >
                  {t('home:vault_pins_close')}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </Modal>
  );
}

export default VaultPinsModal;
