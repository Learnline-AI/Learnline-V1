// Type declarations for RNNoise WASM packages

declare module '@jitsi/rnnoise-wasm' {
  export default class RnnoiseProcessor {
    constructor();
    ready(): Promise<void>;
    process(audioData: Float32Array): Float32Array;
    destroy(): void;
  }
}

declare module '@timephy/rnnoise-wasm' {
  export class RnnoiseWasm {
    constructor();
    init(): Promise<void>;
    process(audioData: Float32Array): Float32Array;
    destroy(): void;
  }
}