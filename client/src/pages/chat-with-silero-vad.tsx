import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { GraduationCap, Settings as SettingsIcon, User as UserIcon, AlertCircle, BookOpen, Zap, Mic, MicOff, Activity } from 'lucide-react';
import { ChatBubble, TypingIndicator } from '@/components/ChatBubble';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { ChatMessage, UserSettings } from '@/types';
import { apiService } from '@/lib/apiService';
import { storage, STORAGE_KEYS } from '@/lib/storage';
import { usePipecatWebSocket } from '@/hooks/usePipecatWebSocket';

type ConversationState = 'idle' | 'listening' | 'processing' | 'speaking';

interface VADEvent {
  type: 'speech_start' | 'speech_end' | 'speech_chunk';
  data: {
    timestamp: number;
    probability?: number;
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

interface ChatPageProps {
  onShowSettings: () => void;
  onShowProfile: () => void;
}

export default function ChatWithSileroVAD({ onShowSettings, onShowProfile }: ChatPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tutorPersonality] = useState<'ravi' | 'meena'>('ravi');
  
  // RAG state
  const [useRag, setUseRag] = useState(false);
  const [ragStatus, setRagStatus] = useState<{
    isAvailable: boolean;
    totalChunks: number;
    isLoaded: boolean;
    chapter: string;
    chapterTitle: string;
  } | null>(null);
  
  // VAD WebSocket state
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [conversationState, setConversationState] = useState<ConversationState>('idle');
  const [lastVADEvent, setLastVADEvent] = useState<VADEvent | null>(null);
  const [vadProvider, setVadProvider] = useState<string>('loading...');
  const [vadStats, setVadStats] = useState<VADStats | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [transcript, setTranscript] = useState<string>('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number>();
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const conversationStartedRef = useRef<boolean>(false);
  
  const { isPlaying, currentAudio, playAudio, stopAudio } = useAudioPlayback();

  // Pipecat WebSocket integration (basic setup for testing)
  const pipecatWebSocket = usePipecatWebSocket({
    autoReconnect: true,
    maxReconnectAttempts: 5,
    reconnectInterval: 1000
  });

  // Enhanced conversational AI system prompt
  const getConversationalPrompt = (question: string, isFirstMessage: boolean = false) => {
    const personality = tutorPersonality === 'ravi' ? 
      'You are Ravi Bhaiya, a friendly older brother figure who teaches Class 9 Science in a conversational way. You use relatable examples from daily life in India, ask follow-up questions, and encourage students to think deeper.' :
      'You are Meena Didi, a caring elder sister who makes Class 9 Science easy to understand. You use everyday examples, ask engaging questions, and create a comfortable learning environment.';

    const conversationalStyle = `
    ${personality}
    
    Rules for conversation:
    - Be conversational and engaging, like talking to a friend
    - Use simple Hindi mixed with English (Hinglish) or pure Hindi/English based on student's preference
    - Give relatable examples from Indian daily life (like "जैसे जब आप चाय बनाते हैं...")
    - Ask follow-up questions to check understanding
    - Encourage students to ask "silly" questions
    - Keep responses to 2-3 sentences, then ask a question back
    - If interrupted, acknowledge and adjust your explanation
    - Use encouraging phrases like "बहुत बढ़िया!", "समझ गए?", "और कोई doubt है?"
    
    ${isFirstMessage ? 'This is the start of conversation. Introduce yourself warmly and ask what topic they want to learn about.' : ''}
    `;

    return conversationalStyle;
  };

  // Initialize Socket.IO connection
  useEffect(() => {
    const socketUrl = window.location.origin;
    console.log('🔌 Connecting to WebSocket at:', socketUrl);
    
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('🔌 Connected to VAD server, socket ID:', socket.id);
      setIsConnected(true);
      setError(null);
    });

    socket.on('connected', (data: ConnectionData) => {
      console.log('✅ VAD session initialized:', data);
      setVadProvider(data.vadProvider);
      setVadStats(data.vadStats);
    });

    socket.on('vad_event', (event: VADEvent) => {
      console.log('🎤 VAD Event:', event);
      setLastVADEvent(event);
      
      // Handle speech events for conversation flow
      if (event.type === 'speech_start') {
        // User started speaking - stop AI if it's currently speaking
        if (isPlaying) {
          stopAudio();
          speechSynthesis.cancel();
        }
      }
    });

    socket.on('conversation_state', (data: { state: ConversationState }) => {
      console.log('🔄 Conversation state:', data.state);
      setConversationState(data.state);
    });

    socket.on('transcription', (data: { text: string }) => {
      console.log('📝 Transcription:', data.text);
      setTranscript(data.text);
      
      // Process transcription when speech ends
      if (data.text && data.text.trim()) {
        handleTranscriptionReady(data.text.trim());
      }
    });

    socket.on('ai_response_chunk', (data: { text: string }) => {
      console.log('🤖 AI Response chunk:', data.text);
    });

    socket.on('error', (data: { message: string }) => {
      console.error('❌ Socket error:', data.message);
      setError(data.message);
    });

    socket.on('vad_stats', (data: { stats: VADStats; provider: string; state: ConversationState }) => {
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
  }, [isPlaying, stopAudio]);

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

  // Handle transcription and AI response
  const handleTranscriptionReady = async (transcribedText: string) => {
    try {
      setError(null);
      setTranscript('');
      
      if (!transcribedText.trim()) {
        return;
      }
      
      const studentMessage: ChatMessage = {
        id: Date.now().toString(),
        type: 'student',
        content: transcribedText,
        timestamp: new Date(),
        duration: '0:02',
      };
      
      setMessages(prev => [...prev, studentMessage]);
      setIsTyping(true);

      // Enhanced AI request with conversational context
      const conversationHistory = messages.slice(-4).map(msg => `${msg.type}: ${msg.content}`).join('\n');
      const isFirstMessage = messages.length === 0 || messages[messages.length - 1]?.id === 'welcome';
      
      const enhancedPrompt = `${getConversationalPrompt(transcribedText, isFirstMessage)}
      
      Recent conversation:
      ${conversationHistory}
      
      Student question: ${transcribedText}`;

      // Create AI message placeholder for streaming
      const aiMessageId = (Date.now() + 1).toString();
      const aiMessage: ChatMessage = {
        id: aiMessageId,
        type: 'ai',
        content: '',
        timestamp: new Date(),
        duration: '0:08',
      };
      
      setMessages(prev => [...prev, aiMessage]);
      
      // Start streaming response with optional RAG
      await apiService.askTeacherStream(
        enhancedPrompt,
        // On text chunk - update display immediately
        (chunk: string, fullText: string) => {
          setMessages(prev => prev.map(msg => 
            msg.id === aiMessageId 
              ? { ...msg, content: fullText }
              : msg
          ));
        },
        // On audio chunk - ignore for now, will handle TTS after completion
        (chunkId: number, text: string, audioUrl: string) => {
          // Audio chunks handled after completion
        },
        // On complete
        async (fullText: string, totalChunks: number) => {
          setIsTyping(false);
          const isHindiResponse = /[\u0900-\u097F]/.test(fullText);
          
          setMessages(prev => prev.map(msg => 
            msg.id === aiMessageId 
              ? { ...msg, content: fullText }
              : msg
          ));
          
          // Start TTS
          const speakResponse = async () => {
            try {
              const voiceConfig = {
                voiceName: isHindiResponse ? 'hi-IN-Wavenet-A' : 'en-US-Wavenet-C',
                languageCode: isHindiResponse ? 'hi-IN' : 'en-US',
                speakingRate: 0.85,
              };
              
              const ttsResponse = await apiService.getTextToSpeech(fullText, voiceConfig);
              
              if (ttsResponse.success && ttsResponse.data?.audioUrl) {
                setMessages(prev => prev.map(msg => 
                  msg.id === aiMessageId 
                    ? { ...msg, audioUrl: ttsResponse.data?.audioUrl }
                    : msg
                ));
                
                await playAudio(ttsResponse.data?.audioUrl || '');
              } else {
                // Fallback to Web Speech API
                const utterance = new SpeechSynthesisUtterance(fullText);
                utterance.lang = isHindiResponse ? 'hi-IN' : 'en-US';
                utterance.rate = 0.85;
                speechSynthesis.speak(utterance);
              }
              
            } catch (error) {
              console.log('TTS failed, using Web Speech API');
              const utterance = new SpeechSynthesisUtterance(fullText);
              utterance.lang = isHindiResponse ? 'hi-IN' : 'en-US';
              utterance.rate = 0.85;
              speechSynthesis.speak(utterance);
            }
          };
          
          speakResponse();
        },
        // On error
        (error: string) => {
          setError(`Failed to get AI response: ${error}`);
          setIsTyping(false);
        },
        // Use RAG if enabled and available
        useRag && ragStatus?.isAvailable
      );
    } catch (error) {
      console.error('Error processing transcription:', error);
      setError(error instanceof Error ? error.message : 'An error occurred');
      setIsTyping(false);
    }
  };

  // Start audio recording with VAD
  const startRecording = async () => {
    try {
      setError(null);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
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
      const bufferSize = 4096;
      processorRef.current = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);
      
      processorRef.current.onaudioprocess = (event) => {
        try {
          if (!socketRef.current || !socketRef.current.connected) {
            return;
          }

          const inputBuffer = event.inputBuffer;
          const inputData = inputBuffer.getChannelData(0);
          
          // Convert Float32Array to 16-bit PCM
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(inputData[i] * 32768)));
          }
          
          // Convert to Uint8Array for base64 encoding
          const uint8Array = new Uint8Array(pcmData.buffer);
          const base64String = btoa(String.fromCharCode.apply(null, Array.from(uint8Array)));
          
          if (base64String.length > 0) {
            const audioChunkData = {
              audioData: base64String,
              timestamp: Date.now(),
              size: uint8Array.length,
              samples: pcmData.length,
              format: 'pcm16'
            };
            
            socketRef.current.emit('audio_chunk', audioChunkData);
          }
        } catch (error) {
          console.error('❌ Error processing audio chunk:', error);
        }
      };

      // Connect the audio pipeline
      source.connect(analyzerRef.current);
      source.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);
      
      updateAudioLevel();
      setIsRecording(true);
      conversationStartedRef.current = true;
      console.log('🎤 Recording started with VAD');

    } catch (err) {
      console.error('❌ Failed to start recording:', err);
      setError('Failed to access microphone');
    }
  };

  // Stop audio recording
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
    conversationStartedRef.current = false;
    console.log('🔇 Recording stopped');
  };

  // Start conversation (just begin recording without intro message)
  const startConversation = async () => {
    // Simply start VAD recording without any intro message
    await startRecording();
  };

  // Load RAG status on component mount
  useEffect(() => {
    const loadRagStatus = async () => {
      const response = await apiService.getRagStatus();
      if (response.success && response.data) {
        setRagStatus(response.data);
      }
    };
    loadRagStatus();
  }, []);

  // Load saved messages
  useEffect(() => {
    const savedMessages = storage.getItem<ChatMessage[]>(STORAGE_KEYS.CHAT_MESSAGES) || [];
    setMessages(savedMessages);
  }, []);

  // Save messages when they change
  useEffect(() => {
    if (messages.length > 0) {
      storage.setItem(STORAGE_KEYS.CHAT_MESSAGES, messages);
    }
  }, [messages]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Helper functions for UI
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

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950">
        <Alert className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Voice recording is not supported in your browser. Please use a modern browser like Chrome, Firefox, or Safari.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 safe-area-inset">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-full">
            <GraduationCap className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="font-semibold text-gray-900 dark:text-white">AI Science Tutor</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Class 9 NCERT - Silero VAD</p>
          </div>
          {/* VAD Status */}
          <div className="flex items-center gap-2 ml-4">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <Badge className={getProviderColor(vadProvider)}>
              {vadProvider}
            </Badge>
            {vadStats && (
              <Badge variant="outline" className="text-xs">
                {vadStats.sileroSuccess}/{vadStats.totalProcessed}
              </Badge>
            )}
          </div>
          {/* RAG Toggle */}
          {ragStatus && (
            <div className="flex items-center gap-2 ml-4">
              <BookOpen className="w-4 h-4 text-gray-500" />
              <Switch
                checked={useRag}
                onCheckedChange={setUseRag}
                disabled={!ragStatus.isAvailable}
              />
              <Badge variant={ragStatus.isAvailable ? "secondary" : "outline"} className="text-xs">
                {ragStatus.isAvailable ? (
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    RAG ({ragStatus.totalChunks})
                  </span>
                ) : "RAG Unavailable"}
              </Badge>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onShowProfile}
            className="p-2"
          >
            <UserIcon className="w-5 h-5" />
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onShowSettings}
            className="p-2"
          >
            <SettingsIcon className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <ChatBubble 
            key={message.id} 
            message={message} 
            onPlayAudio={playAudio}
            isPlaying={isPlaying && currentAudio === message.audioUrl}
          />
        ))}
        
        {isTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* VAD Interface */}
      <div className="p-4 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-t border-gray-200 dark:border-gray-700">
        <Card className="bg-white/90 dark:bg-gray-800/90">
          <CardContent className="p-4">
            <div className="flex flex-col items-center space-y-3">
              {/* Live Transcription */}
              {transcript && (
                <div className="w-full p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-1">
                    सुन रहा हूँ...
                  </p>
                  <p className="text-blue-900 dark:text-blue-100">{transcript}</p>
                </div>
              )}

              {/* Conversation State */}
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded-full ${getStateColor(conversationState)}`} />
                <span className="text-sm font-medium capitalize text-gray-700 dark:text-gray-300">
                  {conversationState === 'listening' ? 'सुन रहा हूँ' : 
                   conversationState === 'processing' ? 'समझ रहा हूँ' :
                   conversationState === 'speaking' ? 'बोल रहा हूँ' : 'तैयार हूँ'}
                </span>
              </div>

              {/* Audio Level Indicator */}
              {isRecording && (
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div 
                    className="bg-green-500 h-2 rounded-full transition-all duration-100" 
                    style={{ width: `${Math.min(audioLevel, 100)}%` }}
                  />
                </div>
              )}

              {/* VAD Controls */}
              <div className="flex gap-4">
                {!conversationStartedRef.current ? (
                  <Button
                    onClick={startConversation}
                    disabled={!isConnected}
                    className="flex items-center gap-2"
                  >
                    <Activity className="w-5 h-5" />
                    बातचीत शुरू करें
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={isRecording ? stopRecording : startRecording}
                      disabled={!isConnected}
                      variant={isRecording ? "destructive" : "default"}
                      className="flex items-center gap-2"
                    >
                      {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                      {isRecording ? 'बंद करें' : 'शुरू करें'}
                    </Button>
                  </>
                )}
              </div>


            </div>
          </CardContent>
        </Card>
        
        {/* Instruction Text Above Navigation */}
        <p className="text-center text-sm text-gray-600 dark:text-gray-400 mt-3 mb-2">
          Push the button for your personal learnline
        </p>
      </div>
    </div>
  );
}