#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('Building for deployment...');

// Create production build
try {
  // Clean dist directory
  if (fs.existsSync('dist')) {
    execSync('rm -rf dist');
  }
  fs.mkdirSync('dist', { recursive: true });
  
  // Build frontend first
  console.log('Building frontend...');
  execSync('vite build', { stdio: 'inherit' });
  
  // Copy server files (no bundling to avoid esbuild issues)
  console.log('Copying server files...');
  execSync('cp -r server dist/', { stdio: 'inherit' });
  execSync('cp -r shared dist/', { stdio: 'inherit' });
  
  // Copy package.json and node_modules for runtime dependencies
  execSync('cp package.json dist/', { stdio: 'inherit' });
  
  // Copy RAG embeddings
  if (fs.existsSync('replit_embeddings_20250706_082403.json')) {
    execSync('cp replit_embeddings_20250706_082403.json dist/', { stdio: 'inherit' });
  }
  
  // Create deployment start script
  const startScript = `#!/usr/bin/env node
import { execSync } from 'child_process';
process.env.NODE_ENV = 'production';
execSync('tsx server/index.ts', { stdio: 'inherit' });`;
  
  fs.writeFileSync('dist/start.js', startScript);
  execSync('chmod +x dist/start.js');
  
  console.log('Deployment build completed!');
  
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}