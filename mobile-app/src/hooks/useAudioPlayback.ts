// useAudioPlayback.ts
// CURRENT STATE: Auto-playing audio queue system (WORKING ✅)
// CONVERSATIONAL TARGET: Add interrupt capability for real-time conversation
// KEY STRENGTHS: Chunk-based playback, proper cleanup, queue management  
// MODIFICATIONS NEEDED: Add interrupt detection, resume capability

import { useState, useRef, useEffect } from 'react';
import { Audio } from 'expo-av';
import { AudioChunk, AudioQueueState } from '../types';

export function useAudioPlayback() {
  const [queueState, setQueueState] = useState<AudioQueueState>({
    isPlaying: false,
    currentMessageId: null,
    currentChunkIndex: 0,
    totalChunks: 0,
    isLoading: false,
  });

  const soundRef = useRef<Audio.Sound | null>(null);
  const audioQueue = useRef<Map<string, AudioChunk[]>>(new Map());
  const isPlayingRef = useRef(false);

  // Initialize audio mode once
  useEffect(() => {
    const initAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch (error) {
        console.error('Failed to initialize audio mode:', error);
      }
    };
    initAudio();

    // Cleanup on unmount
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = async () => {
    isPlayingRef.current = false;
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch (error) {
        console.error('Cleanup error:', error);
      }
      soundRef.current = null;
    }
    audioQueue.current.clear();
    setQueueState({
      isPlaying: false,
      currentMessageId: null,
      currentChunkIndex: 0,
      totalChunks: 0,
      isLoading: false,
    });
  };

  const addChunkToQueue = async (messageId: string, chunk: AudioChunk) => {
    console.log(`Adding chunk ${chunk.id} to queue for message ${messageId}`);
    
    // Get or create queue for this message
    const messageQueue = audioQueue.current.get(messageId) || [];
    messageQueue.push(chunk);
    messageQueue.sort((a, b) => a.id - b.id); // Keep chunks in order
    audioQueue.current.set(messageId, messageQueue);

    // If this is the first chunk and nothing is playing, start auto-play
    if (!isPlayingRef.current && chunk.id === 0) {
      console.log(`Auto-starting playback for message ${messageId}`);
      await startPlayback(messageId);
    }
  };

  const startPlayback = async (messageId: string) => {
    const messageQueue = audioQueue.current.get(messageId);
    if (!messageQueue || messageQueue.length === 0) return;

    isPlayingRef.current = true;
    setQueueState({
      isPlaying: true,
      currentMessageId: messageId,
      currentChunkIndex: 0,
      totalChunks: messageQueue.length,
      isLoading: false,
    });

    await playChunk(messageId, 0);
  };

  const playChunk = async (messageId: string, chunkIndex: number) => {
    if (!isPlayingRef.current) return;

    const messageQueue = audioQueue.current.get(messageId);
    if (!messageQueue || chunkIndex >= messageQueue.length) {
      // Finished playing all chunks
      console.log(`Completed playback for message ${messageId}`);
      isPlayingRef.current = false;
      setQueueState(prev => ({ ...prev, isPlaying: false }));
      return;
    }

    const chunk = messageQueue[chunkIndex];
    if (!chunk || !chunk.audioUrl) {
      // Skip missing chunk
      console.warn(`Chunk ${chunkIndex} missing, skipping`);
      setTimeout(() => playChunk(messageId, chunkIndex + 1), 100);
      return;
    }

    try {
      console.log(`Playing chunk ${chunkIndex}: ${chunk.text.substring(0, 30)}...`);
      
      // Stop current audio
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      // Create and play new sound
      const { sound } = await Audio.Sound.createAsync(
        { uri: chunk.audioUrl },
        { shouldPlay: true }
      );

      soundRef.current = sound;

      // Update state
      setQueueState(prev => ({
        ...prev,
        currentChunkIndex: chunkIndex,
      }));

      // Set completion listener
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish && isPlayingRef.current) {
          console.log(`Chunk ${chunkIndex} finished, playing next`);
          setTimeout(() => playChunk(messageId, chunkIndex + 1), 100);
        }
      });

    } catch (error) {
      console.error(`Failed to play chunk ${chunkIndex}:`, error);
      // Try next chunk
      setTimeout(() => playChunk(messageId, chunkIndex + 1), 100);
    }
  };

  const stopAudio = async () => {
    console.log('Stopping audio playback');
    isPlayingRef.current = false;
    
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch (error) {
        console.error('Failed to stop audio:', error);
      }
      soundRef.current = null;
    }

    setQueueState({
      isPlaying: false,
      currentMessageId: null,
      currentChunkIndex: 0,
      totalChunks: 0,
      isLoading: false,
    });
  };

  // Legacy compatibility
  const playAudio = async (audioUrl: string) => {
    const singleChunk: AudioChunk = {
      id: 0,
      text: '',
      audioUrl,
      isLoaded: true,
    };
    const tempMessageId = 'single-audio-' + Date.now();
    await addChunkToQueue(tempMessageId, singleChunk);
  };

  return {
    queueState,
    addChunkToQueue,
    stopAudio,
    
    // Legacy compatibility
    isPlaying: queueState.isPlaying,
    currentAudio: queueState.currentMessageId,
    playAudio,
  };
}