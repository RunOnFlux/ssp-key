import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../hooks';
import { Card, ScreenContainer } from '../../components/ui';
import Identicon from '../../components/request/Identicon';
import Authentication from '../../components/Authentication/Authentication';
import Divider from '../../components/Divider/Divider';
import { truncateAddress } from '../../lib/addressDisplay';
import {
  deriveHistoryPassword,
  loadSignHistory,
  clearSignHistory,
  type SignHistoryEntry,
  type SignHistoryType,
} from '../../lib/signHistory';
import { MainScreenProps } from '../../../@types/navigation';

// i18n label + Feather icon per history type. Kept local to the screen — these
// are pure presentation, no crypto/state semantics.
const TYPE_META: Record<SignHistoryType, { i18n: string; icon: string }> = {
  transaction: { i18n: 'history:type_transaction', icon: 'send' },
  evm_message: { i18n: 'history:type_evm_message', icon: 'file-text' },
  wk_message: { i18n: 'history:type_wk_message', icon: 'shield' },
  vault_transaction: { i18n: 'history:type_vault_transaction', icon: 'lock' },
  vault_xpub: { i18n: 'history:type_vault_xpub', icon: 'key' },
  public_nonces: { i18n: 'history:type_public_nonces', icon: 'hash' },
  recovery: { i18n: 'history:type_recovery', icon: 'life-buoy' },
  key_nonce_sync: { i18n: 'history:type_key_nonce_sync', icon: 'refresh-cw' },
};

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

/**
 * HistoryScreen — a local, encrypted, biometric-gated log of every action this
 * SSP Key co-signed (Phase 3 / invariant 4). The data is loaded ONLY after the
 * biometric/PIN gate passes, is decrypted on-device with the existing key
 * material, and is never fetched from or sent to the relay.
 */
function History({ navigation }: MainScreenProps<'History'>) {
  const { t } = useTranslation();
  const { Colors, Fonts, Gutters, Layout } = useTheme();

  // Gate state: the log is invisible until biometrics/PIN succeed.
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<SignHistoryEntry[]>([]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const pw = await deriveHistoryPassword();
      if (!pw) {
        setEntries([]);
        return;
      }
      setEntries(await loadSignHistory(pw));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAuthentication = useCallback(
    (status: boolean) => {
      if (status) {
        setUnlocked(true);
        void loadEntries();
      } else {
        // Failed / cancelled biometric gate — leave without exposing anything.
        navigation.goBack();
      }
    },
    [loadEntries, navigation],
  );

  const handleClear = useCallback(() => {
    Alert.alert(
      t('history:clear_title'),
      t('history:clear_confirm'),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('history:clear_action'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await clearSignHistory();
              setEntries([]);
            })();
          },
        },
      ],
      { cancelable: true },
    );
  }, [t]);

  // Biometric gate — reuse the existing sensitive-auth flow. Nothing renders
  // behind it until it resolves true.
  if (!unlocked) {
    return (
      <ScreenContainer>
        <Authentication
          actionStatus={handleAuthentication}
          type="sensitive"
          biomatricsAllowed={true}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View
        style={[
          Layout.row,
          Layout.justifyContentBetween,
          Layout.alignItemsCenter,
          Gutters.smallHPadding,
          Gutters.smallVPadding,
        ]}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="arrow-left" size={24} color={Colors.textGray400} />
        </TouchableOpacity>
        <Text style={[Fonts.textRegular, Fonts.textBold]}>
          {t('history:title')}
        </Text>
        {entries.length > 0 ? (
          <TouchableOpacity
            onPress={handleClear}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name="trash-2" size={20} color={Colors.textGray400} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 20 }} />
        )}
      </View>
      <Divider color={Colors.textGray200} />

      <Text
        style={[
          Fonts.textTiny,
          Fonts.textCenter,
          Gutters.smallHPadding,
          Gutters.tinyVMargin,
          { color: Colors.textGray400 },
        ]}
      >
        {t('history:local_only_notice')}
      </Text>

      {loading && (
        <View style={[Layout.fill, Layout.colCenter, Gutters.largeTMargin]}>
          <ActivityIndicator size="large" />
        </View>
      )}

      {!loading && entries.length === 0 && (
        <View style={[Layout.fill, Layout.colCenter, Gutters.largeTMargin]}>
          <Icon name="inbox" size={48} color={Colors.textGray400} />
          <Text
            style={[
              Fonts.textRegular,
              Fonts.textCenter,
              Gutters.smallTMargin,
              Gutters.smallHPadding,
            ]}
          >
            {t('history:empty')}
          </Text>
        </View>
      )}

      {!loading && entries.length > 0 && (
        <ScrollView
          contentContainerStyle={[Gutters.smallHPadding, Gutters.smallBPadding]}
          keyboardShouldPersistTaps="always"
        >
          {entries.map((entry) => {
            const meta = TYPE_META[entry.type] ?? {
              i18n: 'history:type_unknown',
              icon: 'file',
            };
            return (
              <Card key={entry.id} style={[Gutters.tinyVMargin]}>
                <View style={[Layout.row, Layout.alignItemsCenter]}>
                  <Icon
                    name={meta.icon}
                    size={20}
                    color={Colors.primary}
                    style={[Gutters.smallRMargin]}
                  />
                  <View style={[Layout.fill]}>
                    <Text style={[Fonts.textSmall, Fonts.textBold]}>
                      {t(meta.i18n)}
                    </Text>
                    <Text
                      style={[Fonts.textTiny, { color: Colors.textGray400 }]}
                    >
                      {formatTimestamp(entry.timestamp)}
                      {entry.chain ? ` · ${entry.chain.toUpperCase()}` : ''}
                    </Text>
                    {entry.ref ? (
                      <Text
                        style={[Fonts.textTiny, { color: Colors.textGray400 }]}
                        numberOfLines={1}
                      >
                        {t('history:ref')}: {truncateAddress(entry.ref)}
                      </Text>
                    ) : null}
                  </View>
                  {entry.wkIdentity ? (
                    <View style={[Layout.alignItemsCenter]}>
                      <Identicon value={entry.wkIdentity} size={28} />
                      <Text
                        style={[
                          Fonts.textTiny,
                          Gutters.tinyTMargin,
                          { color: Colors.textGray400 },
                        ]}
                      >
                        {truncateAddress(entry.wkIdentity, 4)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Card>
            );
          })}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

export default History;
