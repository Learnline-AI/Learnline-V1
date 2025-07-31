// Pipecat-Inspired WebSocket Transport for Learnline
// Clean transport abstraction with session management and event-driven architecture

import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { EventEmitter } from 'events';

// Transport Events (Pipecat-inspired)
export type PipecatTransportEvent = 
  | 'connection_established'
  | 'connection_lost'
  | 'audio_frame_received'
  | 'session_created'
  | 'session_destroyed'
  | 'error_occurred'
  | 'heartbeat';

// Session Context (Pipecat-inspired session management)
interface SessionContext {
  sessionId: string;
  socket: Socket;
  created: number;
  lastActivity: number;
  stats: {
    framesReceived: number;
    bytesProcessed: number;
    errors: number;
    duration: number;
  };
  metadata: Record<string, any>;
}

// Audio Frame (Pipecat-inspired frame structure)
interface AudioFrame {
  data: Buffer;
  timestamp: number;
  sessionId: string;
  format: 'pcm16' | 'float32';
  sampleRate: number;
  channels?: number;
}

// Connection Statistics
interface ConnectionStats {
  activeSessions: number;
  totalFramesProcessed: number;
  totalBytesProcessed: number;
  totalErrors: number;
  averageLatency: number;
  uptime: number;
}

// Transport Configuration
interface PipecatTransportConfig {
  pingTimeout?: number;
  pingInterval?: number;
  maxHttpBufferSize?: number;
  sessionTimeout?: number;
  heartbeatInterval?: number;
  maxConcurrentSessions?: number;
}

// Pipecat-Inspired WebSocket Transport
export class PipecatWebSocketTransport extends EventEmitter {
  private io: SocketIOServer;
  private sessions: Map<string, SessionContext> = new Map();
  private config: Required<PipecatTransportConfig>;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private startTime: number;
  private stats = {
    totalFramesProcessed: 0,
    totalBytesProcessed: 0,
    totalErrors: 0,
    totalSessions: 0
  };

  constructor(httpServer: HTTPServer, config: PipecatTransportConfig = {}) {
    super();
    
    this.config = {
      pingTimeout: config.pingTimeout || 60000,
      pingInterval: config.pingInterval || 25000,
      maxHttpBufferSize: config.maxHttpBufferSize || 10 * 1024 * 1024, // 10MB
      sessionTimeout: config.sessionTimeout || 30 * 60 * 1000, // 30 minutes
      heartbeatInterval: config.heartbeatInterval || 30000, // 30 seconds
      maxConcurrentSessions: config.maxConcurrentSessions || 100
    };

    this.startTime = Date.now();
    this.initializeSocketServer(httpServer);
    this.startHeartbeat();
    
    console.log('🚀 PipecatWebSocketTransport: Initialized with config:', {
      pingTimeout: this.config.pingTimeout,
      pingInterval: this.config.pingInterval,
      sessionTimeout: this.config.sessionTimeout,
      maxConcurrentSessions: this.config.maxConcurrentSessions
    });
  }

  private initializeSocketServer(httpServer: HTTPServer): void {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: true,
        credentials: true
      },
      transports: ['websocket', 'polling'],
      pingTimeout: this.config.pingTimeout,
      pingInterval: this.config.pingInterval,
      maxHttpBufferSize: this.config.maxHttpBufferSize,
      allowEIO3: true
    });

    this.io.on('connection', (socket: Socket) => {
      this.handleConnection(socket);
    });

    console.log('✅ PipecatWebSocketTransport: Socket.IO server initialized');
  }

  private async handleConnection(socket: Socket): Promise<void> {
    const sessionId = socket.id;
    
    try {
      // Check concurrent session limit
      if (this.sessions.size >= this.config.maxConcurrentSessions) {
        console.warn(`⚠️ PipecatTransport: Max concurrent sessions reached (${this.config.maxConcurrentSessions})`);
        socket.emit('error', { message: 'Server at capacity, please try again later' });
        socket.disconnect();
        return;
      }

      // Create session context
      const sessionContext: SessionContext = {
        sessionId,
        socket,
        created: Date.now(),
        lastActivity: Date.now(),
        stats: {
          framesReceived: 0,
          bytesProcessed: 0,
          errors: 0,
          duration: 0
        },
        metadata: {}
      };

      this.sessions.set(sessionId, sessionContext);
      this.stats.totalSessions++;

      console.log(`🔌 PipecatTransport: Session created [${sessionId}] - Active sessions: ${this.sessions.size}`);
      
      // Setup event handlers for this session
      this.setupSessionEventHandlers(sessionContext);
      
      // Send connection confirmation
      socket.emit('connected', {
        sessionId,
        pipelineReady: true,
        features: ['audio_streaming', 'session_management', 'heartbeat'],
        config: {
          sampleRate: 16000,
          format: 'pcm16',
          maxFrameSize: 1024 * 1024, // 1MB
          supportedFormats: ['pcm16', 'float32']
        }
      });

      // Emit transport event
      this.emit('session_created', { sessionId, metadata: {} });
      this.emit('connection_established', { sessionId });

    } catch (error) {
      console.error(`❌ PipecatTransport: Failed to create session [${sessionId}]:`, error);
      socket.emit('error', { message: 'Failed to initialize session' });
      socket.disconnect();
      this.emit('error_occurred', { sessionId, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private setupSessionEventHandlers(context: SessionContext): void {
    const { socket, sessionId } = context;

    // Handle audio frames
    socket.on('audio_chunk', (data: { audioData: string; timestamp: number; size: number; format?: string }) => {
      this.handleAudioFrame(context, data);
    });

    // Handle ping for latency measurement
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
      context.lastActivity = Date.now();
    });

    // Handle stats request
    socket.on('get_stats', () => {
      const sessionStats = this.getSessionStats(sessionId);
      const globalStats = this.getStats();
      
      socket.emit('stats', {
        session: sessionStats,
        global: globalStats
      });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`🔌 PipecatTransport: Session disconnected [${sessionId}] - Reason: ${reason}`);
      this.destroySession(sessionId);
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`❌ PipecatTransport: Socket error [${sessionId}]:`, error);
      context.stats.errors++;
      this.emit('error_occurred', { sessionId, error: error.message || 'Socket error' });
    });
  }

  private handleAudioFrame(context: SessionContext, data: { audioData: string; timestamp: number; size: number; format?: string }): void {
    const { sessionId, socket } = context;

    try {
      // Update activity and stats
      context.lastActivity = Date.now();
      context.stats.framesReceived++;
      context.stats.bytesProcessed += data.size;
      this.stats.totalFramesProcessed++;
      this.stats.totalBytesProcessed += data.size;

      // Validate frame data
      if (!data.audioData || !data.timestamp) {
        throw new Error('Invalid audio frame: missing required fields');
      }

      // Create audio frame object
      const audioFrame: AudioFrame = {
        data: Buffer.from(data.audioData, 'base64'),
        timestamp: data.timestamp,
        sessionId,
        format: (data.format as 'pcm16' | 'float32') || 'pcm16',
        sampleRate: 16000
      };

      // Validate frame size
      if (audioFrame.data.length === 0) {
        console.warn(`⚠️ PipecatTransport: Empty audio frame received [${sessionId}]`);
        return;
      }

      // Log periodically for monitoring
      if (context.stats.framesReceived % 100 === 0) {
        const sessionDuration = Date.now() - context.created;
        const avgBytesPerSec = Math.round((context.stats.bytesProcessed / sessionDuration) * 1000);
        console.log(`📊 PipecatTransport: [${sessionId}] ${context.stats.framesReceived} frames, ${Math.round(context.stats.bytesProcessed/1024)}KB, ${avgBytesPerSec}B/s`);
      }

      // Emit transport event for audio processing
      this.emit('audio_frame_received', { sessionId, frame: audioFrame });

      // Acknowledge frame receipt (optional)
      socket.emit('frame_ack', { 
        timestamp: data.timestamp, 
        frameId: context.stats.framesReceived 
      });

    } catch (error) {
      console.error(`❌ PipecatTransport: Error processing audio frame [${sessionId}]:`, error);
      context.stats.errors++;
      this.stats.totalErrors++;
      
      context.socket.emit('error', { 
        message: `Frame processing failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
      
      this.emit('error_occurred', { sessionId, error: error instanceof Error ? error.message : 'Frame processing error' });
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      let staleSessionsRemoved = 0;

      // Check for stale sessions
      for (const [sessionId, context] of this.sessions.entries()) {
        const timeSinceActivity = now - context.lastActivity;
        
        if (timeSinceActivity > this.config.sessionTimeout) {
          console.log(`⏰ PipecatTransport: Session timeout [${sessionId}] - ${Math.round(timeSinceActivity/1000)}s idle`);
          this.destroySession(sessionId);
          staleSessionsRemoved++;
        } else {
          // Update session duration
          context.stats.duration = now - context.created;
        }
      }

      if (staleSessionsRemoved > 0) {
        console.log(`🧹 PipecatTransport: Cleaned up ${staleSessionsRemoved} stale sessions`);
      }

      // Emit heartbeat event
      this.emit('heartbeat', {
        activeSessions: this.sessions.size,
        uptime: now - this.startTime,
        stats: this.stats
      });

      // Log health status
      if (this.sessions.size > 0) {
        console.log(`💗 PipecatTransport: Heartbeat - ${this.sessions.size} active sessions, ${Math.round((now - this.startTime) / 1000)}s uptime`);
      }

    }, this.config.heartbeatInterval);
  }

  // Public API Methods

  /**
   * Get session statistics for a specific session
   */
  public getSessionStats(sessionId: string): any {
    const context = this.sessions.get(sessionId);
    if (!context) {
      return null;
    }

    return {
      sessionId,
      created: new Date(context.created).toISOString(),
      duration: Date.now() - context.created,
      lastActivity: new Date(context.lastActivity).toISOString(),
      framesReceived: context.stats.framesReceived,
      bytesProcessed: context.stats.bytesProcessed,
      errors: context.stats.errors,
      avgFrameSize: context.stats.framesReceived > 0 ? Math.round(context.stats.bytesProcessed / context.stats.framesReceived) : 0
    };
  }

  /**
   * Get global transport statistics
   */
  public getStats(): ConnectionStats {
    const now = Date.now();
    const activeSessions = this.sessions.size;
    
    // Calculate average latency (simplified)
    let totalLatency = 0;
    let latencyMeasurements = 0;
    
    for (const context of this.sessions.values()) {
      // Estimate latency based on recent activity
      const activityDelay = now - context.lastActivity;
      if (activityDelay < 5000) { // Only count recent activity
        totalLatency += activityDelay;
        latencyMeasurements++;
      }
    }

    return {
      activeSessions,
      totalFramesProcessed: this.stats.totalFramesProcessed,
      totalBytesProcessed: this.stats.totalBytesProcessed,
      totalErrors: this.stats.totalErrors,
      averageLatency: latencyMeasurements > 0 ? Math.round(totalLatency / latencyMeasurements) : 0,
      uptime: now - this.startTime
    };
  }

  /**
   * Send data to a specific session
   */
  public sendToSession(sessionId: string, event: string, data: any): boolean {
    const context = this.sessions.get(sessionId);
    if (!context) {
      console.warn(`⚠️ PipecatTransport: Cannot send to session [${sessionId}] - session not found`);
      return false;
    }

    try {
      context.socket.emit(event, data);
      context.lastActivity = Date.now();
      return true;
    } catch (error) {
      console.error(`❌ PipecatTransport: Error sending to session [${sessionId}]:`, error);
      return false;
    }
  }

  /**
   * Broadcast data to all sessions
   */
  public broadcast(event: string, data: any): number {
    let successCount = 0;
    
    for (const context of this.sessions.values()) {
      if (this.sendToSession(context.sessionId, event, data)) {
        successCount++;
      }
    }
    
    return successCount;
  }

  /**
   * Destroy a specific session
   */
  public destroySession(sessionId: string): void {
    const context = this.sessions.get(sessionId);
    
    if (context) {
      const sessionDuration = Date.now() - context.created;
      console.log(`🧹 PipecatTransport: Destroying session [${sessionId}] - Duration: ${Math.round(sessionDuration/1000)}s, Frames: ${context.stats.framesReceived}, Errors: ${context.stats.errors}`);

      // Close socket connection
      if (context.socket.connected) {
        context.socket.disconnect();
      }

      // Remove from sessions
      this.sessions.delete(sessionId);

      // Emit transport event
      this.emit('session_destroyed', { sessionId, stats: context.stats });
      this.emit('connection_lost', { sessionId });
    }
  }

  /**
   * Get all active session IDs
   */
  public getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Check if transport is healthy
   */
  public isHealthy(): boolean {
    return this.sessions.size <= this.config.maxConcurrentSessions && 
           this.stats.totalErrors < this.stats.totalFramesProcessed * 0.1; // Less than 10% error rate
  }

  /**
   * Graceful shutdown
   */
  public async shutdown(): Promise<void> {
    console.log('🔄 PipecatTransport: Shutting down gracefully...');

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Close all sessions
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      this.destroySession(sessionId);
    }

    // Close Socket.IO server
    this.io.close();

    // Final stats
    const finalStats = this.getStats();
    console.log('📊 PipecatTransport: Final stats:', {
      totalSessions: this.stats.totalSessions,
      totalFrames: finalStats.totalFramesProcessed,
      totalBytes: Math.round(finalStats.totalBytesProcessed / 1024) + 'KB',
      totalErrors: finalStats.totalErrors,
      uptime: Math.round(finalStats.uptime / 1000) + 's'
    });

    console.log('✅ PipecatTransport: Shutdown complete');
  }
}

// Export singleton instance creator
let pipecatTransportInstance: PipecatWebSocketTransport | null = null;

export function createPipecatTransport(httpServer: HTTPServer, config?: PipecatTransportConfig): PipecatWebSocketTransport {
  if (pipecatTransportInstance) {
    console.warn('⚠️ PipecatTransport: Instance already exists, returning existing instance');
    return pipecatTransportInstance;
  }

  pipecatTransportInstance = new PipecatWebSocketTransport(httpServer, config);
  return pipecatTransportInstance;
}

export function getPipecatTransport(): PipecatWebSocketTransport | null {
  return pipecatTransportInstance;
}