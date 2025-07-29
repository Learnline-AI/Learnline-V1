// VAD Test Page - Simple UI to test Voice Activity Detection WebSocket connection
import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Mic, MicOff, Activity, AlertCircle, CheckCircle, Settings, BarChart3, RefreshCw } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

type ConversationState = 'idle' | 'listening' | 'processing' | 'speaking';

interface VADEvent {
  type: 'speech_start' | 'speech_end' | 'speech_chunk';
  data: {
    timestamp: number;
    probability?: number;
    audioBuffer?: string;
    provider?: string;
    debug?: {
      sileroResult?: any;
      customResult?: any;
      fallbackUsed?: boolean;
      stats?: any;
    };
  };
}

interface VADStats {
  sileroSuccess: number;
  sileroErrors: number;
  customFallbacks: number;
  totalProcessed: number;
  currentProvider: string;
  sileroReady: boolean;
}

interface ConnectionData {
  sessionId: string;
  vadProvider: string;
  vadStats: VADStats;
  vadConfig: {
    sampleRate: number;
    model: string;
    provider: string;
    positiveSpeechThreshold: number;
    negativeSpeechThreshold: number;
    minSpeechDuration: number;
    minSilenceDuration: number;
    sileroReady: boolean;
  };
}

export default function VADTestPage() {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [conversationState, setConversationState] = useState<ConversationState>('idle');
  const [lastVADEvent, setLastVADEvent] = useState<VADEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  
  // Enhanced VAD state
  const [vadProvider, setVadProvider] = useState<string>('loading...');
  const [vadStats, setVadStats] = useState<VADStats | null>(null);
  const [vadConfig, setVadConfig] = useState<any>(null);
  const [vadDebugInfo, setVadDebugInfo] = useState<any>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(true);
  const [probabilityHistory, setProbabilityHistory] = useState<number[]>([]);
  const [providerSwitching, setProviderSwitching] = useState(false);
  
  const socketRef = useRef<Socket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number>();
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Initialize Socket.IO connection
  useEffect(() => {
    // Use current origin for WebSocket connection (works for both local and deployed)
    const socketUrl = window.location.origin;
    console.log('🔌 Connecting to WebSocket at:', socketUrl);
    
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('🔌 Connected to VAD server, socket ID:', socket.id);
      console.log('🔌 Socket connected status:', socket.connected);
      setIsConnected(true);
      setError(null);
    });

    socket.on('connected', (data: ConnectionData) => {
      console.log('✅ VAD session initialized:', data);
      setVadProvider(data.vadProvider);
      setVadStats(data.vadStats);
      setVadConfig(data.vadConfig);
    });

    socket.on('vad_event', (event: VADEvent) => {
      console.log('🎤 VAD Event:', event);
      setLastVADEvent(event);
      
      // Update probability history for visualization
      if (event.data.probability !== undefined) {
        setProbabilityHistory(prev => {
          const newHistory = [...prev, event.data.probability!].slice(-50); // Keep last 50 values
          return newHistory;
        });
      }
      
      // Store debug information
      if (event.data.debug) {
        setVadDebugInfo(event.data.debug);
      }
    });

    socket.on('conversation_state', (data: { state: ConversationState }) => {
      console.log('🔄 Conversation state:', data.state);
      setConversationState(data.state);
    });

    socket.on('transcription', (data: { text: string }) => {
      console.log('📝 Transcription:', data.text);
      setTranscription(data.text);
    });

    socket.on('ai_response_chunk', (data: { text: string }) => {
      console.log('🤖 AI Response chunk:', data.text);
    });

    socket.on('error', (data: { message: string }) => {
      console.error('❌ Socket error:', data.message);
      setError(data.message);
    });

    socket.on('vad_provider_switched', (data: { success: boolean; provider: string; stats: VADStats }) => {
      console.log('🔄 VAD provider switched:', data);
      if (data.success) {
        setVadProvider(data.provider);
        setVadStats(data.stats);
        setProviderSwitching(false);
      }
    });
    
    socket.on('vad_stats', (data: { stats: VADStats; provider: string; state: ConversationState }) => {
      console.log('📊 VAD stats received:', data);
      setVadStats(data.stats);
      setVadProvider(data.provider);
    });

    socket.on('disconnect', () => {
      console.log('🔌 Disconnected from VAD server');
      setIsConnected(false);
      setVadProvider('disconnected');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Audio level monitoring
  const updateAudioLevel = () => {
    if (analyzerRef.current && dataArrayRef.current) {
      analyzerRef.current.getByteFrequencyData(dataArrayRef.current);
      
      let sum = 0;
      for (let i = 0; i < dataArrayRef.current.length; i++) {
        sum += dataArrayRef.current[i];
      }
      const average = sum / dataArrayRef.current.length;
      setAudioLevel(average / 255 * 100);
      
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    }
  };

  const startRecording = async () => {
    try {
      setError(null);
      
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000, // Optimal for VAD
          channelCount: 1,   // Mono
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      mediaStreamRef.current = stream;

      // Setup audio context for raw audio processing
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      
      // Setup analyzer for visualization
      analyzerRef.current = audioContextRef.current.createAnalyser();
      analyzerRef.current.fftSize = 256;
      const bufferLength = analyzerRef.current.frequencyBinCount;
      dataArrayRef.current = new Uint8Array(bufferLength);
      
      // Create script processor for raw audio data extraction
      // Note: ScriptProcessorNode is deprecated but still widely supported
      // TODO: Replace with AudioWorklet when needed
      const bufferSize = 4096; // Process in chunks of 4096 samples
      processorRef.current = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);
      
      processorRef.current.onaudioprocess = (event) => {
        try {
          if (!socketRef.current || !socketRef.current.connected) {
            console.warn('🔌 WebSocket not connected, skipping audio chunk');
            return;
          }

          const inputBuffer = event.inputBuffer;
          const inputData = inputBuffer.getChannelData(0); // Get mono channel
          
          // Convert Float32Array to 16-bit PCM
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            // Convert from -1.0 to 1.0 range to -32768 to 32767 range
            pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(inputData[i] * 32768)));
          }
          
          // Convert to Uint8Array for browser-compatible base64 encoding
          const uint8Array = new Uint8Array(pcmData.buffer);
          
          // Use browser's native base64 encoding instead of Node.js Buffer
          const base64String = btoa(String.fromCharCode.apply(null, Array.from(uint8Array)));
          
          // Only log occasionally to avoid console spam
          if (Math.random() < 0.05) {
            console.log(`📤 Sending PCM audio chunk: ${pcmData.length} samples, ${uint8Array.length} bytes, base64 length: ${base64String.length}`);
          }
          
          // Verify we have valid data before sending
          if (base64String.length > 0) {
            const audioChunkData = {
              audioData: base64String,
              timestamp: Date.now(),
              size: uint8Array.length,
              samples: pcmData.length,
              format: 'pcm16'
            };
            
            try {
              socketRef.current.emit('audio_chunk', audioChunkData);
              // Only log every 10th chunk to avoid spam
              if (Math.random() < 0.1) {
                console.log('📤 Audio chunk sent successfully');
              }
            } catch (emitError) {
              console.error('❌ Failed to emit audio chunk:', emitError);
            }
          } else {
            console.error('❌ Failed to create base64 audio data');
          }
        } catch (error) {
          console.error('❌ Error processing audio chunk:', error);
        }
      };

      // Connect the audio pipeline: source -> analyzer (for visualization)
      source.connect(analyzerRef.current);
      
      // Connect source -> processor (for raw audio data) -> destination (to prevent garbage collection)
      source.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);
      
      updateAudioLevel();

      setIsRecording(true);
      console.log('🎤 Recording started');

    } catch (err) {
      console.error('❌ Failed to start recording:', err);
      setError('Failed to access microphone');
    }
  };

  const stopRecording = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    setIsRecording(false);
    setAudioLevel(0);
    console.log('🔇 Recording stopped');
  };

  const getStateColor = (state: ConversationState) => {
    switch (state) {
      case 'idle': return 'bg-gray-500';
      case 'listening': return 'bg-green-500 animate-pulse';
      case 'processing': return 'bg-yellow-500 animate-pulse';
      case 'speaking': return 'bg-blue-500 animate-pulse';
      default: return 'bg-gray-500';
    }
  };
  
  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'silero': return 'bg-green-100 text-green-800 border-green-200';
      case 'custom': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'loading...': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'disconnected': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };
  
  const switchVADProvider = (newProvider: 'silero' | 'custom') => {
    if (socketRef.current && isConnected && vadProvider !== newProvider) {
      setProviderSwitching(true);
      socketRef.current.emit('switch_vad_provider', { provider: newProvider });
    }
  };
  
  const refreshVADStats = () => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('get_vad_stats');
    }
  };
  
  const renderProbabilityGraph = () => {
    if (probabilityHistory.length === 0) return null;
    
    return (
      <div className="h-20 bg-gray-50 rounded p-2">
        <div className="text-xs text-gray-600 mb-1">Speech Probability Over Time</div>
        <div className="flex items-end h-12 space-x-0.5">
          {probabilityHistory.map((prob, i) => (
            <div
              key={i}
              className="bg-blue-400 w-1 min-h-0.5"
              style={{ height: `${Math.max(prob * 100, 2)}%` }}
              title={`${prob.toFixed(3)}`}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">VAD Test Interface</h1>
          <p className="text-gray-600">Test Voice Activity Detection WebSocket connection</p>
          
          {/* Navigation help */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
            <p className="text-sm text-blue-800">
              <strong>Navigation:</strong> Use these URLs to navigate:
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-2 text-xs">
              <code className="bg-white px-2 py-1 rounded cursor-pointer" onClick={() => window.location.hash = 'vad-test'}>
                #vad-test (this page)
              </code>
              <code className="bg-white px-2 py-1 rounded cursor-pointer" onClick={() => window.location.hash = 'chat'}>
                #chat
              </code>
              <code className="bg-white px-2 py-1 rounded cursor-pointer" onClick={() => window.location.hash = 'settings'}>
                #settings
              </code>
              <code className="bg-white px-2 py-1 rounded cursor-pointer" onClick={() => window.location.hash = 'profile'}>
                #profile
              </code>
            </div>
          </div>
        </div>

        {/* Connection & VAD Provider Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isConnected ? (
                  <>
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    Connected to Enhanced VAD Server
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-5 h-5 text-red-500" />
                    Disconnected
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDebugPanel(!showDebugPanel)}
                  className="text-xs"
                >
                  <Settings className="w-4 h-4 mr-1" />
                  {showDebugPanel ? 'Hide' : 'Show'} Debug
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshVADStats}
                  disabled={!isConnected}
                  className="text-xs"
                >
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Refresh
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <Badge className={isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                  {isConnected ? 'Online' : 'Offline'}
                </Badge>
                <Badge className={`${getStateColor(conversationState)} text-white`}>
                  {conversationState.toUpperCase()}
                </Badge>
                <Badge className={`border ${getProviderColor(vadProvider)}`}>
                  VAD: {vadProvider.toUpperCase()}
                </Badge>
              </div>
              
              {isConnected && vadConfig && (
                <div className="text-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Model:</span>
                    <span className="font-medium">{vadConfig.model} {vadConfig.sileroReady ? '(ONNX Ready)' : '(Fallback)'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Thresholds:</span>
                    <span className="font-medium text-xs">
                      +{vadConfig.positiveSpeechThreshold} / -{vadConfig.negativeSpeechThreshold}
                    </span>
                  </div>
                </div>
              )}
              
              {isConnected && vadProvider !== 'loading...' && (
                <div className="flex gap-2">
                  <Button
                    variant={vadProvider === 'silero' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => switchVADProvider('silero')}
                    disabled={providerSwitching || vadProvider === 'silero'}
                    className="text-xs flex-1"
                  >
                    {providerSwitching && vadProvider !== 'silero' ? 'Switching...' : 'Silero ONNX'}
                  </Button>
                  <Button
                    variant={vadProvider === 'custom' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => switchVADProvider('custom')}
                    disabled={providerSwitching || vadProvider === 'custom'}
                    className="text-xs flex-1"
                  >
                    {providerSwitching && vadProvider !== 'custom' ? 'Switching...' : 'Custom VAD'}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recording Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Audio Recording
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={!isConnected}
                  className={isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}
                >
                  {isRecording ? (
                    <>
                      <MicOff className="w-4 h-4 mr-2" />
                      Stop Recording
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4 mr-2" />
                      Start Recording
                    </>
                  )}
                </Button>
              </div>
              
              {/* Audio Level Visualization */}
              {isRecording && (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">Audio Level: {Math.round(audioLevel)}%</p>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all duration-100"
                      style={{ width: `${audioLevel}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* VAD Events & Analysis */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              VAD Events & Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lastVADEvent ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge className={lastVADEvent.type === 'speech_start' ? 'bg-green-500' : lastVADEvent.type === 'speech_end' ? 'bg-red-500' : 'bg-blue-500'}>
                    {lastVADEvent.type}
                  </Badge>
                  <span className="text-sm text-gray-600">
                    {new Date(lastVADEvent.data.timestamp).toLocaleTimeString()}
                  </span>
                  {lastVADEvent.data.provider && (
                    <Badge variant="outline" className="text-xs">
                      {lastVADEvent.data.provider}
                    </Badge>
                  )}
                </div>
                
                {lastVADEvent.data.probability !== undefined && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Speech Probability:</span>
                      <span className="font-medium">{(lastVADEvent.data.probability * 100).toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${lastVADEvent.data.probability * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                
                {/* Probability History Graph */}
                {renderProbabilityGraph()}
                
                {vadStats && (
                  <div className="grid grid-cols-2 gap-4 text-sm border-t pt-3">
                    <div>
                      <div className="text-gray-600">Total Processed:</div>
                      <div className="font-medium">{vadStats.totalProcessed}</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Success Rate:</div>
                      <div className="font-medium">
                        {vadStats.totalProcessed > 0 
                          ? `${((vadStats.sileroSuccess / vadStats.totalProcessed) * 100).toFixed(1)}%`
                          : '0%'
                        }
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-600">Silero Success:</div>
                      <div className="font-medium text-green-600">{vadStats.sileroSuccess}</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Fallbacks Used:</div>
                      <div className="font-medium text-yellow-600">{vadStats.customFallbacks}</div>
                    </div>
                  </div>
                )}
                
                <p className="text-xs text-gray-500">
                  Last update: {new Date().toLocaleTimeString()}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-gray-500">No VAD events yet</p>
                <p className="text-xs text-gray-400">
                  {isRecording ? 'Recording active - speak into microphone to test VAD' : 'Start recording to begin VAD detection'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Transcription */}
        <Card>
          <CardHeader>
            <CardTitle>Speech Transcription</CardTitle>
          </CardHeader>
          <CardContent>
            {transcription ? (
              <p className="p-3 bg-blue-50 rounded-lg">{transcription}</p>
            ) : (
              <p className="text-gray-500">No transcription yet</p>
            )}
          </CardContent>
        </Card>

        {/* Error Messages */}
        {error && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Debug Panel */}
        {showDebugPanel && vadDebugInfo && (
          <Card>
            <CardHeader>
              <CardTitle>Debug Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {vadDebugInfo.sileroResult && (
                  <div className="border rounded p-3 bg-green-50">
                    <div className="font-medium text-sm text-green-800 mb-2">Silero ONNX Result</div>
                    <div className="text-xs space-y-1">
                      <div>Probability: {vadDebugInfo.sileroResult.probability?.toFixed(4)}</div>
                      <div>Is Speech: {vadDebugInfo.sileroResult.isSpeech?.toString()}</div>
                      <div>Frame Samples: {vadDebugInfo.sileroResult.frameSamples}</div>
                      <div>Model Version: {vadDebugInfo.sileroResult.modelVersion}</div>
                    </div>
                  </div>
                )}
                
                {vadDebugInfo.customResult && (
                  <div className="border rounded p-3 bg-blue-50">
                    <div className="font-medium text-sm text-blue-800 mb-2">Custom VAD Result</div>
                    <div className="text-xs space-y-1">
                      <div>Energy: {vadDebugInfo.customResult.energy?.toFixed(4)}</div>
                      <div>Activity: {vadDebugInfo.customResult.activity?.toFixed(4)}</div>
                      <div>Probability: {vadDebugInfo.customResult.probability?.toFixed(4)}</div>
                    </div>
                  </div>
                )}
                
                {vadDebugInfo.fallbackUsed && (
                  <div className="border rounded p-3 bg-yellow-50">
                    <div className="font-medium text-sm text-yellow-800">⚠️ Fallback VAD Used</div>
                    <div className="text-xs text-yellow-700">Silero VAD failed, using Custom VAD</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>Enhanced VAD Testing Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
              <li>Ensure you're connected to the Enhanced VAD server</li>
              <li>Check the VAD provider (Silero ONNX or Custom fallback)</li>
              <li>Click "Start Recording" to begin voice activity detection</li>
              <li>Speak into your microphone - watch real-time probability analysis</li>
              <li>Monitor the speech probability graph and statistics</li>
              <li>Switch between VAD providers to compare performance</li>
              <li>Use debug panel to see detailed VAD processing information</li>
              <li>Click "Stop Recording" to end the session</li>
            </ol>
            <div className="mt-4 p-3 bg-blue-50 rounded">
              <div className="text-sm font-medium text-blue-800">Features:</div>
              <ul className="text-xs text-blue-700 mt-1 space-y-1">
                <li>• Real-time Silero ONNX VAD with Custom fallback</li>
                <li>• Live probability visualization and statistics</li>
                <li>• Provider switching and performance comparison</li>
                <li>• Comprehensive debug information</li>
                <li>• Optimized for Hindi/English speech detection</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}