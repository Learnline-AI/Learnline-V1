#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = 'Learnline-AI';
const REPO_NAME = 'learnline-ai-tutor';

if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN not found in environment variables');
  console.log('Add your GitHub Personal Access Token to Replit Secrets');
  process.exit(1);
}

const commitMessage = process.argv[2] || 'Update from Replit';

// Essential files to sync (avoid uploading everything)
const filesToSync = [
  'client',
  'server', 
  'shared',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'tailwind.config.ts',
  'postcss.config.js',
  'components.json',
  'drizzle.config.ts',
  'README.md',
  '.gitignore',
  '.replit'
];

async function syncToGitHub() {
  console.log('Preparing essential files for GitHub sync...');
  
  const files = [];
  
  function addFile(filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        const content = fs.readFileSync(filePath, 'utf8');
        files.push({ path: filePath, content });
        console.log(`Added: ${filePath}`);
      } else if (stat.isDirectory()) {
        const items = fs.readdirSync(filePath);
        items.forEach(item => {
          if (!item.startsWith('.') && item !== 'node_modules') {
            addFile(path.join(filePath, item));
          }
        });
      }
    } catch (error) {
      console.log(`Skipped: ${filePath} (${error.message})`);
    }
  }
  
  filesToSync.forEach(file => {
    if (fs.existsSync(file)) {
      addFile(file);
    }
  });
  
  console.log(`Syncing ${files.length} files to GitHub...`);
  
  try {
    // Get current main branch
    const mainRef = await githubAPI('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/main`);
    const currentCommitSha = mainRef.object.sha;
    
    // Create blobs for all files
    const treeEntries = [];
    for (const file of files) {
      const blob = await githubAPI('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`, {
        content: Buffer.from(file.content).toString('base64'),
        encoding: 'base64'
      });
      
      treeEntries.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha
      });
    }
    
    // Create new tree
    const tree = await githubAPI('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, {
      tree: treeEntries
    });
    
    // Create commit
    const commit = await githubAPI('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, {
      message: commitMessage,
      tree: tree.sha,
      parents: [currentCommitSha]
    });
    
    // Update main branch
    await githubAPI('PATCH', `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/main`, {
      sha: commit.sha
    });
    
    console.log(`Successfully synced to GitHub!`);
    console.log(`Commit: ${commitMessage}`);
    console.log(`View at: https://github.com/${REPO_OWNER}/${REPO_NAME}`);
    
  } catch (error) {
    console.error(`Sync failed: ${error.message}`);
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
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'Replit-Sync',
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
            reject(new Error(`GitHub API ${res.statusCode}: ${response.message || body}`));
          }
        } catch (e) {
          reject(new Error(`Invalid response: ${body}`));
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

syncToGitHub();