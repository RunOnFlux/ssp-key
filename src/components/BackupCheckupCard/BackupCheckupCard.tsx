import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TriangleAlert, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useTheme } from '../../hooks';
import {
  snoozeBackupCheckup,
  useIsBackupCheckupDue,
} from '../../contexts/BackupCheckupContext';
import VerifyBackupModal from '../VerifyBackup/VerifyBackupModal';

/**
 * Periodic backup checkup — a routine reminder, not an accusation. Ported from
 * ssp-wallet's BackupHealthCard, adapted to the Key: PURE SECURITY copy with NO
 * balance/fiat (the Key shows no balances anywhere). Hidden by default; appears
 * only when the install has no recorded verification at all (upgraded installs
 * show it immediately) or when 30 days have elapsed since the last successful
 * one (cycle logic in lib/backupCheckup). Also requires a seed to actually be
 * present — there is nothing to verify otherwise.
 *
 * "Verify" opens the biometric-gated word-match modal (which resets the cycle on
 * success); the "Later" X snoozes it for one full cycle. Warm warning-amber
 * tokens, never alarm red — it reads as guidance, not an error. Theme-aware.
 */
function BackupCheckupCard() {
  const { t } = useTranslation(['home', 'common']);
  const { darkMode, Fonts, Colors } = useTheme();
  const { seedPhrase } = useAppSelector((state) => state.ssp);
  const due = useIsBackupCheckupDue();
  const [verifyOpen, setVerifyOpen] = useState(false);

  // Nothing to verify without a stored seed; and only nag when actually due.
  if (!due || !seedPhrase) return null;

  const iconColor = darkMode ? '#FCD34D' : '#B45309';
  const borderColor = darkMode ? 'rgba(245,158,11,0.5)' : '#FCD34D';
  const cardBg = darkMode ? 'rgba(245,158,11,0.10)' : 'rgba(251,191,36,0.12)';

  return (
    <>
      <View
        accessibilityRole="summary"
        style={[styles.card, { borderColor, backgroundColor: cardBg }]}
      >
        <View style={styles.headerRow}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: 'rgba(245,158,11,0.18)' },
            ]}
          >
            <TriangleAlert size={16} color={iconColor} />
          </View>
          <Text
            style={[Fonts.textSmall, Fonts.textBold, styles.title]}
            numberOfLines={1}
          >
            {t('home:backup_checkup_title')}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('home:backup_checkup_later')}
            onPress={() => snoozeBackupCheckup(Date.now())}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            style={styles.dismiss}
          >
            <X size={16} color={Colors.textGray400} />
          </TouchableOpacity>
        </View>
        <Text
          style={[Fonts.textTiny, styles.body, { color: Colors.textGray400 }]}
        >
          {t('home:backup_checkup_body')}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('home:backup_checkup_verify')}
          onPress={() => setVerifyOpen(true)}
          style={[styles.verifyButton, { backgroundColor: Colors.primary }]}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              { color: Colors.textOnPrimary },
            ]}
          >
            {t('home:backup_checkup_verify')}
          </Text>
        </TouchableOpacity>
      </View>
      <VerifyBackupModal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '90%',
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  title: {
    flex: 1,
  },
  dismiss: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  body: {
    marginTop: 6,
    lineHeight: 18,
  },
  // Full-width action — a comfortable >= 44pt tap target below the copy.
  verifyButton: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default BackupCheckupCard;
