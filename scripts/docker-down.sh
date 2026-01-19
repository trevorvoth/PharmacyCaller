#!/bin/bash
# Stop PharmacyCaller
set -e

echo "=== Stopping PharmacyCaller ==="

# Ensure we're in the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

docker-compose down

echo ""
echo "=== PharmacyCaller Stopped ==="
echo "Data volumes are preserved. Use 'docker-compose down -v' to remove them."
