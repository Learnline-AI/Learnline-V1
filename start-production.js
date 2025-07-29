#!/usr/bin/env node

import { execSync } from 'child_process';
import path from 'path';

console.log('Starting production server...');

try {
  // Check if we're in the dist directory or root
  const isInDist = process.cwd().includes('/dist');
  const serverPath = isInDist ? 'server/index.ts' : 'dist/server/index.ts';
  
  // Set production environment
  process.env.NODE_ENV = 'production';
  
  // Start the server using tsx
  console.log('Starting server with tsx...');
  execSync(`tsx ${serverPath}`, { stdio: 'inherit' });
  
} catch (error) {
  console.error('Failed to start production server:', error.message);
  process.exit(1);
}