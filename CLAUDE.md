# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Learnline AI Tutor** is a voice-based AI tutoring application for Class 9 Science NCERT curriculum, designed for Hindi-speaking students. The AI persona "Ravi Bhaiya" provides personalized learning support in Hindi, English, and Hinglish.

## Essential Commands

### Development
```bash
# Start development server with hot reloading
npm run dev

# Build frontend for production
npm run build

# Start production server
npm start

# Type check TypeScript files
npm run check

# Push database schema changes
npm run db:push
```

### Testing
```bash
# Test all API endpoints
./test-endpoints.sh

# Test specific endpoint (example)
curl -X POST http://localhost:3000/api/ask-teacher-stream \
  -H "Content-Type: application/json" \
  -d '{"text": "What is photosynthesis?"}'
```

### Mobile App Development
```bash
# Navigate to mobile app directory
cd mobile-app

# Start Expo development server
npm start

# Build standalone APK
./build-standalone.sh

# Create local APK build
./create-apk.sh
```

### Deployment
```bash
# Build for Railway deployment
./final-build.sh

# Push to GitHub
./push-to-github.sh
```

## Architecture Overview

### Core Services Structure

1. **AI Service** (`server/services/aiService.ts`)
   - Provider abstraction supporting multiple AI models
   - Primary: Google Gemini 2.0 Flash (faster, cheaper)
   - Fallback: Anthropic Claude Sonnet 4
   - Handles streaming responses and error recovery

2. **TTS Service** (`server/services/ttsService.ts`)
   - Provider abstraction for text-to-speech
   - Primary: Google Cloud TTS (Chirp3 HD Hindi voices)
   - Fallback: ElevenLabs
   - Intelligent text chunking for optimal audio playback

3. **RAG Service** (`server/services/ragService.ts`)
   - Retrieval-Augmented Generation for NCERT content
   - PostgreSQL vector embeddings
   - Content chunking and similarity search

4. **Audio Processing** (`server/services/audioService.ts`)
   - FFmpeg integration for format conversion
   - M4A to WAV conversion for speech recognition
   - Session-based audio chunk management

### API Flow

The main educational interaction flow:
1. User speaks → Audio recorded → Sent to `/api/speech-to-text`
2. Transcribed text → Sent to `/api/ask-teacher-stream`
3. AI generates response → Streamed in chunks
4. Each chunk → TTS conversion → Audio returned
5. Client plays audio chunks sequentially

### Database Schema

Key tables in PostgreSQL:
- `users` - Authentication and profiles
- `messages` - Conversation history
- `userSettings` - API keys and preferences
- `learningStats` - Student progress tracking
- `ragChunks` & `ragEmbeddings` - Educational content

### Frontend Architecture

- **State Management**: TanStack Query for server state
- **Routing**: Wouter (lightweight React router)
- **UI Components**: shadcn/ui (Radix UI + Tailwind CSS)
- **Audio Handling**: Custom hooks for recording and playback
- **Real-time**: Socket.IO for WebSocket connections

## Critical Implementation Details

### Audio Streaming
- Responses are chunked at sentence boundaries for optimal TTS
- Audio chunks are stored temporarily and cleaned up after 5 minutes
- Client maintains audio queue for seamless playback

### Error Handling
- Provider fallback system for both AI and TTS
- Graceful degradation when services fail
- User-friendly error messages in Hindi/English

### Performance Optimizations
- Parallel TTS generation while AI is still streaming
- Audio pre-loading for smooth playback
- Response caching for common queries

### Security Considerations
- API keys are currently hardcoded in `server/config/aiConfig.ts` (needs fixing)
- Session-based authentication with PostgreSQL storage
- CORS configured for production domains

## Mobile App Specifics

The React Native app (`mobile-app/`) uses:
- Expo SDK 53 with managed workflow
- expo-av for audio recording/playback
- Server-sent events for streaming responses
- Push-to-talk interface for voice input

## Environment Variables

Required for production:
```bash
DATABASE_URL=           # PostgreSQL connection string
GOOGLE_GEMINI_API_KEY=  # For Gemini AI
GOOGLE_CLOUD_PROJECT_ID= # For Google TTS
ANTHROPIC_API_KEY=      # For Claude fallback
ELEVENLABS_API_KEY=     # For ElevenLabs fallback
```

## Common Development Tasks

### Adding a New AI Provider
1. Create provider class in `server/services/aiProviders/`
2. Implement `AIProvider` interface
3. Register in `aiService.ts` provider factory
4. Add configuration in `server/config/aiConfig.ts`

### Adding a New TTS Provider
1. Create provider class in `server/services/ttsProviders/`
2. Implement `TTSProvider` interface
3. Register in `ttsService.ts` provider factory
4. Add configuration in `server/config/aiConfig.ts`

### Modifying the RAG Content
1. Add content to `attached_assets/` directory
2. Run content processing script
3. Verify embeddings in `ragEmbeddings` table

## Deployment Notes

- Railway deployment uses Node.js buildpack
- Static files served from `/dist/` in production
- FFmpeg binary included for audio processing
- Database migrations handled by Drizzle Kit

## Recent Architecture Decisions

1. **Switched from Claude to Gemini 2.0 Flash** (July 2025)
   - 2-3x faster response times
   - 70% cost reduction
   - Better Hindi language support

2. **Provider Abstraction Pattern**
   - Easy switching between AI/TTS providers
   - Automatic fallback on failures
   - Configuration-driven provider selection

3. **Streaming Architecture**
   - Real-time responses for better UX
   - Parallel processing of AI and TTS
   - Chunked audio delivery