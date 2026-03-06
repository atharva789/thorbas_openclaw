#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# OpenClaw + Omniclaw — macOS Setup Script
# =============================================================
# Run from the repo root:
#   chmod +x setup-mac.sh && ./setup-mac.sh
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/local-config"
WORKSPACE_DIR="$SCRIPT_DIR/local-workspace"

echo "=============================================="
echo "  OpenClaw + Omniclaw — macOS Setup"
echo "=============================================="
echo ""

# -- 1. Check Docker Desktop ------------------------------------
if ! command -v docker &>/dev/null; then
    echo "ERROR: Docker not found."
    echo "Install Docker Desktop for Mac: https://www.docker.com/products/docker-desktop/"
    exit 1
fi
if ! docker compose version &>/dev/null; then
    echo "ERROR: Docker Compose v2 not available. Update Docker Desktop."
    exit 1
fi
echo "==> Docker: $(docker --version)"
echo "==> Docker Compose: $(docker compose version --short)"

# -- 2. Check ngrok ----------------------------------------------
if ! command -v ngrok &>/dev/null; then
    echo ""
    echo "WARNING: ngrok not found. Install it for Telegram access:"
    echo "  brew install ngrok"
    echo "  ngrok config add-authtoken YOUR_TOKEN"
    echo ""
fi

# -- 3. Create local directories ---------------------------------
echo "==> Creating local directories..."
mkdir -p "$CONFIG_DIR"
mkdir -p "$WORKSPACE_DIR"
mkdir -p "$WORKSPACE_DIR/uscis"

# -- 4. Set up .env -----------------------------------------------
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "==> Creating .env from template..."
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"

    # Generate gateway token
    GATEWAY_TOKEN=$(openssl rand -hex 32)
    # macOS sed uses -i '' instead of -i
    sed -i '' "s/^OPENCLAW_GATEWAY_TOKEN=$/OPENCLAW_GATEWAY_TOKEN=$GATEWAY_TOKEN/" "$SCRIPT_DIR/.env"

    # Override paths for local Mac setup
    sed -i '' "s|^OPENCLAW_CONFIG_DIR=.*|OPENCLAW_CONFIG_DIR=./local-config|" "$SCRIPT_DIR/.env"
    sed -i '' "s|^OPENCLAW_WORKSPACE_DIR=.*|OPENCLAW_WORKSPACE_DIR=./local-workspace|" "$SCRIPT_DIR/.env"

    echo "    Gateway token generated."
    echo "    Paths set to local directories."

    echo ""
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "  IMPORTANT: Edit .env with your secrets before    "
    echo "  running docker compose up:                       "
    echo ""
    echo "    nano $SCRIPT_DIR/.env                          "
    echo ""
    echo "  Required:                                        "
    echo "    - ANTHROPIC_API_KEY                             "
    echo "    - TELEGRAM_BOT_TOKEN                            "
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo ""
else
    echo "==> .env already exists, skipping..."
fi

# -- 5. Copy config templates ------------------------------------
echo "==> Copying config templates..."
if [ ! -f "$CONFIG_DIR/openclaw.json" ]; then
    cp "$SCRIPT_DIR/config/openclaw.json" "$CONFIG_DIR/openclaw.json"
fi
if [ ! -f "$CONFIG_DIR/agents.json" ]; then
    cp "$SCRIPT_DIR/config/agents.json" "$CONFIG_DIR/agents.json"
fi

# -- 6. Check for client_secret.json -----------------------------
if [ ! -f "$CONFIG_DIR/client_secret.json" ]; then
    echo ""
    echo "WARNING: No client_secret.json found at $CONFIG_DIR/client_secret.json"
    echo "  Google Workspace tools won't work without it."
    echo "  Copy your Google Cloud OAuth client secret:"
    echo "    cp /path/to/client_secret.json $CONFIG_DIR/client_secret.json"
    echo ""
fi

# -- 7. Download USCIS H-1B Employer Data -------------------------
echo "==> Downloading USCIS H-1B employer data..."
USCIS_CSV="$WORKSPACE_DIR/uscis/h1b_data.csv"
if [ ! -f "$USCIS_CSV" ]; then
    USCIS_BASE="https://www.uscis.gov/sites/default/files/document/data"
    HEADER_WRITTEN=false
    for YEAR in 2023 2022 2021 2020 2019; do
        echo "    Downloading FY${YEAR}..."
        TMP_CSV=$(mktemp)
        if curl -fsSL -o "$TMP_CSV" "${USCIS_BASE}/h1b_datahubexport-${YEAR}.csv" 2>/dev/null; then
            if [ "$HEADER_WRITTEN" = false ]; then
                cat "$TMP_CSV" >> "$USCIS_CSV"
                HEADER_WRITTEN=true
            else
                tail -n +2 "$TMP_CSV" >> "$USCIS_CSV"
            fi
        else
            echo "    WARNING: Could not download FY${YEAR} data, skipping."
        fi
        rm -f "$TMP_CSV"
    done
    if [ ! -f "$USCIS_CSV" ] || [ ! -s "$USCIS_CSV" ]; then
        echo "WARNING: Could not download any USCIS H-1B data."
        echo "The visa-sponsor-check tool will return 'unknown' for all companies."
    else
        echo "    USCIS H-1B data saved to $USCIS_CSV"
    fi
else
    echo "    USCIS H-1B data already present, skipping download."
fi

# -- 8. Build Docker images ---------------------------------------
echo "==> Building Docker images (this takes a few minutes)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" build

# -- 9. Done -------------------------------------------------------
echo ""
echo "=============================================="
echo "  Setup complete!"
echo "=============================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Edit your secrets:"
echo "   nano $SCRIPT_DIR/.env"
echo ""
echo "2. Copy Google OAuth credentials:"
echo "   cp /path/to/client_secret.json $CONFIG_DIR/client_secret.json"
echo ""
echo "3. Start the server:"
echo "   cd $SCRIPT_DIR && docker compose up -d"
echo ""
echo "4. One-time Google OAuth (opens in your browser):"
echo "   docker compose exec openclaw-gateway openclaw plugins config omniclaw"
echo ""
echo "5. Start ngrok tunnel (for Telegram):"
echo "   ngrok http 18789"
echo ""
echo "6. Add Telegram channel:"
echo "   docker compose exec openclaw-gateway \\"
echo "     openclaw channels add --channel telegram --token YOUR_BOT_TOKEN"
echo ""
echo "7. Keep Mac awake (in another terminal):"
echo "   caffeinate -dims"
echo ""
echo "8. Message your Telegram bot to pair!"
echo ""
echo "Config: $CONFIG_DIR"
echo "Workspace: $WORKSPACE_DIR"
echo "Gateway: http://localhost:18789"
echo ""
