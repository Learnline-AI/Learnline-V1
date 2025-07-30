// React Hook for WebSocket Audio Streaming
import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface WebSocketStats {
  latency: number;
  reconnectAttempts: number;
  messagesSent: number;
  messagesReceived: number;
  bytesTransferred: number;
  connectionDuration: number;
}

interface AudioWebSocketConfig {
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
  heartbeatInterval?: number;
  audioChunkSize?: number;
}

interface VADEvent {
  type: 'speech_start' | 'speech_end' | 'speech_chunk';
  data: {
    timestamp: number;
    probability?: number;
    audioBuffer?: string;
    provider?: string;
    debug?: any;
  };
}

interface ConnectionData {
  sessionId: string;
  vadProvider: string;
  vadStats: any;
  vadConfig: any;
}

const DEFAULT_CONFIG: Required<AudioWebSocketConfig> = {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectInterval: 1000,
  heartbeatInterval: 30000,
  audioChunkSize: 4096
};

export function useAudioWebSocket(config: AudioWebSocketConfig = {}) {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Connection state
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // WebSocket stats
  const [stats, setStats] = useState<WebSocketStats>({
    latency: 0,
    reconnectAttempts: 0,
    messagesReceived: 0,
    messagesSent: 0,
    bytesTransferred: 0,
    connectionDuration: 0
  });

  // VAD state
  const [vadProvider, setVadProvider] = useState<string>('loading...');
  const [vadStats, setVadStats] = useState<any>(null);
  const [vadConfig, setVadConfig] = useState<any>(null);
  const [lastVADEvent, setLastVADEvent] = useState<VADEvent | null>(null);

  // Event callbacks
  const [transcriptionCallback, setTranscriptionCallback] = useState<((text: string) => void) | null>(null);
  const [vadEventCallback, setVADEventCallback] = useState<((event: VADEvent) => void) | null>(null);
  const [conversationStateCallback, setConversationStateCallback] = useState<((state: string) => void) | null>(null);

  // Refs for managing connection
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionStartTimeRef = useRef<number>(0);
  const latencyTestRef = useRef<{ timestamp: number; pending: boolean }>({ timestamp: 0, pending: false });

  /**
   * Establish WebSocket connection
   */
  const connect = useCallback(async (): Promise<boolean> => {
    if (socketRef.current?.connected) {
      console.log('🔌 WebSocket: Already connected');
      return true;
    }

    try {
      setConnectionStatus('connecting');
      setError(null);
      connectionStartTimeRef.current = Date.now();

      // Use current origin for WebSocket connection
      const socketUrl = window.location.origin;
      console.log('🔌 WebSocket: Connecting to:', socketUrl);

      const socket = io(socketUrl, {
        transports: ['websocket', 'polling'],
        timeout: 20000,
        forceNew: true
      });

      socketRef.current = socket;

      // Setup event handlers
      await setupEventHandlers(socket);

      return true;

    } catch (error) {
      console.error('❌ WebSocket: Connection failed:', error);
      setError(error instanceof Error ? error.message : 'Connection failed');
      setConnectionStatus('error');
      return false;
    }
  }, []);

  /**
   * Setup WebSocket event handlers
   */
  const setupEventHandlers = useCallback(async (socket: Socket): Promise<void> => {
    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      socket.on('connect', () => {
        clearTimeout(connectionTimeout);
        console.log('🔌 WebSocket: Connected with socket ID:', socket.id);
        setConnectionStatus('connected');
        setSessionId(socket.id || null);
        setStats(prev => ({ ...prev, reconnectAttempts: 0 }));
        
        // Start heartbeat
        startHeartbeat(socket);
        resolve();
      });

      socket.on('connected', (data: ConnectionData) => {
        console.log('✅ WebSocket: Session initialized:', data);
        setSessionId(data.sessionId || socket.id);
        setVadProvider(data.vadProvider);
        setVadStats(data.vadStats);
        setVadConfig(data.vadConfig);
      });

      socket.on('vad_event', (event: VADEvent) => {
        setLastVADEvent(event);
        setStats(prev => ({ ...prev, messagesReceived: prev.messagesReceived + 1 }));
        
        if (vadEventCallback) {
          vadEventCallback(event);
        }
      });

      socket.on('conversation_state', (data: { state: string }) => {
        if (conversationStateCallback) {
          conversationStateCallback(data.state);
        }
      });

      socket.on('transcription', (data: { text: string }) => {
        console.log('📝 WebSocket: Transcription received:', data.text);
        setStats(prev => ({ ...prev, messagesReceived: prev.messagesReceived + 1 }));
        
        if (transcriptionCallback) {
          transcriptionCallback(data.text);
        }
      });

      socket.on('error', (data: { message: string }) => {
        console.error('❌ WebSocket: Server error:', data.message);
        setError(data.message);
      });

      socket.on('pong', (data: { timestamp: number }) => {
        if (latencyTestRef.current.pending) {
          const latency = Date.now() - latencyTestRef.current.timestamp;
          setStats(prev => ({ ...prev, latency }));
          latencyTestRef.current.pending = false;
        }
      });

      socket.on('disconnect', (reason) => {
        console.log('🔌 WebSocket: Disconnected -', reason);
        setConnectionStatus('disconnected');
        stopHeartbeat();
        
        if (fullConfig.autoReconnect && reason !== 'io client disconnect') {
          scheduleReconnect();
        }
      });

      socket.on('connect_error', (error) => {
        clearTimeout(connectionTimeout);
        console.error('❌ WebSocket: Connection error:', error);
        setError('Connection failed');
        setConnectionStatus('error');
        
        if (fullConfig.autoReconnect) {
          scheduleReconnect();
        }
        
        reject(error);
      });
    });
  }, [transcriptionCallback, vadEventCallback, conversationStateCallback, fullConfig.autoReconnect]);

  /**
   * Send binary audio chunk
   */
  const sendAudioChunk = useCallback((audioBuffer: ArrayBuffer, timestamp?: number): boolean => {
    if (!socketRef.current?.connected) {
      console.warn('⚠️ WebSocket: Cannot send audio - not connected');
      return false;
    }

    try {
      // Convert ArrayBuffer to Uint8Array then base64
      const uint8Array = new Uint8Array(audioBuffer);
      const base64String = btoa(String.fromCharCode.apply(null, Array.from(uint8Array)));

      const audioData = {
        audioData: base64String,
        timestamp: timestamp || Date.now(),
        size: audioBuffer.byteLength,
        samples: audioBuffer.byteLength / 2, // 16-bit samples
        format: 'pcm16' as const
      };

      socketRef.current.emit('audio_chunk', audioData);
      
      setStats(prev => ({
        ...prev,
        messagesSent: prev.messagesSent + 1,
        bytesTransferred: prev.bytesTransferred + audioBuffer.byteLength
      }));

      return true;

    } catch (error) {
      console.error('❌ WebSocket: Error sending audio chunk:', error);
      setError('Failed to send audio data');
      return false;
    }
  }, []);

  /**
   * Switch VAD provider
   */
  const switchVADProvider = useCallback((provider: 'silero' | 'custom'): void => {
    if (!socketRef.current?.connected) {
      console.warn('⚠️ WebSocket: Cannot switch VAD provider - not connected');
      return;
    }

    socketRef.current.emit('switch_vad_provider', { provider });
    setStats(prev => ({ ...prev, messagesSent: prev.messagesSent + 1 }));
  }, []);

  /**
   * Request VAD statistics
   */
  const requestVADStats = useCallback((): void => {
    if (!socketRef.current?.connected) {
      console.warn('⚠️ WebSocket: Cannot request VAD stats - not connected');
      return;
    }

    socketRef.current.emit('get_vad_stats');
    setStats(prev => ({ ...prev, messagesSent: prev.messagesSent + 1 }));
  }, []);

  /**
   * Disconnect WebSocket
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
    setSessionId(null);
    setError(null);
    
    console.log('🔌 WebSocket: Disconnected manually');
  }, []);

  /**
   * Start heartbeat mechanism
   */
  const startHeartbeat = useCallback((socket: Socket): void => {
    stopHeartbeat(); // Clear any existing heartbeat

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
   * Stop heartbeat mechanism
   */
  const stopHeartbeat = useCallback((): void => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  /**
   * Schedule reconnection attempt
   */
  const scheduleReconnect = useCallback((): void => {
    if (stats.reconnectAttempts >= fullConfig.maxReconnectAttempts) {
      console.log('❌ WebSocket: Max reconnection attempts reached');
      setConnectionStatus('error');
      setError('Max reconnection attempts reached');
      return;
    }

    setConnectionStatus('reconnecting');
    setStats(prev => ({ ...prev, reconnectAttempts: prev.reconnectAttempts + 1 }));

    const delay = fullConfig.reconnectInterval * Math.pow(2, stats.reconnectAttempts); // Exponential backoff
    console.log(`🔄 WebSocket: Reconnecting in ${delay}ms (attempt ${stats.reconnectAttempts + 1}/${fullConfig.maxReconnectAttempts})`);

    reconnectTimeoutRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [stats.reconnectAttempts, fullConfig.maxReconnectAttempts, fullConfig.reconnectInterval, connect]);

  /**
   * Set event callbacks
   */
  const onTranscription = useCallback((callback: (text: string) => void) => {
    setTranscriptionCallback(() => callback);
  }, []);

  const onVADEvent = useCallback((callback: (event: VADEvent) => void) => {
    setVADEventCallback(() => callback);
  }, []);

  const onConversationState = useCallback((callback: (state: string) => void) => {
    setConversationStateCallback(() => callback);
  }, []);

  /**
   * Get comprehensive connection info
   */
  const getConnectionInfo = useCallback(() => {
    return {
      status: connectionStatus,
      sessionId,
      error,
      stats: {
        ...stats,
        connectionDuration: connectionStatus === 'connected' 
          ? Date.now() - connectionStartTimeRef.current 
          : stats.connectionDuration
      },
      vadProvider,
      vadStats,
      vadConfig,
      lastVADEvent
    };
  }, [connectionStatus, sessionId, error, stats, vadProvider, vadStats, vadConfig, lastVADEvent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    // Connection methods
    connect,
    disconnect,
    
    // Audio methods
    sendAudioChunk,
    
    // VAD methods
    switchVADProvider,
    requestVADStats,
    
    // Event handlers
    onTranscription,
    onVADEvent,
    onConversationState,
    
    // State
    connectionStatus,
    error,
    sessionId,
    stats,
    vadProvider,
    vadStats,
    vadConfig,
    lastVADEvent,
    
    // Utils
    getConnectionInfo,
    
    // Computed properties
    isConnected: connectionStatus === 'connected',
    isConnecting: connectionStatus === 'connecting' || connectionStatus === 'reconnecting',
    hasError: connectionStatus === 'error' || error !== null
  };
}