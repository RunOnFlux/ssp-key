import React from 'react';
import StepIndicator from 'react-native-step-indicator';
import Icon from 'react-native-vector-icons/Feather';
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
    stepStrokeFinishedColor: '#1677ff',
    stepStrokeUnFinishedColor: '#9a9a9a',
    separatorFinishedColor: '#1677ff',
    separatorUnFinishedColor: '#9a9a9a',
    stepIndicatorFinishedColor: '#1677ff',
    stepIndicatorUnFinishedColor: '#9a9a9a',
    stepIndicatorCurrentColor: '#9a9a9a',
    stepIndicatorLabelFontSize: 15,
    currentStepIndicatorLabelFontSize: 15,
    stepIndicatorLabelCurrentColor: '#fff',
    stepIndicatorLabelFinishedColor: '#fff',
    stepIndicatorLabelUnFinishedColor: '#fff',
    labelColor: '#9a9a9a',
    labelSize: 11,
    currentStepLabelColor: '#9a9a9a',
    finishedStepLabelColor: '#1677ff',
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
      return <Icon name="check" color="#fff" size={17} />;
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
