// Audio Processor for Real-time WebSocket Audio Streaming
import { ConversationVAD } from '../services/vadService';
import { speechToTextService } from '../services/speechToTextService';

interface AudioProcessingResult {
  success: boolean;
  transcription?: string;
  duration?: number;
  provider?: string;
  error?: string;
  stats?: {
    audioSize: number;
    processingTime: number;
    vadProvider: string;
    sttProvider: string;
  };
}

interface AudioChunk {
  buffer: Buffer;
  timestamp: number;
  sequenceNumber: number;
  format: 'pcm16';
}

export class AudioProcessor {
  private vadInstance: ConversationVAD;
  private processingQueue: AudioChunk[] = [];
  private isProcessing: boolean = false;
  private sequenceNumber: number = 0;
  private readonly MAX_QUEUE_SIZE = 100;
  private readonly PROCESSING_TIMEOUT = 10000; // 10 seconds

  private stats = {
    chunksProcessed: 0,
    totalProcessingTime: 0,
    successfulTranscriptions: 0,
    failedTranscriptions: 0,
    vadEvents: 0,
    lastProcessedAt: 0
  };

  constructor(vadInstance: ConversationVAD) {
    this.vadInstance = vadInstance;
    console.log('🔧 Audio Processor: Initialized');
  }

  /**
   * Process real-time audio frame
   */
  async processAudioFrame(audioBuffer: Buffer, timestamp: number = Date.now()): Promise<void> {
    // Create audio chunk with sequence number for packet loss detection
    const audioChunk: AudioChunk = {
      buffer: audioBuffer,
      timestamp,
      sequenceNumber: this.sequenceNumber++,
      format: 'pcm16'
    };

    // Add to processing queue
    if (this.processingQueue.length >= this.MAX_QUEUE_SIZE) {
      console.warn('⚠️ Audio Processor: Queue full, dropping oldest chunk');
      this.processingQueue.shift();
    }

    this.processingQueue.push(audioChunk);
    this.stats.chunksProcessed++;
    this.stats.lastProcessedAt = Date.now();

    // Process queue if not already processing
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Process collected audio buffer for transcription (when speech ends)
   */
  async processCollectedAudio(audioBuffer: Buffer): Promise<AudioProcessingResult> {
    const startTime = performance.now();
    const audioSize = audioBuffer.length;

    try {
      console.log(`🔄 Audio Processor: Processing collected audio - ${audioSize} bytes`);

      // Validate audio buffer
      if (audioSize === 0) {
        return {
          success: false,
          error: 'Empty audio buffer'
        };
      }

      if (audioSize < 1000) { // Less than ~60ms at 16kHz
        return {
          success: false,
          error: 'Audio buffer too short for reliable transcription'
        };
      }

      // Convert audio to base64 for STT service (maintaining compatibility)
      const base64Audio = audioBuffer.toString('base64');

      // Call speech-to-text service
      const sttResult = await speechToTextService.transcribeAudio({
        audio: base64Audio,
        language: 'hi', // Hindi with auto-detection
        enhancedModel: true
      });

      const processingTime = performance.now() - startTime;

      if (sttResult.success && sttResult.data?.text) {
        this.stats.successfulTranscriptions++;
        
        const result: AudioProcessingResult = {
          success: true,
          transcription: sttResult.data.text.trim(),
          duration: sttResult.data.duration,
          provider: sttResult.data.provider || 'unknown',
          stats: {
            audioSize,
            processingTime: Math.round(processingTime),
            vadProvider: this.vadInstance.getCurrentProvider(),
            sttProvider: sttResult.data.provider || 'unknown'
          }
        };

        console.log(`✅ Audio Processor: Transcription successful - "${result.transcription}" (${Math.round(processingTime)}ms)`);
        return result;

      } else {
        this.stats.failedTranscriptions++;
        
        const errorMessage = sttResult.error || 'Unknown STT error';
        console.warn(`⚠️ Audio Processor: Transcription failed - ${errorMessage} (${Math.round(processingTime)}ms)`);
        
        return {
          success: false,
          error: errorMessage,
          stats: {
            audioSize,
            processingTime: Math.round(processingTime),
            vadProvider: this.vadInstance.getCurrentProvider(),
            sttProvider: 'none'
          }
        };
      }

    } catch (error) {
      this.stats.failedTranscriptions++;
      const processingTime = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown processing error';
      
      console.error(`❌ Audio Processor: Processing error - ${errorMessage} (${Math.round(processingTime)}ms)`);
      
      return {
        success: false,
        error: errorMessage,
        stats: {
          audioSize,
          processingTime: Math.round(processingTime),
          vadProvider: this.vadInstance.getCurrentProvider(),
          sttProvider: 'none'
        }
      };
    }
  }

  /**
   * Process audio queue for real-time VAD
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.processingQueue.length > 0) {
        const chunk = this.processingQueue.shift();
        if (!chunk) continue;

        const processingStartTime = performance.now();

        try {
          // Process with VAD - this will trigger VAD events
          const vadEvent = await this.vadInstance.processAudioChunk(chunk.buffer);
          
          if (vadEvent) {
            this.stats.vadEvents++;
            
            // Log VAD events occasionally
            if (this.stats.vadEvents % 50 === 0) {
              console.log(`📊 Audio Processor: Processed ${this.stats.vadEvents} VAD events`);
            }
          }

          const processingTime = performance.now() - processingStartTime;
          this.stats.totalProcessingTime += processingTime;

          // Check for processing timeout
          if (processingTime > this.PROCESSING_TIMEOUT) {
            console.warn(`⚠️ Audio Processor: Slow processing detected - ${Math.round(processingTime)}ms`);
          }

        } catch (error) {
          console.error('❌ Audio Processor: Error processing chunk:', error);
        }

        // Yield control to prevent blocking
        if (this.processingQueue.length > 10) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }

    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Handle sequence number gaps (packet loss detection)
   */
  private detectPacketLoss(expectedSequence: number, receivedSequence: number): boolean {
    const gap = receivedSequence - expectedSequence;
    
    if (gap > 1) {
      console.warn(`⚠️ Audio Processor: Packet loss detected - Missing ${gap - 1} chunks (expected: ${expectedSequence}, got: ${receivedSequence})`);
      return true;
    }
    
    return false;
  }

  /**
   * Get audio processing statistics
   */
  getStats() {
    const avgProcessingTime = this.stats.chunksProcessed > 0 
      ? Math.round(this.stats.totalProcessingTime / this.stats.chunksProcessed)
      : 0;

    const successRate = this.stats.successfulTranscriptions + this.stats.failedTranscriptions > 0
      ? Math.round((this.stats.successfulTranscriptions / (this.stats.successfulTranscriptions + this.stats.failedTranscriptions)) * 100)
      : 0;

    return {
      ...this.stats,
      queueSize: this.processingQueue.length,
      isProcessing: this.isProcessing,
      averageProcessingTime: avgProcessingTime,
      transcriptionSuccessRate: successRate,
      vadProvider: this.vadInstance.getCurrentProvider(),
      vadStats: this.vadInstance.getVADStats()
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      chunksProcessed: 0,
      totalProcessingTime: 0,
      successfulTranscriptions: 0,
      failedTranscriptions: 0,
      vadEvents: 0,
      lastProcessedAt: 0
    };
    
    console.log('🔄 Audio Processor: Statistics reset');
  }

  /**
   * Clear processing queue
   */
  clearQueue(): void {
    this.processingQueue.length = 0;
    console.log('🧹 Audio Processor: Queue cleared');
  }

  /**
   * Get current queue health
   */
  getQueueHealth(): {
    size: number;
    isHealthy: boolean;
    warningLevel: 'low' | 'medium' | 'high';
    recommendation: string;
  } {
    const size = this.processingQueue.length;
    let warningLevel: 'low' | 'medium' | 'high' = 'low';
    let recommendation = 'Queue is healthy';
    let isHealthy = true;

    if (size > this.MAX_QUEUE_SIZE * 0.8) {
      warningLevel = 'high';
      recommendation = 'Queue is nearly full - consider reducing audio chunk size';
      isHealthy = false;
    } else if (size > this.MAX_QUEUE_SIZE * 0.5) {
      warningLevel = 'medium';
      recommendation = 'Queue is filling up - monitor for performance issues';
      isHealthy = false;
    }

    return {
      size,
      isHealthy,
      warningLevel,
      recommendation
    };
  }

  /**
   * Health check for the audio processor
   */
  healthCheck(): {
    status: 'healthy' | 'warning' | 'error';
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let status: 'healthy' | 'warning' | 'error' = 'healthy';

    const queueHealth = this.getQueueHealth();
    const stats = this.getStats();

    // Check queue health
    if (!queueHealth.isHealthy) {
      issues.push(`Queue ${queueHealth.warningLevel} utilization: ${queueHealth.size}/${this.MAX_QUEUE_SIZE}`);
      recommendations.push(queueHealth.recommendation);
      if (queueHealth.warningLevel === 'high') {
        status = 'error';
      } else {
        status = 'warning';
      }
    }

    // Check processing performance
    if (stats.averageProcessingTime > 100) {
      issues.push(`Slow processing: ${stats.averageProcessingTime}ms average`);
      recommendations.push('Consider optimizing VAD processing or reducing audio quality');
      status = status === 'error' ? 'error' : 'warning';
    }

    // Check transcription success rate
    if (stats.transcriptionSuccessRate < 80 && stats.successfulTranscriptions + stats.failedTranscriptions > 5) {
      issues.push(`Low transcription success rate: ${stats.transcriptionSuccessRate}%`);
      recommendations.push('Check audio quality and STT service configuration');
      status = status === 'error' ? 'error' : 'warning';
    }

    // Check if processing is stuck
    const timeSinceLastProcess = Date.now() - stats.lastProcessedAt;
    if (this.isProcessing && timeSinceLastProcess > this.PROCESSING_TIMEOUT) {
      issues.push(`Processing appears stuck: ${Math.round(timeSinceLastProcess/1000)}s since last process`);
      recommendations.push('Restart audio processor or check for deadlocks');
      status = 'error';
    }

    return {
      status,
      issues,
      recommendations
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    console.log('🧹 Audio Processor: Cleaning up...');
    
    this.clearQueue();
    this.isProcessing = false;
    this.sequenceNumber = 0;
    
    console.log('✅ Audio Processor: Cleanup complete');
  }
}