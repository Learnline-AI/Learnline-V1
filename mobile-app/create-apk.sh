#!/bin/bash

echo "Creating local APK build..."

# Update app version to ensure fresh build
current_time=$(date +%s)
sed -i "s/\"version\": \"1.0.0\"/\"version\": \"1.0.$current_time\"/" app.json

# Generate release APK locally using Expo CLI
npx expo export --platform android
npx expo run:android --variant release

echo "APK build process initiated..."
echo "Check android/app/build/outputs/apk/release/ for generated APK"