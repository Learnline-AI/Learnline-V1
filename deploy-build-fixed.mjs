#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';

console.log('Starting deployment build with fixes...');

try {
  // Clean dist directory
  if (fs.existsSync('dist')) {
    execSync('rm -rf dist');
  }
  fs.mkdirSync('dist', { recursive: true });
  
  // Build frontend with optimized settings
  console.log('Building frontend...');
  execSync('vite build', { stdio: 'inherit' });
  
  // Copy server source files (no bundling to avoid esbuild issues)
  console.log('Copying server files...');
  execSync('cp -r server dist/', { stdio: 'inherit' });
  execSync('cp -r shared dist/', { stdio: 'inherit' });
  
  // Copy RAG embeddings
  if (fs.existsSync('replit_embeddings_20250706_082403.json')) {
    execSync('cp replit_embeddings_20250706_082403.json dist/', { stdio: 'inherit' });
  }
  
  // Create deployment-specific package.json
  const deployPackage = {
    "name": "learnline-deploy",
    "version": "1.0.0",
    "type": "module",
    "scripts": {
      "start": "tsx server/index.ts"
    },
    "dependencies": {
      "@anthropic-ai/sdk": "^0.37.0",
      "@neondatabase/serverless": "^0.10.4",
      "express": "^4.18.0",
      "express-session": "^1.17.3",
      "fluent-ffmpeg": "^2.1.2",
      "connect-pg-simple": "^9.0.1",
      "drizzle-orm": "^0.30.0",
      "drizzle-zod": "^0.5.1",
      "zod": "^3.22.4",
      "ws": "^8.16.0",
      "tsx": "^4.19.1",
      "typescript": "^5.6.3",
      "memorystore": "^1.1.2",
      "passport": "^0.7.0",
      "passport-local": "^1.0.0"
    }
  };
  
  fs.writeFileSync('dist/package.json', JSON.stringify(deployPackage, null, 2));
  
  console.log('Deployment build completed successfully!');
  console.log('The deployment will use tsx runtime instead of esbuild bundling');
  
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}