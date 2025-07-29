// apiServices.ts
import {
  APIResponse,
  TeacherResponse,
  TTSResponse,
  VoiceConfig,
} from "../types";
import * as FileSystem from 'expo-file-system';
import EventSource from 'react-native-sse';

const API_BASE_URL = "https://cursor-mvp-learnline-production.up.railway.app/";

class APIService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  async askTeacherStream(
    question: string,
    onMessage: (text: string) => void,
    onAudioChunk: (chunkId: number, text: string, audioUrl: string) => void,
    onError: (error: string) => void,
    onComplete: () => void,
  ): Promise<void> {
    try {
      console.log("🚀 Starting AI teacher stream for question:", question);
      
      // Create EventSource connection with POST data
      const eventSource = new EventSource(`${this.baseUrl}api/ask-teacher-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question }),
      });

      // Handle successful connection
      eventSource.addEventListener('open', (event) => {
        console.log('✅ SSE connection opened');
      });

      // Handle incoming messages
      eventSource.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 SSE EVENT:', data.type, data.chunkId !== undefined ? `chunk ${data.chunkId}` : '');
          
          if (data.type === 'text_chunk') {
            onMessage(data.text);
          } else if (data.type === 'audio_ready') {
            console.log(`🔊 AUDIO_READY: Chunk ${data.chunkId} ready, fetching separately`);
            this.fetchAudioChunk(
              data.chunkId,
              data.text,
              data.sessionId,
              onAudioChunk,
            );
          } else if (data.type === 'text_complete') {
            console.log(`📝 TEXT COMPLETE: Text streaming finished. Total chunks: ${data.totalChunks || 0}`);
          } else if (data.type === 'complete') {
            console.log(`🏁 STREAM COMPLETE: All audio chunks processed`);
            eventSource.close();
            onComplete();
          } else if (data.type === 'error') {
            console.error('❌ Server error:', data.error);
            eventSource.close();
            onError(data.error);
          } else if (data.type === 'audio_error') {
            console.warn(`Audio chunk ${data.chunkId} failed: ${data.error}`);
          }
        } catch (parseError) {
          console.warn('Failed to parse streaming data:', parseError, 'Raw data:', event.data);
        }
      });

      // Handle connection errors
      eventSource.addEventListener('error', (event) => {
        console.error('❌ SSE connection error:', event);
        eventSource.close();
        onError('Connection error occurred');
      });

      // Handle connection close
      eventSource.addEventListener('close', (event) => {
        console.log('🔒 SSE connection closed');
      });

      // Set up timeout for the connection
      const timeout = setTimeout(() => {
        console.error('⏰ SSE connection timeout');
        eventSource.close();
        onError('Connection timeout');
      }, 30000); // 30 second timeout

      // Clear timeout when connection closes
      eventSource.addEventListener('close', () => {
        clearTimeout(timeout);
      });

    } catch (error) {
      console.error("Error in streaming teacher:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("Full error details:", {
        error,
        apiUrl: this.baseUrl,
        endpoint: 'api/ask-teacher-stream'
      });
      onError(`Connection failed: ${errorMessage}. Please check your internet connection.`);
    }
  }

  private async fetchAudioChunk(
    chunkId: number,
    text: string,
    sessionId: string,
    onAudioChunk: (chunkId: number, text: string, audioUrl: string) => void,
  ) {
    try {
      const response = await fetch(
        `${this.baseUrl}api/audio-chunk/${sessionId}/${chunkId}`,
      );
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.audioUrl) {
          // Use server's data URL directly - no blob conversion needed
          onAudioChunk(chunkId, text, data.audioUrl);
        } else {
          console.error(`Failed to fetch audio chunk ${chunkId}:`, data);
        }
      }
    } catch (error) {
      console.error("Error fetching audio chunk:", error);
    }
  }

  async askTeacher(question: string): Promise<APIResponse<TeacherResponse>> {
    try {
      const response = await fetch(`${this.baseUrl}api/ask-teacher`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        console.error("API Error Response:", errorData);
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API Error:", error);
      console.error("Full error context:", {
        endpoint: `${this.baseUrl}api/ask-teacher`,
        method: 'POST',
        error: error instanceof Error ? error.message : error
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getTextToSpeech(
    text: string,
    voiceConfig?: VoiceConfig,
    provider: "elevenlabs" | "google" = "elevenlabs",
  ): Promise<APIResponse<TTSResponse>> {
    try {
      const defaultVoiceConfig: VoiceConfig = {
        voiceName:
          provider === "elevenlabs"
            ? "pNInz6obpgDQGcFmaJgB"
            : "hi-IN-Wavenet-A",
        languageCode: "hi-IN",
        speakingRate: 0.85,
      };

      const response = await fetch(`${this.baseUrl}api/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          provider,
          voiceConfig: voiceConfig || defaultVoiceConfig,
        }),
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("TTS API Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async testConnection(): Promise<APIResponse<{ status: string }>> {
    try {
      const response = await fetch(`${this.baseUrl}api/test-connection`);
      const data = await response.json();
      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  async testGoogleAuth(): Promise<APIResponse<{ authenticated: boolean }>> {
    try {
      const response = await fetch(`${this.baseUrl}api/test-google-auth`);
      const data = await response.json();
      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Auth test failed",
      };
    }
  }

  // Mobile-specific speech-to-text that handles file URIs
  async speechToTextFromUri(uri: string): Promise<APIResponse<{ text: string }>> {
    try {
      console.log('Converting speech from URI:', uri);
      
      // Verify the URI exists and is accessible
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        throw new Error('Audio file does not exist');
      }

      console.log('Audio file info:', {
        exists: fileInfo.exists,
        size: fileInfo.size,
        uri: fileInfo.uri
      });

      // Read the audio file as base64 using expo-file-system
      const base64Audio = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      console.log('Base64 audio length:', base64Audio.length);

      // Send to backend API
      const apiResponse = await fetch(`${this.baseUrl}api/speech-to-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio: base64Audio,
          language: 'hi-IN',
          mimeType: 'audio/mp4' // M4A files have audio/mp4 MIME type
        }),
      });

      if (!apiResponse.ok) {
        const errorData = await apiResponse.json().catch(() => ({ error: `HTTP ${apiResponse.status}` }));
        console.error("Speech-to-text API Error:", {
          status: apiResponse.status,
          statusText: apiResponse.statusText,
          errorData,
          endpoint: `${this.baseUrl}api/speech-to-text`
        });
        throw new Error(errorData.error || `Speech API failed with status ${apiResponse.status}`);
      }
      
      const data = await apiResponse.json();
      console.log('Speech-to-text API response:', data);
      
      if (data.success && data.transcript) {
        return {
          success: true,
          data: { text: data.transcript }
        };
      } else {
        console.error('Speech-to-text failed:', data);
        return {
          success: false,
          error: data.error || 'Speech recognition failed'
        };
      }
    } catch (error) {
      console.error('Speech-to-text error:', error);
      console.error('Error context:', {
        apiUrl: this.baseUrl,
        endpoint: 'api/speech-to-text',
        error: error instanceof Error ? error.stack : error
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Speech recognition failed'
      };
    }
  }

  // Keep original method for backward compatibility
  async speechToText(audioBlob: Blob): Promise<APIResponse<{ text: string }>> {
    try {
      const reader = new FileReader();
      const base64Audio = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      });

      const response = await fetch(`${this.baseUrl}api/speech-to-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audio: base64Audio,
          language: "hi-IN",
          mimeType: audioBlob.type || "audio/mp4",
        }),
      });

      const data = await response.json();

      if (data.success && data.transcript) {
        return {
          success: true,
          data: { text: data.transcript },
        };
      } else {
        return {
          success: false,
          error: data.error || "Speech recognition failed",
        };
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Speech recognition failed",
      };
    }
  }
}

export const apiService = new APIService();
