import React from 'react';
import { Home, Welcome, Create, Restore } from '../screens';
import { createStackNavigator } from '@react-navigation/stack';
import { useAppSelector } from '../hooks';

const Stack = createStackNavigator();

// @refresh reset
const MainNavigator = () => {
  const { seedPhrase } = useAppSelector((state) => state.ssp);
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {seedPhrase ? (
        <Stack.Screen name="Home" component={Home} />
      ) : (
        <Stack.Screen name="Welcome" component={Welcome} />
      )}
      <Stack.Screen name="Create" component={Create} />
      <Stack.Screen name="Restore" component={Restore} />
    </Stack.Navigator>
  );
};

export default MainNavigator;
