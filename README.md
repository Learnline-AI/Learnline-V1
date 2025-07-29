# Learnline AI Tutor

A voice-based AI tutoring application for Class 9 Science NCERT curriculum. Features conversational AI responses with voice input and audio output capabilities.

## Features

- 🎤 Voice input with speech recognition
- 🔊 High-quality audio responses using ElevenLabs TTS
- 🇮🇳 Hindi language support with natural conversation flow
- 📱 Progressive Web App (PWA) optimized for mobile devices
- 🤖 AI-powered tutor "Ravi Bhaiya" for personalized learning
- 🎯 NCERT Class 9 Science curriculum focused

## Technology Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express
- **AI**: Anthropic Claude (latest model)
- **TTS**: ElevenLabs API
- **Styling**: Tailwind CSS + shadcn/ui
- **State Management**: TanStack Query

## Setup Instructions

### Prerequisites

- Node.js 18+ installed
- API keys for:
  - Anthropic API
  - ElevenLabs API

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd learnline-ai-tutor
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env` file in the root directory with the following variables:

```
# AI Provider Configuration
AI_PROVIDER=gemini
AI_FALLBACK=claude
TTS_PROVIDER=google
TTS_FALLBACK=elevenlabs

# API Keys (Required)
GEMINI_API_KEY=your_gemini_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GOOGLE_CLOUD_TTS_API_KEY=your_google_cloud_tts_api_key_here
GOOGLE_CLOUD_SPEECH_API_KEY=your_google_cloud_speech_api_key_here
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here

# Server Configuration
SESSION_SECRET=your_session_secret_here_change_in_production
GITHUB_TOKEN=your_github_token_here

# Optional AI Model Configuration
GEMINI_MODEL=gemini-2.0-flash-exp
GEMINI_MAX_TOKENS=800
GEMINI_TEMPERATURE=0.8

CLAUDE_MODEL=claude-sonnet-4-20250514
CLAUDE_MAX_TOKENS=800
CLAUDE_TEMPERATURE=0.8

# Optional TTS Configuration
GOOGLE_TTS_LANGUAGE_CODE=hi-IN
GOOGLE_TTS_VOICE_NAME=hi-IN-Neural2-A
GOOGLE_TTS_SPEAKING_RATE=0.85

ELEVENLABS_VOICE_ID=FIIBqolBA6JRqu2Lzpd7
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_STABILITY=0.7
ELEVENLABS_SIMILARITY_BOOST=0.8
ELEVENLABS_STYLE=0.1

# Server Configuration
PORT=3000
NODE_ENV=development
```

4. Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:5000`

## Usage

1. Open the app in your mobile browser
2. Tap and hold the microphone button to record your question
3. Ask questions in Hindi or English about Class 9 Science topics
4. Listen to the AI tutor's response with natural Hindi speech
5. Continue the conversation for deeper learning

## API Endpoints

- `POST /api/ask-teacher-stream` - Streaming AI responses with real-time TTS
- `GET /api/audio-chunk/:chunkId` - Retrieve audio chunks
- `POST /api/tts` - Text-to-speech conversion

## Project Structure

```
├── client/          # React frontend
├── server/          # Express backend  
├── shared/          # Shared types and schemas
├── components.json  # shadcn/ui configuration
└── package.json     # Dependencies and scripts
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

MIT License - see LICENSE file for details