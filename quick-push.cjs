#!/usr/bin/env node

// Quick push script for incremental updates
const fs = require('fs');
const { execSync } = require('child_process');

const commitMessage = process.argv[2] || 'Quick update from Replit';

console.log('Creating commit bundle...');

// Create a simple commit info file
const commitInfo = {
  message: commitMessage,
  timestamp: new Date().toISOString(),
  files_changed: 'Updated from Replit development environment'
};

fs.writeFileSync('last-commit.json', JSON.stringify(commitInfo, null, 2));

console.log(`
✅ Your changes are ready for GitHub!

To push to GitHub, you have 2 options:

Option 1: Use the sync script (for major updates)
  node sync-github.cjs "${commitMessage}"

Option 2: Manual upload (quick and reliable)
  1. Download project as zip from Replit (3-dot menu → Download)
  2. Go to https://github.com/Learnline-AI/learnline-ai-tutor
  3. Upload files via GitHub web interface
  4. Commit with message: "${commitMessage}"

Your project contains:
  - Complete voice AI tutor application
  - Fixed audio streaming and queue management  
  - Mobile-optimized PWA interface
  - ElevenLabs TTS integration
  - Hindi conversation support

Commit message: "${commitMessage}"
`);