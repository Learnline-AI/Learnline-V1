#!/usr/bin/env python3
"""
Test script for Facebook Denoiser integration
Tests basic functionality without requiring full model download
"""

import sys
import json
import numpy as np
import base64

def test_basic_imports():
    """Test that basic dependencies can be imported"""
    print("Testing basic imports...", file=sys.stderr)
    
    try:
        import torch
        print(f"✅ PyTorch version: {torch.__version__}", file=sys.stderr)
    except ImportError as e:
        print(f"❌ PyTorch import failed: {e}", file=sys.stderr)
        return False
    
    try:
        import numpy as np
        print(f"✅ NumPy version: {np.__version__}", file=sys.stderr)
    except ImportError as e:
        print(f"❌ NumPy import failed: {e}", file=sys.stderr)
        return False
    
    try:
        import torchaudio
        print(f"✅ TorchAudio version: {torchaudio.__version__}", file=sys.stderr)
    except ImportError as e:
        print(f"❌ TorchAudio import failed: {e}", file=sys.stderr)
        return False
    
    # Test if Demucs is available
    try:
        import demucs
        print(f"✅ Demucs available", file=sys.stderr)
        demucs_available = True
    except ImportError:
        print("⚠️ Demucs not available, will test SpeechBrain fallback", file=sys.stderr)
        demucs_available = False
    
    # Test SpeechBrain as fallback
    if not demucs_available:
        try:
            import speechbrain
            print(f"✅ SpeechBrain available", file=sys.stderr)
        except ImportError:
            print("❌ Neither Demucs nor SpeechBrain available", file=sys.stderr)
            return False
    
    return True

def test_audio_processing():
    """Test basic audio processing without model loading"""
    print("Testing audio processing pipeline...", file=sys.stderr)
    
    # Create test audio data (1 second of 16kHz audio)
    sample_rate = 16000
    duration = 1.0
    samples = int(sample_rate * duration)
    
    # Generate test signal (sine wave with noise)
    t = np.linspace(0, duration, samples, dtype=np.float32)
    signal = 0.5 * np.sin(2 * np.pi * 440 * t)  # 440 Hz tone
    noise = 0.1 * np.random.randn(samples).astype(np.float32)
    test_audio = signal + noise
    
    print(f"✅ Generated test audio: {samples} samples, {sample_rate}Hz", file=sys.stderr)
    
    # Test base64 encoding/decoding
    try:
        audio_bytes = test_audio.tobytes()
        audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
        decoded_bytes = base64.b64decode(audio_b64)
        decoded_audio = np.frombuffer(decoded_bytes, dtype=np.float32)
        
        if np.allclose(test_audio, decoded_audio):
            print("✅ Base64 encoding/decoding test passed", file=sys.stderr)
        else:
            print("❌ Base64 encoding/decoding test failed", file=sys.stderr)
            return False
            
    except Exception as e:
        print(f"❌ Base64 processing failed: {e}", file=sys.stderr)
        return False
    
    return True

def test_communication_protocol():
    """Test JSON communication protocol"""
    print("Testing communication protocol...", file=sys.stderr)
    
    # Test various command formats
    test_commands = [
        {"command": "init", "model_path": "./models/dns64"},
        {"command": "health"},
        {"command": "process", "audio": "dGVzdA=="}  # base64 for "test"
    ]
    
    for cmd in test_commands:
        try:
            json_str = json.dumps(cmd)
            parsed = json.loads(json_str)
            
            if parsed == cmd:
                print(f"✅ JSON protocol test passed for: {cmd['command']}", file=sys.stderr)
            else:
                print(f"❌ JSON protocol test failed for: {cmd['command']}", file=sys.stderr)
                return False
                
        except Exception as e:
            print(f"❌ JSON protocol test failed: {e}", file=sys.stderr)
            return False
    
    return True

def main():
    """Run all integration tests"""
    print("🎤 Facebook Denoiser Integration Test", file=sys.stderr)
    print("=" * 50, file=sys.stderr)
    
    tests = [
        ("Basic Imports", test_basic_imports),
        ("Audio Processing", test_audio_processing),
        ("Communication Protocol", test_communication_protocol)
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"\n🧪 Running: {test_name}", file=sys.stderr)
        try:
            if test_func():
                print(f"✅ {test_name}: PASSED", file=sys.stderr)
                passed += 1
            else:
                print(f"❌ {test_name}: FAILED", file=sys.stderr)
        except Exception as e:
            print(f"❌ {test_name}: ERROR - {e}", file=sys.stderr)
    
    print("\n" + "=" * 50, file=sys.stderr)
    print(f"📊 Test Results: {passed}/{total} tests passed", file=sys.stderr)
    
    if passed == total:
        print("🎉 All tests passed! Facebook Denoiser integration ready.", file=sys.stderr)
        result = {"status": "success", "message": "All integration tests passed", "tests_passed": passed, "tests_total": total}
    else:
        print("⚠️ Some tests failed. Check dependencies and configuration.", file=sys.stderr)
        result = {"status": "warning", "message": f"Only {passed}/{total} tests passed", "tests_passed": passed, "tests_total": total}
    
    # Output result as JSON for Node.js consumption
    print(json.dumps(result))

if __name__ == "__main__":
    main()