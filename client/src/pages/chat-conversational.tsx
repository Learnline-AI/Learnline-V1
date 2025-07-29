import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { GraduationCap, Settings as SettingsIcon, User as UserIcon, AlertCircle, Play, Pause, BookOpen, Zap } from 'lucide-react';
import { ChatBubble, TypingIndicator } from '@/components/ChatBubble';
import { VoiceButton, VoiceLevel } from '@/components/VoiceButton';
import { PushToTalkButton } from '@/components/ui/PushToTalkButton';
import { useVoiceRecording } from '@/hooks/useVoiceRecording';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { useAudioQueue } from '@/hooks/useAudioQueue';
import { ChatMessage, UserSettings } from '@/types';
import { apiService } from '@/lib/apiService';
import { storage, STORAGE_KEYS } from '@/lib/storage';

interface ChatPageProps {
  onShowSettings: () => void;
  onShowProfile: () => void;
}

export default function ConversationalChatPage({ onShowSettings, onShowProfile }: ChatPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<'hindi' | 'english'>('hindi');
  const [conversationStarted, setConversationStarted] = useState(false);
  const [tutorPersonality] = useState<'ravi' | 'meena'>('ravi');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // RAG state
  const [useRag, setUseRag] = useState(false);
  const [ragStatus, setRagStatus] = useState<{
    isAvailable: boolean;
    totalChunks: number;
    isLoaded: boolean;
    chapter: string;
    chapterTitle: string;
  } | null>(null);
  
  const { isPlaying, currentAudio, playAudio, stopAudio, initializeAudioContext } = useAudioPlayback();
  const audioQueue = useAudioQueue();
  const [isAudioContextBlocked, setIsAudioContextBlocked] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<'elevenlabs' | 'google'>('elevenlabs');

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

  // Auto-scroll to bottom when new messages appear
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  // Web Speech API fallback for iOS
  const speakText = (text: string, lang: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.8;
      speechSynthesis.speak(utterance);
    }
  };

  const getConversationalPrompt = (studentQuestion: string, isFirstMessage: boolean) => {
    const personality = tutorPersonality === 'ravi' ? 
      'रवि भैया (Ravi Bhaiya) - enthusiastic male tutor' : 
      'मीना दीदी (Meena Didi) - patient female tutor';
    
    const conversationalStyle = `
    You are ${personality}, a friendly AI tutor for Class 9 Science NCERT curriculum. 
    
    Respond in ${language === 'hindi' ? 'Hindi/Hinglish mix' : 'English'} in a conversational, encouraging tone.
    
    Teaching style:
    - Use simple examples students can relate to
    - Ask follow-up questions to check understanding
    - Encourage curiosity and deeper thinking
    - Mix Hindi and English naturally if language is Hindi
    - Keep responses concise but engaging (2-3 sentences max)
    - End with a question to maintain conversation flow
    
    ${isFirstMessage ? 'Answer the student question directly without introducing yourself.' : ''}
    `;

    return conversationalStyle;
  };

  // TTS playback function with Hindi voice support
  const startTTSPlayback = async (text: string, isHindi: boolean, messageId: string) => {
    try {
      const voiceConfig = {
        voiceName: isHindi ? 'hi-IN-Wavenet-A' : 'en-US-Wavenet-C',
        languageCode: isHindi ? 'hi-IN' : 'en-US',
        speakingRate: 0.85,
      };
      
      const ttsResponse = await apiService.getTextToSpeech(text, voiceConfig);
      console.log('TTS Response with Hindi voice selection:', ttsResponse);
      
      if (ttsResponse.success && ttsResponse.data?.audioUrl) {
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { ...msg, audioUrl: ttsResponse.data?.audioUrl }
            : msg
        ));
        
        try {
          // Auto-play audio immediately when TTS is ready
          await playAudio(ttsResponse.data?.audioUrl || '');
          console.log('AI finished speaking, ready for next question');
        } catch (audioError) {
          console.error('Audio playback failed:', audioError);
          speakText(text, isHindi ? 'hi-IN' : 'en-US');
        }
      } else {
        console.log('TTS failed, using Web Speech API fallback');
        speakText(text, isHindi ? 'hi-IN' : 'en-US');
      }
    } catch (error) {
      console.log('TTS failed, using Web Speech API');
      speakText(text, isHindi ? 'hi-IN' : 'en-US');
    }
  };

  // Streaming conversational handler
  const handleTranscriptionReady = async (transcribedText: string) => {
    try {
      setError(null);
      
      if (!transcribedText.trim()) {
        return;
      }

      // Enhanced feedback loop prevention
      const text = transcribedText.toLowerCase();
      const aiPhrases = [
        'नमस्ते मैं रवि भैया हूँ',
        'हैलो मैं मीना दीदी हूँ',
        'समझाती हूँ',
        'बहुत बढ़िया',
        'और कोई doubt',
        'आगे बढ़ते हैं'
      ];
      
      const isLikelyAIFeedback = aiPhrases.some(phrase => text.includes(phrase)) ||
                                 text.length < 3 ||
                                 /^[a-z\s]*$/.test(text) && text.length < 10;
      
      if (isLikelyAIFeedback) {
        console.log('Detected AI speech feedback, ignoring:', transcribedText);
        return;
      }

      console.log('Processing valid user input:', transcribedText);
      
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
      
      // Clear previous audio queue
      audioQueue.clearQueue();

      // Start streaming response with chunked audio
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
        // On audio chunk - add to queue for parallel playback
        (chunkId: number, text: string, audioUrl: string) => {
          console.log(`🎉 CALLBACK RECEIVED: Audio chunk ${chunkId}: ${text.substring(0, 50)}...`);
          console.log(`🎉 Audio URL length: ${audioUrl.length}, starts with: ${audioUrl.substring(0, 30)}`);
          console.log(`🎉 ADDING TO QUEUE: Chunk ${chunkId}`);
          audioQueue.addChunk(chunkId, text, audioUrl);
        },
        // On complete - only called when all audio chunks are processed
        (fullText: string, totalChunks: number) => {
          setIsTyping(false);
          setMessages(prev => prev.map(msg => 
            msg.id === aiMessageId 
              ? { ...msg, content: fullText, audioUrl: 'streaming' }
              : msg
          ));
          console.log(`All processing complete. Total audio chunks: ${totalChunks}`);
        },
        // On error
        (error: string) => {
          setIsTyping(false);
          setError(error);
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

  const handleRecordingComplete = async (audioBlob: Blob) => {
    console.log('Recording completed, audio blob size:', audioBlob.size, 'type:', audioBlob.type);
    
    // Interrupt any currently playing audio when user starts speaking
    if (audioQueue.isPlaying) {
      console.log('🎙️ User speaking - interrupting current audio');
      audioQueue.interrupt();
    }
    
    // Initialize audio context for Safari during user interaction
    if (initializeAudioContext) {
      initializeAudioContext();
    }
    
    try {
      // Convert audio blob to base64 for API transmission
      const reader = new FileReader();
      const base64Audio = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      });
      
      // Send to backend for speech-to-text processing
      const response = await fetch('/api/speech-to-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio: base64Audio,
          language: language === 'hindi' ? 'hi-IN' : 'en-US',
          mimeType: audioBlob.type
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.transcript && result.transcript.trim()) {
          await handleTranscriptionReady(result.transcript);
        } else {
          setError('Could not understand the audio. Please try again.');
        }
      } else {
        const errorText = await response.text();
        console.error('Speech-to-text API error:', errorText);
        throw new Error(`Speech recognition failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Error processing audio:', error);
      if (error instanceof Error && error.message.includes('Permission')) {
        setError('Microphone permission required. Please allow microphone access.');
      } else if (error instanceof Error && error.message.includes('network')) {
        setError('Network error. Please check your internet connection.');
      } else {
        setError('Could not process your voice. Please try speaking again.');
      }
    }
  };

  // Welcome message setup
  useEffect(() => {
    if (messages.length === 0) {
      setConversationStarted(true);
      
      // Clear any existing timeout
      if (conversationTimeoutRef.current) {
        clearTimeout(conversationTimeoutRef.current);
      }
      
      // Start conversation listening mode
      if (!isPlaying) {
        stopAudio();
      }
    }
  }, [isPlaying, stopAudio]);

  // Auto-scroll effect
  useEffect(() => {
    if (messagesEndRef.current && (messages.length > 0 || isTyping)) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (conversationTimeoutRef.current) {
        clearTimeout(conversationTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-2 rounded-lg">
              <GraduationCap className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
                {tutorPersonality === 'ravi' ? 'रवि भैया' : 'मीना दीदी'}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Class 9 Science Tutor</p>
            </div>
            {/* RAG Toggle */}
            {ragStatus && (
              <div className="flex items-center gap-2 ml-2">
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
          <div className="flex items-center space-x-2">
            {/* TTS Provider Selection */}
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => setTtsProvider('elevenlabs')}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  ttsProvider === 'elevenlabs' 
                    ? 'bg-blue-500 text-white' 
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white'
                }`}
              >
                Quality
              </button>
              <button
                onClick={() => setTtsProvider('google')}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  ttsProvider === 'google' 
                    ? 'bg-green-500 text-white' 
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white'
                }`}
              >
                Speed
              </button>
            </div>
            <Button variant="ghost" size="sm" onClick={onShowProfile}>
              <UserIcon className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onShowSettings}>
              <SettingsIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Debug Panel - removed for now */}
      {false && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 p-3">
          <div className="text-sm font-semibold mb-2">Audio Queue Debug:</div>
          <div className="text-xs space-y-1">
            <div>Queue Length: {audioQueue.queueLength}</div>
            <div>Is Playing: {audioQueue.isPlaying ? 'Yes' : 'No'}</div>
            <div>Current Chunk: {audioQueue.currentChunk ? `${audioQueue.currentChunk.chunkId} - "${audioQueue.currentChunk.text.substring(0, 40)}..."` : 'None'}</div>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => audioQueue.clearQueue()}
              className="mt-2 text-xs h-6"
            >
              Clear Queue
            </Button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <Alert className="bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <AlertDescription className="text-red-800 dark:text-red-200">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {messages.length === 0 && !error && (
          <div className="text-center py-8">
            <div className="text-gray-500 dark:text-gray-400 mb-4">
              <GraduationCap className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p className="text-lg font-medium">Welcome to Class 9 Science!</p>
              <p className="text-sm">Hold the microphone button above to ask your first question</p>
            </div>
          </div>
        )}

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

      {/* Floating Microphone Button - positioned above bottom navigation */}
      <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 z-50">
        <PushToTalkButton
          onRecordingComplete={handleRecordingComplete}
          onRecordingStart={() => {
            if (audioQueue.isPlaying) {
              console.log('🎙️ Mic pressed - interrupting audio');
              audioQueue.interrupt();
            }
          }}
          disabled={isTyping}
        />
      </div>
    </div>
  );
}