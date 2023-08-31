import { ThemeNavigationColors } from '../../../../@types/theme';

export const Colors = {
  primary: '#7454a5',
  textGray800: '#E0E0E0',
  textGray400: '#969696',
  textGray200: '#BABABA',
  textInput: '#e0e0e0',
  inputBackground: '#3a3a3a',
  circleButtonBackground: '#252732',
  backdropColor: 'rgba(20,20,20,0.5)',
  modalBackground: 'black',
  shadowColor: '#969696',
  secondaryButtonBackground: 'black',
  // inputArea in Modal
  bgInputAreaModalColor: '#3a3a3a',
  inputAreaModalColor: '#f6f6f6',
};

export const NavigationColors: Partial<ThemeNavigationColors> = {
  primary: Colors.primary,
  background: '#1B1A23',
  card: '#1B1A23',
};

export default {
  Colors,
  NavigationColors,
};
