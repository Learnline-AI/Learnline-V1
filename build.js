#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Starting build process...');

try {
  // Step 1: Build the frontend with Vite
  console.log('Building frontend...');
  execSync('vite build', { stdio: 'inherit' });
  
  // Step 2: Copy server files to dist (avoiding complex bundling)
  console.log('Preparing server files...');
  
  // Create dist directory if it doesn't exist
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }
  
  // Copy server files to dist
  execSync('cp -r server dist/', { stdio: 'inherit' });
  execSync('cp -r shared dist/', { stdio: 'inherit' });
  
  // Copy package.json and node_modules reference
  execSync('cp package.json dist/', { stdio: 'inherit' });
  
  console.log('Build completed successfully!');
  
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}