import React from 'react';
import { View } from 'react-native';

type Props = {
  color: string;
};

const Divider = ({ color }: Props) => {
  return (
    <View
      style={{
        height: 1,
        width: '100%',
        borderRadius: 1,
        borderWidth: 1,
        borderColor: color,
        borderStyle: 'dashed',
        zIndex: 0,
        marginTop: 10,
        marginBottom: 10,
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '100%',
          height: 1,
          backgroundColor: 'transparent',
          zIndex: 1,
        }}
      />
    </View>
  );
};

export default Divider;
