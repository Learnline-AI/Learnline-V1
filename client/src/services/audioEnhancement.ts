// Client-side Audio Enhancement with RNNoise WebAssembly
// Provides browser-based voice isolation before sending to server

interface AudioEnhancementConfig {
  enabled: boolean;
  debug: boolean;
  fallbackTimeout: number;
  preferredProvider: 'jitsi' | 'timephy' | 'auto';
}

interface ProcessingStats {
  totalProcessed: number;
  successfulProcessed: number;
  errors: number;
  averageLatency: number;
  provider: string | null;
}

interface EnhancementProvider {
  name: string;
  instance: any;
  isReady: boolean;
  initialize(): Promise<void>;
  process(audioData: Float32Array): Promise<Float32Array>;
  destroy(): void;
}

export class AudioEnhancementService {
  private config: AudioEnhancementConfig;
  private providers: EnhancementProvider[] = [];
  private activeProvider: EnhancementProvider | null = null;
  private isInitialized = false;
  private isEnabled = true;
  private stats: ProcessingStats;

  constructor(config?: Partial<AudioEnhancementConfig>) {
    this.config = {
      enabled: true,
      debug: false,
      fallbackTimeout: 500,
      preferredProvider: 'auto',
      ...config
    };

    this.stats = {
      totalProcessed: 0,
      successfulProcessed: 0,
      errors: 0,
      averageLatency: 0,
      provider: null
    };

    if (this.config.debug) {
      console.log('🎤 AudioEnhancement: Browser service initialized', this.config);
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!this.config.enabled) {
      console.log('🎤 AudioEnhancement: Service disabled via configuration');
      this.isEnabled = false;
      this.isInitialized = true;
      return;
    }

    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      console.warn('⚠️ AudioEnhancement: Not in browser environment, disabling');
      this.isEnabled = false;
      this.isInitialized = true;
      return;
    }

    try {
      console.log('🎤 AudioEnhancement: Initializing browser-based voice isolation...');
      
      // Initialize providers with fallback chain
      await this.initializeProviders();
      
      if (this.providers.length === 0) {
        console.warn('⚠️ AudioEnhancement: No providers available, disabling service');
        this.isEnabled = false;
        this.isInitialized = true;
        return;
      }

      // Select the best available provider
      this.activeProvider = this.providers.find(p => p.isReady) || null;
      
      if (!this.activeProvider) {
        console.warn('⚠️ AudioEnhancement: No ready providers available, disabling service');
        this.isEnabled = false;
      } else {
        console.log(`✅ AudioEnhancement: Browser service ready with provider: ${this.activeProvider.name}`);
        this.stats.provider = this.activeProvider.name;
      }

      this.isInitialized = true;
      
    } catch (error) {
      console.error('❌ AudioEnhancement: Browser initialization failed:', error);
      this.isEnabled = false;
      this.isInitialized = true;
    }
  }

  private async initializeProviders(): Promise<void> {
    // Try Jitsi RNNoise WASM first
    if (this.config.preferredProvider === 'jitsi' || this.config.preferredProvider === 'auto') {
      await this.initializeJitsiProvider();
    }
    
    // Try TimePhysics RNNoise WASM as fallback
    if (this.config.preferredProvider === 'timephy' || this.config.preferredProvider === 'auto') {
      await this.initializeTimePhyProvider();
    }
  }

  private async initializeJitsiProvider(): Promise<void> {
    try {
      // Dynamic import for tree shaking
      const { default: RnnoiseProcessor } = await import('@jitsi/rnnoise-wasm');
      
      const processor = new RnnoiseProcessor();
      await processor.ready();
      
      const provider: EnhancementProvider = {
        name: 'jitsi-browser',
        instance: processor,
        isReady: true,
        initialize: async () => {
          // Already initialized
        },
        process: async (audioData: Float32Array): Promise<Float32Array> => {
          return processor.process(audioData);
        },
        destroy: () => {
          processor.destroy();
        }
      };
      
      this.providers.push(provider);
      
      if (this.config.debug) {
        console.log('✅ AudioEnhancement: Jitsi browser provider initialized');
      }
      
    } catch (error) {
      if (this.config.debug) {
        console.warn('⚠️ AudioEnhancement: Jitsi browser provider failed:', error);
      }
    }
  }

  private async initializeTimePhyProvider(): Promise<void> {
    try {
      // Dynamic import for tree shaking
      const { RnnoiseWasm } = await import('@timephy/rnnoise-wasm');
      
      const processor = new RnnoiseWasm();
      await processor.init();
      
      const provider: EnhancementProvider = {
        name: 'timephy-browser',
        instance: processor,
        isReady: true,
        initialize: async () => {
          // Already initialized
        },
        process: async (audioData: Float32Array): Promise<Float32Array> => {
          return processor.process(audioData);
        },
        destroy: () => {
          processor.destroy();
        }
      };
      
      this.providers.push(provider);
      
      if (this.config.debug) {
        console.log('✅ AudioEnhancement: TimePhysics browser provider initialized');
      }
      
    } catch (error) {
      if (this.config.debug) {
        console.warn('⚠️ AudioEnhancement: TimePhysics browser provider failed:', error);
      }
    }
  }

  async enhanceAudio(audioData: Float32Array): Promise<Float32Array> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Return original audio if service is disabled
    if (!this.isEnabled || !this.activeProvider) {
      return audioData;
    }

    if (!audioData || audioData.length === 0) {
      return audioData;
    }

    const startTime = performance.now();
    this.stats.totalProcessed++;

    try {
      // Process audio with timeout protection
      const enhancedAudio = await this.processWithTimeout(audioData);
      
      // Update performance stats
      const processingTime = performance.now() - startTime;
      this.updateStats(processingTime, true);
      
      if (this.config.debug && Math.random() < 0.1) { // Log 10% of requests
        console.log(`🔧 AudioEnhancement: Browser processing successful (${processingTime.toFixed(2)}ms, ${audioData.length} samples)`);
      }

      return enhancedAudio;

    } catch (error) {
      const processingTime = performance.now() - startTime;
      this.updateStats(processingTime, false);
      
      console.warn(`⚠️ AudioEnhancement: Browser processing failed (${processingTime.toFixed(2)}ms):`, error);
      
      // Graceful fallback - return original audio
      return audioData;
    }
  }

  private async processWithTimeout(audioData: Float32Array): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Browser processing timeout after ${this.config.fallbackTimeout}ms`));
      }, this.config.fallbackTimeout);

      this.activeProvider!.process(audioData)
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private updateStats(processingTime: number, success: boolean): void {
    if (success) {
      this.stats.successfulProcessed++;
    } else {
      this.stats.errors++;
    }

    // Update latency stats
    this.stats.averageLatency = (this.stats.averageLatency * (this.stats.totalProcessed - 1) + processingTime) / this.stats.totalProcessed;
  }

  // Public methods for monitoring and control
  getStats(): ProcessingStats {
    return { ...this.stats };
  }

  isServiceEnabled(): boolean {
    return this.isEnabled && this.isInitialized;
  }

  getActiveProvider(): string | null {
    return this.activeProvider?.name || null;
  }

  async switchProvider(providerName: string): Promise<boolean> {
    const provider = this.providers.find(p => p.name === providerName && p.isReady);
    if (provider) {
      this.activeProvider = provider;
      this.stats.provider = provider.name;
      console.log(`✅ AudioEnhancement: Switched to browser provider: ${providerName}`);
      return true;
    }
    console.warn(`⚠️ AudioEnhancement: Browser provider ${providerName} not available`);
    return false;
  }

  enableService(): void {
    if (this.isInitialized && this.activeProvider) {
      this.isEnabled = true;
      console.log('✅ AudioEnhancement: Browser service enabled');
    }
  }

  disableService(): void {
    this.isEnabled = false;
    console.log('⚠️ AudioEnhancement: Browser service disabled');
  }

  destroy(): void {
    console.log('🧹 AudioEnhancement: Destroying browser service...');
    
    // Destroy all providers
    for (const provider of this.providers) {
      try {
        provider.destroy();
      } catch (error) {
        console.warn(`⚠️ AudioEnhancement: Error destroying browser provider ${provider.name}:`, error);
      }
    }

    this.providers = [];
    this.activeProvider = null;
    this.isEnabled = false;
    this.isInitialized = false;

    console.log('✅ AudioEnhancement: Browser service destroyed');
  }
}

// Singleton instance for global use
let audioEnhancementService: AudioEnhancementService | null = null;

export function getAudioEnhancementService(): AudioEnhancementService {
  if (!audioEnhancementService) {
    audioEnhancementService = new AudioEnhancementService({
      enabled: true, // Enable by default in browsers
      debug: false,
      preferredProvider: 'auto'
    });
  }
  return audioEnhancementService;
}

export function createAudioEnhancementService(config?: Partial<AudioEnhancementConfig>): AudioEnhancementService {
  return new AudioEnhancementService(config);
}

// Helper function to convert audio between different formats commonly used in browsers
export function convertAudioFormat(
  audioData: Float32Array, 
  fromSampleRate: number, 
  toSampleRate: number
): Float32Array {
  if (fromSampleRate === toSampleRate) {
    return audioData;
  }

  const ratio = toSampleRate / fromSampleRate;
  const outputLength = Math.floor(audioData.length * ratio);
  const output = new Float32Array(outputLength);

  // Simple linear interpolation resampling
  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i / ratio;
    const index = Math.floor(sourceIndex);
    const fraction = sourceIndex - index;

    if (index < audioData.length - 1) {
      output[i] = audioData[index] * (1 - fraction) + audioData[index + 1] * fraction;
    } else if (index < audioData.length) {
      output[i] = audioData[index];
    }
  }

  return output;
}

// Export types
export type { AudioEnhancementConfig, ProcessingStats };