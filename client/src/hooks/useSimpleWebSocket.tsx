import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface WebSocketStats {
  latency: number;
  messagesReceived: number;
  messagesSent: number;
  bytesTransferred: number;
  connectionDuration: number;
  reconnectAttempts: number;
}

interface WebSocketOptions {
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
}

interface WebSocketHookReturn {
  socket: Socket | null;
  isConnected: boolean;
  isConnecting: boolean;
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  error: string | null;
  stats: WebSocketStats;
  connect: () => void;
  disconnect: () => void;
  sendAudioData: (audioData: any) => void;
  sendTextInput: (text: string) => void;
}

export function useSimpleWebSocket(options: WebSocketOptions = {}): WebSocketHookReturn {
  const {
    autoReconnect = true,
    maxReconnectAttempts = 5,
    reconnectInterval = 1000
  } = options;

  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected' | 'reconnecting'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<WebSocketStats>({
    latency: 0,
    messagesReceived: 0,
    messagesSent: 0,
    bytesTransferred: 0,
    connectionDuration: 0,
    reconnectAttempts: 0
  });

  const connectStartTime = useRef<number>(0);
  const reconnectAttempts = useRef<number>(0);

  const connect = () => {
    if (socket?.connected) return;
    
    setIsConnecting(true);
    setConnectionStatus('connecting');
    setError(null);
    connectStartTime.current = Date.now();

    const newSocket = io({
      transports: ['websocket', 'polling'],
      autoConnect: true
    });

    newSocket.on('connect', () => {
      console.log('🔌 WebSocket connected:', newSocket.id);
      setIsConnected(true);
      setIsConnecting(false);
      setConnectionStatus('connected');
      setError(null);
      reconnectAttempts.current = 0;
      
      setStats(prev => ({
        ...prev,
        connectionDuration: Date.now() - connectStartTime.current,
        reconnectAttempts: reconnectAttempts.current
      }));
    });

    newSocket.on('disconnect', (reason) => {
      console.log('🔌 WebSocket disconnected:', reason);
      setIsConnected(false);
      setConnectionStatus('disconnected');
      
      if (autoReconnect && reconnectAttempts.current < maxReconnectAttempts) {
        setTimeout(() => {
          reconnectAttempts.current++;
          setConnectionStatus('reconnecting');
          setStats(prev => ({ ...prev, reconnectAttempts: reconnectAttempts.current }));
          connect();
        }, reconnectInterval * reconnectAttempts.current);
      }
    });

    newSocket.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
      setError(error.message || 'WebSocket connection error');
      setIsConnecting(false);
      setConnectionStatus('disconnected');
    });

    newSocket.on('transcription', (data) => {
      console.log('🎤 Received transcription:', data.text);
      setStats(prev => ({ ...prev, messagesReceived: prev.messagesReceived + 1 }));
    });

    newSocket.on('ai_response', (data) => {
      console.log('🤖 Received AI response:', data.text);
      setStats(prev => ({ ...prev, messagesReceived: prev.messagesReceived + 1 }));
    });

    newSocket.on('audio_response', (data) => {
      console.log('🔊 Received audio response:', data.audioUrl.substring(0, 50) + '...');
      setStats(prev => ({ 
        ...prev, 
        messagesReceived: prev.messagesReceived + 1,
        bytesTransferred: prev.bytesTransferred + data.audioUrl.length
      }));
    });

    setSocket(newSocket);
  };

  const disconnect = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
      setIsConnected(false);
      setConnectionStatus('disconnected');
    }
  };

  const sendAudioData = (audioData: any) => {
    if (socket?.connected) {
      socket.emit('audio_data', audioData);
      setStats(prev => ({ 
        ...prev, 
        messagesSent: prev.messagesSent + 1,
        bytesTransferred: prev.bytesTransferred + (typeof audioData === 'string' ? audioData.length : 1000)
      }));
    }
  };

  const sendTextInput = (text: string) => {
    if (socket?.connected) {
      socket.emit('text_input', { text });
      setStats(prev => ({ 
        ...prev, 
        messagesSent: prev.messagesSent + 1,
        bytesTransferred: prev.bytesTransferred + text.length
      }));
    }
  };

  useEffect(() => {
    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [socket]);

  return {
    socket,
    isConnected,
    isConnecting,
    connectionStatus,
    error,
    stats,
    connect,
    disconnect,
    sendAudioData,
    sendTextInput
  };
}