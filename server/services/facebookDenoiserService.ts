// Facebook Denoiser Service - Node.js wrapper for Python Demucs denoising
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';

// Configuration from environment variables
const FACEBOOK_DENOISER_ENABLED = process.env.FACEBOOK_DENOISER_ENABLED !== 'false'; // Default enabled
const FACEBOOK_DENOISER_DEBUG = process.env.FACEBOOK_DENOISER_DEBUG === 'true';
const FACEBOOK_DENOISER_TIMEOUT = parseInt(process.env.FACEBOOK_DENOISER_TIMEOUT || '5000');
const PYTHON_PATH = process.env.PYTHON_PATH || 'python3';

// Performance monitoring thresholds
const MAX_PROCESSING_LATENCY = 100; // ms
const MAX_MEMORY_USAGE = 1024 * 1024 * 1024; // 1GB
const MAX_CONSECUTIVE_ERRORS = 3;
const RESTART_THRESHOLD = 3;

interface FacebookDenoiserConfig {
  enabled: boolean;
  debug: boolean;
  timeout: number;
  pythonPath: string;
  restartThreshold: number;
}

interface ProcessingStats {
  totalProcessed: number;
  successfulProcessed: number;
  errors: number;
  consecutiveErrors: number;
  averageLatency: number;
  maxLatency: number;
  restarts: number;
  lastProcessingTime: number;
  pythonStats?: {
    total_processed: number;
    avg_time: number;
    max_time: number;
    errors: number;
  };
}

interface ProcessingResult {
  success: boolean;
  audio?: Float32Array;
  processingTime: number;
  inputSamples: number;
  outputSamples: number;
  error?: string;
  fallbackUsed?: boolean;
  stats?: any;
}

interface PythonCommand {
  command: 'init' | 'process' | 'health';
  model_path?: string;
  audio?: string;
}

interface PythonResponse {
  status: 'success' | 'error' | 'healthy' | 'not_initialized';
  message?: string;
  audio?: string;
  processing_time?: number;
  input_samples?: number;
  output_samples?: number;
  error?: string;
  stats?: any;
  device?: string;
  model_type?: string;
  init_time?: number;
  model_loaded?: boolean;
  memory_usage?: any;
}

export class FacebookDenoiserService extends EventEmitter {
  private config: FacebookDenoiserConfig;
  private pythonProcess: ChildProcess | null = null;
  private isInitialized = false;
  private isEnabled = true;
  private stats: ProcessingStats;
  private performanceMonitor: NodeJS.Timeout | null = null;
  private pendingRequests = new Map<string, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    startTime: number;
  }>();
  private requestCounter = 0;

  constructor(config?: Partial<FacebookDenoiserConfig>) {
    super();
    
    this.config = {
      enabled: FACEBOOK_DENOISER_ENABLED,
      debug: FACEBOOK_DENOISER_DEBUG,
      timeout: FACEBOOK_DENOISER_TIMEOUT,
      pythonPath: PYTHON_PATH,
      restartThreshold: RESTART_THRESHOLD,
      ...config
    };

    this.stats = {
      totalProcessed: 0,
      successfulProcessed: 0,
      errors: 0,
      consecutiveErrors: 0,
      averageLatency: 0,
      maxLatency: 0,
      restarts: 0,
      lastProcessingTime: 0
    };

    if (this.config.debug) {
      console.log('🎤 Facebook Denoiser: Service initialized with config:', {
        enabled: this.config.enabled,
        timeout: this.config.timeout,
        pythonPath: this.config.pythonPath,
        restartThreshold: this.config.restartThreshold
      });
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!this.config.enabled) {
      console.log('🎤 Facebook Denoiser: Service disabled via configuration');
      this.isEnabled = false;
      this.isInitialized = true;
      return;
    }

    try {
      console.log('🎤 Facebook Denoiser: Initializing service...');
      
      // Start Python subprocess
      await this.startPythonProcess();
      
      if (!this.pythonProcess) {
        throw new Error('Failed to start Python process');
      }

      // Initialize the model
      const initResult = await this.sendCommand({ command: 'init' });
      
      if (initResult.status !== 'success') {
        throw new Error(`Model initialization failed: ${initResult.message || initResult.error}`);
      }

      console.log(`✅ Facebook Denoiser: Successfully initialized with ${initResult.model_type} on ${initResult.device} (${initResult.init_time?.toFixed(2)}s)`);
      
      this.isInitialized = true;
      this.startPerformanceMonitoring();
      
      // Emit success event
      this.emit('initialized', {
        device: initResult.device,
        modelType: initResult.model_type,
        initTime: initResult.init_time
      });

    } catch (error) {
      console.error('❌ Facebook Denoiser: Initialization failed:', error);
      this.isEnabled = false;
      this.isInitialized = true;
      
      // Cleanup on initialization failure
      if (this.pythonProcess) {
        this.pythonProcess.kill();
        this.pythonProcess = null;
      }
      
      // Emit error event
      this.emit('initialization_error', error);
      
      // Don't throw - graceful degradation
    }
  }

  private async startPythonProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../python/denoiser_service.py');
      
      if (this.config.debug) {
        console.log(`🎤 Facebook Denoiser: Starting Python process: ${this.config.pythonPath} ${scriptPath}`);
      }

      const pythonProcess = spawn(this.config.pythonPath, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      pythonProcess.on('spawn', () => {
        if (this.config.debug) {
          console.log(`✅ Facebook Denoiser: Python process spawned (PID: ${pythonProcess.pid})`);
        }
        this.pythonProcess = pythonProcess;
        this.setupProcessListeners();
        resolve();
      });

      pythonProcess.on('error', (error) => {
        console.error('❌ Facebook Denoiser: Failed to spawn Python process:', error);
        reject(error);
      });

      pythonProcess.on('exit', (code, signal) => {
        console.warn(`⚠️ Facebook Denoiser: Python process exited (code: ${code}, signal: ${signal})`);
        this.pythonProcess = null;
        this.isInitialized = false;
        
        // Reject all pending requests
        this.pendingRequests.forEach(({ reject }) => {
          reject(new Error('Python process exited'));
        });
        this.pendingRequests.clear();
        
        // Emit process exit event
        this.emit('process_exit', { code, signal });
      });

      // Set a timeout for process startup
      setTimeout(() => {
        if (!this.pythonProcess) {
          reject(new Error('Python process startup timeout'));
        }
      }, 10000);
    });
  }

  private setupProcessListeners(): void {
    if (!this.pythonProcess) return;

    // Handle stdout (JSON responses)
    let buffer = '';
    this.pythonProcess.stdout?.on('data', (data) => {
      buffer += data.toString();
      
      // Process complete JSON lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const response: PythonResponse = JSON.parse(line.trim());
            this.handlePythonResponse(response);
          } catch (error) {
            console.error('❌ Facebook Denoiser: Failed to parse Python response:', error, 'Raw line:', line);
          }
        }
      }
    });

    // Handle stderr (logs)
    this.pythonProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      if (message && this.config.debug) {
        console.log(`🐍 Facebook Denoiser Python:`, message);
      }
    });
  }

  private handlePythonResponse(response: PythonResponse): void {
    // Find matching request by looking for the most recent request
    // (Simple approach since we're processing sequentially)
    const pendingEntries = Array.from(this.pendingRequests.entries());
    if (pendingEntries.length === 0) {
      if (this.config.debug) {
        console.warn('⚠️ Facebook Denoiser: Received response with no pending requests');
      }
      return;
    }

    // Get the oldest pending request (FIFO)
    const [requestId, request] = pendingEntries[0];
    this.pendingRequests.delete(requestId);
    
    clearTimeout(request.timeout);
    request.resolve(response);
  }

  private async sendCommand(command: PythonCommand): Promise<PythonResponse> {
    return new Promise((resolve, reject) => {
      if (!this.pythonProcess || !this.pythonProcess.stdin) {
        reject(new Error('Python process not available'));
        return;
      }

      const requestId = (++this.requestCounter).toString();
      const startTime = performance.now();

      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      // Store request
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout,
        startTime
      });

      // Send command
      try {
        const commandJson = JSON.stringify(command) + '\n';
        this.pythonProcess.stdin.write(commandJson);
      } catch (error) {
        this.pendingRequests.delete(requestId);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  async processAudio(audioData: Float32Array): Promise<ProcessingResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Return original audio if service is disabled
    if (!this.isEnabled || !this.pythonProcess) {
      return {
        success: false,
        audio: audioData,
        processingTime: 0,
        inputSamples: audioData.length,
        outputSamples: audioData.length,
        error: 'Service not available',
        fallbackUsed: true
      };
    }

    const startTime = performance.now();
    this.stats.totalProcessed++;

    try {
      // Validate input
      if (!audioData || audioData.length === 0) {
        return {
          success: false,
          audio: audioData,
          processingTime: 0,
          inputSamples: 0,
          outputSamples: 0,
          error: 'Empty audio data',
          fallbackUsed: true
        };
      }

      // Convert Float32Array to base64
      const audioBytes = new Uint8Array(audioData.buffer);
      const audioBase64 = Buffer.from(audioBytes).toString('base64');

      // Send to Python service
      const response = await this.sendCommand({
        command: 'process',
        audio: audioBase64
      });

      const processingTime = performance.now() - startTime;

      if (response.status === 'success' && response.audio) {
        // Decode processed audio
        const processedBytes = Buffer.from(response.audio, 'base64');
        const processedAudio = new Float32Array(processedBytes.buffer);

        // Update stats
        this.updateStats(processingTime, true);
        this.stats.consecutiveErrors = 0;
        
        // Store Python stats if available
        if (response.stats) {
          this.stats.pythonStats = response.stats;
        }

        if (this.config.debug && Math.random() < 0.1) { // Log 10% of requests
          // Comprehensive logging for Facebook Denoiser performance
          const inputRMS = Math.sqrt(audioData.reduce((sum, val) => sum + val * val, 0) / audioData.length);
          const outputRMS = Math.sqrt(processedAudio.reduce((sum, val) => sum + val * val, 0) / processedAudio.length);
          const qualityChange = ((outputRMS - inputRMS) / inputRMS * 100);
          
          console.log(`🔧 Facebook Denoiser: Audio processed successfully`);
          console.log(`   Processing Time: ${processingTime.toFixed(2)}ms`);
          console.log(`   Samples: ${audioData.length} → ${processedAudio.length}`);
          console.log(`   Input RMS: ${inputRMS.toFixed(6)}, Output RMS: ${outputRMS.toFixed(6)}`);
          console.log(`   Quality Change: ${qualityChange.toFixed(1)}%`);
          console.log(`   Success Rate: ${((this.stats.successfulProcessed / this.stats.totalProcessed) * 100).toFixed(1)}%`);
        }

        return {
          success: true,
          audio: processedAudio,
          processingTime,
          inputSamples: audioData.length,
          outputSamples: processedAudio.length,
          stats: response.stats
        };

      } else {
        // Processing failed
        this.updateStats(processingTime, false);
        this.stats.consecutiveErrors++;

        const errorMessage = response.message || response.error || 'Unknown processing error';
        
        if (this.config.debug) {
          console.warn(`⚠️ Facebook Denoiser: Processing failed (${processingTime.toFixed(2)}ms): ${errorMessage}`);
        }

        // Check if we should restart the service
        if (this.stats.consecutiveErrors >= this.config.restartThreshold) {
          console.error(`❌ Facebook Denoiser: Too many consecutive errors (${this.stats.consecutiveErrors}), restarting service`);
          await this.restartService();
        }

        return {
          success: false,
          audio: audioData, // Return original audio
          processingTime,
          inputSamples: audioData.length,
          outputSamples: audioData.length,
          error: errorMessage,
          fallbackUsed: true
        };
      }

    } catch (error) {
      const processingTime = performance.now() - startTime;
      this.updateStats(processingTime, false);
      this.stats.consecutiveErrors++;

      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.warn(`⚠️ Facebook Denoiser: Processing failed (${processingTime.toFixed(2)}ms):`, errorMessage);

      // Check if we should restart the service
      if (this.stats.consecutiveErrors >= this.config.restartThreshold) {
        console.error(`❌ Facebook Denoiser: Too many consecutive errors (${this.stats.consecutiveErrors}), restarting service`);
        await this.restartService();
      }

      return {
        success: false,
        audio: audioData, // Return original audio
        processingTime,
        inputSamples: audioData.length,
        outputSamples: audioData.length,
        error: errorMessage,
        fallbackUsed: true
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.isInitialized || !this.pythonProcess) {
      return false;
    }

    try {
      const response = await this.sendCommand({ command: 'health' });
      return response.status === 'healthy' && response.model_loaded === true;
    } catch (error) {
      if (this.config.debug) {
        console.warn('⚠️ Facebook Denoiser: Health check failed:', error);
      }
      return false;
    }
  }

  private async restartService(): Promise<void> {
    console.log('🔄 Facebook Denoiser: Restarting service...');
    
    try {
      // Stop current process
      if (this.pythonProcess) {
        this.pythonProcess.kill();
        this.pythonProcess = null;
      }

      // Clear pending requests
      this.pendingRequests.forEach(({ reject }) => {
        reject(new Error('Service restarting'));
      });
      this.pendingRequests.clear();

      // Reset state
      this.isInitialized = false;
      this.stats.restarts++;

      // Wait a bit before restarting
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Reinitialize
      await this.initialize();

      console.log('✅ Facebook Denoiser: Service restarted successfully');
      this.emit('service_restarted', { restartCount: this.stats.restarts });

    } catch (error) {
      console.error('❌ Facebook Denoiser: Service restart failed:', error);
      this.isEnabled = false;
      this.emit('service_disabled', { reason: 'restart_failed' });
    }
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
      console.warn(`⚠️ Facebook Denoiser: High processing latency detected: ${processingTime.toFixed(2)}ms`);
      this.emit('high_latency', { latency: processingTime });
    }
  }

  private startPerformanceMonitoring(): void {
    this.performanceMonitor = setInterval(async () => {
      // Log comprehensive performance stats periodically
      if (this.config.debug && this.stats.totalProcessed > 0) {
        const successRate = (this.stats.successfulProcessed / this.stats.totalProcessed * 100).toFixed(1);
        const errorRate = (this.stats.errors / this.stats.totalProcessed * 100).toFixed(1);
        const throughput = this.stats.totalProcessed / ((Date.now() - this.stats.lastProcessingTime) / 1000);
        
        console.log(`📊 Facebook Denoiser Performance: Success=${successRate}%, Error=${errorRate}%, Avg=${this.stats.averageLatency.toFixed(2)}ms, Max=${this.stats.maxLatency.toFixed(2)}ms`);
        console.log(`📊 Service Health: Restarts=${this.stats.restarts}, Consecutive Errors=${this.stats.consecutiveErrors}, Throughput=${throughput.toFixed(1)} chunks/s`);
        
        if (this.stats.pythonStats) {
          console.log(`📊 Python Performance: Processed=${this.stats.pythonStats.total_processed}, Avg=${this.stats.pythonStats.avg_time.toFixed(1)}ms, Max=${this.stats.pythonStats.max_time?.toFixed(1) || 'N/A'}ms, Errors=${this.stats.pythonStats.errors}`);
        }
      }

      // Perform health check
      const isHealthy = await this.healthCheck();
      if (!isHealthy && this.isEnabled) {
        console.warn('⚠️ Facebook Denoiser: Health check failed, service may need restart');
        this.emit('health_check_failed');
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

  enableService(): void {
    if (this.isInitialized && this.pythonProcess) {
      this.isEnabled = true;
      console.log('✅ Facebook Denoiser: Service enabled');
    }
  }

  disableService(): void {
    this.isEnabled = false;
    console.log('⚠️ Facebook Denoiser: Service disabled');
  }

  async destroy(): Promise<void> {
    console.log('🧹 Facebook Denoiser: Destroying service...');
    
    if (this.performanceMonitor) {
      clearInterval(this.performanceMonitor);
      this.performanceMonitor = null;
    }

    // Reject all pending requests
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('Service being destroyed'));
    });
    this.pendingRequests.clear();

    // Stop Python process
    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }

    this.isEnabled = false;
    this.isInitialized = false;
    this.removeAllListeners();

    console.log('✅ Facebook Denoiser: Service destroyed successfully');
  }
}

// Singleton instance for global use
let facebookDenoiserService: FacebookDenoiserService | null = null;

export function getFacebookDenoiserService(): FacebookDenoiserService {
  if (!facebookDenoiserService) {
    facebookDenoiserService = new FacebookDenoiserService();
  }
  return facebookDenoiserService;
}

export function createFacebookDenoiserService(config?: Partial<FacebookDenoiserConfig>): FacebookDenoiserService {
  return new FacebookDenoiserService(config);
}

// Export types for external use
export type { FacebookDenoiserConfig, ProcessingStats, ProcessingResult };