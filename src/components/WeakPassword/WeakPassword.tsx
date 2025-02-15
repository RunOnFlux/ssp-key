import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

const WeakPassword = (props: {
  isOpen: boolean;
  actionStatus: (status: boolean) => void;
}) => {
  const { t } = useTranslation(['cr', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();

  const reject = () => {
    props.actionStatus(false);
  };

  const approve = () => {
    props.actionStatus(true);
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={props.isOpen}
      onRequestClose={() => reject()}
    >
      <ScrollView
        style={[Layout.fill, Common.modalBackdrop]}
        contentInset={{ bottom: 80 }}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
        ]}
      >
        <View style={[Layout.fill, Common.modalView]}>
          <View
            style={[
              Layout.fill,
              Layout.relative,
              Layout.fullWidth,
              Layout.justifyContentCenter,
              Layout.alignItemsCenter,
            ]}
          >
            <Icon name="alert-circle" size={60} color={Colors.textGray400} />
            <Text
              style={[
                Fonts.textBold,
                Fonts.textRegular,
                Gutters.smallMargin,
                Fonts.textCenter,
              ]}
            >
              {t('cr:weak_password')}
            </Text>
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textCenter,
                Gutters.regularTMargin,
              ]}
            >
              {t('cr:weak_password_info')}
            </Text>
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textCenter,
                Gutters.regularTMargin,
              ]}
            >
              {t('cr:weak_password_confirm')}
            </Text>
          </View>
          <View style={[Layout.justifyContentEnd]}>
            <TouchableOpacity
              style={[
                Common.button.rounded,
                Common.button.bluePrimary,
                Gutters.regularBMargin,
                Gutters.smallTMargin,
              ]}
              onPress={() => reject()}
            >
              <Text style={[Fonts.textRegular, Fonts.textWhite]}>
                {t('cr:weak_password_confirm_cancel')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => approve()}>
              <Text
                style={[
                  Fonts.textTiny,
                  Fonts.textBluePrimary,
                  Fonts.textCenter,
                ]}
              >
                {t('cr:weak_password_confirm_ok')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
};

export default WeakPassword;
