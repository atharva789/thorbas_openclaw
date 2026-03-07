#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# Start ngrok tunnel to OpenClaw Web UI
# =============================================================
# Exposes the gateway (port 18789) via a public ngrok URL
# so you can access the web UI from your phone or anywhere.
#
# Usage:
#   ./scripts/start-ngrok.sh
#   NGROK_AUTH="user:pass" ./scripts/start-ngrok.sh   # custom auth
#
# Prerequisites:
#   - ngrok installed and authenticated (ngrok authtoken <token>)
#   - OpenClaw gateway running (docker compose up -d)
# =============================================================

GATEWAY_PORT="${GATEWAY_PORT:-18789}"
CONFIG_FILE="${OPENCLAW_CONFIG_DIR:-./local-config}/openclaw.json"

# Basic auth protects the tunnel from scanners/bots that exhaust
# OpenClaw's WebSocket auth rate limiter.
# Set NGROK_AUTH="user:pass" to customise, or leave default.
NGROK_AUTH="${NGROK_AUTH:-openclaw:openclaw}"

# Check gateway is running
if ! curl -sf "http://127.0.0.1:${GATEWAY_PORT}/healthz" >/dev/null 2>&1; then
    echo "ERROR: OpenClaw gateway not responding on port ${GATEWAY_PORT}."
    echo "       Start it first: docker compose up -d"
    exit 1
fi

# Kill any existing ngrok tunnels
pkill -f "ngrok http" 2>/dev/null || true
sleep 1

# Start ngrok in background (with basic auth to block scanners)
echo "==> Starting ngrok tunnel to localhost:${GATEWAY_PORT}..."
echo "    Basic auth: ${NGROK_AUTH%%:*}:****"
ngrok http "${GATEWAY_PORT}" \
    --basic-auth="${NGROK_AUTH}" \
    --log=stdout --log-format=json >/tmp/ngrok.log 2>&1 &
NGROK_PID=$!

# Wait for tunnel to establish
echo "    Waiting for tunnel..."
for i in $(seq 1 15); do
    NGROK_URL=$(curl -sf http://127.0.0.1:4040/api/tunnels 2>/dev/null \
        | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; print(next(x['public_url'] for x in t if 'https' in x['public_url']))" 2>/dev/null || true)
    if [ -n "$NGROK_URL" ]; then
        break
    fi
    sleep 1
done

if [ -z "$NGROK_URL" ]; then
    echo "ERROR: Could not get ngrok URL. Check /tmp/ngrok.log"
    kill "$NGROK_PID" 2>/dev/null || true
    exit 1
fi

# Read gateway token from .env for display
GW_TOKEN=""
if [ -f ".env" ]; then
    GW_TOKEN=$(grep -m1 '^OPENCLAW_GATEWAY_TOKEN=' .env 2>/dev/null | cut -d= -f2 || true)
fi

echo ""
echo "=============================================="
echo "  OpenClaw Web UI"
echo "=============================================="
echo ""
echo "  Public URL:  $NGROK_URL"
echo "  Local URL:   http://localhost:${GATEWAY_PORT}"
echo "  Basic Auth:  ${NGROK_AUTH}"
echo "  ngrok PID:   $NGROK_PID"
echo ""
echo "  Open on your phone: $NGROK_URL"
echo "  (you will be prompted for basic auth username/password)"
echo ""
if [ -n "$GW_TOKEN" ]; then
echo "  GATEWAY TOKEN (paste in Control UI settings):"
echo "  $GW_TOKEN"
echo ""
fi
echo "  To stop: kill $NGROK_PID"
echo "=============================================="

# Update openclaw.json allowedOrigins to include the ngrok URL
if [ -f "$CONFIG_FILE" ]; then
    node -e "
        const fs = require('fs');
        const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
        const origins = cfg.gateway?.controlUi?.allowedOrigins ?? [];
        const ngrokUrl = '$NGROK_URL';
        if (!origins.includes(ngrokUrl)) {
            origins.push(ngrokUrl);
            cfg.gateway = cfg.gateway || {};
            cfg.gateway.controlUi = cfg.gateway.controlUi || {};
            cfg.gateway.controlUi.allowedOrigins = origins;
            fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2) + '\n');
            console.log('  Updated allowedOrigins with: ' + ngrokUrl);
        }
    " 2>/dev/null || echo "  NOTE: Could not update allowedOrigins. Add $NGROK_URL manually."
fi

echo ""
echo "  ngrok is running in the background."
echo "  Logs: tail -f /tmp/ngrok.log"
echo ""

# Keep running until interrupted
wait "$NGROK_PID" 2>/dev/null || true
