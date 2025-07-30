// Speech-to-Text Service for WebSocket Audio Processing
interface STTConfig {
  language?: string;
  enhancedModel?: boolean;
  encoding?: 'LINEAR16' | 'WEBM_OPUS' | 'MP4';
  sampleRate?: number;
}

interface STTRequest {
  audio: string; // base64 encoded audio
  language?: string;
  enhancedModel?: boolean;
  format?: string;
}

interface STTResult {
  success: boolean;
  data?: {
    text: string;
    confidence?: number;
    duration?: number;
    provider: string;
    language?: string;
  };
  error?: string;
}

class SpeechToTextService {
  private readonly googleApiKey: string;
  private readonly fallbackProvider = 'google';
  
  constructor() {
    this.googleApiKey = process.env.GOOGLE_CLOUD_SPEECH_API_KEY || process.env.GOOGLE_CLOUD_TTS_API_KEY || '';
    
    if (!this.googleApiKey) {
      console.warn('⚠️ STT Service: No Google API key found - STT functionality will be limited');
    }
  }

  /**
   * Transcribe audio to text
   */
  async transcribeAudio(request: STTRequest): Promise<STTResult> {
    const startTime = performance.now();
    
    try {
      console.log(`🎤 STT: Starting transcription - ${request.audio.length} chars, lang: ${request.language || 'auto'}`);
      
      if (!request.audio || request.audio.length === 0) {
        return {
          success: false,
          error: 'Empty audio data provided'
        };
      }

      // Validate audio size (max 10MB)
      const audioBuffer = Buffer.from(request.audio, 'base64');
      const audioSizeMB = audioBuffer.length / (1024 * 1024);
      
      if (audioSizeMB > 10) {
        return {
          success: false,
          error: `Audio too large: ${audioSizeMB.toFixed(2)}MB (max 10MB)`
        };
      }

      // Try Google Speech-to-Text API
      const result = await this.transcribeWithGoogle(request);
      
      const processingTime = performance.now() - startTime;
      console.log(`✅ STT: Transcription completed in ${Math.round(processingTime)}ms - "${result.data?.text?.substring(0, 50)}..."`);
      
      return result;

    } catch (error) {
      const processingTime = performance.now() - startTime;
      console.error(`❌ STT: Transcription failed in ${Math.round(processingTime)}ms:`, error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown STT error'
      };
    }
  }

  /**
   * Transcribe using Google Speech-to-Text API
   */
  private async transcribeWithGoogle(request: STTRequest): Promise<STTResult> {
    if (!this.googleApiKey) {
      throw new Error('Google Speech API key not configured');
    }

    // Determine audio configuration
    const config = this.getAudioConfig(request);
    const languageCode = this.getLanguageCode(request.language);

    const requestBody = {
      config: {
        encoding: config.encoding,
        sampleRateHertz: config.sampleRate,
        languageCode,
        enableAutomaticPunctuation: true,
        model: request.enhancedModel ? 'latest_long' : 'latest_short',
        useEnhanced: request.enhancedModel || false
      },
      audio: {
        content: request.audio
      }
    };

    console.log(`🔧 STT: Google API request - encoding: ${config.encoding}, rate: ${config.sampleRate}, lang: ${languageCode}`);

    const response = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${this.googleApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ STT: Google API error ${response.status}:`, errorText);
      throw new Error(`Google Speech API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.results || data.results.length === 0) {
      console.warn('⚠️ STT: No speech recognized in audio');
      return {
        success: false,
        error: 'No speech detected in audio'
      };
    }

    // Extract best transcript
    const bestResult = data.results[0];
    const transcript = bestResult.alternatives?.[0]?.transcript || '';
    const confidence = bestResult.alternatives?.[0]?.confidence || 0;

    if (!transcript.trim()) {
      return {
        success: false,
        error: 'Empty transcription result'
      };
    }

    // Calculate duration estimate (rough approximation)
    const audioBuffer = Buffer.from(request.audio, 'base64');
    const estimatedDuration = this.estimateAudioDuration(audioBuffer, config);

    return {
      success: true,
      data: {
        text: transcript.trim(),
        confidence,
        duration: estimatedDuration,
        provider: 'google',
        language: languageCode
      }
    };
  }

  /**
   * Get audio configuration based on request
   */
  private getAudioConfig(request: STTRequest): { encoding: string; sampleRate: number } {
    // Default to LINEAR16 PCM at 16kHz (VAD output format)
    let encoding = 'LINEAR16';
    let sampleRate = 16000;

    // Detect format from base64 data if possible
    if (request.format) {
      const format = request.format.toLowerCase();
      
      if (format.includes('webm') || format.includes('opus')) {
        encoding = 'WEBM_OPUS';
        sampleRate = 48000;
      } else if (format.includes('mp4') || format.includes('m4a')) {
        encoding = 'MP4';
        sampleRate = 44100;
      } else if (format.includes('wav') || format.includes('pcm')) {
        encoding = 'LINEAR16';
        sampleRate = 16000;
      }
    }

    // Try to detect from magic bytes
    try {
      const buffer = Buffer.from(request.audio.substring(0, 32), 'base64');
      const header = buffer.toString('hex');
      
      // WebM signature
      if (header.includes('1a45dfa3')) {
        encoding = 'WEBM_OPUS';
        sampleRate = 48000;
      }
      // M4A/MP4 signatures
      else if (header.includes('667479704d344120') || header.includes('6674797069736f6d')) {
        encoding = 'MP4';
        sampleRate = 44100;
      }
      // WAV signature
      else if (header.includes('52494646')) {
        encoding = 'LINEAR16';
        sampleRate = 16000;
      }
    } catch (error) {
      console.warn('⚠️ STT: Could not detect audio format from magic bytes');
    }

    return { encoding, sampleRate };
  }

  /**
   * Get Google language code
   */
  private getLanguageCode(language?: string): string {
    if (!language) return 'hi-IN'; // Default to Hindi for education app
    
    const languageMap: Record<string, string> = {
      'hi': 'hi-IN',
      'hindi': 'hi-IN',
      'en': 'en-US',
      'english': 'en-US',
      'hinglish': 'hi-IN', // Use Hindi for Hinglish
      'auto': 'hi-IN'
    };

    return languageMap[language.toLowerCase()] || 'hi-IN';
  }

  /**
   * Estimate audio duration from buffer size and config
   */
  private estimateAudioDuration(buffer: Buffer, config: { sampleRate: number }): number {
    try {
      // Rough estimation based on typical compression ratios
      const bytesPerSecond = config.sampleRate * 2; // 16-bit PCM
      const compressionRatio = 0.1; // Assume 10:1 compression for compressed formats
      
      const estimatedBytes = buffer.length * (config.sampleRate === 16000 ? 1 : compressionRatio);
      const duration = estimatedBytes / bytesPerSecond;
      
      return Math.max(0.1, Math.min(60, duration)); // Clamp between 0.1s and 60s
    } catch (error) {
      return 1.0; // Default duration
    }
  }

  /**
   * Check if service is available
   */
  isAvailable(): boolean {
    return !!this.googleApiKey;
  }

  /**
   * Get service configuration
   */
  getConfig() {
    return {
      provider: 'google',
      available: this.isAvailable(),
      supportedLanguages: ['hi-IN', 'en-US'],
      supportedFormats: ['LINEAR16', 'WEBM_OPUS', 'MP4'],
      maxFileSizeMB: 10,
      maxDurationSeconds: 60
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: any;
  }> {
    try {
      if (!this.isAvailable()) {
        return {
          status: 'unhealthy',
          details: {
            error: 'Google API key not configured',
            provider: 'google',
            available: false
          }
        };
      }

      // Try a small test request (without actually sending audio)
      const testResponse = await fetch(
        `https://speech.googleapis.com/v1/speech:recognize?key=${this.googleApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: {
              encoding: 'LINEAR16',
              sampleRateHertz: 16000,
              languageCode: 'hi-IN'
            },
            audio: { content: '' } // Empty content for API validation
          })
        }
      );

      // We expect a 400 error for empty audio, which means API is accessible
      if (testResponse.status === 400) {
        return {
          status: 'healthy',
          details: {
            provider: 'google',
            available: true,
            apiAccessible: true
          }
        };
      }

      return {
        status: 'degraded',
        details: {
          provider: 'google',
          available: true,
          apiAccessible: false,
          statusCode: testResponse.status
        }
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          provider: 'google',
          available: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }
}

// Singleton instance
export const speechToTextService = new SpeechToTextService();

// Export types
export type { STTRequest, STTResult, STTConfig };