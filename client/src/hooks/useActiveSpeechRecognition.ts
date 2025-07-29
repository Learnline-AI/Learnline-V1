import { useState, useRef, useCallback, useEffect } from 'react';

interface UseActiveSpeechRecognitionProps {
  onSpeechDetected?: (text: string) => void;
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
}

export function useActiveSpeechRecognition({ 
  onSpeechDetected, 
  language = 'hi-IN',
  continuous = true,
  interimResults = true
}: UseActiveSpeechRecognitionProps = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [transcript, setTranscript] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [recognitionState, setRecognitionState] = useState<'idle' | 'listening' | 'processing'>('idle');
  
  const recognitionRef = useRef<any>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldBeListeningRef = useRef(false);
  const speechBufferRef = useRef<string>('');
  const interimTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const finalTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true; // Enable continuous recognition for full sentences
    recognition.interimResults = true; // Enable interim results for better buffering
    recognition.lang = 'en-US'; // Use English for better mixed language handling
    recognition.maxAlternatives = 1;

    // Configure for better speech detection
    
    recognition.onstart = () => {
      console.log('Speech recognition started');
      setIsListening(true);
      setRecognitionState('listening');
      speechBufferRef.current = '';
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';
      let maxConfidence = 0;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcriptText = result[0].transcript;
        const confidence = result[0].confidence || 0;

        if (result.isFinal) {
          finalTranscript += transcriptText;
          maxConfidence = Math.max(maxConfidence, confidence);
        } else {
          interimTranscript += transcriptText;
        }
      }

      // Minimal filtering - only block obvious feedback loops
      const text = finalTranscript.toLowerCase();
      const feedbackPatterns = [
        /^(um|uh|ah)$/,  // Only filter single filler words
        /^[a-z]$/        // Single letters only
      ];

      const isFeedback = feedbackPatterns.some(pattern => pattern.test(text)) ||
                        (text.length < 2 && maxConfidence < 0.3);

      if (isFeedback && finalTranscript.trim()) {
        console.log('Filtering feedback loop:', finalTranscript);
        return;
      }

      // Update speech buffer with new content
      if (finalTranscript.trim()) {
        speechBufferRef.current += (speechBufferRef.current ? ' ' : '') + finalTranscript;
        console.log('Added to buffer:', finalTranscript);
        console.log('Current buffer:', speechBufferRef.current);
      }

      // Update display transcript
      const fullTranscript = speechBufferRef.current + (interimTranscript.trim() ? ' ' + interimTranscript : '');
      setTranscript(fullTranscript);
      setConfidence(maxConfidence);

      // Clear existing timeouts
      if (interimTimeoutRef.current) {
        clearTimeout(interimTimeoutRef.current);
        interimTimeoutRef.current = null;
      }
      if (finalTimeoutRef.current) {
        clearTimeout(finalTimeoutRef.current);
        finalTimeoutRef.current = null;
      }

      // Handle final results with lower confidence threshold
      if (finalTranscript.trim() && maxConfidence > 0.5) {
        // Set timeout to process accumulated speech after pause
        finalTimeoutRef.current = setTimeout(() => {
          processSpeechBuffer();
        }, 2000); // 2 second pause timeout
      }

      // Handle interim results for responsiveness
      if (interimTranscript.trim()) {
        interimTimeoutRef.current = setTimeout(() => {
          if (speechBufferRef.current.trim()) {
            processSpeechBuffer();
          }
        }, 4000); // 4 second timeout for interim results
      }
    };

    const processSpeechBuffer = () => {
      if (speechBufferRef.current.trim() && onSpeechDetected) {
        const bufferedText = speechBufferRef.current.trim();
        console.log('Processing buffered speech:', bufferedText);
        onSpeechDetected(bufferedText);
        speechBufferRef.current = '';
        setTranscript('');
        setRecognitionState('processing');
        
        // Brief processing state before returning to listening
        setTimeout(() => {
          if (shouldBeListeningRef.current) {
            setRecognitionState('listening');
          }
        }, 500);
      }
    };

    recognition.onspeechstart = () => {
      console.log('Speech detected');
    };

    recognition.onspeechend = () => {
      console.log('Speech ended');
    };

    recognition.onerror = (event: any) => {
      console.log('Speech recognition error:', event.error);
      
      // Handle different error types without showing user errors
      if (event.error === 'no-speech') {
        console.log('No speech detected, continuing...');
        // Don't restart immediately for no-speech - let continuous mode handle it
        return;
      } else if (event.error === 'network') {
        console.log('Network error, will retry');
      } else if (event.error === 'not-allowed') {
        console.log('Microphone permission denied');
        setIsListening(false);
        setRecognitionState('idle');
        shouldBeListeningRef.current = false;
        return;
      } else if (event.error === 'aborted') {
        console.log('Recognition aborted - normal behavior');
        return;
      }
      
      // Gentle restart for network/service errors only
      if (shouldBeListeningRef.current && (event.error === 'network' || event.error === 'service-not-allowed')) {
        setRecognitionState('idle');
        restartTimeoutRef.current = setTimeout(() => {
          if (shouldBeListeningRef.current) {
            startListening();
          }
        }, 500); // Shorter delay for faster recovery
      }
    };

    recognition.onend = () => {
      console.log('Speech recognition ended, should be listening:', shouldBeListeningRef.current);
      setIsListening(false);
      
      // Process any remaining buffered speech before restarting
      if (speechBufferRef.current.trim() && onSpeechDetected) {
        const bufferedText = speechBufferRef.current.trim();
        console.log('Processing final buffered speech on end:', bufferedText);
        onSpeechDetected(bufferedText);
        speechBufferRef.current = '';
        setTranscript('');
      }
      
      // Continuous restart for seamless recognition
      if (shouldBeListeningRef.current && recognitionState !== 'processing') {
        console.log('Auto-restarting speech recognition for continuous mode');
        setRecognitionState('idle');
        restartTimeoutRef.current = setTimeout(() => {
          if (shouldBeListeningRef.current) {
            startListening();
          }
        }, 500); // Faster restart for continuous experience
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
      if (interimTimeoutRef.current) {
        clearTimeout(interimTimeoutRef.current);
      }
      if (finalTimeoutRef.current) {
        clearTimeout(finalTimeoutRef.current);
      }
    };
  }, [language, continuous, interimResults, onSpeechDetected, recognitionState]);

  const startListening = useCallback(async () => {
    if (!recognitionRef.current || (isListening && recognitionState === 'listening')) {
      console.log('Cannot start - no recognition or already listening:', { hasRecognition: !!recognitionRef.current, isListening, state: recognitionState });
      return;
    }

    try {
      // Clear any existing timeouts
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = null;
      }
      if (interimTimeoutRef.current) {
        clearTimeout(interimTimeoutRef.current);
        interimTimeoutRef.current = null;
      }
      if (finalTimeoutRef.current) {
        clearTimeout(finalTimeoutRef.current);
        finalTimeoutRef.current = null;
      }

      // Request microphone permission first
      console.log('Requesting microphone permission...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Close the stream, we just needed permission
      
      console.log('Microphone permission granted, starting continuous speech recognition');
      shouldBeListeningRef.current = true;
      setIsListening(true);
      setRecognitionState('listening');
      setTranscript('');
      speechBufferRef.current = '';
      recognitionRef.current.start();
    } catch (error) {
      console.error('Error starting recognition:', error);
      if (error instanceof Error && error.name === 'NotAllowedError') {
        console.error('Microphone permission denied');
      }
      shouldBeListeningRef.current = false;
      setIsListening(false);
      setRecognitionState('idle');
    }
  }, [isListening, recognitionState]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;

    console.log('Stopping active speech recognition');
    shouldBeListeningRef.current = false;
    setIsListening(false);
    setRecognitionState('idle');
    
    // Process any remaining buffered speech before stopping
    if (speechBufferRef.current.trim() && onSpeechDetected) {
      const bufferedText = speechBufferRef.current.trim();
      console.log('Processing final buffered speech on stop:', bufferedText);
      onSpeechDetected(bufferedText);
      speechBufferRef.current = '';
      setTranscript('');
    }
    
    // Clear all timeouts
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    if (interimTimeoutRef.current) {
      clearTimeout(interimTimeoutRef.current);
      interimTimeoutRef.current = null;
    }
    if (finalTimeoutRef.current) {
      clearTimeout(finalTimeoutRef.current);
      finalTimeoutRef.current = null;
    }

    try {
      recognitionRef.current.abort(); // Use abort for immediate termination
    } catch (error) {
      console.error('Error stopping recognition:', error);
    }
  }, [onSpeechDetected]);

  const pauseListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      console.log('Pausing speech recognition');
      setRecognitionState('processing');
      recognitionRef.current.abort();
    }
  }, [isListening]);

  const resumeListening = useCallback(() => {
    if (!isListening && shouldBeListeningRef.current) {
      startListening();
    }
  }, [isListening, startListening]);

  return {
    isListening,
    isSupported,
    transcript,
    confidence,
    recognitionState,
    startListening,
    stopListening,
    pauseListening,
    resumeListening
  };
}