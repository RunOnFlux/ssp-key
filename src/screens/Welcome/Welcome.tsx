import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
} from 'react-native';

import { getUniqueId } from 'react-native-device-info';

import { generateMnemonic } from '../../lib/wallet';

import { setSeedPhrase } from '../../store/ssp';

import { useAppSelector, useAppDispatch } from '../../hooks';

function Welcome() {
  const dispatch = useAppDispatch();
  const generateMnemonicPhrase = (entValue: 128 | 256) => {
    const generatedMnemonic = generateMnemonic(entValue);
    // console.log(generatedMnemonic);
    dispatch(setSeedPhrase(generatedMnemonic));
  };
  const { seedPhrase } = useAppSelector((state) => state.ssp);
  const flux = useAppSelector((state) => state.flux);
  console.log(seedPhrase);
  if (!seedPhrase) {
    generateMnemonicPhrase(256);
  }
  return (
    <ScrollView>
    <View>
      <Text>
        abc
      </Text>
      </View>
    </ScrollView>
  );
}

export default Welcome;
