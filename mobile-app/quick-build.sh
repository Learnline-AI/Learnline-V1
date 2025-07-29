#!/bin/bash

echo "Creating new standalone APK build..."

# Clean previous builds
rm -rf .expo/ dist/

# Update app version to force new build
sed -i 's/"version": "1.0.0"/"version": "1.0.1"/' app.json

# Build new APK
npx eas build --platform android --profile preview --local --output ./ai-teacher-v2.apk

echo "Build complete! APK saved as ai-teacher-v2.apk"