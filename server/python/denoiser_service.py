#!/usr/bin/env python3
"""
Facebook Denoiser Service for Learnline
Uses Demucs DNS64 model for real-time audio denoising
Communication via JSON stdin/stdout with Node.js
"""

import sys
import json
import base64
import numpy as np
import torch
import torchaudio
import logging
import time
import os
import warnings
from typing import Optional, Dict, Any
from io import BytesIO

# Suppress warnings for cleaner output
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

class FacebookDenoiserService:
    def __init__(self):
        self.model: Optional[torch.nn.Module] = None
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.sample_rate = 16000
        self.is_initialized = False
        self.processing_stats = {
            'total_processed': 0,
            'total_time': 0.0,
            'avg_time': 0.0,
            'max_time': 0.0,
            'errors': 0
        }
        
        # Setup logging to stderr so it doesn't interfere with JSON communication
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            stream=sys.stderr
        )
        self.logger = logging.getLogger(__name__)
        
    def initialize_model(self, model_path: Optional[str] = None) -> Dict[str, Any]:
        """Initialize the Facebook Demucs DNS64 model"""
        try:
            start_time = time.time()
            self.logger.info("🎤 Facebook Denoiser: Initializing DNS64 model...")
            
            # Try to load pre-trained DNS64 model
            try:
                from demucs.pretrained import get_model
                from demucs.apply import apply_model
                
                # Load DNS64 model (pre-trained denoising model)
                self.model = get_model('dns64')
                self.apply_model = apply_model
                
                self.logger.info(f"✅ Facebook Denoiser: DNS64 model loaded on {self.device}")
                
            except ImportError:
                # Fallback to SpeechBrain DNS model if Demucs not available
                self.logger.warning("⚠️ Demucs not available, trying SpeechBrain DNS...")
                try:
                    from speechbrain.pretrained import SpectralMaskEnhancement
                    self.model = SpectralMaskEnhancement.from_hparams(
                        source="speechbrain/metricgan-plus-voicebank",
                        savedir="pretrained_models/metricgan-plus-voicebank"
                    )
                    self.logger.info("✅ Facebook Denoiser: SpeechBrain DNS model loaded")
                except Exception as e:
                    raise Exception(f"Failed to load any denoising model: {e}")
            
            # Move model to appropriate device
            if hasattr(self.model, 'to'):
                self.model = self.model.to(self.device)
            
            # Set to evaluation mode
            if hasattr(self.model, 'eval'):
                self.model.eval()
            
            init_time = time.time() - start_time
            self.is_initialized = True
            
            self.logger.info(f"✅ Facebook Denoiser: Model initialized in {init_time:.2f}s")
            
            return {
                'status': 'success',
                'message': 'Model initialized successfully',
                'device': str(self.device),
                'model_type': 'dns64' if 'dns64' in str(type(self.model)) else 'speechbrain_dns',
                'init_time': init_time
            }
            
        except Exception as e:
            self.logger.error(f"❌ Facebook Denoiser: Model initialization failed: {e}")
            return {
                'status': 'error',
                'message': f'Model initialization failed: {str(e)}',
                'error': str(e)
            }
    
    def process_audio(self, audio_data: np.ndarray) -> Dict[str, Any]:
        """Process audio chunk with denoising"""
        if not self.is_initialized or self.model is None:
            return {
                'status': 'error',
                'message': 'Model not initialized',
                'audio': None,
                'processing_time': 0
            }
        
        start_time = time.time()
        
        try:
            # Validate input
            if audio_data.size == 0:
                return {
                    'status': 'error',
                    'message': 'Empty audio data',
                    'audio': None,
                    'processing_time': 0
                }
            
            # Convert to tensor and ensure correct format
            if audio_data.dtype != np.float32:
                audio_data = audio_data.astype(np.float32)
            
            # Ensure audio is in range [-1, 1]
            if np.abs(audio_data).max() > 1.0:
                audio_data = audio_data / np.abs(audio_data).max()
            
            # Convert to torch tensor
            audio_tensor = torch.from_numpy(audio_data).to(self.device)
            
            # Add batch and channel dimensions if needed: [batch, channels, samples]
            if audio_tensor.dim() == 1:
                audio_tensor = audio_tensor.unsqueeze(0).unsqueeze(0)  # [1, 1, samples]
            elif audio_tensor.dim() == 2:
                audio_tensor = audio_tensor.unsqueeze(0)  # [1, channels, samples]
            
            # Process with model
            with torch.no_grad():
                if hasattr(self, 'apply_model') and self.apply_model:
                    # Demucs model processing
                    denoised_tensor = self.apply_model(self.model, audio_tensor, device=self.device)
                else:
                    # SpeechBrain or other model processing
                    denoised_tensor = self.model.enhance_batch(audio_tensor)
            
            # Convert back to numpy
            if denoised_tensor.dim() > 2:
                denoised_tensor = denoised_tensor.squeeze(0)  # Remove batch dimension
            if denoised_tensor.dim() > 1:
                denoised_tensor = denoised_tensor.squeeze(0)  # Remove channel dimension
            
            denoised_audio = denoised_tensor.cpu().numpy().astype(np.float32)
            
            # Ensure output has same length as input
            if len(denoised_audio) != len(audio_data):
                # Trim or pad to match input length
                if len(denoised_audio) > len(audio_data):
                    denoised_audio = denoised_audio[:len(audio_data)]
                else:
                    denoised_audio = np.pad(denoised_audio, (0, len(audio_data) - len(denoised_audio)))
            
            processing_time = (time.time() - start_time) * 1000  # Convert to ms
            
            # Update statistics
            self.processing_stats['total_processed'] += 1
            self.processing_stats['total_time'] += processing_time
            self.processing_stats['avg_time'] = self.processing_stats['total_time'] / self.processing_stats['total_processed']
            self.processing_stats['max_time'] = max(self.processing_stats['max_time'], processing_time)
            
            # Log performance occasionally
            if self.processing_stats['total_processed'] % 50 == 0:
                self.logger.info(f"📊 Facebook Denoiser Performance: {self.processing_stats['total_processed']} processed, "
                               f"avg={self.processing_stats['avg_time']:.1f}ms, max={self.processing_stats['max_time']:.1f}ms")
            
            return {
                'status': 'success',
                'audio': denoised_audio,
                'processing_time': processing_time,
                'input_samples': len(audio_data),
                'output_samples': len(denoised_audio),
                'stats': self.processing_stats.copy()
            }
            
        except Exception as e:
            processing_time = (time.time() - start_time) * 1000
            self.processing_stats['errors'] += 1
            
            self.logger.error(f"❌ Facebook Denoiser: Processing failed after {processing_time:.1f}ms: {e}")
            
            return {
                'status': 'error',
                'message': f'Audio processing failed: {str(e)}',
                'audio': audio_data,  # Return original audio on error
                'processing_time': processing_time,
                'error': str(e)
            }
    
    def health_check(self) -> Dict[str, Any]:
        """Health check for the service"""
        return {
            'status': 'healthy' if self.is_initialized else 'not_initialized',
            'model_loaded': self.is_initialized,
            'device': str(self.device),
            'stats': self.processing_stats.copy(),
            'memory_usage': self.get_memory_usage()
        }
    
    def get_memory_usage(self) -> Dict[str, float]:
        """Get memory usage statistics"""
        try:
            import psutil
            process = psutil.Process()
            memory_info = process.memory_info()
            return {
                'rss_mb': memory_info.rss / 1024 / 1024,
                'vms_mb': memory_info.vms / 1024 / 1024,
                'cpu_percent': process.cpu_percent()
            }
        except ImportError:
            return {'error': 'psutil not available'}
        except Exception as e:
            return {'error': str(e)}

def main():
    """Main service loop for JSON communication"""
    service = FacebookDenoiserService()
    
    # Log startup
    service.logger.info("🎤 Facebook Denoiser Service starting...")
    
    try:
        while True:
            try:
                # Read JSON command from stdin
                line = sys.stdin.readline()
                if not line:
                    break
                
                command = json.loads(line.strip())
                command_type = command.get('command')
                
                if command_type == 'init':
                    # Initialize model
                    model_path = command.get('model_path')
                    result = service.initialize_model(model_path)
                    
                elif command_type == 'process':
                    # Process audio data
                    audio_b64 = command.get('audio')
                    if not audio_b64:
                        result = {'status': 'error', 'message': 'No audio data provided'}
                    else:
                        try:
                            # Decode base64 audio data
                            audio_bytes = base64.b64decode(audio_b64)
                            # Convert bytes to float32 array
                            audio_array = np.frombuffer(audio_bytes, dtype=np.float32)
                            
                            # Process audio
                            process_result = service.process_audio(audio_array)
                            
                            # Encode processed audio back to base64
                            if process_result['status'] == 'success' and process_result['audio'] is not None:
                                processed_bytes = process_result['audio'].tobytes()
                                processed_b64 = base64.b64encode(processed_bytes).decode('utf-8')
                                process_result['audio'] = processed_b64
                            
                            result = process_result
                            
                        except Exception as e:
                            result = {
                                'status': 'error',
                                'message': f'Audio decoding/encoding failed: {str(e)}',
                                'error': str(e)
                            }
                
                elif command_type == 'health':
                    # Health check
                    result = service.health_check()
                
                else:
                    result = {
                        'status': 'error',
                        'message': f'Unknown command: {command_type}'
                    }
                
                # Send JSON response to stdout
                print(json.dumps(result), flush=True)
                
            except json.JSONDecodeError as e:
                error_response = {
                    'status': 'error',
                    'message': f'Invalid JSON: {str(e)}',
                    'error': str(e)
                }
                print(json.dumps(error_response), flush=True)
                
            except Exception as e:
                service.logger.error(f"❌ Unexpected error in main loop: {e}")
                error_response = {
                    'status': 'error',
                    'message': f'Service error: {str(e)}',
                    'error': str(e)
                }
                print(json.dumps(error_response), flush=True)
    
    except KeyboardInterrupt:
        service.logger.info("🛑 Facebook Denoiser Service stopping...")
    except Exception as e:
        service.logger.error(f"❌ Fatal error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()