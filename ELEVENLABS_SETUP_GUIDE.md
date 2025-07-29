# ElevenLabs API Key Setup Guide

## Step 1: Create ElevenLabs Account
1. Visit [ElevenLabs.io](https://elevenlabs.io)
2. Click "Get Started" or "Sign Up"
3. Create account with email/password or Google sign-in
4. Verify your email address

## Step 2: Get API Key
1. After login, click on your profile icon (top right)
2. Select "Profile + API Key" from dropdown
3. In the API section, you'll see your API key
4. Click "Copy" to copy the key (starts with `sk_...`)

## Step 3: Add API Key to Replit
1. In your Replit project, go to "Secrets" tab (🔒 icon in sidebar)
2. Click "New Secret"
3. Name: `ELEVENLABS_API_KEY`
4. Value: Paste your copied API key
5. Click "Add Secret"

## Step 4: Verify Setup
- The app will automatically use ElevenLabs for TTS
- If ElevenLabs fails, it falls back to Google TTS
- Check console logs to see which provider is being used

## Voice Configuration
The app uses these voices:
- **English/Hinglish**: Bella (warm, friendly female voice)
- **Hindi**: Lily (multilingual, clear pronunciation)

## Usage Limits
- Free tier: 10,000 characters/month
- Starter: $5/month for 30,000 characters
- Creator: $22/month for 100,000 characters

## Troubleshooting
- If you see "ElevenLabs API key not configured", check the secret name
- If requests fail, verify your API key is valid
- The app will automatically fall back to Google TTS if needed