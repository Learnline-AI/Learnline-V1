#!/usr/bin/env node

// Simple GitHub API push script
// Usage: node github-push.js "commit message"

const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = 'Learnline-AI';
const REPO_NAME = 'learnline-ai-tutor';

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable not set');
  console.log('Please add your GitHub token to Replit Secrets:');
  console.log('1. Go to GitHub Settings > Developer settings > Personal access tokens');
  console.log('2. Generate a new token with "repo" permissions');
  console.log('3. Add it to Replit Secrets as GITHUB_TOKEN');
  process.exit(1);
}

const commitMessage = process.argv[2] || 'Update from Replit';

async function pushToGitHub() {
  console.log('Preparing files for GitHub...');
  
  // Get list of files to upload (excluding .git and node_modules)
  const filesToUpload = [];
  
  function scanDirectory(dir, basePath = '') {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      // Skip unnecessary directories and files
      if (item.startsWith('.git') || 
          item === 'node_modules' || 
          item === 'attached_assets' ||
          item === 'dist' ||
          item === 'build' ||
          item.endsWith('.log') ||
          item.endsWith('.tmp')) continue;
      
      const fullPath = path.join(dir, item);
      const relativePath = basePath ? `${basePath}/${item}` : item;
      
      if (fs.statSync(fullPath).isDirectory()) {
        scanDirectory(fullPath, relativePath);
      } else {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          filesToUpload.push({
            path: relativePath,
            content: content
          });
        } catch (err) {
          console.log(`Skipping binary file: ${relativePath}`);
        }
      }
    }
  }
  
  scanDirectory('.');
  
  console.log(`Found ${filesToUpload.length} files to upload`);
  
  // Create tree with file content
  const tree = filesToUpload.map(file => ({
    path: file.path,
    mode: '100644',
    type: 'blob',
    content: file.content
  }));
  
  try {
    // Get current commit SHA
    const currentRef = await githubAPI('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/main`);
    const currentCommitSha = currentRef.object.sha;
    
    // Create new tree
    const newTree = await githubAPI('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, {
      tree: tree,
      base_tree: currentCommitSha
    });
    
    // Create new commit
    const newCommit = await githubAPI('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, {
      message: commitMessage,
      tree: newTree.sha,
      parents: [currentCommitSha]
    });
    
    // Update reference
    await githubAPI('PATCH', `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/main`, {
      sha: newCommit.sha
    });
    
    console.log('✅ Successfully pushed to GitHub!');
    console.log(`Commit: ${commitMessage}`);
    console.log(`SHA: ${newCommit.sha}`);
    
  } catch (error) {
    console.error('❌ Error pushing to GitHub:', error.message);
    process.exit(1);
  }
}

function githubAPI(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Replit-Push-Script',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };
    
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(response);
          } else {
            reject(new Error(`GitHub API error: ${response.message || body}`));
          }
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${body}`));
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

pushToGitHub();