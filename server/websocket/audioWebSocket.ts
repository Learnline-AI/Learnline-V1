// WebSocket Audio Streaming Server with Socket.IO
import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { createVADInstance, ConversationVAD, VADEvent } from '../services/vadService';
import { ConnectionManager } from './connectionManager';
import { AudioProcessor } from './audioProcessor';

interface AudioChunkData {
  audioData: string; // base64 encoded PCM16 audio
  timestamp: number;
  size: number;
  samples: number;
  format: 'pcm16';
}

interface SessionContext {
  sessionId: string;
  vadInstance: ConversationVAD;
  audioProcessor: AudioProcessor;
  isRecording: boolean;
  lastActivity: number;
  stats: {
    chunksReceived: number;
    bytesProcessed: number;
    errors: number;
    startTime: number;
  };
}

export class AudioWebSocketServer {
  private io: SocketIOServer;
  private connectionManager: ConnectionManager;
  private sessions: Map<string, SessionContext> = new Map();
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(httpServer: HTTPServer) {
    console.log('🔌 Initializing WebSocket Audio Server...');

    // Initialize Socket.IO server with optimized configuration
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: true,
        credentials: true
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e7, // 10MB for large audio chunks
      allowEIO3: true
    });

    this.connectionManager = new ConnectionManager();
    this.setupEventHandlers();
    this.startHeartbeat();

    console.log('✅ WebSocket Audio Server initialized successfully');
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`🔌 WebSocket: New connection established [${socket.id}]`);
      this.handleConnection(socket);
    });
  }

  private async handleConnection(socket: Socket): Promise<void> {
    const sessionId = socket.id;
    
    try {
      // Create VAD instance for this session
      const vadInstance = createVADInstance({
        provider: 'auto',
        facebookDenoiserEnabled: true,
        rnnoiseEnabled: true,
        facebookDenoiserDebug: false,
        rnnoiseDebug: false
      });

      await vadInstance.initialize();

      // Create audio processor for this session
      const audioProcessor = new AudioProcessor(vadInstance);

      // Create session context
      const sessionContext: SessionContext = {
        sessionId,
        vadInstance,
        audioProcessor,
        isRecording: false,
        lastActivity: Date.now(),
        stats: {
          chunksReceived: 0,
          bytesProcessed: 0,
          errors: 0,
          startTime: Date.now()
        }
      };

      this.sessions.set(sessionId, sessionContext);
      this.connectionManager.addConnection(socket);

      // Setup VAD event handlers
      this.setupVADEventHandlers(socket, sessionContext);

      // Send connection confirmation
      socket.emit('connected', {
        sessionId,
        vadProvider: vadInstance.getCurrentProvider(),
        vadStats: vadInstance.getVADStats(),
        vadConfig: {
          sampleRate: 16000,
          model: 'v5',
          provider: vadInstance.getCurrentProvider(),
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.35,
          minSpeechDuration: 1000,
          minSilenceDuration: 800,
          sileroReady: vadInstance.getVADStats().sileroReady
        }
      });

      console.log(`✅ WebSocket: Session initialized [${sessionId}] - VAD: ${vadInstance.getCurrentProvider()}`);

      // Setup socket event handlers
      this.setupSocketEventHandlers(socket, sessionContext);

    } catch (error) {
      console.error(`❌ WebSocket: Failed to initialize session [${sessionId}]:`, error);
      socket.emit('error', { message: 'Failed to initialize audio session' });
      socket.disconnect();
    }
  }

  private setupVADEventHandlers(socket: Socket, context: SessionContext): void {
    const { vadInstance, sessionId } = context;

    vadInstance.on('speech_start', (event: VADEvent) => {
      console.log(`🎤 WebSocket: Speech started [${sessionId}]`);
      socket.emit('vad_event', event);
      socket.emit('conversation_state', { state: 'listening' });
    });

    vadInstance.on('speech_end', (event: VADEvent) => {
      console.log(`🔇 WebSocket: Speech ended [${sessionId}]`);
      socket.emit('vad_event', event);
      socket.emit('conversation_state', { state: 'processing' });
      
      // Process collected audio for transcription
      if (event.data.audioChunk) {
        this.processCollectedAudio(socket, context, event.data.audioChunk);
      }
    });

    vadInstance.on('speech_chunk', (event: VADEvent) => {
      socket.emit('vad_event', event);
    });

    vadInstance.on('state_change', (event: VADEvent) => {
      socket.emit('conversation_state', { state: event.data.state });
    });
  }

  private setupSocketEventHandlers(socket: Socket, context: SessionContext): void {
    const { sessionId } = context;

    // Handle incoming audio chunks
    socket.on('audio_chunk', async (data: AudioChunkData) => {
      await this.handleAudioChunk(socket, context, data);
    });

    // Handle VAD provider switching
    socket.on('switch_vad_provider', async (data: { provider: 'silero' | 'custom' }) => {
      await this.handleProviderSwitch(socket, context, data.provider);
    });

    // Handle VAD stats request
    socket.on('get_vad_stats', () => {
      const stats = context.vadInstance.getVADStats();
      socket.emit('vad_stats', {
        stats,
        provider: context.vadInstance.getCurrentProvider(),
        state: context.vadInstance.getCurrentState()
      });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`🔌 WebSocket: Connection disconnected [${sessionId}] - Reason: ${reason}`);
      this.handleDisconnection(sessionId);
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`❌ WebSocket: Socket error [${sessionId}]:`, error);
      context.stats.errors++;
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });
  }

  private async handleAudioChunk(socket: Socket, context: SessionContext, data: AudioChunkData): Promise<void> {
    const { sessionId, vadInstance, stats } = context;

    try {
      // Update activity timestamp
      context.lastActivity = Date.now();
      stats.chunksReceived++;
      stats.bytesProcessed += data.size;

      // Validate audio chunk data
      if (!data.audioData || data.format !== 'pcm16') {
        throw new Error(`Invalid audio format: ${data.format}`);
      }

      // Decode base64 audio data to buffer
      const audioBuffer = Buffer.from(data.audioData, 'base64');
      
      if (audioBuffer.length === 0) {
        console.warn(`⚠️ WebSocket: Empty audio chunk received [${sessionId}]`);
        return;
      }

      // Log occasionally for monitoring
      if (stats.chunksReceived % 100 === 0) {
        const duration = Date.now() - stats.startTime;
        const avgBytesPerSec = Math.round((stats.bytesProcessed / duration) * 1000);
        console.log(`📊 Audio Stream: [${sessionId}] ${stats.chunksReceived} chunks, ${Math.round(stats.bytesProcessed/1024)}KB, ${avgBytesPerSec}B/s`);
      }

      // Process audio with VAD
      const vadEvent = await vadInstance.processAudioChunk(audioBuffer);
      
      if (vadEvent) {
        // VAD event will be emitted through the event handlers we set up
        // No need to emit here as it's handled by setupVADEventHandlers
      }

    } catch (error) {
      console.error(`❌ WebSocket: Error processing audio chunk [${sessionId}]:`, error);
      stats.errors++;
      
      socket.emit('error', { 
        message: `Audio processing failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    }
  }

  private async handleProviderSwitch(socket: Socket, context: SessionContext, provider: 'silero' | 'custom'): Promise<void> {
    const { sessionId, vadInstance } = context;

    try {
      console.log(`🔄 WebSocket: Switching VAD provider to ${provider} [${sessionId}]`);
      
      const success = await vadInstance.switchProvider(provider);
      const stats = vadInstance.getVADStats();

      socket.emit('vad_provider_switched', {
        success,
        provider: vadInstance.getCurrentProvider(),
        stats
      });

      if (success) {
        console.log(`✅ WebSocket: VAD provider switched to ${provider} [${sessionId}]`);
      } else {
        console.warn(`⚠️ WebSocket: Failed to switch VAD provider to ${provider} [${sessionId}]`);
      }

    } catch (error) {
      console.error(`❌ WebSocket: Error switching VAD provider [${sessionId}]:`, error);
      socket.emit('error', { message: 'Failed to switch VAD provider' });
    }
  }

  private async processCollectedAudio(socket: Socket, context: SessionContext, audioBuffer: Buffer): Promise<void> {
    const { sessionId } = context;

    try {
      console.log(`🔄 WebSocket: Processing collected audio [${sessionId}] - ${audioBuffer.length} bytes`);

      // Process audio through AudioProcessor for transcription
      const result = await context.audioProcessor.processCollectedAudio(audioBuffer);

      if (result.success && result.transcription) {
        console.log(`📝 WebSocket: Transcription ready [${sessionId}]: "${result.transcription}"`);
        socket.emit('transcription', { text: result.transcription });
      } else {
        console.warn(`⚠️ WebSocket: Transcription failed [${sessionId}]: ${result.error}`);
        socket.emit('error', { message: result.error || 'Transcription failed' });
      }

    } catch (error) {
      console.error(`❌ WebSocket: Error processing collected audio [${sessionId}]:`, error);
      socket.emit('error', { message: 'Audio processing failed' });
    }
  }

  private handleDisconnection(sessionId: string): void {
    const context = this.sessions.get(sessionId);
    
    if (context) {
      // Cleanup session resources
      const sessionDuration = Date.now() - context.stats.startTime;
      console.log(`🧹 WebSocket: Cleaning up session [${sessionId}] - Duration: ${Math.round(sessionDuration/1000)}s, Chunks: ${context.stats.chunksReceived}, Errors: ${context.stats.errors}`);

      // Destroy VAD instance
      context.vadInstance.destroy().catch(error => {
        console.error(`❌ WebSocket: Error destroying VAD instance [${sessionId}]:`, error);
      });

      // Remove from sessions
      this.sessions.delete(sessionId);
    }

    this.connectionManager.removeConnection(sessionId);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      let cleanedSessions = 0;

      // Check for stale sessions
      for (const [sessionId, context] of this.sessions.entries()) {
        const timeSinceActivity = now - context.lastActivity;
        
        if (timeSinceActivity > this.SESSION_TIMEOUT) {
          console.log(`⏰ WebSocket: Session timeout [${sessionId}] - ${Math.round(timeSinceActivity/1000)}s idle`);
          this.handleDisconnection(sessionId);
          cleanedSessions++;
        }
      }

      if (cleanedSessions > 0) {
        console.log(`🧹 WebSocket: Cleaned up ${cleanedSessions} stale sessions`);
      }

      // Log server health
      const activeConnections = this.sessions.size;
      if (activeConnections > 0) {
        console.log(`💗 WebSocket: Heartbeat - ${activeConnections} active sessions`);
      }

    }, this.HEARTBEAT_INTERVAL);
  }

  // Get server statistics
  getStats() {
    const activeSessions = this.sessions.size;
    const connectionStats = this.connectionManager.getConnectionStats();
    
    let totalChunks = 0;
    let totalBytes = 0;
    let totalErrors = 0;

    for (const context of this.sessions.values()) {
      totalChunks += context.stats.chunksReceived;
      totalBytes += context.stats.bytesProcessed;
      totalErrors += context.stats.errors;
    }

    return {
      activeSessions,
      totalChunksProcessed: totalChunks,
      totalBytesProcessed: totalBytes,
      totalErrors,
      averageBytesPerSession: activeSessions > 0 ? Math.round(totalBytes / activeSessions) : 0,
      connectionStats
    };
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    console.log('🔄 WebSocket: Shutting down gracefully...');

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Close all sessions
    const sessionPromises = Array.from(this.sessions.keys()).map(sessionId => {
      return this.handleDisconnection(sessionId);
    });

    await Promise.all(sessionPromises);

    // Close Socket.IO server
    this.io.close();

    console.log('✅ WebSocket: Server shutdown complete');
  }
}