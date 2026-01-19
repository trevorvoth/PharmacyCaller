#!/bin/bash
# Start PharmacyCaller with Docker Compose
set -e

echo "=== Starting PharmacyCaller ==="

# Ensure we're in the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Check for .env file
if [ ! -f .env ]; then
    echo "Error: .env file not found. Copy .env.example to .env and fill in values."
    exit 1
fi

# Start services
echo "Starting PostgreSQL and Redis..."
docker-compose up -d postgres redis

echo "Waiting for services to be healthy..."
sleep 5

# Run migrations
echo "Running database migrations..."
docker-compose --profile migrate up migrate

# Start backend and frontend
echo "Starting backend and frontend..."
docker-compose up -d backend frontend

echo ""
echo "=== PharmacyCaller Started ==="
echo "Frontend: http://localhost:80"
echo "Backend API: http://localhost:3000"
echo "Health check: http://localhost:3000/health"
echo ""
echo "View logs: docker-compose logs -f"
