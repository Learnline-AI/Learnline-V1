import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { GraduationCap, Settings as SettingsIcon, User as UserIcon, AlertCircle, Play, Pause } from 'lucide-react';
import { ChatBubble, TypingIndicator } from '@/components/ChatBubble';
import { VoiceButton, VoiceLevel } from '@/components/VoiceButton';
import { PushToTalkButton } from '@/components/ui/PushToTalkButton';
import { useVoiceRecording } from '@/hooks/useVoiceRecording';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
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
  
  const { isPlaying, currentAudio, playAudio, stopAudio, initializeAudioContext } = useAudioPlayback();
  const [isAudioContextBlocked, setIsAudioContextBlocked] = useState(false);
  


  const speakText = (text: string, lang: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;
      
      const voices = speechSynthesis.getVoices();
      let voice;
      
      if (lang.includes('hi')) {
        voice = voices.find(v => v.lang.includes('hi') || v.name.toLowerCase().includes('hindi'));
      } else {
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

  // Conversational handler with interruption support and feedback loop prevention
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
        'class 9',
        'साइंस',
        'science',
        'समझाऊंगा',
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
      
      // Start streaming response
      await apiService.askTeacherStream(
        enhancedPrompt,
        // On each chunk
        (chunk: string, fullText: string) => {
          setMessages(prev => prev.map(msg => 
            msg.id === aiMessageId 
              ? { ...msg, content: fullText }
              : msg
          ));
        },
        // On audio chunk
        (chunkId: number, text: string, audioUrl: string) => {
          // Audio queue not implemented in this broken version
        },
        // On complete
        (fullText: string) => {
          setIsTyping(false);
          setMessages(prev => prev.map(msg => 
            msg.id === aiMessageId 
              ? { ...msg, content: fullText }
              : msg
          ));
          
          // Start TTS immediately after streaming completes
          const isHindiResponse = /[\u0900-\u097F]/.test(fullText);
          startTTSPlayback(fullText, isHindiResponse, aiMessageId);
        },
        // On error
        (error: string) => {
          setIsTyping(false);
          setError(error);
        }
      );
    } catch (error) {
      console.error('Error processing transcription:', error);
      setError(error instanceof Error ? error.message : 'An error occurred');
      setIsTyping(false);
    }
  };

  const handleRecordingComplete = async (audioBlob: Blob) => {
    console.log('Recording completed, audio blob size:', audioBlob.size, 'type:', audioBlob.type);
    
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
        throw new Error('Speech recognition failed');
      }
    } catch (error) {
      console.error('Error processing audio:', error);
      setError('Failed to process audio recording. Please check your connection.');
    }
  };
  
  // Simple push-to-talk voice recording
  const {
    isRecording,
    isSupported,
    startRecording,
    stopRecording,
  } = useVoiceRecording({
    onRecordingComplete: handleRecordingComplete,
    maxDuration: 30000
  });

  // No automatic listening - only manual push-to-talk

  // Audio context state for iOS compatibility
  const [audioContextUnlocked, setAudioContextUnlocked] = useState(false);

  // Initialize audio context for iOS compatibility
  const initializeAudio = useCallback(() => {
    if (audioContextUnlocked) return;
    
    try {
      // Create a dummy audio element and play it to unlock audio context
      const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      audio.play().then(() => {
        console.log('Audio context initialized and unlocked');
        setAudioContextUnlocked(true);
      }).catch(() => {
        console.log('Audio context initialization failed, but that is expected');
        // Even if it fails, we mark as unlocked since the attempt was made with user interaction
        setAudioContextUnlocked(true);
      });
    } catch (error) {
      console.log('Audio initialization error:', error);
      setAudioContextUnlocked(true);
    }
  }, [audioContextUnlocked]);

  // Start conversation without automatic intro
  const startConversation = async () => {
    // Initialize audio context for iOS Safari
    initializeAudio();
    setConversationStarted(true);
    console.log('Conversation started - ready for user to tap Listen button');
  };

  // Stop conversation
  const stopConversation = () => {
    setConversationStarted(false);
    stopRecording();
    if (conversationTimeoutRef.current) {
      clearTimeout(conversationTimeoutRef.current);
    }
    if (isPlaying) {
      stopAudio();
    }
    speechSynthesis.cancel();
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (conversationTimeoutRef.current) {
        clearTimeout(conversationTimeoutRef.current);
      }
      speechSynthesis.cancel();
    };
  }, []);

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
            <h1 className="font-semibold text-gray-900 dark:text-white">
              {tutorPersonality === 'ravi' ? 'Ravi Bhaiya' : 'Meena Didi'}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {conversationStarted ? (isRecording ? '🎤 Recording...' : isPlaying ? '🔊 Speaking...' : '💬 Ready to chat') : 'AI Science Tutor'}
            </p>
          </div>
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

      {/* Messages Area - Reduced height to make room for fixed controls */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 pb-32">
        {!conversationStarted ? (
          <Card className="mx-auto max-w-sm">
            <CardContent className="p-6 text-center">
              <GraduationCap className="w-12 h-12 mx-auto mb-4 text-blue-600" />
              <h2 className="text-lg font-semibold mb-2">
                {tutorPersonality === 'ravi' ? 'Ravi Bhaiya के साथ सीखें' : 'Meena Didi के साथ पढ़ें'}
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Press "Start Learning" to begin. Then tap "Listen" whenever you want to ask a question!
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="absolute bottom-28 left-4 right-4 z-10">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Start Learning Button */}
      {!conversationStarted && (
        <div className="fixed bottom-20 left-4 right-4 z-10">
          <Button
            onClick={() => setConversationStarted(true)}
            className="w-full h-14 text-lg"
            size="lg"
          >
            <Play className="w-5 h-5 mr-2" />
            Start Learning
          </Button>
        </div>
      )}

      {/* Push-to-talk button - positioned higher */}
      {conversationStarted && (
        <div className="fixed bottom-32 left-4 z-10">
          <PushToTalkButton 
            onRecordingComplete={handleRecordingComplete}
            disabled={isPlaying}
          />
        </div>
      )}

      {/* End Chat Button - bottom aligned with mic button */}
      {conversationStarted && (
        <div className="fixed bottom-32 right-4 z-10">
          <Button
            onClick={stopConversation}
            variant="destructive"
            className="h-12 px-6"
          >
            End Chat
          </Button>
        </div>
      )}
    </div>
  );
}