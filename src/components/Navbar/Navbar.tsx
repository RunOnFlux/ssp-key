import React, { useState } from 'react';
import Icon from 'react-native-vector-icons/Feather';
import { View, Image, TouchableOpacity } from 'react-native';
import { useTheme } from '../../hooks';

import HelpSection from '../../components/HelpSection/HelpSection';

function PoweredByFlux(props: { openSettingsTrigger: () => void }) {
  const { Gutters, Layout, Images, Colors } = useTheme();
  const [helpSectionModalOpen, setHelpSectionModalOpen] = useState(false);
  const openHelp = () => {
    setHelpSectionModalOpen(true);
  };
  const handleHelpModalAction = () => {
    console.log('help modal close.');
    setHelpSectionModalOpen(false);
  };
  const openSettings = () => {
    props.openSettingsTrigger();
  };
  return (
    <>
      <View
        style={[
          Layout.row,
          Layout.justifyContentBetween,
          Layout.fullWidth,
          Gutters.smallHPadding,
          Gutters.tinyTMargin,
        ]}
      >
        <Image
          style={{ width: 35, height: 35 }}
          source={Images.ssp.logo}
          resizeMode={'contain'}
        />
        <View style={[Layout.row, Gutters.tinyTMargin]}>
          <TouchableOpacity
            onPressIn={() => openHelp()}
            style={[Gutters.smallRMargin]}
          >
            <Icon name="help-circle" size={22} color={Colors.textGray400} />
          </TouchableOpacity>
          <TouchableOpacity onPressIn={() => openSettings()}>
            <Icon name="settings" size={22} color={Colors.textGray400} />
          </TouchableOpacity>
        </View>
      </View>
      {helpSectionModalOpen && (
        <HelpSection actionStatus={handleHelpModalAction} />
      )}
    </>
  );
}

export default PoweredByFlux;