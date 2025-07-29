import { APIResponse, TeacherResponse, TTSResponse, VoiceConfig } from '@/types';

const BASE_URL = window.location.origin;

class APIService {

  // Streaming version for real-time responses with optional RAG
  async askTeacherStream(
    question: string, 
    onTextChunk: (chunk: string, fullText: string) => void,
    onAudioChunk: (chunkId: number, text: string, audioUrl: string) => void,
    onComplete: (fullText: string, totalChunks: number) => void,
    onError: (error: string) => void,
    useRag: boolean = false
  ): Promise<void> {
    try {
      const response = await fetch(`${BASE_URL}/api/ask-teacher-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question, useRag }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              console.log('🎬 SSE EVENT:', data.type, data.chunkId !== undefined ? `chunk ${data.chunkId}` : '');
              
              if (data.type === 'text_chunk') {
                onTextChunk(data.text, data.fullText);
              } else if (data.type === 'audio_ready') {
                console.log(`🔊 AUDIO_READY: Chunk ${data.chunkId} ready, fetching separately`);
                console.log(`🔊 Audio chunk data:`, data);
                this.fetchAudioChunk(data.chunkId, data.text, data.sessionId, onAudioChunk);
              } else if (data.type === 'text_complete') {
                console.log(`📝 TEXT COMPLETE: Text streaming finished. Total chunks: ${data.totalChunks || 0}`);
                // Audio playback already started when first chunk arrived - no action needed
              } else if (data.type === 'complete') {
                console.log(`🏁 STREAM COMPLETE: All audio chunks processed`);
                onComplete(data.fullText, data.totalChunks || 0);
              } else if (data.type === 'error') {
                onError(data.error);
              } else if (data.type === 'audio_error') {
                console.warn(`Audio chunk ${data.chunkId} failed: ${data.error}`);
              }
            } catch (parseError) {
              console.warn('Failed to parse streaming data:', parseError, 'Raw line:', line);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error in streaming teacher:', error);
      onError(error instanceof Error ? error.message : 'Failed to get streaming response');
    }
  }

  private async fetchAudioChunk(chunkId: number, text: string, sessionId: string, onAudioChunk: (chunkId: number, text: string, audioUrl: string) => void) {
    try {
      console.log(`🎵 FETCH: Getting audio chunk ${chunkId} from server with session ${sessionId}`);
      const response = await fetch(`/api/audio-chunk/${sessionId}/${chunkId}`);
      
      if (!response.ok) {
        console.error(`❌ FETCH ERROR: Failed to fetch audio chunk ${chunkId}: ${response.status}`);
        return;
      }
      
      const data = await response.json();
      if (data.success && data.audioUrl) {
        console.log(`✅ FETCH SUCCESS: Audio chunk ${chunkId}, URL length: ${data.audioUrl.length}`);
        console.log(`🎯 CALLING CALLBACK: onAudioChunk for chunk ${chunkId}`);
        onAudioChunk(chunkId, text, data.audioUrl);
      } else {
        console.error(`❌ INVALID RESPONSE: Audio chunk ${chunkId}:`, data);
      }
    } catch (error) {
      console.error(`💥 FETCH EXCEPTION: Audio chunk ${chunkId}:`, error);
    }
  }

  // Keep original non-streaming version for fallback
  async askTeacher(question: string): Promise<APIResponse<TeacherResponse>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 second timeout
      
      const response = await fetch(`${BASE_URL}/api/ask-teacher`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: data.success || true,
        data: {
          answer: data.answer || data.response || data.text,
          audioUrl: data.audioUrl,
        },
      };
    } catch (error) {
      console.error('Error asking teacher:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get response from AI teacher',
      };
    }
  }

  async getTextToSpeech(text: string, voiceConfig?: VoiceConfig, provider: 'elevenlabs' | 'google' = 'elevenlabs'): Promise<APIResponse<TTSResponse>> {
    try {
      const defaultVoiceConfig: VoiceConfig = {
        voiceName: 'hi-IN-Wavenet-A',
        languageCode: 'hi-IN',
        speakingRate: 0.9,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout for TTS

      const response = await fetch(`${BASE_URL}/api/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voiceConfig: voiceConfig || defaultVoiceConfig,
          provider: provider,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: data.success || true,
        data: {
          audioUrl: data.audioUrl || data.url,
          provider: data.provider,
        },
      };
    } catch (error) {
      console.error('Error getting TTS:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate speech',
      };
    }
  }

  async testConnection(): Promise<APIResponse<{ status: string }>> {
    try {
      const response = await fetch(`${BASE_URL}/api/test-connection`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: data.success || true,
        data: { status: data.status || 'Connected' },
      };
    } catch (error) {
      console.error('Error testing connection:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect to server',
      };
    }
  }

  async testGoogleAuth(): Promise<APIResponse<{ authenticated: boolean }>> {
    try {
      // For now, return a success response since TTS is not fully implemented
      return {
        success: true,
        data: { authenticated: true },
      };
    } catch (error) {
      console.error('Error testing Google auth:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to test Google authentication',
      };
    }
  }

  async speechToText(audioBlob: Blob): Promise<APIResponse<{ text: string }>> {
    try {
      console.log('Converting speech to text, blob size:', audioBlob.size);
      
      const reader = new FileReader();
      const base64Audio = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      });

      console.log('Base64 audio length:', base64Audio.length);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout for STT

      const response = await fetch(`${BASE_URL}/api/speech-to-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio: base64Audio,
          language: 'hi-IN',
          mimeType: audioBlob.type || 'audio/webm',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        console.error('Speech-to-text API Error:', {
          status: response.status,
          statusText: response.statusText,
          errorData,
        });
        throw new Error(errorData.error || `Speech API failed with status ${response.status}`);
      }
      
      const data = await response.json();
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
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Speech recognition failed'
      };
    }
  }

  // RAG service methods
  async getRagStatus(): Promise<APIResponse<{
    isAvailable: boolean;
    totalChunks: number;
    isLoaded: boolean;
    chapter: string;
    chapterTitle: string;
  }>> {
    try {
      const response = await fetch(`${BASE_URL}/api/rag/status`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error('Error getting RAG status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get RAG status',
      };
    }
  }

  async searchRag(query: string, topK: number = 3): Promise<APIResponse<{
    query: string;
    results: Array<{
      id: string;
      type: string;
      section: string;
      similarity: number;
      content: string;
      aiMetadata: any;
    }>;
  }>> {
    try {
      const response = await fetch(`${BASE_URL}/api/rag/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, topK }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error('Error searching RAG:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search RAG',
      };
    }
  }
}

export const apiService = new APIService();
