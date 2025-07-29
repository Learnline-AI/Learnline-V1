# AI शिक्षक Mobile App

Android application for conversational AI-powered Class 9 Science learning.

## Setup Instructions

### Prerequisites
1. Install Node.js (18+ recommended)
2. Install Expo CLI: `npm install -g @expo/cli`
3. Install Android Studio for Android development
4. Have an Android device or emulator ready

### Installation
1. Navigate to mobile-app directory:
   ```bash
   cd mobile-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

4. Run on Android:
   ```bash
   npm run android
   ```

### Backend Connection
The app connects to your existing Express backend running on port 5000. Make sure your backend is running before testing the mobile app.

For development, the app uses `http://localhost:5000` as the API base URL.

### Features
- Voice-based conversation with AI tutor
- Push-to-talk recording
- Real-time audio playback
- Hindi/English multilingual support
- Learning progress tracking
- Settings customization

### Building for Production
1. Build the app:
   ```bash
   expo build:android
   ```

2. The APK will be generated for distribution

### Testing
- Use Android emulator or connect physical Android device via USB
- Enable USB debugging in developer options
- App will connect to your running backend server

## File Structure
```
src/
├── components/     # Reusable UI components
├── hooks/         # Custom React hooks for audio/voice
├── screens/       # Main app screens (Chat, Settings, Profile)
├── services/      # API service layer
└── types/         # TypeScript type definitions
```