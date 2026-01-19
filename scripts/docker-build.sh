#!/bin/bash
# Docker build script for PharmacyCaller
set -e

echo "=== PharmacyCaller Docker Build ==="

# Ensure we're in the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "Building in: $PROJECT_ROOT"

# Check for .env file
if [ ! -f .env ]; then
    echo "Error: .env file not found. Copy .env.example to .env and fill in values."
    exit 1
fi

# Build all images
echo ""
echo "=== Building Docker Images ==="
docker-compose build

echo ""
echo "=== Docker Build Complete ==="
echo "Run 'docker-compose up -d' to start all services."
