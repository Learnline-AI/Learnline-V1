import { useState, useRef, useCallback, useEffect } from 'react';

interface AudioChunk {
  chunkId: number;
  text: string;
  audioUrl: string;
  status: 'pending' | 'playing' | 'played' | 'error';
}

interface UseAudioQueueReturn {
  addChunk: (chunkId: number, text: string, audioUrl: string) => void;
  isPlaying: boolean;
  currentChunk: AudioChunk | null;
  queueLength: number;
  clearQueue: () => void;
  playNext: () => void;
  interrupt: () => void;
}

export function useAudioQueue(): UseAudioQueueReturn {
  const [chunks, setChunks] = useState<AudioChunk[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentChunk, setCurrentChunk] = useState<AudioChunk | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  const expectedNextChunk = useRef(0); // Track which chunk we expect to play next

  const playNext = useCallback(() => {
    console.log('🎯 PLAY-NEXT: Called with playing:', playingRef.current, 'expecting chunk:', expectedNextChunk.current);
    
    if (playingRef.current) {
      console.log('❌ ALREADY-PLAYING: Skipping playNext');
      return;
    }

    setChunks(currentChunks => {
      // Look for the specific chunk we expect to play next
      const nextChunk = currentChunks.find(chunk => 
        chunk.chunkId === expectedNextChunk.current && chunk.status === 'pending'
      );
      
      if (!nextChunk) {
        console.log(`⏸️ WAITING: Chunk ${expectedNextChunk.current} not ready yet`);
        return currentChunks; // Wait for the expected chunk
      }

      console.log(`✅ FOUND: Playing expected chunk ${nextChunk.chunkId}`);

      playingRef.current = true;
      setIsPlaying(true);
      setCurrentChunk(nextChunk);

      // Create and play audio
      const audio = new Audio();
      audioRef.current = audio;

      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      
      const playAudio = async () => {
        try {
          audio.src = nextChunk.audioUrl;
          console.log(`Loading audio for chunk ${nextChunk.chunkId}, URL length: ${nextChunk.audioUrl.length}`);
          await audio.play();
          console.log(`Successfully started playing chunk ${nextChunk.chunkId}`);
        } catch (error) {
          console.error('Audio playback failed:', error);
          setChunks(prev => prev.map(chunk => 
            chunk.chunkId === nextChunk.chunkId 
              ? { ...chunk, status: 'error' } 
              : chunk
          ));
          playingRef.current = false;
          setIsPlaying(false);
        }
      };

      // Audio event handlers
      audio.onended = () => {
        console.log(`Chunk ${nextChunk.chunkId} finished playing`);
        playingRef.current = false;
        setIsPlaying(false);
        
        // Move to next expected chunk
        expectedNextChunk.current++;
        console.log(`🔄 NEXT-EXPECTED: Now expecting chunk ${expectedNextChunk.current}`);
        
        // Update status to played
        setChunks(prev => prev.map(chunk => 
          chunk.chunkId === nextChunk.chunkId 
            ? { ...chunk, status: 'played' } 
            : chunk
        ));
        
        // Check for next chunk immediately
        playNext();
      };

      audio.onerror = (error) => {
        console.error(`Audio error for chunk ${nextChunk.chunkId}:`, error);
        handleAudioError(nextChunk.chunkId);
      };

      // Start playing immediately
      playAudio();

      // Update chunk status to playing
      return currentChunks.map(chunk => 
        chunk.chunkId === nextChunk.chunkId 
          ? { ...chunk, status: 'playing' } 
          : chunk
      );
    });
  }, []);

  const handleAudioError = useCallback((chunkId: number) => {
    console.log(`Audio error for chunk ${chunkId}`);
    setChunks(prev => prev.map(chunk => 
      chunk.chunkId === chunkId 
        ? { ...chunk, status: 'error' } 
        : chunk
    ));
    playingRef.current = false;
    setIsPlaying(false);
    
    // Move to next expected chunk and try again
    expectedNextChunk.current++;
    console.log(`⚠️ ERROR-SKIP: Moving to chunk ${expectedNextChunk.current} after error`);
    playNext();
  }, [playNext]);

  const addChunk = useCallback((chunkId: number, text: string, audioUrl: string) => {
    console.log(`🎧 QUEUE ADD: Adding audio chunk ${chunkId}: ${text.substring(0, 30)}...`);
    
    const newChunk: AudioChunk = {
      chunkId,
      text,
      audioUrl,
      status: 'pending'
    };

    setChunks(prev => {
      const updated = [...prev, newChunk];
      console.log(`📦 QUEUE UPDATED: Now has ${updated.length} chunks`);
      return updated;
    });
  }, []);

  const clearQueue = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setChunks([]);
    setIsPlaying(false);
    setCurrentChunk(null);
    playingRef.current = false;
    expectedNextChunk.current = 0; // Reset expected chunk counter
    console.log('Audio queue cleared, reset to expect chunk 0');
  }, []);

  const interrupt = useCallback(() => {
    console.log('🛑 INTERRUPT: Stopping current audio and clearing queue');
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setChunks([]);
    setIsPlaying(false);
    setCurrentChunk(null);
    playingRef.current = false;
    expectedNextChunk.current = 0; // Reset expected chunk counter
  }, []);

  // Auto-trigger playback when chunks arrive and not playing
  useEffect(() => {
    if (chunks.length > 0 && !playingRef.current) {
      const hasPending = chunks.some(chunk => chunk.status === 'pending');
      if (hasPending) {
        console.log('🚀 AUTO-START: Triggering playback for pending chunks');
        playNext();
      }
    }
  }, [chunks, playNext]);

  return {
    addChunk,
    isPlaying,
    currentChunk,
    queueLength: chunks.length,
    clearQueue,
    playNext,
    interrupt
  };
}