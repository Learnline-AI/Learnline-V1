#!/bin/bash

echo "Starting final deployment build..."

# Clean dist directory
rm -rf dist
mkdir -p dist

# Build frontend
echo "Building frontend..."
vite build

# Copy server files (no bundling to avoid esbuild issues)
echo "Copying server files..."
cp -r server dist/
cp -r shared dist/

# Copy essential files
cp package.json dist/
cp tsconfig.json dist/

# Copy RAG embeddings
if [ -f "replit_embeddings_20250706_082403.json" ]; then
    cp replit_embeddings_20250706_082403.json dist/
fi

# Create deployment package.json with minimal dependencies
cat > dist/package.json << 'EOF'
{
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
}
EOF

echo "Final deployment build completed!"
EOF