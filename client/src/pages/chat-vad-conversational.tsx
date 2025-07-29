import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { GraduationCap, Settings as SettingsIcon, User as UserIcon, AlertCircle, Play, Pause, BookOpen, Zap, Mic, MicOff, CheckCircle } from 'lucide-react';
import { ChatBubble, TypingIndicator } from '@/components/ChatBubble';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { useAudioQueue } from '@/hooks/useAudioQueue';
import { ChatMessage, UserSettings } from '@/types';
import { apiService } from '@/lib/apiService';
import { storage, STORAGE_KEYS } from '@/lib/storage';
import { MicVAD, utils } from '@ricky0123/vad-web';

interface ChatPageProps {
  onShowSettings: () => void;
  onShowProfile: () => void;
}

type ConversationState = 'idle' | 'listening' | 'processing' | 'speaking';

export default function VADConversationalChatPage({ onShowSettings, onShowProfile }: ChatPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<'hindi' | 'english'>('hindi');
  const [conversationStarted, setConversationStarted] = useState(false);
  const [tutorPersonality] = useState<'ravi' | 'meena'>('ravi');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Silero VAD State Management
  const [isVADActive, setIsVADActive] = useState(false);
  const [conversationState, setConversationState] = useState<ConversationState>('idle');
  const [speechProbability, setSpeechProbability] = useState<number>(0);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  
  // Silero VAD and Audio References
  const micVADRef = useRef<MicVAD | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSpeechSegmentRef = useRef<Float32Array[]>([]);
  const isMountedRef = useRef<boolean>(true);
  
  // Audio level monitoring (like VAD test page)
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number>();
  
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

  // Audio level monitoring function (from VAD test page)
  const updateAudioLevel = useCallback(() => {
    if (analyzerRef.current && dataArrayRef.current && isMountedRef.current) {
      analyzerRef.current.getByteFrequencyData(dataArrayRef.current);
      
      let sum = 0;
      for (let i = 0; i < dataArrayRef.current.length; i++) {
        sum += dataArrayRef.current[i];
      }
      const average = sum / dataArrayRef.current.length;
      const normalizedLevel = average / 255 * 100;
      
      // Blend VAD speech probability with actual audio level for better visualization
      const blendedLevel = Math.max(normalizedLevel, speechProbability * 100);
      setAudioLevel(blendedLevel);
      
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    }
  }, [speechProbability]);

  // Initialize Silero VAD
  useEffect(() => {
    const initializeSileroVAD = async () => {
      try {
        console.log('🧠 Initializing Silero VAD...');
        setError(null);

        // Create audio context for gain control (audio ducking)
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioContext;
        gainNodeRef.current = audioContext.createGain();
        gainNodeRef.current.connect(audioContext.destination);

        // Production-grade Silero VAD configuration for educational AI
        // Model selection: "v5" (newer, potentially more accurate) or "legacy" (stable, well-tested)
        // v5: Latest Silero model with improved accuracy for diverse accents and languages
        // legacy: Original model, proven stable performance
        const vadModel: "v5" | "legacy" = "v5"; // Switch to "legacy" if v5 causes issues
        
        // Calculate frame counts for precise timing using VAD utility - TUNED FOR HINDI/ENGLISH SPEECH
        const frameSamples = vadModel === "v5" ? 512 : 1536; // V5 model expects 512, legacy expects 1536
        const redemptionFrames = utils.minFramesForTargetMS(800, frameSamples); // 800ms grace period (was 200ms)
        const preSpeechPadFrames = utils.minFramesForTargetMS(300, frameSamples); // 300ms pre-speech padding (was 100ms)
        const minSpeechFrames = utils.minFramesForTargetMS(1000, frameSamples); // 1000ms minimum speech (was 200ms)
        
        console.log(`🧠 Initializing Silero VAD ${vadModel} model with calculated frame timing`);
        
        const vad = await MicVAD.new({
          // Model selection for testing accuracy
          model: vadModel,
          // TUNED thresholds for Hindi/English speech - less aggressive
          positiveSpeechThreshold: 0.5,    // Lowered from 0.8 - more sensitive to speech start
          negativeSpeechThreshold: 0.35,   // Raised from 0.2 - wait longer before ending speech
          frameSamples,                    // Explicit frame size for predictable behavior
          redemptionFrames,                // Calculated frames for 200ms grace period
          preSpeechPadFrames,              // Calculated frames for 100ms pre-speech padding
          minSpeechFrames,                 // Calculated frames for 200ms minimum speech
          submitUserSpeechOnPause: true,   // Submit speech when user pauses VAD for better UX
          
          // Enhanced audio constraints for better microphone control
          additionalAudioConstraints: {
            sampleRate: 16000,             // Ensure consistent sample rate for VAD model
            echoCancellation: true,        // Better audio quality
            noiseSuppression: true,        // Reduce background noise
            // Note: Other advanced constraints like latency are handled by the VAD library internally
          },
          
          // Real-time processing callbacks
          onFrameProcessed: (probabilities) => {
            // Update speech probability for visual feedback
            // probabilities is a SpeechProbabilities object with { notSpeech, isSpeech }
            const speechProbability = probabilities.isSpeech;
            if (isMountedRef.current) {
              setSpeechProbability(speechProbability);
              setAudioLevel(speechProbability * 100);
            }
          },

          onSpeechStart: () => {
            console.log('🎤 Silero VAD: Speech started (initial detection)');
            if (!isMountedRef.current) return;
            
            setConversationState('listening');
            setIsRecordingVoice(true);
            
            // Clear previous speech segment
            currentSpeechSegmentRef.current = [];
            
            // Interrupt AI if speaking (audio ducking)
            if (audioQueue.isPlaying) {
              console.log('🔇 Ducking AI audio - user is speaking');
              audioQueue.interrupt();
              // Apply audio ducking if gainNode is available
              if (gainNodeRef.current && audioContextRef.current) {
                gainNodeRef.current.gain.setTargetAtTime(0.15, audioContextRef.current.currentTime, 0.1);
              }
            }
          },

          onSpeechRealStart: () => {
            console.log('✅ Silero VAD: Valid speech confirmed (not a misfire)');
            if (!isMountedRef.current) return;
            
            // This provides more accurate feedback that real speech has started
            // Could be used for more precise UI updates or analytics
          },

          onSpeechEnd: (audio) => {
            console.log('🔇 Silero VAD: Speech ended, processing audio...');
            if (!isMountedRef.current) return;
            
            setConversationState('processing');
            setIsRecordingVoice(false);
            
            // Restore AI audio volume
            if (gainNodeRef.current && audioContextRef.current) {
              gainNodeRef.current.gain.setTargetAtTime(1.0, audioContextRef.current.currentTime, 0.1);
            }
            
            // Process the collected speech audio
            handleSpeechAudio(audio);
          },

          onVADMisfire: () => {
            console.log('⚠️ Silero VAD: False positive detected, ignoring');
            if (!isMountedRef.current) return;
            
            setConversationState('idle');
            setIsRecordingVoice(false);
          }
        });

        micVADRef.current = vad;
        
        // Start VAD processing
        await vad.start();
        
        // Set up audio level monitoring by getting access to the MediaStream
        // The VAD library creates its own MediaStream internally, so we need to create our own for monitoring
        try {
          const monitoringStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              sampleRate: 16000,
              echoCancellation: true,
              noiseSuppression: true,
            }
          });
          
          mediaStreamRef.current = monitoringStream;
          
          // Set up audio analyzer for level monitoring (like VAD test page)
          const source = audioContextRef.current!.createMediaStreamSource(monitoringStream);
          analyzerRef.current = audioContextRef.current!.createAnalyser();
          analyzerRef.current.fftSize = 256;
          const bufferLength = analyzerRef.current.frequencyBinCount;
          dataArrayRef.current = new Uint8Array(bufferLength);
          
          // Connect source to analyzer for monitoring (no output to prevent feedback)
          source.connect(analyzerRef.current);
          
          // Start audio level monitoring
          updateAudioLevel();
          
          console.log('✅ Audio level monitoring initialized');
        } catch (audioError) {
          console.warn('⚠️ Audio level monitoring setup failed:', audioError);
          // VAD will still work without level monitoring
        }
        
        if (isMountedRef.current) {
          setIsVADActive(true);
          setConversationState('idle');
        }
        
        console.log('✅ Silero VAD initialized and running');

      } catch (error) {
        console.error('❌ Failed to initialize Silero VAD:', error);
        if (isMountedRef.current) {
          setError('Failed to initialize voice detection. Please refresh the page.');
          setIsVADActive(false);
        }
      }
    };

    initializeSileroVAD();

    // Cleanup function
    return () => {
      if (micVADRef.current) {
        try {
          micVADRef.current.destroy();
          micVADRef.current = null;
        } catch (error) {
          console.warn('Error destroying VAD during initialization cleanup:', error);
        }
      }
      
      // Stop audio level monitoring
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      
      // Clean up monitoring MediaStream
      if (mediaStreamRef.current) {
        try {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
        } catch (error) {
          console.warn('Error stopping MediaStream tracks during initialization cleanup:', error);
        }
      }
      
      // Clean up audio analyzer
      if (analyzerRef.current) {
        try {
          analyzerRef.current.disconnect();
          analyzerRef.current = null;
        } catch (error) {
          console.warn('Error disconnecting AnalyserNode during initialization cleanup:', error);
        }
      }
      
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
          audioContextRef.current = null;
        } catch (error) {
          console.warn('Error closing AudioContext during initialization cleanup:', error);
        }
      }
      
      if (gainNodeRef.current) {
        try {
          gainNodeRef.current.disconnect();
          gainNodeRef.current = null;
        } catch (error) {
          console.warn('Error disconnecting GainNode during initialization cleanup:', error);
        }
      }
      
      setIsVADActive(false);
    };
  }, []);

  // Load RAG status on component mount
  useEffect(() => {
    const loadRagStatus = async () => {
      try {
        const response = await apiService.getRagStatus();
        if (response.success && response.data && isMountedRef.current) {
          setRagStatus(response.data);
        }
      } catch (error) {
        console.warn('Error loading RAG status:', error);
      }
    };
    loadRagStatus();
  }, []);

  // Handle audio recording completion (from working chat page)
  const handleRecordingComplete = async (audioBlob: Blob) => {
    console.log('🎤 VAD AUDIO PROCESSING: Recording completed');
    console.log('📊 Audio blob details:', {
      size: audioBlob.size,
      type: audioBlob.type,
      sizeKB: Math.round(audioBlob.size / 1024),
      duration: 'unknown' // VAD doesn't provide duration
    });
    
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
      // Convert audio blob to base64 for API transmission using VAD library utility
      const arrayBuffer = await audioBlob.arrayBuffer();
      const base64Audio = utils.arrayBufferToBase64(arrayBuffer);
      
      console.log('🔄 AUDIO CONVERSION:', {
        arrayBufferSize: arrayBuffer.byteLength,
        base64Length: base64Audio.length,
        expectedSize: Math.round(arrayBuffer.byteLength * 1.33) // base64 is ~33% larger
      });
      
      // Send to backend for speech-to-text processing
      console.log('📤 SENDING TO STT API:', {
        endpoint: '/api/speech-to-text',
        language: language === 'hindi' ? 'hi-IN' : 'en-US',
        mimeType: audioBlob.type,
        payloadSize: base64Audio.length
      });
      
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
      
      console.log('📥 STT API RESPONSE:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ STT SUCCESS:', result);
        
        if (!isMountedRef.current) return; // Check if component is still mounted
        
        if (result.success && result.transcript && result.transcript.trim()) {
          console.log('🎯 TRANSCRIPT READY:', result.transcript);
          await handleTranscriptionReady(result.transcript);
        } else {
          console.warn('⚠️ STT NO TRANSCRIPT:', result);
          setError('Could not understand the audio. Please try again.');
          setConversationState('idle');
        }
      } else {
        const errorText = await response.text();
        console.error('❌ STT API ERROR:', {
          status: response.status,
          statusText: response.statusText,
          errorText: errorText
        });
        throw new Error(`Speech recognition failed: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('Error processing audio:', error);
      if (!isMountedRef.current) return; // Check if component is still mounted
      
      if (error instanceof Error && error.message.includes('Permission')) {
        setError('Microphone permission required. Please allow microphone access.');
      } else if (error instanceof Error && error.message.includes('network')) {
        setError('Network error. Please check your internet connection.');
      } else if (error instanceof Error && error.message.includes('413')) {
        setError('Audio file too large. Please try speaking for a shorter duration.');
      } else if (error instanceof Error && error.message.includes('request entity too large')) {
        setError('Audio file too large. Please try speaking for a shorter duration.');
      } else {
        setError('Could not process your voice. Please try speaking again.');
      }
      setConversationState('idle');
    }
  };

  // Handle processed speech audio from Silero VAD
  const handleSpeechAudio = async (audioData: Float32Array) => {
    try {
      const durationMs = Math.round((audioData.length / 16000) * 1000); // Assuming 16kHz
      console.log('🔊 VAD SPEECH PROCESSING START:', {
        samples: audioData.length,
        durationMs: durationMs,
        durationSeconds: (durationMs / 1000).toFixed(2),
        sampleRate: '16kHz (assumed)',
        dataType: 'Float32Array',
        isLikelyTooShort: durationMs < 500 ? 'YES - MAY BE CLIPPED!' : 'No'
      });
      
      // Warn if audio segment seems too short for reliable STT
      if (durationMs < 500) {
        console.warn('⚠️ Audio segment may be too short for reliable STT:', durationMs + 'ms');
      }
      
      if (!isMountedRef.current) return; // Check if component is still mounted
      
      // Convert Float32Array to 16-bit PCM for API compatibility
      const pcmData = new Int16Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(audioData[i] * 32768)));
      }
      
      console.log('🔄 AUDIO FORMAT CONVERSION:', {
        originalSamples: audioData.length,
        pcmSamples: pcmData.length,
        originalType: 'Float32Array (-1 to 1)',
        convertedType: 'Int16Array (-32768 to 32767)'
      });
      
      // Create audio blob for STT API (WAV format)
      const audioBuffer = utils.encodeWAV(audioData);
      const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' });
      
      console.log('📦 WAV ENCODING:', {
        bufferSize: audioBuffer.byteLength,
        blobSize: audioBlob.size,
        mimeType: audioBlob.type,
        format: 'WAV via utils.encodeWAV()'
      });
      
      // Use handleRecordingComplete logic
      await handleRecordingComplete(audioBlob);
      
    } catch (error) {
      console.error('❌ Error processing speech audio:', error);
      if (!isMountedRef.current) return; // Check if component is still mounted
      
      setError('Failed to process speech. Please try again.');
      setConversationState('idle');
    }
  };

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

  // Streaming conversational handler (modified for VAD integration)
  const handleTranscriptionReady = async (transcribedText: string) => {
    try {
      setError(null);
      
      if (!transcribedText.trim()) {
        // Return to listening if empty transcription
        setConversationState('idle');
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
        setConversationState('idle'); // Return to listening
        return;
      }

      console.log('Processing valid user input:', transcribedText);
      
      // Set state to processing
      setConversationState('processing');
      
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
      
      // Set state to speaking when AI starts responding
      setConversationState('speaking');

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
          console.log(`🎉 Audio chunk ${chunkId}: ${text.substring(0, 50)}...`);
          audioQueue.addChunk(chunkId, text, audioUrl);
        },
        // On complete - return to listening mode
        (fullText: string, totalChunks: number) => {
          setIsTyping(false);
          setMessages(prev => prev.map(msg => 
            msg.id === aiMessageId 
              ? { ...msg, content: fullText, audioUrl: 'streaming' }
              : msg
          ));
          
          console.log(`AI response complete. Total chunks: ${totalChunks}`);
          setConversationState('speaking');
          
          // Return to listening mode when audio finishes playing
          // The audioQueue will handle the transition back to idle
        },
        // On error
        (error: string) => {
          setIsTyping(false);
          setError(error);
          setConversationState('idle'); // Return to listening on error
        },
        // Use RAG if enabled and available
        useRag && ragStatus?.isAvailable
      );
    } catch (error) {
      console.error('Error processing transcription:', error);
      setError(error instanceof Error ? error.message : 'An error occurred');
      setIsTyping(false);
      setConversationState('idle'); // Return to listening on error
    }
  };

  // Monitor audioQueue to return to idle when AI finishes speaking
  useEffect(() => {
    if (conversationState === 'speaking' && !audioQueue.isPlaying && !isTyping) {
      const timer = setTimeout(() => {
        if (isMountedRef.current) {
          setConversationState('idle');
          console.log('🎤 AI finished speaking - returning to listening mode');
        }
      }, 500); // Brief delay to ensure audio has fully stopped
      
      return () => clearTimeout(timer);
    }
  }, [conversationState, audioQueue.isPlaying, isTyping]);

  // Auto-scroll effect
  useEffect(() => {
    if (messagesEndRef.current && (messages.length > 0 || isTyping)) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping]);

  // Cleanup on unmount
  useEffect(() => {
    // Mark component as mounted
    isMountedRef.current = true;
    
    return () => {
      // Mark component as unmounted
      isMountedRef.current = false;
      
      // Clean up VAD resources
      if (micVADRef.current) {
        try {
          micVADRef.current.destroy();
          micVADRef.current = null;
        } catch (error) {
          console.warn('Error destroying VAD:', error);
        }
      }
      
      // Stop audio level monitoring
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      
      // Clean up monitoring MediaStream
      if (mediaStreamRef.current) {
        try {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
        } catch (error) {
          console.warn('Error stopping MediaStream tracks:', error);
        }
      }
      
      // Clean up audio analyzer
      if (analyzerRef.current) {
        try {
          analyzerRef.current.disconnect();
          analyzerRef.current = null;
        } catch (error) {
          console.warn('Error disconnecting AnalyserNode:', error);
        }
      }
      
      // Clean up AudioContext
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
          audioContextRef.current = null;
        } catch (error) {
          console.warn('Error closing AudioContext:', error);
        }
      }
      
      // Clean up GainNode
      if (gainNodeRef.current) {
        try {
          gainNodeRef.current.disconnect();
          gainNodeRef.current = null;
        } catch (error) {
          console.warn('Error disconnecting GainNode:', error);
        }
      }
      
      // Clear conversation timeout
      if (conversationTimeoutRef.current) {
        clearTimeout(conversationTimeoutRef.current);
        conversationTimeoutRef.current = null;
      }
      
      // Clear audio queue
      audioQueue.clearQueue();
      
      // Only update state if component is still mounted (though this runs on unmount, 
      // these are here as safety checks for any pending async operations)
      setIsVADActive(false);
      setConversationState('idle');
    };
  }, []);

  // Get status color for conversation state
  const getStateColor = (state: ConversationState) => {
    switch (state) {
      case 'idle': return 'bg-green-500';
      case 'listening': return 'bg-blue-500 animate-pulse';
      case 'processing': return 'bg-yellow-500 animate-pulse';
      case 'speaking': return 'bg-purple-500 animate-pulse';
      default: return 'bg-gray-500';
    }
  };

  const getStateText = (state: ConversationState) => {
    switch (state) {
      case 'idle': return 'Listening...';
      case 'listening': return 'You are speaking';
      case 'processing': return 'Processing...';
      case 'speaking': return `${tutorPersonality === 'ravi' ? 'Ravi Bhaiya' : 'Meena Didi'} is speaking`;
      default: return 'Connecting...';
    }
  };

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
                {tutorPersonality === 'ravi' ? 'रवि भैया' : 'मीना दीदी'} (VAD)
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Hands-free Conversation</p>
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

      {/* VAD Status Bar */}
      <div className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Connection Status */}
            <div className="flex items-center gap-2">
              {isVADActive ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-500" />
              )}
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {isVADActive ? 'Silero VAD Active' : 'Initializing...'}
              </span>
            </div>
            
            {/* Conversation State */}
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getStateColor(conversationState)}`}></div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {getStateText(conversationState)}
              </span>
            </div>
          </div>
          
          {/* Speech Probability Indicator */}
          {isVADActive && (
            <div className="flex items-center gap-2">
              <Mic className={`w-4 h-4 ${isRecordingVoice ? 'text-red-500' : 'text-gray-500'}`} />
              <div className="w-20 bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-100 ${
                    speechProbability > 0.8 ? 'bg-red-500' : 
                    speechProbability > 0.5 ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${audioLevel}%` }}
                ></div>
              </div>
              <span className="text-xs text-gray-500">
                {speechProbability > 0 ? `${(speechProbability * 100).toFixed(0)}%` : '0%'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-4">
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
              <p className="text-lg font-medium">Welcome to Hands-free Conversation!</p>
              <p className="text-sm">
                {isVADActive && conversationState === 'idle' 
                  ? 'Just start speaking - Silero VAD is listening!' 
                  : 'Initializing production-grade voice detection...'}
              </p>
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

      {/* No floating button needed - completely hands-free! */}
    </div>
  );
}