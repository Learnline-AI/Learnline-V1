import { useState, useRef, useCallback } from "react";
import { apiService } from "../lib/apiService";
import { getAudioEnhancementService } from "../services/audioEnhancement";

interface UseVoiceRecordingProps {
  onRecordingComplete?: (audioBlob: Blob) => void;
  onTranscriptionReady?: (transcript: string) => void;
  onError?: (error: string) => void;
  maxDuration?: number;
}

export function useVoiceRecording({
  onRecordingComplete,
  onTranscriptionReady,
  onError,
  maxDuration = 30000,
}: UseVoiceRecordingProps = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [transcript, setTranscript] = useState<string>('');
  const [isEnhancementReady, setIsEnhancementReady] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioEnhancementRef = useRef(getAudioEnhancementService());

  const startRecording = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setIsSupported(false);
        throw new Error("Voice recording is not supported in this browser");
      }

      // Initialize audio enhancement service
      console.log('🎤 AudioEnhancement: Initializing client-side voice isolation...');
      try {
        await audioEnhancementRef.current.initialize();
        setIsEnhancementReady(audioEnhancementRef.current.isServiceEnabled());
        
        if (audioEnhancementRef.current.isServiceEnabled()) {
          console.log(`✅ AudioEnhancement: Client-side ready with provider: ${audioEnhancementRef.current.getActiveProvider()}`);
        } else {
          console.log('⚠️ AudioEnhancement: Client-side disabled, using standard recording');
        }
      } catch (enhancementError) {
        console.warn('⚠️ AudioEnhancement: Client-side initialization failed:', enhancementError);
        setIsEnhancementReady(false);
      }

      // Enhanced audio constraints for better RNNoise compatibility
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true, // Keep browser noise suppression as additional layer
          autoGainControl: true,
          sampleRate: 48000, // RNNoise prefers 48kHz
          channelCount: 1 // Mono audio
        },
      });

      streamRef.current = stream;

      // Try to use webm with opus codec, fallback to supported format
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/webm";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "audio/mp4";
        }
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
      });

      mediaRecorderRef.current = mediaRecorder;
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const originalAudioBlob = new Blob(chunks, { type: mimeType });
        console.log('Audio recorded with format:', mimeType, 'Size:', originalAudioBlob.size);
        
        // Apply client-side audio enhancement if available
        let finalAudioBlob = originalAudioBlob;
        
        if (isEnhancementReady && audioEnhancementRef.current.isServiceEnabled()) {
          try {
            console.log('🎤 AudioEnhancement: Processing recorded audio with client-side RNNoise...');
            finalAudioBlob = await processAudioBlobWithEnhancement(originalAudioBlob, mimeType);
            console.log('✅ AudioEnhancement: Client-side processing complete');
          } catch (enhancementError) {
            console.warn('⚠️ AudioEnhancement: Client-side processing failed, using original audio:', enhancementError);
            finalAudioBlob = originalAudioBlob; // Fallback to original
          }
        }
        
        onRecordingComplete?.(finalAudioBlob);

        // Transcribe the enhanced audio if transcription callback is provided
        if (onTranscriptionReady) {
          setIsTranscribing(true);
          try {
            const result = await apiService.speechToText(finalAudioBlob);
            if (result.success && result.data) {
              setTranscript(result.data.text);
              onTranscriptionReady(result.data.text);
            } else {
              const errorMessage = result.error || 'Could not process your voice. Please try speaking again.';
              onError?.(errorMessage);
            }
          } catch (error) {
            console.error('Transcription error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Could not process your voice. Please try speaking again.';
            onError?.(errorMessage);
          } finally {
            setIsTranscribing(false);
          }
        }
      };

      mediaRecorder.start();
      setIsRecording(true);

      // Auto-stop after maxDuration
      timeoutRef.current = setTimeout(() => {
        stopRecording();
      }, maxDuration);
    } catch (error) {
      console.error("Error starting recording:", error);
      setIsRecording(false);
      throw error;
    }
  }, [onRecordingComplete, maxDuration]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [isRecording]);

  // Helper function to process audio blob with RNNoise enhancement
  const processAudioBlobWithEnhancement = useCallback(async (
    audioBlob: Blob, 
    mimeType: string
  ): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 48000 // Match RNNoise expected sample rate
      });
      
      const fileReader = new FileReader();
      
      fileReader.onload = async (event) => {
        try {
          const arrayBuffer = event.target?.result as ArrayBuffer;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          // Get Float32Array from the first channel (mono)
          const audioData = audioBuffer.getChannelData(0);
          
          // Process with RNNoise
          const enhancedAudioData = await audioEnhancementRef.current.enhanceAudio(audioData);
          
          // Create new AudioBuffer with enhanced data
          const enhancedBuffer = audioContext.createBuffer(
            1, // mono
            enhancedAudioData.length,
            audioContext.sampleRate
          );
          enhancedBuffer.copyToChannel(enhancedAudioData, 0);
          
          // Convert back to blob using MediaRecorder or OfflineAudioContext
          const offlineContext = new OfflineAudioContext(
            1,
            enhancedBuffer.length,
            enhancedBuffer.sampleRate
          );
          
          const source = offlineContext.createBufferSource();
          source.buffer = enhancedBuffer;
          source.connect(offlineContext.destination);
          source.start();
          
          const renderedBuffer = await offlineContext.startRendering();
          
          // Convert to WAV blob for better compatibility
          const wavBlob = audioBufferToWavBlob(renderedBuffer);
          
          audioContext.close();
          resolve(wavBlob);
          
        } catch (error) {
          audioContext.close();
          reject(error);
        }
      };
      
      fileReader.onerror = () => {
        reject(new Error('Failed to read audio blob'));
      };
      
      fileReader.readAsArrayBuffer(audioBlob);
    });
  }, []);

  // Helper function to convert AudioBuffer to WAV Blob
  const audioBufferToWavBlob = useCallback((audioBuffer: AudioBuffer): Blob => {
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const channels = audioBuffer.numberOfChannels;
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    
    // Convert float32 samples to int16
    const channelData = audioBuffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
  }, []);

  return {
    isRecording,
    isTranscribing,
    isSupported,
    isEnhancementReady,
    transcript,
    startRecording,
    stopRecording,
  };
}
