#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN not found in environment');
  console.log('Add your GitHub token to Replit Secrets as GITHUB_TOKEN');
  process.exit(1);
}

const commitMessage = process.argv[2] || 'Update from Replit';

try {
  // Configure git with token authentication
  const repoUrl = `https://${GITHUB_TOKEN}@github.com/Learnline-AI/learnline-ai-tutor.git`;
  
  console.log('Setting up git remote...');
  try {
    execSync(`git remote set-url origin ${repoUrl}`, { stdio: 'pipe' });
  } catch (e) {
    execSync(`git remote add origin ${repoUrl}`, { stdio: 'pipe' });
  }
  
  console.log('Adding files...');
  execSync('git add .', { stdio: 'pipe' });
  
  console.log('Committing changes...');
  execSync(`git commit -m "${commitMessage}"`, { stdio: 'pipe' });
  
  console.log('Pushing to GitHub...');
  execSync('git push -u origin main --force', { stdio: 'pipe' });
  
  console.log('✅ Successfully pushed to GitHub!');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  
  // Fallback: show manual instructions
  console.log('\nManual push instructions:');
  console.log('1. Download project as zip from Replit');
  console.log('2. Upload to GitHub repository manually');
}