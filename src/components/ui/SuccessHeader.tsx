import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CircleCheck } from 'lucide-react-native';
import { useTheme } from '../../hooks';
import PillarMark from '../PillarMark/PillarMark';

/**
 * Shared success-moment header — the brand pillar mark above a
 * success-colored check + title row. Gives every confirmation modal
 * (sync success, tx sent, signing approved, nonces shared) the same
 * celebration layout instead of the v1 grey icon.
 */
const SuccessHeader = ({ title }: { title: string }) => {
  const { Colors, Fonts } = useTheme();
  return (
    <View style={styles.wrap}>
      <PillarMark size={56} />
      <View style={styles.titleRow}>
        <CircleCheck size={20} color={Colors.success} />
        <Text
          style={[
            Fonts.textRegular,
            Fonts.textBold,
            styles.title,
            { color: Colors.textGray800 },
          ]}
        >
          {title}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  title: {
    marginLeft: 8,
    flexShrink: 1,
    textAlign: 'center',
  },
});

export default SuccessHeader;
