import React from 'react';
import { View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { useTheme } from '../../hooks';
import { identiconData, IDENTICON_GRID } from '../../lib/identicon';

/**
 * Deterministic identicon — 5x5 symmetric grid derived from the identity
 * string (see lib/identicon.ts). The same identity always renders the same
 * pattern, giving a fast visual "is this the address I expect?" check.
 */
const Identicon = ({ value, size = 36 }: { value: string; size?: number }) => {
  const { Colors } = useTheme();
  const { color, cells } = identiconData(value);
  const padding = Math.round(size * 0.12);
  const cellSize = (size - padding * 2) / IDENTICON_GRID;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
        borderWidth: 1,
        borderColor: Colors.border,
        backgroundColor: Colors.inputBackground,
        overflow: 'hidden',
      }}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size}>
        {cells.map((active, index) =>
          active ? (
            <Rect
              key={index}
              x={padding + (index % IDENTICON_GRID) * cellSize}
              y={padding + Math.floor(index / IDENTICON_GRID) * cellSize}
              width={cellSize}
              height={cellSize}
              fill={color}
            />
          ) : null,
        )}
      </Svg>
    </View>
  );
};

export default Identicon;
