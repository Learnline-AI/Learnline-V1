#!/bin/bash

echo "Starting Replit deployment build..."

# Create dist directory
mkdir -p dist

# Copy server files
echo "Copying server files..."
cp -r server dist/
cp -r shared dist/

# Copy RAG embeddings if exists
if [ -f "replit_embeddings_20250706_082403.json" ]; then
    cp replit_embeddings_20250706_082403.json dist/
fi

# Build frontend with limited resources
echo "Building frontend..."
NODE_OPTIONS="--max-old-space-size=2048" npm run build:frontend

echo "Build completed successfully!"