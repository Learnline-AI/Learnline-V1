import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import ChatScreen from './src/screens/ChatScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import BottomNavigation from './src/components/BottomNavigation';

type ActiveTab = 'chat' | 'profile' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');

  const renderCurrentScreen = () => {
    switch (activeTab) {
      case 'chat':
        return <ChatScreen />;
      case 'settings':
        return <SettingsScreen onBack={() => setActiveTab('chat')} />;
      case 'profile':
        return <ProfileScreen onBack={() => setActiveTab('chat')} />;
      default:
        return <ChatScreen />;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      {renderCurrentScreen()}
      <BottomNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});
