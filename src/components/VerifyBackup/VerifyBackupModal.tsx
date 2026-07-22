import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import Toast from 'react-native-toast-message';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useTheme } from '../../hooks';
import { revealSeedPhrase } from '../../lib/revealSeedPhrase';
import { markBackupVerifyNow } from '../../contexts/BackupCheckupContext';
import Authentication from '../Authentication/Authentication';
import ConfirmSeedWords from '../ConfirmSeedWords/ConfirmSeedWords';
import BlurOverlay from '../../BlurOverlay';

type Stage = 'auth' | 'challenge' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Word-match backup verification for the SSP Key, shared by the Home "Backup
 * checkup" card and the Settings → Security "Verify seed backup" row.
 *
 * Flow: the existing Authentication modal (type "sensitive") biometric/password
 * gates the reveal; on success the mnemonic is decrypted READ-ONLY via the same
 * path SSKeyDetails uses (lib/revealSeedPhrase), then the user identifies a few
 * of their seed words among BIP39 decoys using the existing ConfirmSeedWords
 * challenge (also read-only over the in-memory phrase). All-correct →
 * markBackupVerifyNow (resets the 30-day cycle) + success toast + close. Cancel
 * or a failed unlock changes nothing.
 *
 * Nothing here touches crypto beyond the existing decrypt call, and no seed,
 * key or config is ever written.
 */
function VerifyBackupModal({ open, onClose }: Props) {
  const { t } = useTranslation(['home', 'cr', 'common']);
  const { Fonts, Gutters, Layout, Common, Colors } = useTheme();
  const { seedPhrase } = useAppSelector((state) => state.ssp);
  const [stage, setStage] = useState<Stage>('auth');
  const [phrase, setPhrase] = useState('');

  // Reset to the auth gate every time the modal is (re)opened; clear the
  // decrypted phrase from memory when it closes.
  useEffect(() => {
    if (open) {
      setStage('auth');
      setPhrase('');
    } else {
      setPhrase('');
    }
  }, [open]);

  if (!open) return null;

  const handleAuth = (status: boolean) => {
    if (!status) {
      onClose();
      return;
    }
    // Authenticated — decrypt the seed READ-ONLY, then run the word challenge.
    void (async () => {
      try {
        const mnemonic = await revealSeedPhrase(seedPhrase);
        if (!mnemonic) {
          throw new Error('Empty mnemonic');
        }
        setPhrase(mnemonic);
        setStage('challenge');
      } catch (error) {
        console.log('[BACKUP] verify decrypt failed', error);
        setStage('error');
      }
    })();
  };

  const handleVerified = () => {
    markBackupVerifyNow(Date.now());
    setPhrase('');
    onClose();
    Toast.show({
      type: 'success',
      text1: t('home:backup_checkup_verified_toast'),
    });
  };

  if (stage === 'auth') {
    return (
      <Authentication
        actionStatus={handleAuth}
        type="sensitive"
        biomatricsAllowed={true}
      />
    );
  }

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => onClose()}
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
          <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
            {t('home:backup_checkup_verify_title')}
          </Text>
          {stage === 'error' ? (
            <View
              style={[
                Layout.fill,
                Layout.alignItemsCenter,
                Gutters.regularTMargin,
              ]}
            >
              <Text
                style={[
                  Fonts.textSmall,
                  Fonts.textCenter,
                  Gutters.smallMargin,
                  Fonts.textError,
                ]}
              >
                {t('home:backup_checkup_verify_decrypt_error')}
              </Text>
            </View>
          ) : (
            <>
              <Text
                style={[
                  Fonts.textSmall,
                  Fonts.textCenter,
                  Gutters.smallTMargin,
                  Gutters.smallLMargin,
                  Gutters.smallRMargin,
                  { color: Colors.textGray400 },
                ]}
              >
                {t('home:backup_checkup_verify_lead')}
              </Text>
              <ConfirmSeedWords
                phrase={phrase}
                onVerified={handleVerified}
                onBack={() => onClose()}
              />
            </>
          )}
          <View style={[Layout.justifyContentEnd]}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => onClose()}
              hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
              style={[Gutters.regularTMargin]}
            >
              <Text
                style={[Fonts.textSmall, Fonts.textPrimary, Fonts.textCenter]}
              >
                {t('common:cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}

export default VerifyBackupModal;
