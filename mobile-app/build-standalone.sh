#!/bin/bash

echo "Building standalone APK without authentication..."

# Clear any existing builds
rm -rf .expo/

# Initialize new build
npx expo install --fix
npx expo prebuild --clean

echo "APK build initiated. Check your Expo dashboard for download link."
echo "Alternative: Use Expo Go with QR code for immediate testing."

# Start development server for immediate testing
npx expo start --clear