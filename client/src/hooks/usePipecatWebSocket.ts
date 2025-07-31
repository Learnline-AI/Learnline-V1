// Pipecat-Inspired WebSocket Client Hook
// Clean React hook with event-driven API and automatic reconnection

import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

// Connection States (Pipecat-inspired)
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

// Transport Events (matching server-side)
export type TransportEvent = 
  | 'connection_established'
  | 'connection_lost'
  | 'audio_frame_received'
  | 'session_created'
  | 'session_destroyed'
  | 'error_occurred';

// Hook Configuration
interface PipecatWebSocketConfig {
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
  heartbeatInterval?: number;
  connectionTimeout?: number;
}

// Connection Statistics
interface ConnectionStats {
  latency: number;
  reconnectAttempts: number;
  messagesSent: number;
  messagesReceived: number;
  bytesTransferred: number;
  connectionDuration: number;
  errors: number;
}

// Session Information
interface SessionInfo {
  sessionId: string;
  pipelineReady: boolean;
  features: string[];
  config: {
    sampleRate: number;
    format: string;
    maxFrameSize: number;
    supportedFormats: string[];
  };
}

// Event Callbacks
type EventCallback<T = any> = (data: T) => void;
type AudioFrameCallback = (frame: { data: ArrayBuffer; timestamp: number; sessionId: string }) => void;
type ConnectionCallback = (sessionId: string) => void;
type ErrorCallback = (error: { message: string; sessionId?: string }) => void;
type StatsCallback = (stats: { session: any; global: any }) => void;

const DEFAULT_CONFIG: Required<PipecatWebSocketConfig> = {
  autoReconnect: true,
  maxReconnectAttempts: 10,
  reconnectInterval: 1000,
  heartbeatInterval: 30000,
  connectionTimeout: 10000
};

export function usePipecatWebSocket(config: PipecatWebSocketConfig = {}) {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Connection State
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  
  // Statistics
  const [stats, setStats] = useState<ConnectionStats>({
    latency: 0,
    reconnectAttempts: 0,
    messagesReceived: 0,
    messagesSent: 0,
    bytesTransferred: 0,
    connectionDuration: 0,
    errors: 0
  });

  // Event Callbacks Storage
  const callbacks = useRef<{
    onConnection?: ConnectionCallback;
    onDisconnection?: ConnectionCallback;
    onAudioFrame?: AudioFrameCallback;
    onError?: ErrorCallback;
    onStats?: StatsCallback;
    [key: string]: EventCallback | undefined;
  }>({});

  // Connection Management
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionStartTimeRef = useRef<number>(0);
  const latencyTestRef = useRef<{ timestamp: number; pending: boolean }>({ timestamp: 0, pending: false });

  /**
   * Establish WebSocket Connection
   */
  const connect = useCallback(async (): Promise<boolean> => {
    if (socketRef.current?.connected) {
      console.log('🔌 PipecatClient: Already connected');
      return true;
    }

    try {
      setConnectionStatus('connecting');
      setError(null);
      connectionStartTimeRef.current = Date.now();

      const socketUrl = window.location.origin;
      console.log('🔌 PipecatClient: Connecting to:', socketUrl);

      const socket = io(socketUrl, {
        transports: ['websocket', 'polling'],
        timeout: fullConfig.connectionTimeout,
        forceNew: true,
        reconnection: false // We handle reconnection manually
      });

      socketRef.current = socket;
      await setupEventHandlers(socket);
      
      return true;

    } catch (error) {
      console.error('❌ PipecatClient: Connection failed:', error);
      setError(error instanceof Error ? error.message : 'Connection failed');
      setConnectionStatus('error');
      
      if (fullConfig.autoReconnect) {
        scheduleReconnect();
      }
      
      return false;
    }
  }, [fullConfig.autoReconnect, fullConfig.connectionTimeout]);

  /**
   * Setup Socket Event Handlers
   */
  const setupEventHandlers = useCallback((socket: Socket): Promise<void> => {
    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, fullConfig.connectionTimeout);

      // Connection established
      socket.on('connect', () => {
        clearTimeout(connectionTimeout);
        console.log('🔌 PipecatClient: Connected with socket ID:', socket.id);
        setConnectionStatus('connected');
        setStats(prev => ({ ...prev, reconnectAttempts: 0, errors: 0 }));
        
        startHeartbeat(socket);
        resolve();
      });

      // Session initialized
      socket.on('connected', (data: SessionInfo) => {
        console.log('✅ PipecatClient: Session initialized:', data);
        setSessionInfo(data);
        
        if (callbacks.current.onConnection) {
          callbacks.current.onConnection(data.sessionId);
        }
      });

      // Frame acknowledgment
      socket.on('frame_ack', (data: { timestamp: number; frameId: number }) => {
        if (latencyTestRef.current.pending && latencyTestRef.current.timestamp === data.timestamp) {
          const latency = Date.now() - data.timestamp;
          setStats(prev => ({ ...prev, latency }));
          latencyTestRef.current.pending = false;
        }
      });

      // Statistics response
      socket.on('stats', (data: { session: any; global: any }) => {
        setStats(prev => ({ ...prev, messagesReceived: prev.messagesReceived + 1 }));
        
        if (callbacks.current.onStats) {
          callbacks.current.onStats(data);
        }
      });

      // Ping/Pong for latency measurement
      socket.on('pong', (data: { timestamp: number }) => {
        if (latencyTestRef.current.pending) {
          const latency = Date.now() - latencyTestRef.current.timestamp;
          setStats(prev => ({ ...prev, latency }));
          latencyTestRef.current.pending = false;
        }
      });

      // Error handling
      socket.on('error', (data: { message: string }) => {
        console.error('❌ PipecatClient: Server error:', data.message);
        setError(data.message);
        setStats(prev => ({ ...prev, errors: prev.errors + 1 }));
        
        if (callbacks.current.onError) {
          callbacks.current.onError({ message: data.message, sessionId: sessionInfo?.sessionId });
        }
      });

      // Disconnection
      socket.on('disconnect', (reason) => {
        console.log('🔌 PipecatClient: Disconnected -', reason);
        setConnectionStatus('disconnected');
        setSessionInfo(null);
        stopHeartbeat();
        
        if (callbacks.current.onDisconnection && sessionInfo?.sessionId) {
          callbacks.current.onDisconnection(sessionInfo.sessionId);
        }
        
        if (fullConfig.autoReconnect && reason !== 'io client disconnect') {
          scheduleReconnect();
        }
      });

      // Connection error
      socket.on('connect_error', (error) => {
        clearTimeout(connectionTimeout);
        console.error('❌ PipecatClient: Connection error:', error);
        setError('Connection failed');
        setConnectionStatus('error');
        setStats(prev => ({ ...prev, errors: prev.errors + 1 }));
        
        if (fullConfig.autoReconnect) {
          scheduleReconnect();
        }
        
        reject(error);
      });
    });
  }, [fullConfig.connectionTimeout, fullConfig.autoReconnect, sessionInfo?.sessionId]);

  /**
   * Send Audio Frame
   */
  const sendAudioFrame = useCallback((audioBuffer: ArrayBuffer, timestamp?: number): boolean => {
    if (!socketRef.current?.connected) {
      console.warn('⚠️ PipecatClient: Cannot send audio frame - not connected');
      return false;
    }

    try {
      const frameTimestamp = timestamp || Date.now();
      
      // Convert ArrayBuffer to base64
      const uint8Array = new Uint8Array(audioBuffer);
      const base64String = btoa(String.fromCharCode.apply(null, Array.from(uint8Array)));

      const frameData = {
        audioData: base64String,
        timestamp: frameTimestamp,
        size: audioBuffer.byteLength,
        format: 'pcm16'
      };

      socketRef.current.emit('audio_chunk', frameData);
      
      // Track latency for this frame
      if (!latencyTestRef.current.pending) {
        latencyTestRef.current = { timestamp: frameTimestamp, pending: true };
      }

      setStats(prev => ({
        ...prev,
        messagesSent: prev.messagesSent + 1,
        bytesTransferred: prev.bytesTransferred + audioBuffer.byteLength
      }));

      return true;

    } catch (error) {
      console.error('❌ PipecatClient: Error sending audio frame:', error);
      setError('Failed to send audio data');
      setStats(prev => ({ ...prev, errors: prev.errors + 1 }));
      return false;
    }
  }, []);

  /**
   * Request Statistics
   */
  const requestStats = useCallback((): void => {
    if (!socketRef.current?.connected) {
      console.warn('⚠️ PipecatClient: Cannot request stats - not connected');
      return;
    }

    socketRef.current.emit('get_stats');
    setStats(prev => ({ ...prev, messagesSent: prev.messagesSent + 1 }));
  }, []);

  /**
   * Disconnect
   */
  const disconnect = useCallback((): void => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    stopHeartbeat();

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setConnectionStatus('disconnected');
    setSessionInfo(null);
    setError(null);
    
    console.log('🔌 PipecatClient: Disconnected manually');
  }, []);

  /**
   * Start Heartbeat
   */
  const startHeartbeat = useCallback((socket: Socket): void => {
    stopHeartbeat();

    heartbeatIntervalRef.current = setInterval(() => {
      if (socket.connected) {
        latencyTestRef.current = { timestamp: Date.now(), pending: true };
        socket.emit('ping');
        
        // Update connection duration
        setStats(prev => ({
          ...prev,
          connectionDuration: Date.now() - connectionStartTimeRef.current
        }));
      }
    }, fullConfig.heartbeatInterval);
  }, [fullConfig.heartbeatInterval]);

  /**
   * Stop Heartbeat
   */
  const stopHeartbeat = useCallback((): void => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  /**
   * Schedule Reconnection
   */
  const scheduleReconnect = useCallback((): void => {
    if (stats.reconnectAttempts >= fullConfig.maxReconnectAttempts) {
      console.log('❌ PipecatClient: Max reconnection attempts reached');
      setConnectionStatus('error');
      setError('Max reconnection attempts reached');
      return;
    }

    setConnectionStatus('reconnecting');
    setStats(prev => ({ ...prev, reconnectAttempts: prev.reconnectAttempts + 1 }));

    // Exponential backoff
    const delay = fullConfig.reconnectInterval * Math.pow(2, Math.min(stats.reconnectAttempts, 5));
    console.log(`🔄 PipecatClient: Reconnecting in ${delay}ms (attempt ${stats.reconnectAttempts + 1}/${fullConfig.maxReconnectAttempts})`);

    reconnectTimeoutRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [stats.reconnectAttempts, fullConfig.maxReconnectAttempts, fullConfig.reconnectInterval, connect]);

  // Event Handler Registration
  const onConnection = useCallback((callback: ConnectionCallback) => {
    callbacks.current.onConnection = callback;
  }, []);

  const onDisconnection = useCallback((callback: ConnectionCallback) => {
    callbacks.current.onDisconnection = callback;
  }, []);

  const onAudioFrame = useCallback((callback: AudioFrameCallback) => {
    callbacks.current.onAudioFrame = callback;
  }, []);

  const onError = useCallback((callback: ErrorCallback) => {
    callbacks.current.onError = callback;
  }, []);

  const onStats = useCallback((callback: StatsCallback) => {
    callbacks.current.onStats = callback;
  }, []);

  const onEvent = useCallback((event: string, callback: EventCallback) => {
    callbacks.current[event] = callback;
  }, []);

  // Connection Info
  const getConnectionInfo = useCallback(() => {
    return {
      status: connectionStatus,
      error,
      sessionInfo,
      stats: {
        ...stats,
        connectionDuration: connectionStatus === 'connected' 
          ? Date.now() - connectionStartTimeRef.current 
          : stats.connectionDuration
      }
    };
  }, [connectionStatus, error, sessionInfo, stats]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // Public API
  return {
    // Connection Management
    connect,
    disconnect,
    
    // Data Transmission
    sendAudioFrame,
    requestStats,
    
    // Event Handlers
    onConnection,
    onDisconnection,
    onAudioFrame,
    onError,
    onStats,
    onEvent,
    
    // State
    connectionStatus,
    error,
    sessionInfo,
    stats,
    
    // Utils
    getConnectionInfo,
    
    // Computed Properties
    isConnected: connectionStatus === 'connected',
    isConnecting: connectionStatus === 'connecting' || connectionStatus === 'reconnecting',
    hasError: connectionStatus === 'error' || error !== null,
    sessionId: sessionInfo?.sessionId || null
  };
}

// Export types for external use
export type {
  ConnectionStatus,
  TransportEvent,
  PipecatWebSocketConfig,
  ConnectionStats,
  SessionInfo,
  EventCallback,
  AudioFrameCallback,
  ConnectionCallback,
  ErrorCallback,
  StatsCallback
};