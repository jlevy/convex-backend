#!/bin/bash
#
# Teardown script for workflow testing harness.
# Stops local Convex development server and cleans up.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "[teardown] Workflow Testing Harness Teardown"

# Stop Convex dev server if we started it
if [ -f ".convex-pid" ]; then
    CONVEX_PID=$(cat .convex-pid)
    if ps -p $CONVEX_PID > /dev/null 2>&1; then
        echo "[teardown] Stopping Convex dev server (PID: $CONVEX_PID)..."
        kill $CONVEX_PID 2>/dev/null || true
        sleep 2
        # Force kill if still running
        if ps -p $CONVEX_PID > /dev/null 2>&1; then
            kill -9 $CONVEX_PID 2>/dev/null || true
        fi
    fi
    rm -f .convex-pid
fi

# Clean up logs
if [ -f "convex-dev.log" ]; then
    echo "[teardown] Removing convex-dev.log..."
    rm -f convex-dev.log
fi

echo "[teardown] Teardown complete!"
