#!/bin/bash

echo "Fixing Expo Go loading issues..."

# Backup current package.json
cp package.json package.json.backup

# Use minimal dependencies for Expo Go compatibility
cp package-minimal.json package.json

# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Expo cache
npx expo r -c

echo "Fixed! Now run: npm start"
echo "Then scan QR code with Expo Go app on your phone"