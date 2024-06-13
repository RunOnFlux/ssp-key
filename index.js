/**
 * @format
 */
import './shim.js';
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';
import { onBackgroundMessageHandler } from './src/lib/fcmHelper';

onBackgroundMessageHandler();

AppRegistry.registerComponent(appName, () => App);
