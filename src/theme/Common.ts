/**
 * This file defines the base application styles.
 *
 * Use it to define generic component styles (e.g. the default text styles, default button styles...).
 */
import { StyleSheet } from 'react-native';
import buttonStyles from './components/Buttons';
import { CommonParams } from '../../@types/theme';

export default function <C>({ Colors, ...args }: CommonParams<C>) {
  return {
    button: buttonStyles({ Colors, ...args }),
    ...StyleSheet.create({
      backgroundPrimary: {
        backgroundColor: Colors.primary,
      },
      backgroundReset: {
        backgroundColor: Colors.transparent,
      },
      textInput: {
        backgroundColor: Colors.inputBackground,
        color: Colors.textInput,
        // design tokens: radius 8 for controls
        borderRadius: 8,
        flex: 1,
        padding: 12,
      },
      modalBackdrop: {
        backgroundColor: Colors.backdropColor,
      },
      modalView: {
        backgroundColor: Colors.modalBackground,
        margin: 30,
        marginTop: 60,
        // design tokens: radius 16 for sheets/modals
        borderRadius: 16,
        padding: 20,
        shadowColor: Colors.shadowColor,
        shadowOffset: {
          width: 0,
          height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      modalMenu: {
        position: 'absolute',
        right: 5,
        // min/max width so translated menu labels neither clip nor overflow
        minWidth: 150,
        maxWidth: 260,
        backgroundColor: Colors.modalBackground,
        marginTop: 60,
        // design tokens: radius 12 for cards/popovers
        borderRadius: 12,
        shadowColor: Colors.shadowColor,
        shadowOffset: {
          width: 0,
          height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      inputIcon: {
        padding: 12,
      },
      inputArea: {
        flex: 1,
        padding: 12,
        // design tokens: radius 8 for controls
        borderRadius: 8,
        marginTop: 16,
      },
      inputAreaColors: {
        backgroundColor: Colors.inputBackground,
        color: Colors.textInput,
      },
      inputAreaModalColors: {
        backgroundColor: Colors.bgInputAreaModalColor,
        color: Colors.inputAreaModalColor,
      },
      inputWithButtonBgColors: {
        backgroundColor: Colors.inputBackground,
      },
      inputWithButtonBgModalColors: {
        backgroundColor: Colors.bgInputAreaModalColor,
      },
      textInputBgModal: {
        backgroundColor: Colors.bgInputAreaModalColor,
      },
    }),
  };
}
