import { NavigatorScreenParams } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';

export type MainParamsList = {
  Home: undefined;
  Welcome: undefined;
  Create: undefined;
  Restore: undefined;
  LavaMoatTest: undefined;
};

export type ApplicationStackParamList = {
  Startup: undefined;
  Main: NavigatorScreenParams<MainParamsList>;
};

export type ApplicationScreenProps =
  StackScreenProps<ApplicationStackParamList>;

export type MainScreenProps<T extends keyof MainParamsList> = StackScreenProps<
  MainParamsList,
  T
>;
