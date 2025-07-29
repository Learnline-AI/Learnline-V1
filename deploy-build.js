#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('Starting deployment build process...');

try {
  // Step 1: Build the frontend with Vite
  console.log('Building frontend...');
  execSync('vite build', { stdio: 'inherit' });
  
  // Step 2: Prepare server for deployment using tsx runtime
  console.log('Preparing server for deployment...');
  
  // Create dist directory if it doesn't exist
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }
  
  // Copy server files to dist
  execSync('cp -r server dist/', { stdio: 'inherit' });
  execSync('cp -r shared dist/', { stdio: 'inherit' });
  
  // Create a deployment-specific package.json with tsx runtime
  const deployPackageJson = {
    "name": "learnline-deploy",
    "version": "1.0.0",
    "type": "module",
    "main": "server/index.ts",
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
      "typescript": "^5.6.3"
    }
  };
  
  fs.writeFileSync('dist/package.json', JSON.stringify(deployPackageJson, null, 2));
  
  // Copy replit_embeddings file if it exists
  if (fs.existsSync('replit_embeddings_20250706_082403.json')) {
    execSync('cp replit_embeddings_20250706_082403.json dist/', { stdio: 'inherit' });
  }
  
  console.log('Deployment build completed successfully!');
  
} catch (error) {
  console.error('Deployment build failed:', error.message);
  process.exit(1);
}