import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { CircleAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import BlurOverlay from '../../BlurOverlay';

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
      <BlurOverlay />
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
            <CircleAlert size={60} color={Colors.textGray400} />
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
                Common.button.primary,
                Gutters.regularBMargin,
                Gutters.smallTMargin,
              ]}
              onPress={() => reject()}
            >
              <Text style={[Fonts.textRegular, Fonts.textOnPrimary]}>
                {t('cr:weak_password_confirm_cancel')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => approve()}>
              <Text
                style={[Fonts.textTiny, Fonts.textPrimary, Fonts.textCenter]}
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
