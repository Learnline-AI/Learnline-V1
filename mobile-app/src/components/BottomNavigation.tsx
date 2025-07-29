import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

interface BottomNavigationProps {
  activeTab: 'chat' | 'profile' | 'settings';
  onTabChange: (tab: 'chat' | 'profile' | 'settings') => void;
}

export default function BottomNavigation({ activeTab, onTabChange }: BottomNavigationProps) {
  const tabs = [
    {
      id: 'chat' as const,
      label: 'Chat • चैट',
      icon: '💬',
    },
    {
      id: 'profile' as const,
      label: 'Profile • प्रोफाइल',
      icon: '👤',
    },
    {
      id: 'settings' as const,
      label: 'Settings • सेटिंग्स',
      icon: '⚙️',
    },
  ];

  return (
    <View style={styles.container}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.id}
          style={[
            styles.tab,
            activeTab === tab.id && styles.activeTab,
          ]}
          onPress={() => onTabChange(tab.id)}
        >
          <Text style={styles.icon}>{tab.icon}</Text>
          <Text style={[
            styles.label,
            activeTab === tab.id && styles.activeLabel,
          ]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
    paddingTop: 12,
    paddingBottom: 36,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  activeTab: {
    backgroundColor: 'transparent',
  },
  icon: {
    fontSize: 24,
    marginBottom: 6,
  },
  label: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
    fontWeight: '500',
  },
  activeLabel: {
    color: '#007AFF',
    fontWeight: '700',
  },
});