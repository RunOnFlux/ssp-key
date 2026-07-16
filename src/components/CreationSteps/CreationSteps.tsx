import React from 'react';
import StepIndicator from '@runonflux/react-native-step-indicator';
import { Check } from 'lucide-react-native';
import { Text, TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

type Props = {
  step: number;
  isImport: boolean;
};

const CreationSteps = ({ step, isImport }: Props) => {
  const { t } = useTranslation(['cr']);
  const labels = [
    t('cr:get_started'),
    isImport ? t('cr:import_key') : t('cr:create_key'),
    t('cr:backup_key'),
    t('cr:sync_wallet'),
  ];
  const customStyles = {
    stepIndicatorSize: 25,
    currentStepIndicatorSize: 25,
    separatorStrokeWidth: 1,
    currentStepStrokeWidth: 2,
    stepStrokeCurrentColor: '#9a9a9a',
    stepStrokeWidth: 2,
    separatorStrokeFinishedWidth: 3,
    stepStrokeFinishedColor: '#FBBF24',
    stepStrokeUnFinishedColor: '#9a9a9a',
    separatorFinishedColor: '#FBBF24',
    separatorUnFinishedColor: '#9a9a9a',
    stepIndicatorFinishedColor: '#FBBF24',
    stepIndicatorUnFinishedColor: '#9a9a9a',
    stepIndicatorCurrentColor: '#9a9a9a',
    stepIndicatorLabelFontSize: 15,
    currentStepIndicatorLabelFontSize: 15,
    stepIndicatorLabelCurrentColor: '#fff',
    stepIndicatorLabelFinishedColor: '#000',
    stepIndicatorLabelUnFinishedColor: '#fff',
    labelColor: '#9a9a9a',
    labelSize: 11,
    currentStepLabelColor: '#9a9a9a',
    finishedStepLabelColor: '#F59E0B',
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
      return <Check color="#000" size={17} />;
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
