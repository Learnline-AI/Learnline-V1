#!/bin/bash

echo "Installing Android App Dependencies..."

# Install core dependencies
npm install

# Install React Navigation
npm install @react-navigation/native @react-navigation/bottom-tabs

# Install required peer dependencies for React Navigation
npm install react-native-screens react-native-safe-area-context

# Install Expo AV for audio functionality
npm install expo-av

# Install Expo Speech for text-to-speech
npm install expo-speech

# Install AsyncStorage for local storage
npm install @react-native-async-storage/async-storage

# Install additional utilities
npm install expo-constants react-native-svg

echo "Dependencies installed successfully!"
echo "Run 'npm start' to start the development server"
echo "Run 'npm run android' to run on Android device/emulator"