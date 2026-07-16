import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import {
  generateWordChallenge,
  generateWordChallenges,
  isCorrectWord,
} from '../../lib/seedConfirmation';
import type { WordChallenge } from '../../lib/seedConfirmation';
import PillarMark from '../PillarMark/PillarMark';

type Props = {
  /** The just-generated seed phrase, read-only — words are only compared. */
  phrase: string;
  /** True while the caller persists the key after verification. */
  isLoading?: boolean;
  /** Called once the user has identified every challenged word. */
  onVerified: () => void;
  /** Return to the seed phrase view. */
  onBack: () => void;
};

/**
 * Seed backup word challenge: the user must pick a few randomly-positioned
 * words of their just-generated phrase among BIP39 decoys before the key is
 * stored. Purely presentational over the in-memory phrase — no storage, no
 * decryption, no crypto. Challenge construction lives in lib/seedConfirmation.
 */
const ConfirmSeedWords = ({ phrase, isLoading, onVerified, onBack }: Props) => {
  const { t } = useTranslation(['cr', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const words = useMemo(() => phrase.split(' '), [phrase]);
  const [challenges, setChallenges] = useState<WordChallenge[]>(() =>
    generateWordChallenges(words),
  );
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(false);

  const challenge = challenges[step];

  const handleSelect = (option: string) => {
    if (completed || isLoading) {
      return;
    }
    if (isCorrectWord(words, challenge, option)) {
      if (step + 1 >= challenges.length) {
        setCompleted(true);
        onVerified();
      } else {
        setStep(step + 1);
      }
    } else {
      Toast.show({
        type: 'info',
        text1: t('cr:incorrect_backup_confirmation'),
      });
      // reshuffle decoys for the current position so the answer cannot be
      // brute-forced by remembering previously eliminated options
      setChallenges((previous) =>
        previous.map((item, index) =>
          index === step ? generateWordChallenge(words, item.position) : item,
        ),
      );
    }
  };

  if (completed) {
    return (
      <View style={[Layout.alignItemsCenter, Gutters.regularTMargin]}>
        <PillarMark size={64} pulse={!!isLoading} />
        <Text
          style={[
            Fonts.textRegular,
            Fonts.textBold,
            Fonts.textCenter,
            Gutters.regularTMargin,
          ]}
        >
          {t('cr:backup_confirmed')}
        </Text>
        {isLoading && (
          <ActivityIndicator size={'large'} style={[Gutters.regularVMargin]} />
        )}
      </View>
    );
  }

  return (
    <View style={[Layout.alignItemsCenter, Gutters.regularTMargin]}>
      <Text style={[Fonts.textRegular, Fonts.textBold, Fonts.textCenter]}>
        {t('cr:confirm_backup_title')}
      </Text>
      <Text
        style={[
          Fonts.textSmall,
          Fonts.textCenter,
          Gutters.tinyTMargin,
          { color: Colors.textGray400 },
        ]}
      >
        {t('cr:confirm_backup_info')}
      </Text>
      <Text
        style={[
          Fonts.textSmall,
          Fonts.textBold,
          Fonts.textCenter,
          Gutters.regularTMargin,
          styles.tabularText,
        ]}
      >
        {t('cr:select_word_number', { number: challenge.position + 1 })}
      </Text>
      <Text
        style={[
          Fonts.textTinyTiny,
          Fonts.textCenter,
          Gutters.tinyTMargin,
          styles.tabularText,
          { color: Colors.textGray400 },
        ]}
      >
        {t('cr:word_challenge_progress', {
          current: step + 1,
          total: challenges.length,
        })}
      </Text>
      <View style={[styles.optionsWrap, Gutters.smallTMargin]}>
        {challenge.options.map((option) => (
          <TouchableOpacity
            key={option}
            style={[
              Common.button.outlineRounded,
              Common.button.secondaryButton,
              styles.optionButton,
            ]}
            onPress={() => handleSelect(option)}
          >
            <Text style={[Fonts.textSmall, Fonts.textPrimary]}>{option}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity onPress={onBack} style={[Gutters.regularTMargin]}>
        <Text style={[Fonts.textSmall, Fonts.textPrimary, Fonts.textCenter]}>
          {t('cr:back_to_seed_phrase')}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  optionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  optionButton: {
    paddingHorizontal: 16,
  },
  tabularText: {
    fontVariant: ['tabular-nums'],
  },
});

export default ConfirmSeedWords;
