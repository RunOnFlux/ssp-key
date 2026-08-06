import React from 'react';
import { StyleSheet, View } from 'react-native';

type Props = {
  color: string;
};

/**
 * Solid hairline separator — the v2 language uses plain 1px rules
 * (the dashed rule was a v1 leftover).
 */
const Divider = ({ color }: Props) => {
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        width: '100%',
        backgroundColor: color,
        marginTop: 10,
        marginBottom: 10,
      }}
    />
  );
};

export default Divider;
