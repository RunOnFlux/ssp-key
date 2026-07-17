import React from 'react';
import StepIndicator from '@runonflux/react-native-step-indicator';
import { Check } from 'lucide-react-native';
import { Text, TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

type Props = {
  step: number;
  isImport: boolean;
};

const CreationSteps = ({ step, isImport }: Props) => {
  const { t } = useTranslation(['cr']);
  const { Colors, darkMode } = useTheme();
  const labels = [
    t('cr:get_started'),
    isImport ? t('cr:import_key') : t('cr:create_key'),
    t('cr:backup_key'),
    t('cr:sync_wallet'),
  ];
  // Number color on the neutral (warm-stone) indicator fill — mirrors the
  // black-on-amber rule: dark text on light fills, light text on dark fills.
  // Light mode fill is textGray400 #57534E (white on it 7.4:1); dark mode
  // fill is textGray400 #A8A29E (near-black on it 9.6:1).
  const onNeutralFill = darkMode ? '#0C0A09' : '#FFFFFF';
  const customStyles = {
    stepIndicatorSize: 25,
    currentStepIndicatorSize: 25,
    separatorStrokeWidth: 1,
    currentStepStrokeWidth: 2,
    stepStrokeCurrentColor: Colors.textGray400,
    stepStrokeWidth: 2,
    separatorStrokeFinishedWidth: 3,
    stepStrokeFinishedColor: Colors.primary,
    stepStrokeUnFinishedColor: Colors.borderSecondary,
    separatorFinishedColor: Colors.primary,
    separatorUnFinishedColor: Colors.borderSecondary,
    stepIndicatorFinishedColor: Colors.primary,
    stepIndicatorUnFinishedColor: Colors.textGray400,
    stepIndicatorCurrentColor: Colors.textGray400,
    stepIndicatorLabelFontSize: 15,
    currentStepIndicatorLabelFontSize: 15,
    stepIndicatorLabelCurrentColor: onNeutralFill,
    stepIndicatorLabelFinishedColor: Colors.textOnPrimary,
    stepIndicatorLabelUnFinishedColor: onNeutralFill,
    labelColor: Colors.textGray400,
    labelSize: 11,
    currentStepLabelColor: Colors.textGray800,
    finishedStepLabelColor: Colors.primaryDeep,
    borderRadiusSize: 15,
  };

  const indicatorLabelStyle: TextStyle = {
    overflow: 'hidden',
    fontSize: customStyles.currentStepIndicatorLabelFontSize,
    color: customStyles.stepIndicatorLabelCurrentColor,
  };

  const renderStepIndicator = ({
    position,
    stepStatus,
  }: {
    position: number;
    stepStatus: string;
  }) => {
    if (stepStatus === 'finished') {
      return <Check color={Colors.textOnPrimary} size={17} />;
    }
    return <Text style={indicatorLabelStyle}>{`${position + 1}`}</Text>;
  };

  return (
    <StepIndicator
      customStyles={customStyles}
      currentPosition={step}
      stepCount={labels.length}
      renderStepIndicator={renderStepIndicator}
      labels={labels}
    />
  );
};

export default CreationSteps;
