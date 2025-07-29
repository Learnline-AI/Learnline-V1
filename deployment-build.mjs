#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';

console.log('Starting deployment build...');

try {
  // Clean and create dist directory
  if (fs.existsSync('dist')) {
    execSync('rm -rf dist');
  }
  fs.mkdirSync('dist', { recursive: true });
  
  // Build frontend with optimized settings
  console.log('Building frontend...');
  execSync('NODE_OPTIONS="--max-old-space-size=2048" vite build --minify=false', { stdio: 'inherit' });
  
  // Copy server files without bundling (avoiding esbuild issues)
  console.log('Copying server files...');
  execSync('cp -r server dist/', { stdio: 'inherit' });
  execSync('cp -r shared dist/', { stdio: 'inherit' });
  
  // Copy essential files
  execSync('cp package.json dist/', { stdio: 'inherit' });
  execSync('cp tsconfig.json dist/', { stdio: 'inherit' });
  
  // Copy RAG embeddings
  if (fs.existsSync('replit_embeddings_20250706_082403.json')) {
    execSync('cp replit_embeddings_20250706_082403.json dist/', { stdio: 'inherit' });
  }
  
  // Create optimized package.json for deployment
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const deployPackage = {
    name: packageJson.name,
    version: packageJson.version,
    type: "module",
    scripts: {
      start: "tsx server/index.ts"
    },
    dependencies: {
      "@anthropic-ai/sdk": packageJson.dependencies["@anthropic-ai/sdk"],
      "@neondatabase/serverless": packageJson.dependencies["@neondatabase/serverless"],
      "express": packageJson.dependencies["express"],
      "express-session": packageJson.dependencies["express-session"],
      "fluent-ffmpeg": packageJson.dependencies["fluent-ffmpeg"],
      "connect-pg-simple": packageJson.dependencies["connect-pg-simple"],
      "drizzle-orm": packageJson.dependencies["drizzle-orm"],
      "drizzle-zod": packageJson.dependencies["drizzle-zod"],
      "zod": packageJson.dependencies["zod"],
      "ws": packageJson.dependencies["ws"],
      "tsx": packageJson.dependencies["tsx"],
      "typescript": packageJson.dependencies["typescript"],
      "memorystore": packageJson.dependencies["memorystore"],
      "passport": packageJson.dependencies["passport"],
      "passport-local": packageJson.dependencies["passport-local"]
    }
  };
  
  fs.writeFileSync('dist/package.json', JSON.stringify(deployPackage, null, 2));
  
  console.log('Deployment build completed successfully!');
  
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}