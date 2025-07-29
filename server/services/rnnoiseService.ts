// RNNoise Voice Isolation Service - Bulletproof implementation with comprehensive error handling
import { EventEmitter } from 'events';
import { getErrorMonitoringService, logRNNoiseError, logRNNoiseSuccess } from './errorMonitoring';

// Configuration from environment variables
const RNNOISE_ENABLED = process.env.RNNOISE_ENABLED !== 'false'; // Default enabled
const RNNOISE_DEBUG = process.env.RNNOISE_DEBUG === 'true';
const VOICE_ISOLATION_LEVEL = process.env.VOICE_ISOLATION_LEVEL || 'medium';
const RNNOISE_FALLBACK_TIMEOUT = parseInt(process.env.RNNOISE_FALLBACK_TIMEOUT || '500');

// Performance monitoring thresholds
const MAX_PROCESSING_LATENCY = 100; // ms
const MAX_MEMORY_USAGE = 50 * 1024 * 1024; // 50MB
const MAX_CONSECUTIVE_ERRORS = 5;

interface RNNoiseConfig {
  sampleRate: number;
  frameSize: number;
  enabled: boolean;
  debug: boolean;
  fallbackTimeout: number;
}

interface ProcessingStats {
  totalProcessed: number;
  successfulProcessed: number;
  errors: number;
  consecutiveErrors: number;
  averageLatency: number;
  maxLatency: number;
  memoryUsage: number;
  lastProcessingTime: number;
}

interface RNNoiseProvider {
  name: string;
  instance: any;
  isReady: boolean;
  initialize(): Promise<void>;
  process(audioData: Float32Array): Promise<Float32Array>;
  destroy(): Promise<void>;
}

export class RNNoiseService extends EventEmitter {
  private config: RNNoiseConfig;
  private providers: RNNoiseProvider[] = [];
  private activeProvider: RNNoiseProvider | null = null;
  private isInitialized = false;
  private isEnabled = true;
  private stats: ProcessingStats;
  private performanceMonitor: NodeJS.Timeout | null = null;

  constructor(config?: Partial<RNNoiseConfig>) {
    super();
    
    this.config = {
      sampleRate: 48000, // RNNoise expects 48kHz
      frameSize: 480, // RNNoise frame size
      enabled: RNNOISE_ENABLED,
      debug: RNNOISE_DEBUG,
      fallbackTimeout: RNNOISE_FALLBACK_TIMEOUT,
      ...config
    };

    this.stats = {
      totalProcessed: 0,
      successfulProcessed: 0,
      errors: 0,
      consecutiveErrors: 0,
      averageLatency: 0,
      maxLatency: 0,
      memoryUsage: 0,
      lastProcessingTime: 0
    };

    if (this.config.debug) {
      console.log('🎤 RNNoise: Service initialized with config:', {
        enabled: this.config.enabled,
        sampleRate: this.config.sampleRate,
        frameSize: this.config.frameSize,
        fallbackTimeout: this.config.fallbackTimeout
      });
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!this.config.enabled) {
      console.log('🎤 RNNoise: Service disabled via configuration');
      this.isEnabled = false;
      this.isInitialized = true;
      return;
    }

    try {
      console.log('🎤 RNNoise: Initializing voice isolation...');
      
      // Initialize providers with fallback chain
      await this.initializeProviders();
      
      if (this.providers.length === 0) {
        console.warn('⚠️ RNNoise: No providers available, disabling service');
        this.isEnabled = false;
        this.isInitialized = true;
        return;
      }

      // Select the best available provider
      this.activeProvider = this.providers.find(p => p.isReady) || null;
      
      if (!this.activeProvider) {
        console.warn('⚠️ RNNoise: No ready providers available, disabling service');
        this.isEnabled = false;
      } else {
        console.log(`✅ RNNoise: Successfully initialized with provider: ${this.activeProvider.name}`);
        this.startPerformanceMonitoring();
      }

      this.isInitialized = true;
      
    } catch (error) {
      console.error('❌ RNNoise: Initialization failed:', error);
      this.isEnabled = false;
      this.isInitialized = true;
      
      // Log to error monitoring system
      logRNNoiseError('server', 'critical', 'initialization_failed', 
        'RNNoise service initialization failed completely', 
        { 
          providersAttempted: this.providers.length,
          config: this.config
        }, 
        error instanceof Error ? error : new Error(String(error))
      );
      
      // Emit error event for monitoring
      this.emit('initialization_error', error);
      
      // Don't throw - graceful degradation
    }
  }

  private async initializeProviders(): Promise<void> {
    // Initialize Jitsi RNNoise WASM (primary)
    await this.initializeJitsiProvider();
    
    // Initialize TimePhysics RNNoise WASM (fallback)
    await this.initializeTimePhyProvider();
  }

  private async initializeJitsiProvider(): Promise<void> {
    try {
      const { default: RnnoiseProcessor } = await import('@jitsi/rnnoise-wasm');
      
      const processor = new RnnoiseProcessor();
      await processor.ready();
      
      const provider: RNNoiseProvider = {
        name: 'jitsi-rnnoise-wasm',
        instance: processor,
        isReady: true,
        initialize: async () => {
          // Already initialized
        },
        process: async (audioData: Float32Array): Promise<Float32Array> => {
          return processor.process(audioData);
        },
        destroy: async () => {
          processor.destroy();
        }
      };
      
      this.providers.push(provider);
      
      if (this.config.debug) {
        console.log('✅ RNNoise: Jitsi provider initialized successfully');
      }
      
    } catch (error) {
      if (this.config.debug) {
        console.warn('⚠️ RNNoise: Jitsi provider initialization failed:', error);
      }
    }
  }

  private async initializeTimePhyProvider(): Promise<void> {
    try {
      const { RnnoiseWasm } = await import('@timephy/rnnoise-wasm');
      
      const processor = new RnnoiseWasm();
      await processor.init();
      
      const provider: RNNoiseProvider = {
        name: 'timephy-rnnoise-wasm',
        instance: processor,
        isReady: true,
        initialize: async () => {
          // Already initialized
        },
        process: async (audioData: Float32Array): Promise<Float32Array> => {
          return processor.process(audioData);
        },
        destroy: async () => {
          processor.destroy();
        }
      };
      
      this.providers.push(provider);
      
      if (this.config.debug) {
        console.log('✅ RNNoise: TimePhysics provider initialized successfully');
      }
      
    } catch (error) {
      if (this.config.debug) {
        console.warn('⚠️ RNNoise: TimePhysics provider initialization failed:', error);
      }
    }
  }

  async processAudio(audioData: Float32Array): Promise<Float32Array> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Return original audio if service is disabled
    if (!this.isEnabled || !this.activeProvider) {
      return audioData;
    }

    const startTime = performance.now();
    this.stats.totalProcessed++;

    try {
      // Validate input
      if (!audioData || audioData.length === 0) {
        if (this.config.debug) {
          console.warn('⚠️ RNNoise: Empty audio data received');
        }
        return audioData;
      }

      // Process audio with timeout protection
      const processedAudio = await this.processWithTimeout(audioData);
      
      // Update performance stats
      const processingTime = performance.now() - startTime;
      this.updateStats(processingTime, true);
      
      if (this.config.debug && Math.random() < 0.1) { // Log 10% of requests
        console.log(`🔧 RNNoise: Audio processed successfully (${processingTime.toFixed(2)}ms, ${audioData.length} samples)`);
      }

      // Log successful processing to monitoring system
      logRNNoiseSuccess('server', processingTime, {
        inputSamples: audioData.length,
        outputSamples: processedAudio.length,
        provider: this.activeProvider?.name,
        consecutiveErrors: this.stats.consecutiveErrors
      });

      this.stats.consecutiveErrors = 0;
      return processedAudio;

    } catch (error) {
      const processingTime = performance.now() - startTime;
      this.updateStats(processingTime, false);
      
      console.warn(`⚠️ RNNoise: Processing failed (${processingTime.toFixed(2)}ms):`, error);
      
      // Handle consecutive errors
      this.stats.consecutiveErrors++;
      
      // Determine error type and severity
      const errorMessage = error instanceof Error ? error.message : String(error);
      let errorType = 'processing_failed';
      let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
      
      if (errorMessage.includes('timeout')) {
        errorType = 'processing_timeout';
        severity = 'high';
      } else if (errorMessage.includes('memory')) {
        errorType = 'memory_error';
        severity = 'high';
      } else if (this.stats.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        errorType = 'consecutive_errors';
        severity = 'critical';
      }
      
      // Log error with comprehensive context
      logRNNoiseError('server', severity, errorType, errorMessage, {
        processingTime,
        consecutiveErrors: this.stats.consecutiveErrors,
        inputSamples: audioData.length,
        provider: this.activeProvider?.name,
        totalProcessed: this.stats.totalProcessed,
        errorRate: (this.stats.errors / this.stats.totalProcessed * 100).toFixed(2) + '%',
        memoryUsage: this.stats.memoryUsage,
        isServiceEnabled: this.isEnabled
      }, error instanceof Error ? error : new Error(errorMessage));
      
      if (this.stats.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`❌ RNNoise: Too many consecutive errors (${this.stats.consecutiveErrors}), disabling service`);
        this.isEnabled = false;
        this.emit('service_disabled', { reason: 'consecutive_errors', count: this.stats.consecutiveErrors });
      }

      // Emit error event for monitoring
      this.emit('processing_error', error);
      
      // Always return the original audio for graceful degradation
      return audioData;
    }
  }

  private async processWithTimeout(audioData: Float32Array): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Processing timeout after ${this.config.fallbackTimeout}ms`));
      }, this.config.fallbackTimeout);

      this.processWithActiveProvider(audioData)
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

  private async processWithActiveProvider(audioData: Float32Array): Promise<Float32Array> {
    if (!this.activeProvider) {
      throw new Error('No active provider available');
    }

    // Handle frame size differences (Web Audio: 128 samples, RNNoise: 480 samples)
    return await this.processWithFrameBuffering(audioData);
  }

  private frameBuffer: Float32Array = new Float32Array(0);
  
  private async processWithFrameBuffering(audioData: Float32Array): Promise<Float32Array> {
    // Combine with existing buffer
    const combinedLength = this.frameBuffer.length + audioData.length;
    const combined = new Float32Array(combinedLength);
    combined.set(this.frameBuffer);
    combined.set(audioData, this.frameBuffer.length);

    const results: Float32Array[] = [];
    let offset = 0;

    // Process complete frames
    while (offset + this.config.frameSize <= combined.length) {
      const frame = combined.slice(offset, offset + this.config.frameSize);
      const processedFrame = await this.activeProvider!.process(frame);
      results.push(processedFrame);
      offset += this.config.frameSize;
    }

    // Store remaining samples for next call
    this.frameBuffer = combined.slice(offset);

    // Combine processed frames
    if (results.length === 0) {
      return new Float32Array(0);
    }

    const totalLength = results.reduce((sum, frame) => sum + frame.length, 0);
    const output = new Float32Array(totalLength);
    let outputOffset = 0;

    for (const frame of results) {
      output.set(frame, outputOffset);
      outputOffset += frame.length;
    }

    return output;
  }

  private updateStats(processingTime: number, success: boolean): void {
    if (success) {
      this.stats.successfulProcessed++;
    } else {
      this.stats.errors++;
    }

    // Update latency stats
    this.stats.averageLatency = (this.stats.averageLatency * (this.stats.totalProcessed - 1) + processingTime) / this.stats.totalProcessed;
    this.stats.maxLatency = Math.max(this.stats.maxLatency, processingTime);
    this.stats.lastProcessingTime = processingTime;

    // Check performance thresholds
    if (processingTime > MAX_PROCESSING_LATENCY) {
      console.warn(`⚠️ RNNoise: High processing latency detected: ${processingTime.toFixed(2)}ms`);
      this.emit('high_latency', { latency: processingTime });
    }
  }

  private startPerformanceMonitoring(): void {
    this.performanceMonitor = setInterval(() => {
      // Update memory usage
      if (process.memoryUsage) {
        this.stats.memoryUsage = process.memoryUsage().heapUsed;
        
        if (this.stats.memoryUsage > MAX_MEMORY_USAGE) {
          console.warn(`⚠️ RNNoise: High memory usage detected: ${(this.stats.memoryUsage / 1024 / 1024).toFixed(2)}MB`);
          this.emit('high_memory', { usage: this.stats.memoryUsage });
        }
      }

      // Log performance stats periodically
      if (this.config.debug && this.stats.totalProcessed > 0) {
        const successRate = (this.stats.successfulProcessed / this.stats.totalProcessed * 100).toFixed(1);
        console.log(`📊 RNNoise: Performance stats - Success: ${successRate}%, Avg latency: ${this.stats.averageLatency.toFixed(2)}ms, Memory: ${(this.stats.memoryUsage / 1024 / 1024).toFixed(2)}MB`);
      }
    }, 30000); // Every 30 seconds
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
      console.log(`✅ RNNoise: Switched to provider: ${providerName}`);
      return true;
    }
    console.warn(`⚠️ RNNoise: Provider ${providerName} not available`);
    return false;
  }

  enableService(): void {
    if (this.isInitialized && this.activeProvider) {
      this.isEnabled = true;
      console.log('✅ RNNoise: Service enabled');
    }
  }

  disableService(): void {
    this.isEnabled = false;
    console.log('⚠️ RNNoise: Service disabled');
  }

  async destroy(): Promise<void> {
    console.log('🧹 RNNoise: Destroying service...');
    
    if (this.performanceMonitor) {
      clearInterval(this.performanceMonitor);
      this.performanceMonitor = null;
    }

    // Destroy all providers
    for (const provider of this.providers) {
      try {
        await provider.destroy();
      } catch (error) {
        console.warn(`⚠️ RNNoise: Error destroying provider ${provider.name}:`, error);
      }
    }

    this.providers = [];
    this.activeProvider = null;
    this.isEnabled = false;
    this.isInitialized = false;
    this.removeAllListeners();

    console.log('✅ RNNoise: Service destroyed successfully');
  }
}

// Singleton instance for global use
let rnnoiseService: RNNoiseService | null = null;

export function getRNNoiseService(): RNNoiseService {
  if (!rnnoiseService) {
    rnnoiseService = new RNNoiseService();
  }
  return rnnoiseService;
}

export function createRNNoiseService(config?: Partial<RNNoiseConfig>): RNNoiseService {
  return new RNNoiseService(config);
}

// Export types for external use
export type { RNNoiseConfig, ProcessingStats };