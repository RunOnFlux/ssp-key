import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TouchableWithoutFeedback,
  StyleSheet,
} from 'react-native';
import {
  ClipboardPen,
  KeyRound,
  RotateCcw,
  Settings,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import BlurOverlay from '../../BlurOverlay';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * The Home overflow menu — icon + left-aligned label rows (mirrors the
 * wallet's tidied menu), 44pt touch targets, popover card from the theme.
 */
const MenuModal = (props: { actionStatus: (data: string) => void }) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Layout, Common, Colors } = useTheme();

  const items: { key: string; label: string; icon: LucideIcon }[] = [
    { key: 'manualinput', label: t('home:manual_input'), icon: ClipboardPen },
    {
      key: 'addressdetails',
      label: t('home:synced_ssp_address'),
      icon: Wallet,
    },
    { key: 'sspkeydetails', label: t('home:ssp_key_details'), icon: KeyRound },
    { key: 'menusettings', label: t('common:settings'), icon: Settings },
    { key: 'restore', label: t('common:restore'), icon: RotateCcw },
  ];

  const handleCancel = () => {
    props.actionStatus('cancel');
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={() => {
        handleCancel();
      }}
      transparent={true}
      visible={true}
    >
      <BlurOverlay />
      <TouchableWithoutFeedback
        onPress={() => {
          handleCancel();
        }}
      >
        <SafeAreaView style={[Layout.fill]}>
          <View>
            <View style={[Common.modalMenu, styles.menu]}>
              {items.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <TouchableOpacity
                    key={item.key}
                    accessibilityRole="menuitem"
                    accessibilityLabel={item.label}
                    onPress={() => props.actionStatus(item.key)}
                    style={styles.row}
                  >
                    <ItemIcon size={18} color={Colors.textGray400} />
                    <Text
                      style={[
                        Fonts.textSmall,
                        styles.rowLabel,
                        { color: Colors.textGray800 },
                      ]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </SafeAreaView>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  menu: {
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  rowLabel: {
    marginLeft: 12,
    flexShrink: 1,
  },
});

export default MenuModal;
