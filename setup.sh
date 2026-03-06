#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# OpenClaw + Omniclaw — Hetzner CX23 Setup Script
# =============================================================
# Run on a fresh Ubuntu VPS:
#   curl -fsSL <raw-url>/setup.sh | bash
# Or clone the repo and run:
#   chmod +x setup.sh && ./setup.sh
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="/opt/openclaw/config"
WORKSPACE_DIR="/opt/openclaw/workspace"

echo "=============================================="
echo "  OpenClaw + Omniclaw — Hetzner CX23 Setup"
echo "=============================================="
echo ""

# -- 1. System updates -----------------------------------------
echo "==> Updating system packages..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# -- 2. Install Docker -----------------------------------------
if command -v docker &>/dev/null; then
    echo "==> Docker already installed: $(docker --version)"
else
    echo "==> Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
    echo "==> Docker installed. You may need to log out and back in for group changes."
    echo "    If 'docker compose' fails below, run: newgrp docker && ./setup.sh"
fi

# Verify Docker Compose
if ! docker compose version &>/dev/null; then
    echo "ERROR: Docker Compose v2 not available. Install Docker Desktop or docker-compose-plugin."
    exit 1
fi
echo "==> Docker Compose: $(docker compose version --short)"

# -- 3. Create persistent directories -------------------------
echo "==> Creating persistent directories..."
sudo mkdir -p "$CONFIG_DIR"
sudo mkdir -p "$WORKSPACE_DIR"
sudo mkdir -p "$CONFIG_DIR/extensions"
sudo mkdir -p "$CONFIG_DIR/agents"
# OpenClaw container runs as uid 1000 (node user)
sudo chown -R 1000:1000 "$CONFIG_DIR" "$WORKSPACE_DIR"

# -- 4. Set up .env --------------------------------------------
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "==> Creating .env from template..."
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"

    # Generate gateway token
    GATEWAY_TOKEN=$(openssl rand -hex 32)
    sed -i "s/^OPENCLAW_GATEWAY_TOKEN=$/OPENCLAW_GATEWAY_TOKEN=$GATEWAY_TOKEN/" "$SCRIPT_DIR/.env"
    echo "    Gateway token generated."

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

# -- 5. Copy config templates ---------------------------------
echo "==> Copying config templates..."
if [ ! -f "$CONFIG_DIR/openclaw.json" ]; then
    cp "$SCRIPT_DIR/config/openclaw.json" "$CONFIG_DIR/openclaw.json"
    sudo chown 1000:1000 "$CONFIG_DIR/openclaw.json"
fi
if [ ! -f "$CONFIG_DIR/agents.json" ]; then
    cp "$SCRIPT_DIR/config/agents.json" "$CONFIG_DIR/agents.json"
    sudo chown 1000:1000 "$CONFIG_DIR/agents.json"
fi

# -- 6. Check for client_secret.json --------------------------
if [ ! -f "$CONFIG_DIR/client_secret.json" ]; then
    echo ""
    echo "WARNING: No client_secret.json found at $CONFIG_DIR/client_secret.json"
    echo "  Google Workspace tools won't work without it."
    echo "  Upload your Google Cloud OAuth client secret:"
    echo "    scp client_secret.json user@vps:$CONFIG_DIR/client_secret.json"
    echo "    sudo chown 1000:1000 $CONFIG_DIR/client_secret.json"
    echo ""
fi

# -- 7. Set up swap (safety net for 4GB VPS) ------------------
if [ ! -f /swapfile ]; then
    echo "==> Setting up 2GB swap..."
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    echo "    Swap enabled."
else
    echo "==> Swap already exists, skipping..."
fi

# -- 7b. Download USCIS H-1B Employer Data --------------------
echo ""
echo "==> Downloading USCIS H-1B employer data..."
USCIS_DIR="$WORKSPACE_DIR/uscis"
sudo mkdir -p "$USCIS_DIR"
sudo chown 1000:1000 "$USCIS_DIR"
USCIS_CSV="$USCIS_DIR/h1b_data.csv"
if [ ! -f "$USCIS_CSV" ]; then
    curl -fsSL -o "$USCIS_CSV" \
        "https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-All.csv" \
        2>/dev/null || {
        echo "WARNING: Could not download USCIS H-1B data."
        echo "The visa-sponsor-check tool will return 'unknown' for all companies."
        echo "You can manually place the CSV at: $USCIS_CSV"
    }
else
    echo "    USCIS H-1B data already present, skipping download."
fi

# -- 8. Build Docker image ------------------------------------
echo "==> Building custom OpenClaw image (this takes a few minutes)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" build

# -- 9. Start everything ---------------------------------------
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
echo "2. Upload Google OAuth credentials:"
echo "   scp client_secret.json user@vps:$CONFIG_DIR/client_secret.json"
echo "   sudo chown 1000:1000 $CONFIG_DIR/client_secret.json"
echo ""
echo "3. Start the server:"
echo "   cd $SCRIPT_DIR && docker compose up -d"
echo ""
echo "4. Check logs:"
echo "   docker compose logs -f"
echo ""
echo "5. Add Telegram channel:"
echo "   docker compose exec openclaw-gateway openclaw channels add --channel telegram --token <your-bot-token>"
echo ""
echo "6. One-time Google OAuth (from your laptop):"
echo "   ssh -L 9753:localhost:9753 user@<vps-ip>"
echo "   docker compose exec openclaw-gateway openclaw plugins config omniclaw"
echo ""
echo "7. Send a message to your Telegram bot to pair!"
echo ""
echo "Config: $CONFIG_DIR"
echo "Workspace: $WORKSPACE_DIR"
echo "Gateway: http://localhost:18789"
echo ""
