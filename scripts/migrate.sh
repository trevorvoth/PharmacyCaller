#!/bin/bash
# Database migration script for PharmacyCaller
set -e

echo "=== PharmacyCaller Database Migration ==="

# Ensure we're in the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Check for .env file
if [ ! -f .env ]; then
    echo "Error: .env file not found. Copy .env.example to .env and fill in values."
    exit 1
fi

# Load environment variables
source .env

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL not set in .env"
    exit 1
fi

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo ""
echo "=== Migration Complete ==="
