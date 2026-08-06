import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks';
import { VERIFY_ACCENTS } from '../../lib/pairingVerification';
import { MONOSPACE_FONT } from '../../lib/typography';

/**
 * Pairing verification-code display — the out-of-band cross-check that defeats
 * a malicious relay swapping extended keys during sync. Both SSP Wallet and
 * SSP Key independently derive these 6 words from their own view of the two
 * extended keys (see lib/verificationCode). The user compares them across the
 * two devices: identical words prove the keys match; different words mean the
 * connection may be compromised.
 *
 * Presentational only — the words are computed by the caller and passed in.
 * Rendering is deliberately consistent with the wallet side (same order, same
 * lowercase casing, numbered chips) so a side-by-side eyeball comparison is
 * easy. NEVER log the words.
 */
const VerificationWords = (props: {
  heading: string;
  body: string;
  words: string[];
}) => {
  const { Fonts, Gutters, Colors } = useTheme();
  // Render the 6 words as two groups of 3, each numbered (1–6) with a subtle
  // per-position colour accent identical to SSP Wallet's, so a side-by-side
  // eyeball comparison is fast (same order, casing and accents on both).
  const renderChip = (word: string, index: number) => (
    <View
      key={`${index}-${word}`}
      style={[
        styles.chip,
        {
          backgroundColor: Colors.inputBackground,
          borderColor: Colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.chipIndexBadge,
          { backgroundColor: VERIFY_ACCENTS[index % VERIFY_ACCENTS.length] },
        ]}
      >
        <Text style={styles.chipIndex}>{index + 1}</Text>
      </View>
      <Text
        style={[styles.chipWord, { color: Colors.textGray800 }]}
        numberOfLines={1}
      >
        {word}
      </Text>
    </View>
  );
  return (
    <View style={styles.container}>
      <Text
        style={[Fonts.textBold, Fonts.textRegular, Fonts.textCenter]}
        accessibilityRole="header"
      >
        {props.heading}
      </Text>
      <Text
        style={[
          Fonts.textSmall,
          Fonts.textCenter,
          Gutters.smallTMargin,
          { color: Colors.textGray400 },
        ]}
      >
        {props.body}
      </Text>
      <View
        style={Gutters.smallTMargin}
        accessibilityLabel={props.words.join(' ')}
      >
        <View style={styles.chipRow}>
          {props.words
            .slice(0, 3)
            .map((word, index) => renderChip(word, index))}
        </View>
        <View style={[styles.chipRow, Gutters.tinyTMargin]}>
          {props.words
            .slice(3)
            .map((word, index) => renderChip(word, index + 3))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 6,
  },
  chipIndexBadge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipIndex: {
    fontFamily: 'Inter',
    fontSize: 10,
    fontWeight: '700',
    color: '#0c0a09',
    fontVariant: ['tabular-nums'],
  },
  chipWord: {
    // Deliberately monospace, NOT Inter: fixed-width glyphs make single
    // character differences between words pop during the side-by-side check,
    // and SSP Wallet renders its verification words in the same mono stack
    // (--ssp-mono), so both devices show identical word shapes.
    fontFamily: MONOSPACE_FONT,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});

export default VerificationWords;
