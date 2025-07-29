#!/bin/bash

echo "Installing dependencies with correct versions..."

# First, install EAS CLI globally
npm install -g @expo/eas-cli

# Clean existing modules
rm -rf node_modules package-lock.json

# Install dependencies
npm install

# Update to compatible versions
npm install @react-native-async-storage/async-storage@2.1.2
npm install expo-av@~15.1.6
npm install expo-constants@~17.1.6
npm install expo-speech@~13.1.7
npm install react-native-safe-area-context@5.4.0
npm install react-native-screens@~4.11.1
npm install react-native-svg@15.11.2

echo "Dependencies updated successfully!"
echo "Next steps:"
echo "1. Run: npx expo login"
echo "2. Run: npx eas build --platform android --profile preview"