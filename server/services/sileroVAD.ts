// sileroVAD.ts - Server-side Silero ONNX VAD Integration
let InferenceSession: any = null;
let Tensor: any = null;
let onnxRuntimeLoaded = false;

// Lazy loading of ONNX runtime with graceful fallback
async function loadONNXRuntime(): Promise<boolean> {
  if (onnxRuntimeLoaded) return InferenceSession !== null;
  
  try {
    // Use dynamic import for ES modules compatibility
    const onnxRuntime = await import('onnxruntime-node');
    InferenceSession = onnxRuntime.InferenceSession;
    Tensor = onnxRuntime.Tensor;
    onnxRuntimeLoaded = true;
    console.log('✅ ONNX Runtime loaded successfully');
    return true;
  } catch (error) {
    console.warn('⚠️ ONNX Runtime not available:', (error as Error).message);
    console.warn('🔄 Silero VAD will be disabled, using custom VAD only');
    onnxRuntimeLoaded = true;
    return false;
  }
}

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Silero VAD Configuration
interface SileroConfig {
  modelVersion: 'v5' | 'legacy';
  sampleRate: number;
  frameSamples: number;
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  minSpeechFrames: number;
  minSilenceFrames: number;
  windowSizeSamples: number;
}

const DEFAULT_SILERO_CONFIG: SileroConfig = {
  modelVersion: 'v5',
  sampleRate: 16000,
  frameSamples: 512, // V5 model expects 512 samples per frame
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  minSpeechFrames: 32, // ~1 second at 16kHz with 512 sample frames
  minSilenceFrames: 25, // ~800ms silence threshold
  windowSizeSamples: 512,
};

export interface SileroVADResult {
  probability: number;
  isSpeech: boolean;
  timestamp: number;
  frameSamples: number;
  modelVersion: string;
}

export class SileroONNXVAD {
  private session: any = null;
  private config: SileroConfig;
  private isInitialized = false;
  private modelPath: string;
  
  // LSTM state management for Silero ONNX model
  private h0State!: Float32Array; // Hidden state tensor [2,1,64]
  private c0State!: Float32Array; // Cell state tensor [2,1,64]
  private sampleRate!: Int32Array; // Sample rate tensor [16000]
  
  // State variables for speech detection
  private speechFrameCount = 0;
  private silenceFrameCount = 0;
  private currentSpeechState = false;
  private lastSpeechTime = 0;
  
  constructor(config: Partial<SileroConfig> = {}) {
    this.config = { ...DEFAULT_SILERO_CONFIG, ...config };
    
    // Determine model path based on version
    const modelFileName = this.config.modelVersion === 'v5' ? 'silero_vad_v5.onnx' : 'silero_vad_legacy.onnx';
    this.modelPath = path.join(__dirname, '../../node_modules/@ricky0123/vad-web/dist', modelFileName);
    
    // Initialize LSTM state tensors with correct shapes
    // Silero VAD requires h0 and c0 states with shape [1, 1, 128]
    this.initializeStateTensors();
    
    console.log(`🧠 Silero ONNX VAD initialized with config:`, {
      modelVersion: this.config.modelVersion,
      modelPath: this.modelPath,
      frameSamples: this.config.frameSamples,
      stateTensorShapes: {
        h0: [1, 1, 128],
        c0: [1, 1, 128],
        sr: [this.config.sampleRate]
      },
      thresholds: {
        positive: this.config.positiveSpeechThreshold,
        negative: this.config.negativeSpeechThreshold
      }
    });
  }
  
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    // Try to load ONNX runtime
    const onnxAvailable = await loadONNXRuntime();
    if (!onnxAvailable || !InferenceSession || !Tensor) {
      throw new Error('ONNX Runtime not available - falling back to custom VAD');
    }
    
    try {
      console.log('🔧 Initializing Silero ONNX VAD session...');
      
      // Check if model file exists
      if (!fs.existsSync(this.modelPath)) {
        throw new Error(`Silero ONNX model not found at: ${this.modelPath}`);
      }
      
      console.log(`📁 Loading Silero ${this.config.modelVersion} model from: ${this.modelPath}`);
      
      // Create ONNX inference session
      this.session = await InferenceSession.create(this.modelPath, {
        executionProviders: ['cpu'], // Use CPU execution for reliability
        enableCpuMemArena: true,
        enableMemPattern: true,
        executionMode: 'sequential',
      });
      
      console.log('✅ Silero ONNX VAD session created successfully');
      
      // Validate model inputs and outputs
      this.validateModelCompatibility();
      
      this.isInitialized = true;
      
    } catch (error) {
      console.error('❌ Failed to initialize Silero ONNX VAD:', error);
      throw new Error(`Silero ONNX VAD initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  async processAudioChunk(audioData: Float32Array): Promise<SileroVADResult> {
    if (!this.isInitialized || !this.session) {
      throw new Error('Silero VAD not initialized');
    }
    
    const timestamp = Date.now();
    
    try {
      // Ensure we have the right number of samples for the model
      const processedAudio = this.preprocessAudio(audioData);
      
      // Debug audio signal characteristics
      this.debugAudioSignal(processedAudio, 'before_inference');
      
      // Create input tensors based on what the model actually expects
      const inputTensor = new Tensor('float32', processedAudio, [1, processedAudio.length]);
      const feeds: any = { 'input': inputTensor };
      
      // Add state tensors based on model version (fixed patterns)
      const hiddenSize = 128; // Both V5 and Legacy models use 128-dimensional hidden states
      const inputNames = this.session.inputNames;
      
      if (this.config.modelVersion === 'v5') {
        // V5 model uses 'state' input (concatenated h0 and c0)
        if (inputNames.includes('state')) {
          const combinedState = new Float32Array(this.h0State.length + this.c0State.length);
          combinedState.set(this.h0State, 0);
          combinedState.set(this.c0State, this.h0State.length);
          feeds['state'] = new Tensor('float32', combinedState, [2, 1, hiddenSize]);
          console.log(`🔧 V5 model: using combined 'state' input [2,1,${hiddenSize}]`);
        } else {
          console.warn(`⚠️ V5 model expected 'state' input but found: ${inputNames.join(', ')}`);
        }
      } else {
        // Legacy model uses separate h0/c0 inputs
        if (inputNames.includes('h0') && inputNames.includes('c0')) {
          feeds['h0'] = new Tensor('float32', this.h0State, [1, 1, hiddenSize]);
          feeds['c0'] = new Tensor('float32', this.c0State, [1, 1, hiddenSize]);
          console.log(`🔧 Legacy model: using separate h0/c0 inputs [1,1,${hiddenSize}]`);
        } else if (inputNames.includes('h') && inputNames.includes('c')) {
          feeds['h'] = new Tensor('float32', this.h0State, [1, 1, hiddenSize]);
          feeds['c'] = new Tensor('float32', this.c0State, [1, 1, hiddenSize]);
          console.log(`🔧 Legacy model: using alternative h/c inputs [1,1,${hiddenSize}]`);
        } else {
          console.warn(`⚠️ Legacy model expected h0/c0 or h/c inputs but found: ${inputNames.join(', ')}`);
        }
      }
      
      // Add sample rate if model expects it
      if (inputNames.includes('sr')) {
        feeds['sr'] = new Tensor('int64', new BigInt64Array([BigInt(this.sampleRate[0])]), [1]);
      }
      
      // Validate that we have all required inputs
      const providedInputs = Object.keys(feeds);
      const missingInputs = inputNames.filter((name: string) => !providedInputs.includes(name));
      
      if (missingInputs.length > 0) {
        throw new Error(`Missing required inputs: ${missingInputs.join(', ')}. Model expects: ${inputNames.join(', ')}, but got: ${providedInputs.join(', ')}`);
      }
      
      console.log(`🔧 ONNX inference with inputs:`, Object.keys(feeds), `(model expects: ${inputNames.join(', ')})`);
      
      // Run inference with validated inputs
      const results = await this.session.run(feeds);
      
      // Extract speech probability from output tensor
      const outputTensor = results.output;
      let speechProbability = 0;
      
      if (outputTensor && outputTensor.data) {
        // Handle different tensor data types (Float32Array, regular Array, or single number)
        if (outputTensor.data.length !== undefined) {
          // TypedArray or regular Array
          speechProbability = typeof outputTensor.data[0] === 'number' ? outputTensor.data[0] : 0;
        } else if (typeof outputTensor.data === 'number') {
          // Single number
          speechProbability = outputTensor.data;
        }
        
        // Debug output tensor structure
        console.log(`🔍 ONNX Output Debug: tensor.data type=${typeof outputTensor.data}, length=${outputTensor.data.length}, first_value=${outputTensor.data[0] || outputTensor.data}, extracted_prob=${speechProbability}`);
      } else {
        console.warn('⚠️ Invalid output tensor structure:', outputTensor);
      }
      
      // Update LSTM states for next inference using unified state update method
      this.updateLSTMStates(results);
      
      // Apply dual-threshold logic for robust speech detection
      const vadResult = this.applyVADLogic(speechProbability, timestamp);
      
      console.log(`🎙️ Silero ${this.config.modelVersion}: samples=${processedAudio.length}, prob=${speechProbability.toFixed(4)}, speech=${vadResult.isSpeech}`);
      
      return {
        probability: speechProbability,
        isSpeech: vadResult.isSpeech,
        timestamp,
        frameSamples: processedAudio.length,
        modelVersion: this.config.modelVersion,
      };
      
    } catch (error) {
      console.error('❌ Silero ONNX inference error:', error);
      
      // Enhanced error handling with specific error types
      let errorType = 'unknown';
      let shouldReset = false;
      
      if (error instanceof Error) {
        if (error.message.includes('state') || error.message.includes('tensor')) {
          errorType = 'state-error';
          shouldReset = true;
          console.warn('🔄 State tensor error detected - resetting LSTM states');
          this.resetState();
        } else if (error.message.includes('input') || error.message.includes('Missing required')) {
          errorType = 'input-error';
          console.warn('🔧 Input validation error - check model compatibility');
        } else if (error.message.includes('ONNX') || error.message.includes('session')) {
          errorType = 'onnx-error';
          console.warn('💀 ONNX session error - may need reinitialization');
        }
      }
      
      // Return fallback result with diagnostic information
      return {
        probability: 0,
        isSpeech: false,
        timestamp,
        frameSamples: audioData.length,
        modelVersion: `${this.config.modelVersion}-${errorType}`,
      };
    }
  }
  
  private preprocessAudio(audioData: Float32Array): Float32Array {
    // Ensure we have the right number of samples for the model
    const targetSamples = this.config.frameSamples;
    
    // Validate input audio
    if (audioData.length === 0) {
      console.warn('⚠️ Preprocessing: Empty audio buffer received');
      return new Float32Array(targetSamples); // Return silence
    }
    
    let processedAudio: Float32Array;
    
    if (audioData.length === targetSamples) {
      processedAudio = audioData;
    } else if (audioData.length > targetSamples) {
      // Truncate to target length - take the most recent samples
      processedAudio = audioData.slice(-targetSamples);
      console.log(`🔧 Preprocessing: Truncated ${audioData.length} → ${targetSamples} samples`);
    } else {
      // Pad with zeros if too short - but preserve original signal at start
      processedAudio = new Float32Array(targetSamples);
      processedAudio.set(audioData, 0);
      console.log(`🔧 Preprocessing: Padded ${audioData.length} → ${targetSamples} samples`);
    }
    
    // Validate processed audio has reasonable signal characteristics
    const rms = Math.sqrt(processedAudio.reduce((sum, val) => sum + val * val, 0) / processedAudio.length);
    if (rms < 0.0001) {
      console.warn(`⚠️ Preprocessing: Very low RMS (${rms.toFixed(6)}) - likely silence or near-silence`);
    }
    
    return processedAudio;
  }
  
  private updateLSTMStates(results: any): void {
    // Unified method for updating LSTM states based on model version
    const outputNames = this.session?.outputNames || [];
    
    try {
      if (this.config.modelVersion === 'v5') {
        // V5 model typically outputs 'stateN' (where N is a number) or just 'state'
        const stateOutputKey = outputNames.find((name: string) => 
          name.startsWith('state') || name === 'stateN' || name === 'state1' || name === 'state0'
        );
        
        if (stateOutputKey && results[stateOutputKey]) {
          const stateOutput = results[stateOutputKey].data;
          if (stateOutput && stateOutput.length === this.h0State.length + this.c0State.length) {
            // Split combined state output [h0, c0]
            const halfLength = stateOutput.length / 2;
            this.h0State.set(stateOutput.slice(0, halfLength));
            this.c0State.set(stateOutput.slice(halfLength));
            console.log(`🔄 V5: Updated LSTM states from '${stateOutputKey}' (${stateOutput.length} elements)`);
          } else {
            console.warn(`⚠️ V5 state size mismatch: expected ${this.h0State.length + this.c0State.length}, got ${stateOutput?.length || 0}`);
            // Keep previous states - don't update with invalid data
          }
        } else {
          console.warn(`⚠️ V5: No state output found in: [${outputNames.join(', ')}]`);
        }
        
      } else {
        // Legacy model uses separate h/c outputs
        let updated = false;
        
        if (results.hn && results.cn) {
          this.updateSeparateStates(results.hn.data, results.cn.data, 'hn/cn');
          updated = true;
        } else if (results.state_h && results.state_c) {
          this.updateSeparateStates(results.state_h.data, results.state_c.data, 'state_h/state_c');
          updated = true;
        } else if (results.h && results.c) {
          this.updateSeparateStates(results.h.data, results.c.data, 'h/c');
          updated = true;
        }
        
        if (!updated) {
          console.warn(`⚠️ Legacy: No valid state outputs found in: [${outputNames.join(', ')}]`);
        }
      }
      
    } catch (error) {
      console.error('❌ Error updating LSTM states:', error);
      // Keep existing states on error - don't reset to zeros
    }
  }
  
  private updateSeparateStates(newH0: any, newC0: any, outputType: string): void {
    let h0Updated = false;
    let c0Updated = false;
    
    if (newH0 && newH0.length === this.h0State.length) {
      this.h0State.set(newH0);
      h0Updated = true;
    }
    if (newC0 && newC0.length === this.c0State.length) {
      this.c0State.set(newC0);
      c0Updated = true;
    }
    
    if (h0Updated && c0Updated) {
      console.log(`🔄 Legacy: Updated LSTM states (${outputType}): h0=${newH0?.length || 0}, c0=${newC0?.length || 0}`);
    } else {
      console.warn(`⚠️ Legacy: Partial state update (${outputType}): h0=${h0Updated}, c0=${c0Updated}`);
    }
  }
  
  private debugAudioSignal(audioData: Float32Array, stage: string): void {
    if (audioData.length === 0) {
      console.warn(`🔍 Audio Debug [${stage}]: Empty audio buffer`);
      return;
    }
    
    // Calculate signal statistics
    let min = audioData[0];
    let max = audioData[0];
    let sum = 0;
    let sumSquares = 0;
    let nonZeroSamples = 0;
    
    for (let i = 0; i < audioData.length; i++) {
      const sample = audioData[i];
      min = Math.min(min, sample);
      max = Math.max(max, sample);
      sum += sample;
      sumSquares += sample * sample;
      if (Math.abs(sample) > 0.001) nonZeroSamples++; // Count significant samples
    }
    
    const mean = sum / audioData.length;
    const rms = Math.sqrt(sumSquares / audioData.length);
    const nonZeroRatio = nonZeroSamples / audioData.length;
    
    // Check if signal is valid
    const isAllZeros = nonZeroSamples === 0;
    const isInValidRange = min >= -1.0 && max <= 1.0;
    const hasSignificantSignal = rms > 0.001; // Threshold for meaningful audio
    
    console.log(`🔍 Audio Debug [${stage}]: len=${audioData.length}, min=${min.toFixed(4)}, max=${max.toFixed(4)}, mean=${mean.toFixed(4)}, rms=${rms.toFixed(4)}, nonZero=${nonZeroRatio.toFixed(3)}`);
    
    if (isAllZeros) {
      console.warn(`⚠️ Audio Warning [${stage}]: Signal is all zeros - no audio content`);
    }
    if (!isInValidRange) {
      console.warn(`⚠️ Audio Warning [${stage}]: Signal out of range [-1,1] - normalization issue`);
    }
    if (!hasSignificantSignal) {
      console.warn(`⚠️ Audio Warning [${stage}]: Signal RMS too low (${rms.toFixed(4)}) - likely silence or very quiet`);
    }
  }
  
  private applyVADLogic(probability: number, timestamp: number): { isSpeech: boolean } {
    // Dual-threshold logic similar to the original Silero implementation
    let newSpeechState = this.currentSpeechState;
    
    if (probability > this.config.positiveSpeechThreshold) {
      // High probability - likely speech
      this.speechFrameCount++;
      this.silenceFrameCount = 0;
      this.lastSpeechTime = timestamp;
      
      if (!this.currentSpeechState && this.speechFrameCount >= 1) {
        // Transition to speech state
        newSpeechState = true;
        console.log('🎤 Silero VAD: Speech started');
      }
      
    } else if (probability < this.config.negativeSpeechThreshold) {
      // Low probability - likely silence
      this.silenceFrameCount++;
      this.speechFrameCount = Math.max(0, this.speechFrameCount - 1);
      
      if (this.currentSpeechState && this.silenceFrameCount >= this.config.minSilenceFrames) {
        // Transition to silence state
        newSpeechState = false;
        console.log('🔇 Silero VAD: Speech ended');
        this.speechFrameCount = 0;
        this.silenceFrameCount = 0;
      }
      
    } else {
      // Intermediate probability - maintain current state
      if (this.currentSpeechState) {
        this.speechFrameCount++;
      } else {
        this.silenceFrameCount++;
      }
    }
    
    this.currentSpeechState = newSpeechState;
    
    return { isSpeech: newSpeechState };
  }
  
  private initializeStateTensors(): void {
    // Initialize LSTM state tensors with correct dimensions
    // Both V5 and Legacy models use [1, 1, 128] for each individual state (h0 and c0)
    const hiddenSize = 128; // Both V5 and Legacy models use 128-dimensional hidden states
    const stateSize = 1 * 1 * hiddenSize;
    
    this.h0State = new Float32Array(stateSize).fill(0);
    this.c0State = new Float32Array(stateSize).fill(0);
    
    // Sample rate tensor for Silero VAD (16kHz)
    this.sampleRate = new Int32Array([this.config.sampleRate]);
    
    console.log(`🔧 Initialized LSTM state tensors for ${this.config.modelVersion}: h0=${this.h0State.length}, c0=${this.c0State.length}, hidden_size=${hiddenSize}, sr=${this.sampleRate[0]}`);
  }
  
  resetState(): void {
    // Reset LSTM states to zeros
    this.h0State.fill(0);
    this.c0State.fill(0);
    
    // Reset speech detection states
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.currentSpeechState = false;
    this.lastSpeechTime = 0;
    
    console.log('🔄 Silero VAD complete state reset (LSTM + speech detection)');
  }
  
  private validateModelCompatibility(): void {
    if (!this.session) return;
    
    // Different Silero ONNX model variations have different input names
    const possibleInputPatterns = {
      pattern1: ['input', 'h0', 'c0', 'sr'],     // Standard pattern
      pattern2: ['input', 'state', 'sr'],        // Some models use single 'state'
      pattern3: ['input', 'h', 'c', 'sr'],       // Alternative naming
      pattern4: ['input', 'state']               // Minimal pattern
    };
    
    console.log('📊 Model validation:', {
      inputNames: this.session.inputNames,
      outputNames: this.session.outputNames
    });
    
    // Find which pattern matches the model
    let matchedPattern = null;
    for (const [patternName, inputs] of Object.entries(possibleInputPatterns)) {
      const missingInputs = inputs.filter(input => !this.session.inputNames.includes(input));
      if (missingInputs.length === 0) {
        matchedPattern = patternName;
        console.log(`✅ Model matches ${patternName}: ${inputs.join(', ')}`);
        break;
      }
    }
    
    if (!matchedPattern) {
      console.warn('⚠️ Model input pattern not recognized. Available inputs:', this.session.inputNames);
      console.warn('Will attempt dynamic input mapping...');
    }
  }
  
  // Public method to reset states (for session management)
  resetSession(): void {
    this.resetState();
    console.log('🔄 VAD session reset - ready for new conversation');
  }
  
  // Get current state information for debugging
  getStateInfo(): any {
    return {
      h0StateSum: Array.from(this.h0State).reduce((a, b) => a + Math.abs(b), 0),
      c0StateSum: Array.from(this.c0State).reduce((a, b) => a + Math.abs(b), 0),
      speechState: this.currentSpeechState,
      frameCount: this.speechFrameCount,
      isInitialized: this.isInitialized
    };
  }
  
  getConfig(): SileroConfig {
    return { ...this.config };
  }
  
  updateConfig(newConfig: Partial<SileroConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('⚙️ Silero VAD config updated:', newConfig);
  }
  
  isReady(): boolean {
    return this.isInitialized && this.session !== null && InferenceSession !== null;
  }
  
  async destroy(): Promise<void> {
    if (this.session) {
      try {
        await this.session.release();
        console.log('🧹 Silero ONNX session released');
      } catch (error) {
        console.error('❌ Error releasing ONNX session:', error);
      }
      this.session = null;
    }
    this.isInitialized = false;
    this.resetState();
  }
}

// Utility functions for VAD configuration
export function createSileroVADConfig(options: {
  sensitivity?: 'low' | 'medium' | 'high';
  language?: 'hindi' | 'english' | 'mixed';
  modelVersion?: 'v5' | 'legacy';
}): Partial<SileroConfig> {
  const { sensitivity = 'medium', language = 'mixed', modelVersion = 'v5' } = options;
  
  let config: Partial<SileroConfig> = {
    modelVersion,
    frameSamples: modelVersion === 'v5' ? 512 : 1536,
  };
  
  // Adjust thresholds based on sensitivity
  switch (sensitivity) {
    case 'high':
      config.positiveSpeechThreshold = 0.3;
      config.negativeSpeechThreshold = 0.2;
      break;
    case 'medium':
      config.positiveSpeechThreshold = 0.5;
      config.negativeSpeechThreshold = 0.35;
      break;
    case 'low':
      config.positiveSpeechThreshold = 0.7;
      config.negativeSpeechThreshold = 0.5;
      break;
  }
  
  // Adjust parameters based on language characteristics
  if (language === 'hindi' || language === 'mixed') {
    // Hindi speech often has different rhythm patterns
    config.minSpeechFrames = 25; // Slightly more tolerance
    config.minSilenceFrames = 20; // Shorter silence threshold
  }
  
  return config;
}

// Factory function for easy instantiation
export function createSileroVAD(options: Parameters<typeof createSileroVADConfig>[0] = {}): SileroONNXVAD {
  const config = createSileroVADConfig(options);
  return new SileroONNXVAD(config);
}