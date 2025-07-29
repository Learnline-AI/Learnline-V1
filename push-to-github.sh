#!/bin/bash

# Simple script to push changes to GitHub
# Usage: ./push-to-github.sh "Your commit message"

# Check if commit message is provided
if [ -z "$1" ]; then
    echo "Usage: ./push-to-github.sh \"Your commit message\""
    exit 1
fi

# Set up git user if not already set
git config user.email "ai@learnline.com" 2>/dev/null || true
git config user.name "Learnline AI" 2>/dev/null || true

# Add all changes
echo "Adding changes..."
git add .

# Commit changes
echo "Committing changes..."
git commit -m "$1"

# Push to GitHub
echo "Pushing to GitHub..."
git push origin main

echo "Successfully pushed to GitHub!"