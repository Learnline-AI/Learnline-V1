import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { GraduationCap, Settings as SettingsIcon, User as UserIcon, AlertCircle, Play, Pause, BookOpen, Zap } from 'lucide-react';
import { ChatBubble, TypingIndicator } from '@/components/ChatBubble';
import { VoiceButton, VoiceLevel } from '@/components/VoiceButton';
import { useVoiceRecording } from '@/hooks/useVoiceRecording';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { ChatMessage, UserSettings } from '@/types';
import { apiService } from '@/lib/apiService';
import { storage, STORAGE_KEYS } from '@/lib/storage';

interface ChatPageProps {
  onShowSettings: () => void;
  onShowProfile: () => void;
}

export default function ChatPage({ onShowSettings, onShowProfile }: ChatPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<'hindi' | 'english'>('hindi');
  const [conversationStarted, setConversationStarted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [tutorPersonality] = useState<'ravi' | 'meena'>('ravi'); // Default to Ravi Bhaiya
  
  // RAG state
  const [useRag, setUseRag] = useState(false);
  const [ragStatus, setRagStatus] = useState<{
    isAvailable: boolean;
    totalChunks: number;
    isLoaded: boolean;
    chapter: string;
    chapterTitle: string;
  } | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const { isPlaying, currentAudio, playAudio, stopAudio } = useAudioPlayback();

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

  const speakText = (text: string, lang: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.9; // Faster rate
      utterance.pitch = 1;
      utterance.volume = 1;
      
      // Find appropriate voice with better selection
      const voices = speechSynthesis.getVoices();
      let voice;
      
      if (lang.includes('hi')) {
        // Look for Hindi voices
        voice = voices.find(v => v.lang.includes('hi') || v.name.toLowerCase().includes('hindi'));
      } else {
        // Look for English voices
        voice = voices.find(v => v.lang.includes('en') && (v.name.includes('Google') || v.name.includes('Microsoft')));
      }
      
      if (voice) utterance.voice = voice;
      
      speechSynthesis.speak(utterance);
    }
  };

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

  // Conversational handler with interruption support
  const handleTranscriptionReady = async (transcribedText: string) => {
    try {
      setError(null);
      
      if (!transcribedText.trim()) {
        startContinuousListening(); // Restart listening
        return;
      }

      // If AI is currently speaking, stop it (interruption)
      if (isPlaying) {
        stopAudio();
        speechSynthesis.cancel();
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
          
          // Start TTS and then resume listening
          const speakAndListen = async () => {
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
              speakText(fullText, isHindiResponse ? 'hi-IN' : 'en-US');
            }
            
            // Resume listening after AI finishes speaking
            setTimeout(() => {
              if (conversationStarted) {
                startContinuousListening();
              }
            }, 1000);
            
          } catch (error) {
            console.log('TTS failed, using Web Speech API');
            speakText(fullText, isHindiResponse ? 'hi-IN' : 'en-US');
            setTimeout(() => {
              if (conversationStarted) {
                startContinuousListening();
              }
            }, 3000);
          }
        };
        
        speakAndListen();
        },
        // On error
        (error: string) => {
          setError(`Failed to get AI response: ${error}`);
          setIsTyping(false);
          // Resume listening even after error
          setTimeout(() => {
            if (conversationStarted) {
              startContinuousListening();
            }
          }, 2000);
        },
        // Use RAG if enabled and available
        useRag && ragStatus?.isAvailable
      );
    } catch (error) {
      console.error('Error processing transcription:', error);
      setError(error instanceof Error ? error.message : 'An error occurred');
      setIsTyping(false);
      // Resume listening even after error
      setTimeout(() => {
        if (conversationStarted) {
          startContinuousListening();
        }
      }, 2000);
    }
  };

  const handleRecordingComplete = async (audioBlob: Blob) => {
    console.log('Recording completed, audio blob size:', audioBlob.size);
  };

  // Initialize voice recording hook with consistent ordering
  const voiceRecordingProps = {
    onRecordingComplete: handleRecordingComplete,
    onTranscriptionReady: handleTranscriptionReady,
    language: language === 'hindi' ? 'hi-IN' : 'en-US',
  };
  
  const { isRecording, isSupported, transcript, startRecording, stopRecording } = useVoiceRecording(voiceRecordingProps);

  // Continuous listening management
  const startContinuousListening = useCallback(() => {
    if (!conversationStarted || isPlaying || !startRecording) return;
    
    setIsListening(true);
    startRecording();
    
    // Clear any existing timeout
    if (conversationTimeoutRef.current) {
      clearTimeout(conversationTimeoutRef.current);
    }
    
    // Set timeout to stop listening after silence
    conversationTimeoutRef.current = setTimeout(() => {
      if (stopRecording) {
        stopRecording();
      }
      setIsListening(false);
      // Restart listening after a brief pause
      setTimeout(() => {
        if (conversationStarted && !isPlaying) {
          startContinuousListening();
        }
      }, 2000);
    }, 5000); // 5 seconds of continuous listening
  }, [conversationStarted, isPlaying, startRecording, stopRecording]);

  // Start conversation with intro
  const startConversation = async () => {
    setConversationStarted(true);
    
    const introMessage = tutorPersonality === 'ravi' 
      ? `नमस्ते! मैं रवि भैया हूँ, आपका साइंस टीचर। Class 9 के किसी भी science topic के बारे में पूछिए - मैं आसान भाषा में समझाऊंगा। आज क्या पढ़ना है?`
      : `हैलो! मैं मीना दीदी हूँ। Class 9 साइंस में कोई भी doubt हो तो बेझिझक पूछिए। रोज़ाना की जिंदगी से examples देकर समझाती हूँ। बताइए, क्या सीखना चाहते हैं?`;

    const welcomeMsg: ChatMessage = {
      id: 'welcome',
      type: 'ai',
      content: introMessage,
      timestamp: new Date(),
      duration: '0:15',
    };
    
    setMessages([welcomeMsg]);
    
    // Speak the intro
    try {
      const ttsResponse = await apiService.getTextToSpeech(introMessage, {
        voiceName: 'hi-IN-Wavenet-A',
        languageCode: 'hi-IN',
        speakingRate: 0.85,
      });
      
      if (ttsResponse.success && ttsResponse.data?.audioUrl) {
        setMessages(prev => prev.map(msg => 
          msg.id === 'welcome' 
            ? { ...msg, audioUrl: ttsResponse.data?.audioUrl }
            : msg
        ));
        
        await playAudio(ttsResponse.data?.audioUrl || '');
      } else {
        speakText(introMessage, 'hi-IN');
      }
      
      // Start listening after intro finishes
      setTimeout(() => {
        startContinuousListening();
      }, 2000);
      
    } catch (error) {
      console.log('Using Web Speech for intro');
      speakText(introMessage, 'hi-IN');
      setTimeout(() => {
        startContinuousListening();
      }, 8000);
    }
  };

  // Load saved messages and settings
  useEffect(() => {
    const savedMessages = storage.getItem<ChatMessage[]>(STORAGE_KEYS.CHAT_MESSAGES) || [];
    setMessages(savedMessages);
    
    const settings = storage.getItem<UserSettings>(STORAGE_KEYS.USER_SETTINGS);
    if (settings?.preferredLanguage) {
      setLanguage(settings.preferredLanguage === 'hinglish' ? 'hindi' : settings.preferredLanguage);
    }
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

  // Show welcome message on first load
  useEffect(() => {
    if (messages.length === 0) {
      const welcomeMessage: ChatMessage = {
        id: 'welcome',
        type: 'ai',
        content: language === 'hindi' 
          ? 'नमस्ते! मैं आपका AI विज्ञान शिक्षक हूँ। Class 9 के विज्ञान के बारे में कोई भी सवाल पूछिए।'
          : 'Hello! I am your AI Science teacher. Ask me any questions about Class 9 Science topics.',
        timestamp: new Date(),
        duration: '0:03',
      };
      setMessages([welcomeMessage]);
    }
  }, [language]);

  if (!isSupported) {
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
            <p className="text-sm text-gray-500 dark:text-gray-400">Class 9 NCERT</p>
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

      {/* Voice Recording Interface */}
      <div className="p-4 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-t border-gray-200 dark:border-gray-700">
        <Card className="bg-white/90 dark:bg-gray-800/90">
          <CardContent className="p-6">
            <div className="flex flex-col items-center space-y-4">
              {/* Live Transcription */}
              {transcript && (
                <div className="w-full p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-1">
                    {language === 'hindi' ? 'सुन रहा हूँ...' : 'Listening...'}
                  </p>
                  <p className="text-blue-900 dark:text-blue-100">{transcript}</p>
                </div>
              )}

              {/* Voice Level Indicator */}
              <VoiceLevel isVisible={isRecording} />

              {/* Voice Button */}
              <VoiceButton
                isRecording={isRecording}
                onStartRecording={startRecording}
                onStopRecording={stopRecording}
                disabled={isTyping}
              />

              {/* Instructions */}
              <p className="text-center text-sm text-gray-600 dark:text-gray-400">
                {language === 'hindi' 
                  ? 'बटन दबाकर अपना सवाल पूछें' 
                  : 'Press and hold to ask your question'
                }
              </p>

              {/* Language Toggle */}
              <div className="flex gap-2">
                <Button
                  variant={language === 'hindi' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setLanguage('hindi')}
                  className="text-xs"
                >
                  हिंदी
                </Button>
                <Button
                  variant={language === 'english' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setLanguage('english')}
                  className="text-xs"
                >
                  English
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}