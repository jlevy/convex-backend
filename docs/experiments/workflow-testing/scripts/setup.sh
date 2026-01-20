#!/bin/bash
#
# Setup script for workflow testing harness.
# Starts local Convex development server and deploys functions.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "[setup] Workflow Testing Harness Setup"
echo "[setup] Project directory: $PROJECT_DIR"

# Check for pnpm
if ! command -v pnpm &> /dev/null; then
    echo "[setup] ERROR: pnpm is not installed"
    echo "[setup] Install with: npm install -g pnpm"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "[setup] Installing dependencies..."
    pnpm install
fi

# Check if convex dev is already running
if curl -s http://127.0.0.1:3210 > /dev/null 2>&1; then
    echo "[setup] Convex dev server already running at http://127.0.0.1:3210"
else
    echo "[setup] Starting Convex dev server in background..."
    echo "[setup] Note: Run 'pnpm dev' in a separate terminal for interactive development"

    # Start dev server in background with output redirected
    nohup pnpm exec convex dev --once > convex-dev.log 2>&1 &
    CONVEX_PID=$!
    echo $CONVEX_PID > .convex-pid

    # Wait for server to start
    echo "[setup] Waiting for Convex server to start..."
    for i in {1..30}; do
        if curl -s http://127.0.0.1:3210 > /dev/null 2>&1; then
            echo "[setup] Convex server started successfully"
            break
        fi
        if [ $i -eq 30 ]; then
            echo "[setup] ERROR: Convex server failed to start within 30 seconds"
            echo "[setup] Check convex-dev.log for errors"
            exit 1
        fi
        sleep 1
    done
fi

echo "[setup] Setup complete!"
echo "[setup] Run 'pnpm test' to execute tests"
