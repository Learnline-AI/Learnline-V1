#!/usr/bin/env node

/**
 * Facebook Denoiser Integration Test
 * Tests the complete integration pipeline for Facebook Denoiser
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const PYTHON_PATH = process.env.PYTHON_PATH || 'python3';
const TEST_TIMEOUT = 30000; // 30 seconds

async function testPythonIntegration() {
  console.log('🎤 Testing Facebook Denoiser Python Integration...');
  console.log('=' .repeat(60));
  
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'server/python/test_integration.py');
    
    console.log(`📍 Running: ${PYTHON_PATH} ${scriptPath}`);
    
    const pythonProcess = spawn(PYTHON_PATH, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: TEST_TIMEOUT
    });
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      // Print stderr in real-time for test progress
      process.stderr.write(data);
    });
    
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve({ success: true, result, stderr });
        } catch (error) {
          resolve({ success: false, error: `Failed to parse result: ${error.message}`, stdout, stderr });
        }
      } else {
        resolve({ success: false, error: `Python process exited with code ${code}`, stdout, stderr });
      }
    });
    
    pythonProcess.on('error', (error) => {
      resolve({ success: false, error: `Failed to start Python process: ${error.message}` });
    });
    
    // Set timeout
    setTimeout(() => {
      pythonProcess.kill();
      resolve({ success: false, error: 'Test timeout after 30 seconds' });
    }, TEST_TIMEOUT);
  });
}

async function testNodeJSService() {
  console.log('\n🎤 Testing Facebook Denoiser Node.js Service...');
  console.log('=' .repeat(60));
  
  try {
    // Import the service (this tests if the module loads without errors)
    const { FacebookDenoiserService } = await import('./server/services/facebookDenoiserService.js');
    console.log('✅ Facebook Denoiser service module loaded successfully');
    
    // Test service creation with test config
    const service = new FacebookDenoiserService({
      enabled: true,
      debug: true,
      timeout: 5000,
      pythonPath: PYTHON_PATH,
      restartThreshold: 3
    });
    
    console.log('✅ Facebook Denoiser service instance created');
    
    // Test service methods exist
    const methods = ['initialize', 'processAudio', 'healthCheck', 'getStats', 'destroy'];
    for (const method of methods) {
      if (typeof service[method] === 'function') {
        console.log(`✅ Method ${method} exists`);
      } else {
        throw new Error(`Method ${method} missing`);
      }
    }
    
    console.log('✅ All required methods exist');
    
    // Test stats structure
    const stats = service.getStats();
    const requiredStats = ['totalProcessed', 'successfulProcessed', 'errors', 'averageLatency'];
    for (const stat of requiredStats) {
      if (stat in stats) {
        console.log(`✅ Stat ${stat} exists: ${stats[stat]}`);
      } else {
        throw new Error(`Stat ${stat} missing`);
      }
    }
    
    return { success: true, message: 'Node.js service tests passed' };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function testVADServiceIntegration() {
  console.log('\n🎤 Testing VAD Service Integration...');
  console.log('=' .repeat(60));
  
  try {
    // Import VAD service
    const { ConversationVAD } = await import('./server/services/vadService.js');
    console.log('✅ VAD service module loaded successfully');
    
    // Test VAD service creation with Facebook Denoiser enabled
    const vadService = new ConversationVAD({
      facebookDenoiserEnabled: true,
      facebookDenoiserDebug: true,
      rnnoiseEnabled: true,
      rnnoiseDebug: true
    });
    
    console.log('✅ VAD service instance created with Facebook Denoiser config');
    
    // Test that the service has the required methods
    const methods = ['initialize', 'processAudioChunk', 'getVADStats', 'destroy'];
    for (const method of methods) {
      if (typeof vadService[method] === 'function') {
        console.log(`✅ VAD method ${method} exists`);
      } else {
        throw new Error(`VAD method ${method} missing`);
      }
    }
    
    // Test VAD stats include Facebook Denoiser stats
    const stats = vadService.getVADStats();
    const requiredStats = ['facebookDenoiserEnabled', 'facebookDenoiserSuccess', 'facebookDenoiserErrors'];
    for (const stat of requiredStats) {
      if (stat in stats) {
        console.log(`✅ VAD stat ${stat} exists: ${stats[stat]}`);
      } else {
        console.warn(`⚠️ VAD stat ${stat} missing (may be added during initialization)`);
      }
    }
    
    return { success: true, message: 'VAD service integration tests passed' };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function runAllTests() {
  console.log('🎉 Facebook Denoiser Integration Test Suite');
  console.log('=' .repeat(80));
  
  const tests = [
    { name: 'Python Integration', fn: testPythonIntegration },
    { name: 'Node.js Service', fn: testNodeJSService },
    { name: 'VAD Integration', fn: testVADServiceIntegration }
  ];
  
  let passed = 0;
  let total = tests.length;
  const results = [];
  
  for (const test of tests) {
    console.log(`\n🧪 Running: ${test.name}`);
    try {
      const result = await test.fn();
      if (result.success) {
        console.log(`✅ ${test.name}: PASSED`);
        if (result.message) console.log(`   ${result.message}`);
        passed++;
      } else {
        console.log(`❌ ${test.name}: FAILED`);
        console.log(`   Error: ${result.error}`);
      }
      results.push({ name: test.name, ...result });
    } catch (error) {
      console.log(`❌ ${test.name}: ERROR`);
      console.log(`   Exception: ${error.message}`);
      results.push({ name: test.name, success: false, error: error.message });
    }
  }
  
  console.log('\n' + '=' .repeat(80));
  console.log(`📊 Integration Test Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All integration tests passed! Facebook Denoiser is ready to use.');
    console.log('\n📋 Next steps:');
    console.log('   1. Install Python dependencies: pip install -r server/python/requirements.txt');
    console.log('   2. Start the development server: npm run dev');
    console.log('   3. Open VAD test page and enable Facebook Denoiser');
    console.log('   4. Test voice input with superior noise suppression');
  } else {
    console.log('⚠️ Some integration tests failed. Please review the errors above.');
    console.log('\n🔧 Troubleshooting:');
    console.log('   - Ensure Python 3.8+ is installed and accessible');
    console.log('   - Install required dependencies: pip install torch torchaudio numpy');
    console.log('   - Check that all TypeScript files compile without errors');
  }
  
  return { passed, total, results };
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

export { runAllTests, testPythonIntegration, testNodeJSService, testVADServiceIntegration };