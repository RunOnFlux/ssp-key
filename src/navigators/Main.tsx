import React from 'react';
import { Welcome, Create, Restore } from '../screens';
import { createStackNavigator } from '@react-navigation/stack';

const Stack = createStackNavigator();

// @refresh reset
const MainNavigator = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Welcome" component={Welcome} />
      <Stack.Screen name="Create" component={Create} />
      <Stack.Screen name="Restore" component={Restore} />
    </Stack.Navigator>
  );
};

export default MainNavigator;
