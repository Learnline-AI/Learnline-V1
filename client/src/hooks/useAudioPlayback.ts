import { useState, useRef, useCallback } from 'react';

export function useAudioPlayback() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Initialize audio context with user interaction for Safari compatibility
  const initializeAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
        console.log('Audio context initialized for Safari');
        
        // Create a silent audio element to unlock Safari's audio system
        const silentAudio = new Audio();
        silentAudio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaAjqJz/LNZymEK3vEOG9gGoqVgJKjTgdSdSWNHhAOHglQOuNMBCFObKCFo0n/E0PaZUWOnbpFhbP5XmwkGrg5TGP3K0T2AIhVTKNHh0d2OehBGiYFKIu9SqJOQZH7Aq1oUgIJQ3z5LIlMPKRRCDHNRJlGcTQNUJCBjLGogpqk7yoKEJSLtDW5NgQWHYNJhgNUL2nrO8j6SJLWzWlxIj4LiWDM2wW6N5o0CJiEm4tURpLPxjTD3gmcKpCdmEFgO8o0yDCcUFe0aHCKgZFGsA6F8UBm0VBEyEF8vCO1KwKd5UYJQhUl7DGYzQ0LO5nOJNLQ0GgYh6aOx3AEOZVdFAUjOGxvUmlJCCqWQMR2FjyBmfqPJZIzx3t8RwJdBmVNdySbWLhXgxFPVpjQLFwRbUTAYJhTTGvEjKZWNZQOKjM1N8YGBi9OJ59xdTtQG2Jt';
        silentAudio.play().catch(() => {}); // Silently fail if needed
        
      } catch (error) {
        console.warn('AudioContext initialization failed:', error);
      }
    }
    
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().catch(console.warn);
    }
  }, []);

  const playAudio = useCallback(async (audioUrl: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        console.log('Safari audio playback - URL length:', audioUrl.length);
        
        // Initialize audio context for Safari
        initializeAudioContext();
        
        // Stop current audio if playing
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          audioRef.current = null;
        }

        const audio = new Audio();
        
        // Safari-specific audio configuration
        audio.preload = 'auto';
        audio.crossOrigin = 'anonymous';
        audio.autoplay = false; // Explicit Safari requirement
        
        // Set up event handlers before setting src
        audio.oncanplaythrough = () => {
          console.log('Safari audio ready, attempting immediate play');
          
          // Safari requires immediate play without delay
          const playPromise = audio.play();
          
          if (playPromise !== undefined) {
            playPromise.then(() => {
              console.log('Safari audio playback started successfully');
            }).catch((playError) => {
              console.error('Safari audio play failed:', playError);
              
              // Safari fallback: try play with small delay
              setTimeout(() => {
                audio.play().then(() => {
                  console.log('Safari audio fallback successful');
                }).catch((retryError) => {
                  console.error('Safari audio fallback failed:', retryError);
                  setIsPlaying(false);
                  setCurrentAudio(null);
                  audioRef.current = null;
                  reject(playError);
                });
              }, 50);
            });
          }
        };

        audio.onended = () => {
          console.log('Audio playback ended');
          setIsPlaying(false);
          setCurrentAudio(null);
          audioRef.current = null;
          resolve();
        };

        audio.onerror = (error) => {
          console.error('Audio error event:', error, audio.error);
          setIsPlaying(false);
          setCurrentAudio(null);
          audioRef.current = null;
          reject(new Error(`Audio load failed: ${audio.error?.message || 'Unknown error'}`));
        };

        audio.onloadstart = () => {
          console.log('Audio load started');
        };

        audio.onloadeddata = () => {
          console.log('Audio data loaded');
        };

        audioRef.current = audio;
        setCurrentAudio(audioUrl);
        setIsPlaying(true);
        
        // Set the audio source
        audio.src = audioUrl;
        audio.load();

      } catch (error) {
        console.error('Error setting up audio:', error);
        setIsPlaying(false);
        setCurrentAudio(null);
        reject(error);
      }
    });
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setCurrentAudio(null);
  }, []);

  return {
    isPlaying,
    currentAudio,
    playAudio,
    stopAudio,
    initializeAudioContext,
  };
}
