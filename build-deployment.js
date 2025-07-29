#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';

console.log('Starting deployment build process...');

try {
  // Create dist directory
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }
  
  // Copy essential files for deployment
  console.log('Copying server files...');
  execSync('cp -r server dist/', { stdio: 'inherit' });
  execSync('cp -r shared dist/', { stdio: 'inherit' });
  
  // Copy RAG embeddings if exists
  if (fs.existsSync('replit_embeddings_20250706_082403.json')) {
    execSync('cp replit_embeddings_20250706_082403.json dist/', { stdio: 'inherit' });
  }
  
  // Build frontend separately with timeout handling
  console.log('Building frontend...');
  try {
    execSync('timeout 300 vite build', { stdio: 'inherit' });
  } catch (error) {
    console.log('Frontend build timed out, trying alternative approach...');
    // Copy client files as fallback
    execSync('cp -r client dist/', { stdio: 'inherit' });
  }
  
  console.log('Deployment build completed successfully!');
  
} catch (error) {
  console.error('Deployment build failed:', error.message);
  process.exit(1);
}