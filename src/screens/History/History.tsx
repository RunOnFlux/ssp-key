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
import {
  ArrowLeft,
  Eye,
  EyeOff,
  File,
  FileText,
  Hash,
  Inbox,
  Key,
  LifeBuoy,
  Lock,
  RefreshCw,
  Send,
  Shield,
  Trash2,
  type LucideIcon,
} from 'lucide-react-native';
import { useTheme } from '../../hooks';
import { Card, ScreenContainer } from '../../components/ui';
import Identicon from '../../components/request/Identicon';
import Authentication from '../../components/Authentication/Authentication';
import Divider from '../../components/Divider/Divider';
import { truncateAddress } from '../../lib/addressDisplay';
import { maskSensitive } from '../../lib/privacy';
import { usePrivacyMode } from '../../contexts/PrivacyContext';
import {
  deriveHistoryPassword,
  loadSignHistory,
  clearSignHistory,
  type SignHistoryEntry,
  type SignHistoryType,
} from '../../lib/signHistory';
import { MainScreenProps } from '../../../@types/navigation';

// i18n label + Lucide icon per history type. Kept local to the screen — these
// are pure presentation, no crypto/state semantics.
const TYPE_META: Record<SignHistoryType, { i18n: string; icon: LucideIcon }> = {
  transaction: { i18n: 'history:type_transaction', icon: Send },
  evm_message: { i18n: 'history:type_evm_message', icon: FileText },
  wk_message: { i18n: 'history:type_wk_message', icon: Shield },
  vault_transaction: { i18n: 'history:type_vault_transaction', icon: Lock },
  vault_xpub: { i18n: 'history:type_vault_xpub', icon: Key },
  public_nonces: { i18n: 'history:type_public_nonces', icon: Hash },
  recovery: { i18n: 'history:type_recovery', icon: LifeBuoy },
  key_nonce_sync: { i18n: 'history:type_key_nonce_sync', icon: RefreshCw },
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
  // Privacy mode: masks wallet identities and tx references in this log.
  // Purely presentational — entries themselves are untouched.
  const { hidden, togglePrivacy } = usePrivacyMode();

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
          <ArrowLeft size={24} color={Colors.textGray400} />
        </TouchableOpacity>
        <Text style={[Fonts.textRegular, Fonts.textBold]}>
          {t('history:title')}
        </Text>
        <View style={[Layout.row, Layout.alignItemsCenter]}>
          <TouchableOpacity
            onPress={togglePrivacy}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel={t(
              hidden ? 'history:privacy_show' : 'history:privacy_hide',
            )}
          >
            {hidden ? (
              <EyeOff size={20} color={Colors.textGray400} />
            ) : (
              <Eye size={20} color={Colors.textGray400} />
            )}
          </TouchableOpacity>
          {entries.length > 0 ? (
            <TouchableOpacity
              onPress={handleClear}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={[Gutters.smallLMargin]}
            >
              <Trash2 size={20} color={Colors.textGray400} />
            </TouchableOpacity>
          ) : null}
        </View>
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
          <Inbox size={48} color={Colors.textGray400} />
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
              icon: File,
            };
            const MetaIcon = meta.icon;
            return (
              <Card key={entry.id} style={[Gutters.tinyVMargin]}>
                <View style={[Layout.row, Layout.alignItemsCenter]}>
                  <MetaIcon
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
                        {t('history:ref')}:{' '}
                        {maskSensitive(truncateAddress(entry.ref), hidden)}
                      </Text>
                    ) : null}
                  </View>
                  {entry.wkIdentity ? (
                    // Tap-to-toggle, mirroring the wallet's tap-the-balance
                    // semantics on its sensitive display.
                    <TouchableOpacity
                      style={[Layout.alignItemsCenter]}
                      onPress={togglePrivacy}
                      accessibilityLabel={t(
                        hidden
                          ? 'history:privacy_show'
                          : 'history:privacy_hide',
                      )}
                    >
                      {hidden ? (
                        // The identicon is a visual hash of the identity —
                        // masked too, or it would still identify the wallet.
                        <EyeOff size={28} color={Colors.textGray400} />
                      ) : (
                        <Identicon value={entry.wkIdentity} size={28} />
                      )}
                      <Text
                        style={[
                          Fonts.textTiny,
                          Gutters.tinyTMargin,
                          { color: Colors.textGray400 },
                        ]}
                      >
                        {maskSensitive(
                          truncateAddress(entry.wkIdentity, 4),
                          hidden,
                        )}
                      </Text>
                    </TouchableOpacity>
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
