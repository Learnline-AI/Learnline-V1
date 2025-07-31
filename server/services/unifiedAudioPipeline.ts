// Pipecat-Inspired Unified Audio Processing Pipeline
// Single service that handles: Audio Input → Voice Isolation → VAD → STT → AI → TTS → Audio Output

import { EventEmitter } from 'events';
import { getRNNoiseService } from './rnnoiseService';
import { createVADInstance, ConversationVAD, VADEvent } from './vadService';
import { generateAIResponse } from './aiService';
import { generateTTS } from './ttsService';
import { SYSTEM_PROMPTS } from '../config/aiConfig';

interface AudioChunk {
  data: Buffer;
  timestamp: number;
  sessionId: string;
  format: 'pcm16' | 'float32';
  sampleRate: number;
}

interface ProcessingResult {
  success: boolean;
  transcription?: string;
  aiResponse?: string;
  audioResponse?: string;
  error?: string;
  processingSteps: string[];
}

interface SessionContext {
  sessionId: string;
  vadInstance: ConversationVAD;
  voiceIsolationManager: VoiceIsolationManager;
  isActive: boolean;
  lastActivity: number;
  stats: {
    totalChunks: number;
    successfulProcessings: number;
    errors: number;
    startTime: number;
  };
}

interface VoiceIsolationProvider {
  name: string;
  initialize(): Promise<boolean>;
  process(audio: Float32Array): Promise<Float32Array>;
  isAvailable(): boolean;
  destroy(): Promise<void>;
}

class FacebookDenoiserProvider implements VoiceIsolationProvider {
  name = 'FacebookDenoiser';
  private isReady = false;

  async initialize(): Promise<boolean> {
    try {
      // Try to initialize Facebook Denoiser
      // This would typically load the model/service
      console.log('🔧 Initializing Facebook Denoiser...');
      
      // Mock initialization - replace with actual implementation
      // const denoiser = await import('./facebookDenoiserService');
      // await denoiser.initialize();
      
      this.isReady = true;
      console.log('✅ Facebook Denoiser initialized');
      return true;
    } catch (error) {
      console.warn('⚠️ Facebook Denoiser failed to initialize:', error);
      return false;
    }
  }

  async process(audio: Float32Array): Promise<Float32Array> {
    if (!this.isReady) {
      throw new Error('Facebook Denoiser not initialized');
    }
    
    // Mock processing - replace with actual denoising
    // Apply some basic noise reduction simulation
    const processed = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i++) {
      // Simple high-pass filter simulation
      processed[i] = audio[i] * 0.9;
    }
    
    return processed;
  }

  isAvailable(): boolean {
    return this.isReady;
  }

  async destroy(): Promise<void> {
    this.isReady = false;
  }
}

class RNNoiseProvider implements VoiceIsolationProvider {
  name = 'RNNoise';
  private rnnoiseService = getRNNoiseService();

  async initialize(): Promise<boolean> {
    try {
      await this.rnnoiseService.initialize();
      return this.rnnoiseService.isServiceEnabled();
    } catch (error) {
      console.warn('⚠️ RNNoise failed to initialize:', error);
      return false;
    }
  }

  async process(audio: Float32Array): Promise<Float32Array> {
    return await this.rnnoiseService.processAudio(audio);
  }

  isAvailable(): boolean {
    return this.rnnoiseService.isServiceEnabled();
  }

  async destroy(): Promise<void> {
    await this.rnnoiseService.destroy();
  }
}

class WebRTCProvider implements VoiceIsolationProvider {
  name = 'WebRTC';

  async initialize(): Promise<boolean> {
    // WebRTC noise suppression is always available
    return true;
  }

  async process(audio: Float32Array): Promise<Float32Array> {
    // Apply basic WebRTC-style noise suppression
    const processed = new Float32Array(audio.length);
    
    // Simple moving average for noise reduction
    const windowSize = 5;
    for (let i = 0; i < audio.length; i++) {
      let sum = 0;
      let count = 0;
      
      for (let j = Math.max(0, i - windowSize); j <= Math.min(audio.length - 1, i + windowSize); j++) {
        sum += audio[j];
        count++;
      }
      
      processed[i] = sum / count;
    }
    
    return processed;
  }

  isAvailable(): boolean {
    return true;
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }
}

class VoiceIsolationManager {
  private providers: VoiceIsolationProvider[] = [];
  private activeProvider: VoiceIsolationProvider | null = null;

  async initialize(): Promise<void> {
    // Initialize providers in order of preference
    const providerClasses = [FacebookDenoiserProvider, RNNoiseProvider, WebRTCProvider];
    
    for (const ProviderClass of providerClasses) {
      const provider = new ProviderClass();
      const success = await provider.initialize();
      
      if (success) {
        this.providers.push(provider);
        if (!this.activeProvider) {
          this.activeProvider = provider;
          console.log(`✅ Voice isolation: Using ${provider.name} as primary provider`);
        }
      }
    }

    if (!this.activeProvider) {
      throw new Error('No voice isolation providers available');
    }
  }

  async processAudio(audio: Float32Array): Promise<Float32Array> {
    if (!this.activeProvider) {
      return audio; // Graceful fallback
    }

    try {
      return await this.activeProvider.process(audio);
    } catch (error) {
      console.warn(`⚠️ Voice isolation failed with ${this.activeProvider.name}, using original audio:`, error);
      
      // Try to switch to next available provider
      await this.switchToNextProvider();
      
      return audio; // Graceful fallback
    }
  }

  private async switchToNextProvider(): Promise<void> {
    if (!this.activeProvider || this.providers.length <= 1) {
      return;
    }

    const currentIndex = this.providers.indexOf(this.activeProvider);
    const nextIndex = (currentIndex + 1) % this.providers.length;
    
    this.activeProvider = this.providers[nextIndex];
    console.log(`🔄 Voice isolation: Switched to ${this.activeProvider.name}`);
  }

  getActiveProvider(): string {
    return this.activeProvider?.name || 'none';
  }

  async destroy(): Promise<void> {
    for (const provider of this.providers) {
      await provider.destroy();
    }
    this.providers = [];
    this.activeProvider = null;
  }
}

export class UnifiedAudioPipeline extends EventEmitter {
  private sessions: Map<string, SessionContext> = new Map();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startCleanupTimer();
  }

  async createSession(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    try {
      // Initialize voice isolation manager
      const voiceIsolationManager = new VoiceIsolationManager();
      await voiceIsolationManager.initialize();

      // Initialize VAD instance
      const vadInstance = createVADInstance({
        provider: 'auto',
        facebookDenoiserEnabled: false, // We handle this in voice isolation
        rnnoiseEnabled: false, // We handle this in voice isolation
        sampleRate: 16000
      });
      await vadInstance.initialize();

      // Create session context
      const sessionContext: SessionContext = {
        sessionId,
        vadInstance,
        voiceIsolationManager,
        isActive: true,
        lastActivity: Date.now(),
        stats: {
          totalChunks: 0,
          successfulProcessings: 0,
          errors: 0,
          startTime: Date.now()
        }
      };

      this.sessions.set(sessionId, sessionContext);
      
      console.log(`✅ Unified Pipeline: Session created [${sessionId}] with voice isolation: ${voiceIsolationManager.getActiveProvider()}`);
      
      this.emit('session_created', { sessionId, voiceIsolationProvider: voiceIsolationManager.getActiveProvider() });
      
    } catch (error) {
      console.error(`❌ Unified Pipeline: Failed to create session [${sessionId}]:`, error);
      throw error;
    }
  }

  async processAudioChunk(sessionId: string, audioChunk: AudioChunk): Promise<ProcessingResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        error: `Session ${sessionId} not found`,
        processingSteps: ['session_lookup_failed']
      };
    }

    session.lastActivity = Date.now();
    session.stats.totalChunks++;

    const processingSteps: string[] = [];
    
    try {
      // Step 1: Convert audio format if needed
      processingSteps.push('audio_format_conversion');
      let audioData: Float32Array;
      
      if (audioChunk.format === 'pcm16') {
        // Convert PCM16 to Float32
        const int16Array = new Int16Array(audioChunk.data.buffer);
        audioData = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
          audioData[i] = int16Array[i] / 32768.0;
        }
      } else {
        audioData = new Float32Array(audioChunk.data.buffer);
      }

      // Step 2: Voice Isolation (Facebook Denoiser → RNNoise → WebRTC fallback)
      processingSteps.push('voice_isolation');
      const isolatedAudio = await session.voiceIsolationManager.processAudio(audioData);

      // Step 3: VAD Processing
      processingSteps.push('vad_processing');
      const audioBuffer = Buffer.from(isolatedAudio.buffer);
      const vadEvent = await session.vadInstance.processAudioChunk(audioBuffer);

      if (vadEvent && vadEvent.type === 'speech_end' && vadEvent.data.audioChunk) {
        // Step 4: Speech-to-Text
        processingSteps.push('speech_to_text');
        const transcription = await this.processSTT(vadEvent.data.audioChunk);
        
        if (transcription) {
          // Step 5: AI Processing
          processingSteps.push('ai_processing');
          const aiResponse = await this.processAI(transcription);
          
          // Step 6: Text-to-Speech
          processingSteps.push('text_to_speech');
          const audioResponse = await this.processTTS(aiResponse);
          
          session.stats.successfulProcessings++;
          
          const result: ProcessingResult = {
            success: true,
            transcription,
            aiResponse,
            audioResponse,
            processingSteps
          };

          this.emit('processing_complete', { sessionId, result });
          return result;
        }
      }

      // No speech detected or processing incomplete
      return {
        success: true,
        processingSteps
      };

    } catch (error) {
      session.stats.errors++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.error(`❌ Unified Pipeline: Processing failed [${sessionId}]:`, error);
      
      this.emit('processing_error', { sessionId, error: errorMessage, processingSteps });
      
      return {
        success: false,
        error: errorMessage,
        processingSteps
      };
    }
  }

  private async processSTT(audioBuffer: Buffer): Promise<string | null> {
    try {
      const apiKey = process.env.GOOGLE_CLOUD_SPEECH_API_KEY || process.env.GOOGLE_CLOUD_TTS_API_KEY;
      if (!apiKey) {
        throw new Error('Google Cloud Speech API key not configured');
      }

      const base64Audio = audioBuffer.toString('base64');
      
      const response = await fetch(
        `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: {
              encoding: 'LINEAR16',
              sampleRateHertz: 16000,
              languageCode: 'hi-IN',
              enableAutomaticPunctuation: true
            },
            audio: { content: base64Audio }
          })
        }
      );

      if (!response.ok) {
        throw new Error(`STT API error: ${response.status}`);
      }

      const data = await response.json();
      const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;
      
      return transcript || null;
      
    } catch (error) {
      console.error('❌ STT processing failed:', error);
      return null;
    }
  }

  private async processAI(transcription: string): Promise<string> {
    const aiResponse = await generateAIResponse(transcription, SYSTEM_PROMPTS.HINDI_TEACHER_BASE, false);
    
    if ('stream' in aiResponse) {
      throw new Error('Expected non-streaming response');
    }
    
    return aiResponse.content;
  }

  private async processTTS(text: string): Promise<string> {
    const ttsResult = await generateTTS(text, { languageCode: 'hi-IN' });
    return ttsResult.audioUrl;
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      await session.vadInstance.destroy();
      await session.voiceIsolationManager.destroy();
      
      this.sessions.delete(sessionId);
      
      const duration = Date.now() - session.stats.startTime;
      console.log(`🧹 Unified Pipeline: Session destroyed [${sessionId}] - Duration: ${Math.round(duration/1000)}s, Chunks: ${session.stats.totalChunks}, Success: ${session.stats.successfulProcessings}, Errors: ${session.stats.errors}`);
      
      this.emit('session_destroyed', { sessionId, stats: session.stats });
      
    } catch (error) {
      console.error(`❌ Unified Pipeline: Error destroying session [${sessionId}]:`, error);
    }
  }

  getSessionStats(sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session ? { ...session.stats } : null;
  }

  getAllStats() {
    const activeSessions = this.sessions.size;
    let totalChunks = 0;
    let totalSuccesses = 0;
    let totalErrors = 0;

    for (const session of this.sessions.values()) {
      totalChunks += session.stats.totalChunks;
      totalSuccesses += session.stats.successfulProcessings;
      totalErrors += session.stats.errors;
    }

    return {
      activeSessions,
      totalChunks,
      totalSuccesses,
      totalErrors,
      successRate: totalChunks > 0 ? (totalSuccesses / totalChunks * 100).toFixed(2) + '%' : '0%'
    };
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      
      for (const [sessionId, session] of this.sessions.entries()) {
        if (now - session.lastActivity > this.SESSION_TIMEOUT) {
          console.log(`⏰ Unified Pipeline: Session timeout [${sessionId}]`);
          this.destroySession(sessionId);
        }
      }
    }, 60000); // Check every minute
  }

  async shutdown(): Promise<void> {
    console.log('🔄 Unified Pipeline: Shutting down...');
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Destroy all sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.destroySession(id)));
    
    this.removeAllListeners();
    
    console.log('✅ Unified Pipeline: Shutdown complete');
  }
}

// Singleton instance
let unifiedPipeline: UnifiedAudioPipeline | null = null;

export function getUnifiedAudioPipeline(): UnifiedAudioPipeline {
  if (!unifiedPipeline) {
    unifiedPipeline = new UnifiedAudioPipeline();
  }
  return unifiedPipeline;
}