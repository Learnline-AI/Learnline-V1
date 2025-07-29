#!/bin/bash

echo "Creating local development build..."

# Start Metro bundler in background
npx expo start --clear --non-interactive &
METRO_PID=$!

echo "Metro bundler started (PID: $METRO_PID)"
echo ""
echo "INSTRUCTIONS:"
echo "1. Install Expo Go app on your OnePlus 8"
echo "2. Open Expo Go and scan this QR code:"
echo ""

# Wait a moment for Metro to start
sleep 5

# Show the QR code
npx expo start --clear --tunnel

# Clean up
kill $METRO_PID 2>/dev/null