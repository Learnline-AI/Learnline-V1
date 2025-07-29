// Audio Processing Utilities for RNNoise Integration
// Handles format conversions between Buffer, Float32Array, and different sample rates

const AUDIO_DEBUG = process.env.RNNOISE_DEBUG === 'true';

interface AudioConversionStats {
  inputSamples: number;
  outputSamples: number;
  inputFormat: string;
  outputFormat: string;
  processingTime: number;
  rmsLevel: number;
  peakLevel: number;
}

/**
 * Convert PCM16 Buffer (16kHz) to Float32Array (48kHz) for RNNoise processing
 * RNNoise expects 48kHz audio, but our VAD system uses 16kHz
 */
export function convertPCM16ToFloat32_48kHz(audioData: Buffer): { 
  audio: Float32Array; 
  stats: AudioConversionStats 
} {
  const startTime = performance.now();
  
  if (audioData.length === 0) {
    return {
      audio: new Float32Array(0),
      stats: {
        inputSamples: 0,
        outputSamples: 0,
        inputFormat: 'PCM16@16kHz',
        outputFormat: 'Float32@48kHz',
        processingTime: 0,
        rmsLevel: 0,
        peakLevel: 0
      }
    };
  }

  // Convert 16-bit PCM to Float32 (normalized to -1.0 to 1.0)
  const inputSamples = audioData.length / 2; // 16-bit = 2 bytes per sample
  const float32_16kHz = new Float32Array(inputSamples);
  
  let maxSample = 0;
  let sumSquares = 0;
  
  for (let i = 0; i < inputSamples; i++) {
    const sample = audioData.readInt16LE(i * 2);
    const normalized = sample / 32768.0;
    float32_16kHz[i] = normalized;
    
    // Calculate stats
    const abs = Math.abs(normalized);
    maxSample = Math.max(maxSample, abs);
    sumSquares += normalized * normalized;
  }

  // Upsample from 16kHz to 48kHz (3x interpolation)
  const outputSamples = inputSamples * 3;
  const float32_48kHz = new Float32Array(outputSamples);
  
  // Simple linear interpolation for upsampling
  for (let i = 0; i < inputSamples - 1; i++) {
    const current = float32_16kHz[i];
    const next = float32_16kHz[i + 1];
    
    // Place original sample
    float32_48kHz[i * 3] = current;
    
    // Interpolate intermediate samples
    float32_48kHz[i * 3 + 1] = current + (next - current) * 0.33;
    float32_48kHz[i * 3 + 2] = current + (next - current) * 0.67;
  }
  
  // Handle last sample
  if (inputSamples > 0) {
    float32_48kHz[outputSamples - 3] = float32_16kHz[inputSamples - 1];
    float32_48kHz[outputSamples - 2] = float32_16kHz[inputSamples - 1];
    float32_48kHz[outputSamples - 1] = float32_16kHz[inputSamples - 1];
  }

  const processingTime = performance.now() - startTime;
  const rmsLevel = Math.sqrt(sumSquares / inputSamples);

  const stats: AudioConversionStats = {
    inputSamples,
    outputSamples,
    inputFormat: 'PCM16@16kHz',
    outputFormat: 'Float32@48kHz',
    processingTime,
    rmsLevel,
    peakLevel: maxSample
  };

  if (AUDIO_DEBUG && Math.random() < 0.05) { // Log 5% of conversions
    console.log(`🔧 Audio: PCM16→Float32(48k) - ${inputSamples}→${outputSamples} samples, RMS=${rmsLevel.toFixed(4)}, Peak=${maxSample.toFixed(4)}, Time=${processingTime.toFixed(2)}ms`);
  }

  return { audio: float32_48kHz, stats };
}

/**
 * Convert Float32Array (48kHz) back to PCM16 Buffer (16kHz) after RNNoise processing
 */
export function convertFloat32ToPCM16_16kHz(audioData: Float32Array): { 
  buffer: Buffer; 
  stats: AudioConversionStats 
} {
  const startTime = performance.now();
  
  if (audioData.length === 0) {
    return {
      buffer: Buffer.alloc(0),
      stats: {
        inputSamples: audioData.length,
        outputSamples: 0,
        inputFormat: 'Float32@48kHz',
        outputFormat: 'PCM16@16kHz',
        processingTime: 0,
        rmsLevel: 0,
        peakLevel: 0
      }
    };
  }

  // Downsample from 48kHz to 16kHz (1/3 decimation)
  const outputSamples = Math.floor(audioData.length / 3);
  const float32_16kHz = new Float32Array(outputSamples);
  
  // Simple decimation (take every 3rd sample)
  for (let i = 0; i < outputSamples; i++) {
    float32_16kHz[i] = audioData[i * 3];
  }

  // Convert Float32 back to PCM16
  const buffer = Buffer.allocUnsafe(outputSamples * 2); // 2 bytes per 16-bit sample
  
  let maxSample = 0;
  let sumSquares = 0;
  
  for (let i = 0; i < outputSamples; i++) {
    const floatSample = float32_16kHz[i];
    
    // Clamp to valid range and convert to 16-bit signed integer
    const clampedSample = Math.max(-1.0, Math.min(1.0, floatSample));
    const intSample = Math.floor(clampedSample * 32767);
    buffer.writeInt16LE(intSample, i * 2);
    
    // Calculate stats
    const abs = Math.abs(clampedSample);
    maxSample = Math.max(maxSample, abs);
    sumSquares += clampedSample * clampedSample;
  }

  const processingTime = performance.now() - startTime;
  const rmsLevel = Math.sqrt(sumSquares / outputSamples);

  const stats: AudioConversionStats = {
    inputSamples: audioData.length,
    outputSamples,
    inputFormat: 'Float32@48kHz',
    outputFormat: 'PCM16@16kHz',
    processingTime,
    rmsLevel,
    peakLevel: maxSample
  };

  if (AUDIO_DEBUG && Math.random() < 0.05) { // Log 5% of conversions
    console.log(`🔧 Audio: Float32(48k)→PCM16 - ${audioData.length}→${outputSamples} samples, RMS=${rmsLevel.toFixed(4)}, Peak=${maxSample.toFixed(4)}, Time=${processingTime.toFixed(2)}ms`);
  }

  return { buffer, stats };
}

/**
 * Convert Float32Array (16kHz) to Float32Array (48kHz) for direct Float32 processing
 */
export function resampleFloat32_16to48kHz(audioData: Float32Array): { 
  audio: Float32Array; 
  stats: AudioConversionStats 
} {
  const startTime = performance.now();
  
  if (audioData.length === 0) {
    return {
      audio: new Float32Array(0),
      stats: {
        inputSamples: 0,
        outputSamples: 0,
        inputFormat: 'Float32@16kHz',
        outputFormat: 'Float32@48kHz',
        processingTime: 0,
        rmsLevel: 0,
        peakLevel: 0
      }
    };
  }

  const inputSamples = audioData.length;
  const outputSamples = inputSamples * 3;
  const resampled = new Float32Array(outputSamples);
  
  let maxSample = 0;
  let sumSquares = 0;
  
  // Linear interpolation upsampling
  for (let i = 0; i < inputSamples - 1; i++) {
    const current = audioData[i];
    const next = audioData[i + 1];
    
    resampled[i * 3] = current;
    resampled[i * 3 + 1] = current + (next - current) * 0.33;
    resampled[i * 3 + 2] = current + (next - current) * 0.67;
    
    // Calculate stats on original samples
    const abs = Math.abs(current);
    maxSample = Math.max(maxSample, abs);
    sumSquares += current * current;
  }
  
  // Handle last sample
  if (inputSamples > 0) {
    const lastSample = audioData[inputSamples - 1];
    resampled[outputSamples - 3] = lastSample;
    resampled[outputSamples - 2] = lastSample;
    resampled[outputSamples - 1] = lastSample;
    
    const abs = Math.abs(lastSample);
    maxSample = Math.max(maxSample, abs);
    sumSquares += lastSample * lastSample;
  }

  const processingTime = performance.now() - startTime;
  const rmsLevel = Math.sqrt(sumSquares / inputSamples);

  const stats: AudioConversionStats = {
    inputSamples,
    outputSamples,
    inputFormat: 'Float32@16kHz',
    outputFormat: 'Float32@48kHz',
    processingTime,
    rmsLevel,
    peakLevel: maxSample
  };

  return { audio: resampled, stats };
}

/**
 * Convert Float32Array (48kHz) back to Float32Array (16kHz)
 */
export function resampleFloat32_48to16kHz(audioData: Float32Array): { 
  audio: Float32Array; 
  stats: AudioConversionStats 
} {
  const startTime = performance.now();
  
  if (audioData.length === 0) {
    return {
      audio: new Float32Array(0),
      stats: {
        inputSamples: 0,
        outputSamples: 0,
        inputFormat: 'Float32@48kHz',
        outputFormat: 'Float32@16kHz',
        processingTime: 0,
        rmsLevel: 0,
        peakLevel: 0
      }
    };
  }

  const inputSamples = audioData.length;
  const outputSamples = Math.floor(inputSamples / 3);
  const resampled = new Float32Array(outputSamples);
  
  let maxSample = 0;
  let sumSquares = 0;
  
  // Simple decimation (take every 3rd sample)
  for (let i = 0; i < outputSamples; i++) {
    const sample = audioData[i * 3];
    resampled[i] = sample;
    
    const abs = Math.abs(sample);
    maxSample = Math.max(maxSample, abs);
    sumSquares += sample * sample;
  }

  const processingTime = performance.now() - startTime;
  const rmsLevel = Math.sqrt(sumSquares / outputSamples);

  const stats: AudioConversionStats = {
    inputSamples,
    outputSamples,
    inputFormat: 'Float32@48kHz',
    outputFormat: 'Float32@16kHz',
    processingTime,
    rmsLevel,
    peakLevel: maxSample
  };

  return { audio: resampled, stats };
}

/**
 * Analyze audio characteristics for debugging
 */
export function analyzeAudio(audioData: Float32Array | Buffer, format: string): {
  samples: number;
  rmsLevel: number;
  peakLevel: number;
  silenceRatio: number;
  format: string;
} {
  let samples: Float32Array;
  
  if (audioData instanceof Buffer) {
    // Convert Buffer to Float32Array for analysis
    const sampleCount = audioData.length / 2;
    samples = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = audioData.readInt16LE(i * 2) / 32768.0;
    }
  } else {
    samples = audioData;
  }

  let maxSample = 0;
  let sumSquares = 0;
  let silentSamples = 0;
  
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const abs = Math.abs(sample);
    
    maxSample = Math.max(maxSample, abs);
    sumSquares += sample * sample;
    
    // Count samples below threshold as "silent"
    if (abs < 0.001) {
      silentSamples++;
    }
  }

  const rmsLevel = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;
  const silenceRatio = samples.length > 0 ? silentSamples / samples.length : 0;

  return {
    samples: samples.length,
    rmsLevel,
    peakLevel: maxSample,
    silenceRatio,
    format
  };
}

/**
 * Validate audio data integrity
 */
export function validateAudioData(audioData: Float32Array | Buffer, expectedFormat: string): {
  isValid: boolean;
  issues: string[];
  recommendations: string[];
} {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check for empty data
  if (!audioData || audioData.length === 0) {
    issues.push('Audio data is empty');
    recommendations.push('Check microphone input or audio pipeline');
  }

  // Analyze audio characteristics
  const analysis = analyzeAudio(audioData, expectedFormat);
  
  // Check for all-zero audio
  if (analysis.peakLevel === 0) {
    issues.push('Audio data contains only zeros');
    recommendations.push('Verify microphone permissions and input levels');
  }
  
  // Check for clipping
  if (analysis.peakLevel >= 0.99) {
    issues.push('Audio clipping detected');
    recommendations.push('Reduce input gain or check for digital clipping');
  }
  
  // Check for very low levels
  if (analysis.rmsLevel < 0.001 && analysis.peakLevel > 0) {
    issues.push('Very low audio levels detected');
    recommendations.push('Increase microphone sensitivity or check input levels');
  }
  
  // Check for high silence ratio
  if (analysis.silenceRatio > 0.95) {
    issues.push('Audio contains mostly silence');
    recommendations.push('Check microphone placement and background noise');
  }

  return {
    isValid: issues.length === 0,
    issues,
    recommendations
  };
}

// Export types
export type { AudioConversionStats };