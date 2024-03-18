import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../hooks';
import ToastNotif from '../Toast/Toast';
import CreationSteps from '../../components/CreationSteps/CreationSteps';
import { wordlist } from '@scure/bip39/wordlists/english';

const ConfirmWordsModal = (props: {
  actionStatus: (status: boolean) => void;
  mnemonic: string;
  isOpen: boolean;
  isLoading: boolean;
}) => {
  const { t } = useTranslation(['cr', 'common']);
  const { Common, Fonts, Gutters, Layout } = useTheme();
  const [wordIndex, setWordIndex] = useState(1);
  const [isConfirmed, setIsConfirmed] = useState(false);

  const displayMessage = (type: string, content: string) => {
    Toast.show({
      type,
      text1: content,
    });
  };

  const RandomWord = () => {
    const pos = Math.floor(Math.random() * (wordlist.length + 1));
    return wordlist[pos];
  };

  // Generate word list that does not include any words in seedphrase or duplicates
  const generateWordList = () => {
    const randomWordList: string[] = [];
    for (let index = 0; index < 5; index++) {
      const newWord = RandomWord();
      randomWordList.includes(newWord) || props.mnemonic.includes(newWord)
        ? index--
        : randomWordList.push(newWord);
    }
    return randomWordList;
  };

  const incorrectWord = () => {
    displayMessage('error', t('cr:incorrect_backup_confirmation'));
  };

  const correctWord = () => {
    wordIndex === 9
      ? setIsConfirmed(true)
      : setWordIndex((prevIndex) => prevIndex + 4);
  };

  const Randomize = (compProps: { wordIndex: number }) => {
    const randomWords: JSX.Element[] = [];
    const generatedWords = generateWordList();
    const realPos = Math.floor(Math.random() * 5);

    generatedWords.map((word: string, index) => {
      if (index === realPos) {
        randomWords.push(
          <TouchableOpacity
            key={index}
            style={[
              Common.button.rounded,
              Common.button.bluePrimary,
              Gutters.tinyBMargin,
              Gutters.tinyTMargin,
            ]}
            onPress={() => correctWord()}
          >
            <Text style={[Fonts.textRegular, Fonts.textWhite]}>
              {props.mnemonic.split(' ')[compProps.wordIndex]}
            </Text>
          </TouchableOpacity>,
        );
      } else {
        randomWords.push(
          <TouchableOpacity
            key={index}
            style={[
              Common.button.rounded,
              Common.button.bluePrimary,
              Gutters.tinyBMargin,
              Gutters.tinyTMargin,
            ]}
            onPress={() => incorrectWord()}
          >
            <Text style={[Fonts.textRegular, Fonts.textWhite]}>{word}</Text>
          </TouchableOpacity>,
        );
      }
    });
    return randomWords;
  };

  const handleCancel = () => {
    setIsConfirmed(false);
    setWordIndex(1);
    props.actionStatus(false);
  };

  const handleOK = () => {
    props.actionStatus(true);
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={props.isOpen}
      onRequestClose={() => handleCancel()}
    >
      <ScrollView
        keyboardShouldPersistTaps="always"
        style={[Layout.fill, Common.modalBackdrop]}
        contentInset={{ bottom: 80 }}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
        ]}
      >
        <View style={[Layout.fill, Common.modalView]}>
          <Text
            style={[Fonts.titleSmall, Gutters.smallBMargin, Fonts.textCenter]}
          >
            {t('cr:key_backup')}
          </Text>
          <View style={[Gutters.smallBMargin]}>
            <CreationSteps step={2} isImport={false} />
          </View>
          <View
            style={[
              Layout.fill,
              Layout.relative,
              Layout.fullWidth,
              Layout.alignItemsCenter,
              Gutters.regularTMargin,
            ]}
          >
            {isConfirmed && (
              <Text style={[Fonts.titleTiny, Gutters.tinyBMargin]}>
                {t('cr:backup_confirmed')}
              </Text>
            )}
            {!isConfirmed && (
              <>
                <Text style={[Fonts.titleTiny, Gutters.tinyBMargin]}>
                  {t('cr:confirm_key_seed_word')}
                </Text>
                <Text
                  style={[
                    Fonts.textBold,
                    Fonts.textSmall,
                    Fonts.textCenter,
                    Gutters.tinyBMargin,
                  ]}
                >
                  {t('cr:word_number', { number: wordIndex + 1 })}
                </Text>
                <Randomize wordIndex={wordIndex} />
              </>
            )}
          </View>
          <View style={[Layout.justifyContentEnd]}>
            <TouchableOpacity
              style={[
                Common.button.rounded,
                Common.button.bluePrimary,
                Gutters.regularBMargin,
                Gutters.smallTMargin,
                !isConfirmed ? Common.button.backgroundDisabled : null,
              ]}
              disabled={!isConfirmed}
              onPress={() => handleOK()}
            >
              {props.isLoading && (
                <ActivityIndicator
                  size={'large'}
                  style={[Gutters.largeVMargin]}
                />
              )}
              {!props.isLoading && (
                <Text style={[Fonts.textRegular, Fonts.textWhite]}>
                  {t('cr:setup_key')}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              disabled={props.isLoading}
              onPress={() => handleCancel()}
            >
              <Text
                style={[
                  Fonts.textSmall,
                  Fonts.textBluePrimary,
                  Fonts.textCenter,
                ]}
              >
                {t('common:cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      <ToastNotif />
    </Modal>
  );
};

export default ConfirmWordsModal;
