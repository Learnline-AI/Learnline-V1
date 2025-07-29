// vadService.ts - Enhanced VAD service with Silero ONNX and Custom VAD fallback
import { EventEmitter } from 'events';
import { SileroONNXVAD, createSileroVAD, type SileroVADResult } from './sileroVAD';

// VAD Provider Types
type VADProvider = 'silero' | 'custom' | 'auto';

// Environment variable for VAD provider selection
const VAD_PROVIDER = (process.env.VAD_PROVIDER as VADProvider) || 'auto';
const VAD_DEBUG = process.env.VAD_DEBUG === 'true';

// Enhanced VAD Configuration supporting both Silero ONNX and Custom VAD
interface VADConfig {
  sampleRate: number;
  provider: VADProvider;
  // Silero VAD specific settings
  model: "v5" | "legacy";
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number; 
  frameSamples: number;
  redemptionFrames: number;
  preSpeechPadFrames: number;
  minSpeechFrames: number;
  minSpeechDuration: number;
  minSilenceDuration: number;
  // Custom VAD fallback settings
  customVADEnabled: boolean;
  energyThreshold: number;
  activityThreshold: number;
}

const DEFAULT_VAD_CONFIG: VADConfig = {
  sampleRate: 16000,
  provider: VAD_PROVIDER,
  // Silero VAD settings (optimized for Hindi/English)
  model: "v5",
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  frameSamples: 512,
  redemptionFrames: 0,
  preSpeechPadFrames: 0,
  minSpeechFrames: 0,
  minSpeechDuration: 1000,
  minSilenceDuration: 800,
  // Custom VAD fallback settings
  customVADEnabled: true,
  energyThreshold: 0.01,
  activityThreshold: 0.6,
};

export type ConversationState = 'idle' | 'listening' | 'processing' | 'speaking';

export interface VADEvent {
  type: 'speech_start' | 'speech_end' | 'speech_chunk' | 'state_change';
  data: {
    timestamp: number;
    audioChunk?: Buffer;
    probability?: number;
    state?: ConversationState;
    provider?: string;
    debug?: {
      sileroResult?: SileroVADResult;
      customResult?: {
        energy: number;
        activity: number;
        probability: number;
      };
      fallbackUsed?: boolean;
    };
  };
}

export class ConversationVAD extends EventEmitter {
  private config: VADConfig;
  private state: ConversationState = 'idle';
  private audioBuffer: Float32Array[] = [];
  private speechStartTime: number | null = null;
  private lastSpeechTime: number = 0;
  private isInitialized = false;
  private isMounted = true;
  
  // VAD Provider instances
  private sileroVAD: SileroONNXVAD | null = null;
  private currentProvider: VADProvider = 'custom';
  
  // Audio processing state
  private currentSpeechSegment: Float32Array[] = [];
  
  // Performance tracking
  private vadStats = {
    sileroSuccess: 0,
    sileroErrors: 0,
    customFallbacks: 0,
    totalProcessed: 0,
  };

  constructor(config: Partial<VADConfig> = {}) {
    super();
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
    
    console.log('🎤 ConversationVAD initialized with enhanced config:', {
      provider: this.config.provider,
      model: this.config.model,
      positiveSpeechThreshold: this.config.positiveSpeechThreshold,
      negativeSpeechThreshold: this.config.negativeSpeechThreshold,
      customVADEnabled: this.config.customVADEnabled,
      debug: VAD_DEBUG
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('🔧 Initializing Enhanced VAD service...');
      
      // Try to initialize Silero ONNX VAD first
      if (this.config.provider === 'silero' || this.config.provider === 'auto') {
        try {
          this.sileroVAD = createSileroVAD({
            sensitivity: 'medium',
            language: 'mixed',
            modelVersion: this.config.model
          });
          
          await this.sileroVAD.initialize();
          this.currentProvider = 'silero';
          console.log('✅ Silero ONNX VAD initialized successfully');
          
        } catch (error) {
          console.warn('⚠️ Silero VAD initialization failed, will use custom VAD:', error);
          
          if (this.config.provider === 'silero') {
            throw new Error('Silero VAD required but initialization failed');
          }
          
          this.currentProvider = 'custom';
          this.vadStats.sileroErrors++;
        }
      } else {
        this.currentProvider = 'custom';
      }
      
      // Calculate frame-based timing for compatibility
      const frameSamples = this.config.model === "v5" ? 512 : 1536;
      this.config.frameSamples = frameSamples;
      this.config.redemptionFrames = Math.ceil((this.config.minSilenceDuration / 1000) * (this.config.sampleRate / frameSamples));
      this.config.preSpeechPadFrames = Math.ceil((300 / 1000) * (this.config.sampleRate / frameSamples));
      this.config.minSpeechFrames = Math.ceil((this.config.minSpeechDuration / 1000) * (this.config.sampleRate / frameSamples));
      
      console.log('🧠 VAD service configured:', {
        activeProvider: this.currentProvider,
        frameSamples: this.config.frameSamples,
        redemptionFrames: this.config.redemptionFrames,
        customVADEnabled: this.config.customVADEnabled
      });
      
      this.isInitialized = true;
      console.log('✅ Enhanced VAD service initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize VAD service:', error);
      throw error;
    }
  }

  async processAudioChunk(audioData: Buffer): Promise<VADEvent | null> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const timestamp = Date.now();
    this.vadStats.totalProcessed++;
    
    // Convert PCM16 Buffer to Float32Array
    const float32Audio = this.convertPCM16ToFloat32(audioData);
    
    if (float32Audio.length === 0) {
      console.warn('⚠️ Empty audio chunk received');
      return null;
    }
    
    // Add to buffer for speech collection
    this.audioBuffer.push(float32Audio);

    // Process with primary VAD provider
    const vadResult = await this.processWithActiveVAD(float32Audio, timestamp);
    
    return this.handleVADResult(vadResult, float32Audio, timestamp);
  }
  
  private convertPCM16ToFloat32(audioData: Buffer): Float32Array {
    // Convert 16-bit PCM Buffer to Float32Array (same logic as frontend lines 450-454)
    if (audioData.length === 0) return new Float32Array(0);
    
    const numSamples = audioData.length / 2; // 16-bit = 2 bytes per sample
    const float32Data = new Float32Array(numSamples);
    
    let minSample = 0, maxSample = 0, nonZeroCount = 0;
    
    for (let i = 0; i < numSamples; i++) {
      // Read 16-bit little-endian signed integer and normalize to -1.0 to 1.0
      const sample = audioData.readInt16LE(i * 2);
      const normalized = sample / 32768.0; // Convert to float32 range
      float32Data[i] = normalized;
      
      // Track statistics for debugging
      minSample = Math.min(minSample, normalized);
      maxSample = Math.max(maxSample, normalized);
      if (Math.abs(normalized) > 0.001) nonZeroCount++;
    }
    
    // Log conversion statistics occasionally (every ~20th call to avoid spam)
    if (Math.random() < 0.05) {
      const rms = Math.sqrt(float32Data.reduce((sum, val) => sum + val * val, 0) / numSamples);
      console.log(`🔧 PCM16→Float32 conversion: ${numSamples} samples, range=[${minSample.toFixed(4)}, ${maxSample.toFixed(4)}], rms=${rms.toFixed(4)}, nonZero=${(nonZeroCount/numSamples*100).toFixed(1)}%`);
      
      if (nonZeroCount === 0) {
        console.warn('⚠️ Converted audio is all zeros - check microphone input or audio pipeline');
      }
    }
    
    return float32Data;
  }
  
  private async processWithActiveVAD(audioData: Float32Array, timestamp: number): Promise<{
    probability: number;
    provider: string;
    debug?: any;
  }> {
    let sileroResult: SileroVADResult | null = null;
    let customResult = null;
    let fallbackUsed = false;
    let finalProbability = 0;
    let activeProvider = this.currentProvider;
    
    // Try Silero VAD first if available
    if (this.currentProvider === 'silero' && this.sileroVAD?.isReady()) {
      try {
        sileroResult = await this.sileroVAD.processAudioChunk(audioData);
        finalProbability = sileroResult.probability;
        this.vadStats.sileroSuccess++;
        
        if (VAD_DEBUG) {
          console.log(`🎤 Silero ONNX: prob=${finalProbability.toFixed(4)}, speech=${sileroResult.isSpeech}`);
        }
        
      } catch (error) {
        console.warn('⚠️ Silero VAD processing failed, falling back to custom VAD:', error);
        this.vadStats.sileroErrors++;
        fallbackUsed = true;
        activeProvider = 'custom';
      }
    }
    
    // Use custom VAD (either as primary or fallback)
    if (this.currentProvider === 'custom' || fallbackUsed || (this.config.customVADEnabled && !sileroResult)) {
      customResult = this.processCustomVAD(audioData);
      
      // Use custom result if Silero failed or as primary
      if (!sileroResult || fallbackUsed) {
        finalProbability = customResult.probability;
        activeProvider = 'custom';
        this.vadStats.customFallbacks++;
      }
      
      if (VAD_DEBUG) {
        console.log(`🔧 Custom VAD: energy=${customResult.energy.toFixed(4)}, activity=${customResult.activity.toFixed(3)}, prob=${customResult.probability.toFixed(4)}`);
      }
    }
    
    // Return comprehensive result
    return {
      probability: finalProbability,
      provider: activeProvider,
      debug: VAD_DEBUG ? {
        sileroResult,
        customResult,
        fallbackUsed,
        stats: this.vadStats
      } : undefined
    };
  }
  
  private processCustomVAD(audioData: Float32Array): {
    energy: number;
    activity: number;
    probability: number;
  } {
    if (audioData.length === 0) {
      return { energy: 0, activity: 0, probability: 0 };
    }
    
    // Enhanced custom VAD with better speech characteristics detection
    let energySum = 0;
    let maxAmplitude = 0;
    let silentSamples = 0;
    let activeSamples = 0;
    
    for (let i = 0; i < audioData.length; i++) {
      const sample = Math.abs(audioData[i]);
      energySum += audioData[i] * audioData[i];
      maxAmplitude = Math.max(maxAmplitude, sample);
      
      // Count samples above/below activity thresholds
      if (sample < this.config.energyThreshold) {
        silentSamples++;
      } else {
        activeSamples++;
      }
    }
    
    const rmsEnergy = Math.sqrt(energySum / audioData.length);
    const activityRatio = activeSamples / audioData.length;
    
    // Improved scoring for speech detection
    const energyScore = Math.min(rmsEnergy * 20, 1.0); // Scale energy
    const peakScore = Math.min(maxAmplitude * 5, 1.0);  // Scale peak
    const activityScore = activityRatio > this.config.activityThreshold ? 1.0 : activityRatio;
    
    // Weighted combination optimized for Hindi/English speech
    const probability = (energyScore * 0.4) + (peakScore * 0.3) + (activityScore * 0.3);
    
    return {
      energy: rmsEnergy,
      activity: activityRatio,
      probability: Math.min(probability, 1.0)
    };
  }


  private handleVADResult(vadResult: {
    probability: number;
    provider: string;
    debug?: any;
  }, audioData: Float32Array, timestamp: number): VADEvent | null {
    const wasSpeaking = this.state === 'listening';
    const { probability, provider, debug } = vadResult;
    
    // Enhanced dual-threshold logic with provider-specific adjustments
    let eventType: VADEvent['type'] | null = null;
    
    if (probability > this.config.positiveSpeechThreshold) {
      // Speech detected
      if (!wasSpeaking) {
        // Speech start
        this.speechStartTime = timestamp;
        this.currentSpeechSegment = [];
        this.setState('listening');
        eventType = 'speech_start';
        console.log(`🎤 ${provider} VAD: Speech started (prob=${probability.toFixed(3)})`);
      } else {
        // Continuing speech - collect audio chunk
        this.currentSpeechSegment.push(audioData);
        eventType = 'speech_chunk';
      }
      this.lastSpeechTime = timestamp;
      
    } else if (probability < this.config.negativeSpeechThreshold && wasSpeaking) {
      // Silence detected during speech
      const silenceDuration = timestamp - this.lastSpeechTime;
      const speechDuration = this.speechStartTime ? timestamp - this.speechStartTime : 0;
      
      if (silenceDuration >= this.config.minSilenceDuration && 
          speechDuration >= this.config.minSpeechDuration) {
        // End of speech
        this.setState('processing');
        eventType = 'speech_end';
        this.speechStartTime = null;
        console.log(`🔇 ${provider} VAD: Speech ended (duration=${speechDuration}ms)`);
      }
    }

    if (eventType) {
      const event: VADEvent = {
        type: eventType,
        data: {
          timestamp,
          audioChunk: eventType === 'speech_end' ? this.getCollectedAudioAsBuffer() : undefined,
          probability,
          state: this.state,
          provider,
          debug: VAD_DEBUG ? debug : undefined
        }
      };
      
      this.emit(eventType, event);
      return event;
    }

    return null;
  }

  private setState(newState: ConversationState) {
    if (this.state !== newState) {
      console.log(`🔄 Conversation state: ${this.state} → ${newState}`);
      this.state = newState;
      
      const event: VADEvent = {
        type: 'state_change',
        data: {
          timestamp: Date.now(),
          state: newState
        }
      };
      
      this.emit('state_change', event);
    }
  }

  getCollectedAudio(): Buffer {
    // Convert Float32Array back to Buffer for compatibility
    return this.getCollectedAudioAsBuffer();
  }
  
  private getCollectedAudioAsBuffer(): Buffer {
    // Combine all Float32Array chunks into a single Float32Array
    const totalLength = this.currentSpeechSegment.reduce((sum, chunk) => sum + chunk.length, 0);
    const combinedAudio = new Float32Array(totalLength);
    
    let offset = 0;
    for (const chunk of this.currentSpeechSegment) {
      combinedAudio.set(chunk, offset);
      offset += chunk.length;
    }
    
    // Convert Float32Array back to PCM16 Buffer (reverse of convertPCM16ToFloat32)
    const buffer = Buffer.allocUnsafe(combinedAudio.length * 2); // 2 bytes per 16-bit sample
    
    for (let i = 0; i < combinedAudio.length; i++) {
      // Convert float32 (-1.0 to 1.0) back to 16-bit signed integer
      const sample = Math.max(-32768, Math.min(32767, Math.floor(combinedAudio[i] * 32768)));
      buffer.writeInt16LE(sample, i * 2);
    }
    
    return buffer;
  }
  
  getCollectedAudioAsFloat32(): Float32Array {
    // Return the raw Float32Array data (for WAV encoding like frontend)
    const totalLength = this.currentSpeechSegment.reduce((sum, chunk) => sum + chunk.length, 0);
    const combinedAudio = new Float32Array(totalLength);
    
    let offset = 0;
    for (const chunk of this.currentSpeechSegment) {
      combinedAudio.set(chunk, offset);
      offset += chunk.length;
    }
    
    return combinedAudio;
  }

  clearBuffer() {
    this.audioBuffer = [];
    this.currentSpeechSegment = [];
  }

  getCurrentState(): ConversationState {
    return this.state;
  }

  // Public method to change state (for external control)
  setConversationState(state: ConversationState) {
    this.setState(state);
  }
  
  // VAD provider management methods
  getCurrentProvider(): VADProvider {
    return this.currentProvider;
  }
  
  async switchProvider(provider: VADProvider): Promise<boolean> {
    if (provider === this.currentProvider) return true;
    
    try {
      if (provider === 'silero') {
        if (!this.sileroVAD) {
          this.sileroVAD = createSileroVAD();
          await this.sileroVAD.initialize();
        }
        if (this.sileroVAD.isReady()) {
          this.currentProvider = 'silero';
          console.log('✅ Switched to Silero VAD');
          return true;
        }
      } else if (provider === 'custom') {
        this.currentProvider = 'custom';
        console.log('✅ Switched to Custom VAD');
        return true;
      }
    } catch (error) {
      console.error(`❌ Failed to switch to ${provider} VAD:`, error);
    }
    
    return false;
  }
  
  getVADStats() {
    return {
      ...this.vadStats,
      currentProvider: this.currentProvider,
      sileroReady: this.sileroVAD?.isReady() || false,
      sileroStateInfo: this.sileroVAD?.getStateInfo() || null
    };
  }
  
  // Reset VAD session (clears LSTM states)
  resetSession(): void {
    if (this.sileroVAD) {
      this.sileroVAD.resetSession();
    }
    this.clearBuffer();
    this.setState('idle');
    console.log('🔄 VAD session completely reset');
  }

  async destroy() {
    this.isMounted = false;
    this.clearBuffer();
    this.removeAllListeners();
    
    if (this.sileroVAD) {
      await this.sileroVAD.destroy();
      this.sileroVAD = null;
    }
    
    console.log('🧹 Enhanced VAD service destroyed');
  }
}

// Factory function for creating VAD instances with provider selection
export function createVADInstance(config?: Partial<VADConfig>): ConversationVAD {
  return new ConversationVAD(config);
}

// Utility function to get optimal VAD configuration for different scenarios
export function getOptimalVADConfig(scenario: {
  language?: 'hindi' | 'english' | 'mixed';
  environment?: 'quiet' | 'noisy' | 'variable';
  sensitivity?: 'low' | 'medium' | 'high';
}): Partial<VADConfig> {
  const { language = 'mixed', environment = 'variable', sensitivity = 'medium' } = scenario;
  
  let config: Partial<VADConfig> = {
    provider: 'auto', // Let system choose best provider
    model: 'v5',
  };
  
  // Adjust thresholds based on sensitivity
  switch (sensitivity) {
    case 'high':
      config.positiveSpeechThreshold = 0.3;
      config.negativeSpeechThreshold = 0.2;
      config.energyThreshold = 0.005;
      break;
    case 'low':
      config.positiveSpeechThreshold = 0.7;
      config.negativeSpeechThreshold = 0.5;
      config.energyThreshold = 0.02;
      break;
    default: // medium
      config.positiveSpeechThreshold = 0.5;
      config.negativeSpeechThreshold = 0.35;
      config.energyThreshold = 0.01;
  }
  
  // Adjust for language characteristics
  if (language === 'hindi' || language === 'mixed') {
    // Hindi speech patterns - more tolerance for pauses
    config.minSilenceDuration = 900;
    config.minSpeechDuration = 800;
  }
  
  // Adjust for environment
  if (environment === 'noisy') {
    config.positiveSpeechThreshold! += 0.1;
    config.energyThreshold! *= 2;
  }
  
  return config;
}

// Export types for external use
export type { VADConfig, VADProvider };