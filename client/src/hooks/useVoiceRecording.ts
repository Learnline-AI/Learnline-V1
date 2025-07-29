import { useState, useRef, useCallback } from "react";
import { apiService } from "../lib/apiService";

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setIsSupported(false);
        throw new Error("Voice recording is not supported in this browser");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
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
        const audioBlob = new Blob(chunks, { type: mimeType });
        console.log('Audio recorded with format:', mimeType, 'Size:', audioBlob.size);
        onRecordingComplete?.(audioBlob);

        // Transcribe the audio if transcription callback is provided
        if (onTranscriptionReady) {
          setIsTranscribing(true);
          try {
            const result = await apiService.speechToText(audioBlob);
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

  return {
    isRecording,
    isTranscribing,
    isSupported,
    transcript,
    startRecording,
    stopRecording,
  };
}
