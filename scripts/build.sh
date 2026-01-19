#!/bin/bash
# Production build script for PharmacyCaller
set -e

echo "=== PharmacyCaller Production Build ==="

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

# Backend build
echo ""
echo "=== Building Backend ==="
npm ci --production=false
npm run db:generate
npm run build
echo "Backend build complete."

# Frontend build
echo ""
echo "=== Building Frontend ==="
cd web
npm ci
npm run build
cd ..
echo "Frontend build complete."

echo ""
echo "=== Build Complete ==="
echo "Backend: dist/"
echo "Frontend: web/dist/"
