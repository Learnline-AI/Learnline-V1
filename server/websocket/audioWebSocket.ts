import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { generateAIResponse } from '../services/aiService';
import { generateTTS } from '../services/ttsService';
import { speechToTextService } from '../services/speechToTextService';
import { SYSTEM_PROMPTS } from '../config/aiConfig';

interface AudioSession {
  id: string;
  userId?: string;
  isActive: boolean;
  lastActivity: number;
}

export class SimpleAudioWebSocket {
  private io: SocketIOServer;
  private sessions: Map<string, AudioSession> = new Map();
  private sessionTimeout = 5 * 60 * 1000; // 5 minutes

  constructor(server: HTTPServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      },
      transports: ['websocket', 'polling']
    });

    this.setupEventHandlers();
    this.startSessionCleanup();
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 WebSocket connected: ${socket.id}`);
      
      // Create session
      const session: AudioSession = {
        id: socket.id,
        isActive: true,
        lastActivity: Date.now()
      };
      this.sessions.set(socket.id, session);

      // Handle audio data
      socket.on('audio_data', async (data) => {
        try {
          await this.handleAudioData(socket.id, data);
        } catch (error) {
          console.error('Error processing audio:', error);
          socket.emit('error', { message: 'Audio processing failed' });
        }
      });

      // Handle text input
      socket.on('text_input', async (data) => {
        try {
          await this.handleTextInput(socket.id, data.text);
        } catch (error) {
          console.error('Error processing text:', error);
          socket.emit('error', { message: 'Text processing failed' });
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log(`🔌 WebSocket disconnected: ${socket.id}`);
        this.sessions.delete(socket.id);
      });

      // Send connection confirmation
      socket.emit('connected', { sessionId: socket.id });
    });
  }

  private async handleAudioData(sessionId: string, audioData: any) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();

    // Convert base64 to buffer if needed
    let audioBuffer: Buffer;
    if (typeof audioData === 'string') {
      audioBuffer = Buffer.from(audioData, 'base64');
    } else if (audioData.audio) {
      audioBuffer = Buffer.from(audioData.audio, 'base64');
    } else {
      audioBuffer = Buffer.from(audioData);
    }

    // Process audio through speech-to-text
    try {
      const audioBase64 = audioBuffer.toString('base64');
      
      // Use the same API call format as the HTTP endpoint
      const sttResponse = await fetch('http://localhost:3000/api/speech-to-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: audioBase64,
          language: 'hi-IN',
          mimeType: 'audio/pcm;codecs=pcm'
        })
      });
      
      const sttData = await sttResponse.json();
      const transcription = sttData.transcript;
      
      if (transcription && transcription.trim()) {
        console.log(`🎤 Transcribed: ${transcription}`);
        
        // Send transcription to client
        this.io.to(sessionId).emit('transcription', { text: transcription });
        
        // Process with AI
        await this.handleTextInput(sessionId, transcription);
      }
    } catch (error) {
      console.error('STT Error:', error);
      this.io.to(sessionId).emit('error', { message: 'Speech recognition failed' });
    }
  }

  private async handleTextInput(sessionId: string, text: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();

    try {
      console.log(`💭 Processing text: ${text}`);
      
      // Get AI response using the same function as HTTP endpoint
      const aiResponse = await generateAIResponse(text, SYSTEM_PROMPTS.HINDI_TEACHER_BASE, false);
      
      if ('content' in aiResponse && aiResponse.content && aiResponse.content.trim()) {
        // Send text response to client
        this.io.to(sessionId).emit('ai_response', { text: aiResponse.content });
        
        // Generate TTS using the same function as HTTP endpoint
        const ttsResult = await generateTTS(aiResponse.content, {
          languageCode: 'hi-IN',
          voiceName: 'hi-IN-Wavenet-A',
          speakingRate: 0.85,
        });
        
        if (ttsResult.audioUrl) {
          // Send audio URL to client
          this.io.to(sessionId).emit('audio_response', { audioUrl: ttsResult.audioUrl });
        }
      }
    } catch (error) {
      console.error('AI/TTS Error:', error);
      this.io.to(sessionId).emit('error', { message: 'AI processing failed' });
    }
  }

  private startSessionCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [sessionId, session] of this.sessions.entries()) {
        if (now - session.lastActivity > this.sessionTimeout) {
          console.log(`🧹 Cleaning up inactive session: ${sessionId}`);
          this.sessions.delete(sessionId);
        }
      }
    }, 60000); // Check every minute
  }

  // Public methods for external integration
  public sendToSession(sessionId: string, event: string, data: any) {
    this.io.to(sessionId).emit(event, data);
  }

  public getActiveSessionCount(): number {
    return this.sessions.size;
  }
}