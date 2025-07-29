#!/bin/bash

echo "Rebuilding Android APK with fixes..."

# Build new APK with EAS
npx eas build --platform android --profile preview --clear-cache

echo "Build submitted. You will receive a download link when complete."
echo "Install the new APK on your OnePlus 8 to test the fixes:"
echo "1. Network connectivity (now uses deployed backend)"
echo "2. Voice-to-text processing (real speech recognition)"
echo "3. Improved Android UI styling"
echo "4. Better audio playback buttons"