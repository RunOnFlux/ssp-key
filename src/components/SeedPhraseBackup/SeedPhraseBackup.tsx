import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { MONOSPACE_FONT } from '../../lib/typography';
import RiskBanner from '../request/RiskBanner';
import { Card, SecondaryButton } from '../ui';

/**
 * Numbered seed word grid — mono words in outlined chips, masked with dots
 * until revealed. Words are deliberately not selectable (mirrors the
 * wallet's canvas seed display): the backup is meant to be written down,
 * not put on the clipboard.
 */
export const SeedPhraseGrid = ({
  phrase,
  visible,
}: {
  /** The seed phrase, read-only — split for display only. */
  phrase: string;
  /** Whether the words are currently revealed. */
  visible: boolean;
}) => {
  const { Colors, Fonts } = useTheme();
  const words = phrase.split(' ').filter((word) => word.length > 0);
  // masked placeholder chips until the phrase is available
  const displayWords = words.length > 0 ? words : Array<string>(12).fill('');
  return (
    <Card style={[styles.fullWidth, styles.gridCard]}>
      <View style={styles.wordsWrap}>
        {displayWords.map((word, index) => (
          <View
            key={index}
            style={[styles.wordChip, { borderColor: Colors.borderSecondary }]}
          >
            <Text
              style={[
                Fonts.textTinyTiny,
                styles.wordNumber,
                { color: Colors.textGray400 },
              ]}
            >
              {index + 1}
            </Text>
            <Text
              style={[
                Fonts.textTiny,
                styles.wordText,
                { color: Colors.textGray800 },
              ]}
              numberOfLines={1}
            >
              {visible && word ? word : '•••••'}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
};

type Props = {
  /** The seed phrase, read-only — split for display only. */
  phrase: string;
  /** Whether the words are currently revealed. */
  visible: boolean;
  /** Toggle reveal/hide. */
  onToggle: () => void;
};

/**
 * Seed phrase backup surface shared by Create and Restore: security warning
 * banner, numbered word grid (masked until revealed) and the show/hide
 * control. Purely presentational — the phrase is only split for display,
 * never stored, transformed or copied here.
 */
const SeedPhraseBackup = ({ phrase, visible, onToggle }: Props) => {
  const { t } = useTranslation(['cr', 'common']);
  return (
    <>
      <RiskBanner
        severity="high"
        title={t('common:warning')}
        messages={[t('cr:ssp_key_mnemonic_sec')]}
        style={styles.fullWidth}
      />
      <SeedPhraseGrid phrase={phrase} visible={visible} />
      <SecondaryButton
        label={`${visible ? t('cr:hide_mnemonic') : t('cr:show_mnemonic')} ${t(
          'common:key_seed_phrase',
        )}`}
        onPress={onToggle}
        style={styles.fullWidth}
      />
    </>
  );
};

const styles = StyleSheet.create({
  fullWidth: {
    width: '100%',
  },
  gridCard: {
    width: '100%',
    marginBottom: 12,
  },
  wordsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  wordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  wordNumber: {
    fontVariant: ['tabular-nums'],
    marginRight: 5,
  },
  wordText: {
    fontFamily: MONOSPACE_FONT,
  },
});

export default SeedPhraseBackup;
