#!/usr/bin/env bash
set -euo pipefail

WORKER="openclaw@100.66.83.22"
REMOTE_DIR="/home/openclaw/zapi-pwa"

echo "→ Pulling latest on worker5"
ssh "$WORKER" "cd $REMOTE_DIR && git pull origin main"

echo "→ Installing dependencies"
ssh "$WORKER" "cd $REMOTE_DIR && bun install"

echo "→ Restarting systemd service"
ssh "$WORKER" "sudo systemctl restart zapi-pwa-daemon"

echo "→ Status"
ssh "$WORKER" "systemctl status zapi-pwa-daemon --no-pager"

echo "✓ daemon deployed"
