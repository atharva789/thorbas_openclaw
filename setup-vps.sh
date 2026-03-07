#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# OpenClaw + Omniclaw — VPS Setup Script
# =============================================================
# Tested on: Ubuntu 22.04+ (any US-based VPS, 2+ vCPU, 4GB+ RAM)
#
# Recommended cheapest option: Hetzner CX22 (Ashburn, VA)
#   - 2 vCPU / 4 GB RAM / 40 GB disk — ~$4.35/mo
#   - https://www.hetzner.com/cloud/
#
# Usage:
#   git clone https://github.com/atharva789/thorbas_openclaw.git
#   cd thorbas_openclaw
#   chmod +x setup-vps.sh && ./setup-vps.sh
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="/opt/openclaw/config"
WORKSPACE_DIR="/opt/openclaw/workspace"

echo "=============================================="
echo "  OpenClaw + Omniclaw — VPS Setup"
echo "=============================================="
echo ""

# -- 0. Preflight checks --------------------------------------
echo "==> Preflight checks..."
TOTAL_MEM_MB=$(free -m 2>/dev/null | awk '/Mem:/{print $2}' || echo 0)
if [ "$TOTAL_MEM_MB" -gt 0 ] && [ "$TOTAL_MEM_MB" -lt 3500 ]; then
    echo "WARNING: Only ${TOTAL_MEM_MB}MB RAM detected. 4GB+ recommended."
    echo "         Chromium + Node can OOM on low-memory machines."
    echo ""
fi

# -- 1. System updates ----------------------------------------
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
    echo "    If 'docker compose' fails below, run: newgrp docker && ./setup-vps.sh"
fi

# Verify Docker Compose
if ! docker compose version &>/dev/null; then
    echo "ERROR: Docker Compose v2 not available. Install docker-compose-plugin."
    exit 1
fi
echo "==> Docker Compose: $(docker compose version --short)"

# -- 3. Create persistent directories -------------------------
echo "==> Creating persistent directories..."
sudo mkdir -p "$CONFIG_DIR" "$WORKSPACE_DIR" "$CONFIG_DIR/extensions" "$CONFIG_DIR/agents"
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
    echo "NOTE: No client_secret.json found at $CONFIG_DIR/client_secret.json"
    echo "  Google Workspace tools (Gmail, Calendar, Forms, etc.) need it."
    echo "  Upload from your laptop:"
    echo "    scp client_secret.json user@<vps-ip>:$CONFIG_DIR/client_secret.json"
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

# -- 8. Download USCIS H-1B Employer Data ---------------------
echo "==> Downloading USCIS H-1B employer data..."
USCIS_DIR="$WORKSPACE_DIR/uscis"
sudo mkdir -p "$USCIS_DIR"
sudo chown 1000:1000 "$USCIS_DIR"
USCIS_CSV="$USCIS_DIR/h1b_data.csv"
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
        echo "WARNING: Could not download USCIS data. visa-sponsor-check will return 'unknown'."
    else
        sudo chown 1000:1000 "$USCIS_CSV"
        echo "    Saved to $USCIS_CSV"
    fi
else
    echo "    Already present, skipping."
fi

# -- 9. Build Docker images -----------------------------------
echo "==> Building Docker images (first run takes 5-10 min)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" build

# -- 10. Enable auto-restart on reboot ------------------------
echo "==> Enabling Docker auto-start on boot..."
sudo systemctl enable docker 2>/dev/null || true

# -- Done! -----------------------------------------------------
echo ""
echo "=============================================="
echo "  Setup complete!"
echo "=============================================="
echo ""
echo "NEXT STEPS:"
echo ""
echo "1. Edit .env with your API keys:"
echo "   nano $SCRIPT_DIR/.env"
echo "   # Required: ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN"
echo "   # Optional: GEMINI_API_KEY (cheaper fallback)"
echo ""
echo "2. Upload Google OAuth credentials (from your laptop):"
echo "   scp client_secret.json user@<vps-ip>:$CONFIG_DIR/"
echo "   ssh user@<vps-ip> 'sudo chown 1000:1000 $CONFIG_DIR/client_secret.json'"
echo ""
echo "3. Start:"
echo "   cd $SCRIPT_DIR && docker compose up -d"
echo ""
echo "4. One-time Google OAuth (from your laptop):"
echo "   ssh -L 9753:localhost:9753 user@<vps-ip>"
echo "   # Then on the VPS:"
echo "   docker compose exec -it openclaw-gateway node /usr/local/bin/google-oauth-setup.js"
echo "   # Open the URL it prints in your local browser"
echo ""
echo "5. Send a message to your Telegram bot to pair!"
echo ""
echo "Logs:      docker compose logs -f"
echo "Restart:   docker compose restart"
echo "Config:    $CONFIG_DIR"
echo "Workspace: $WORKSPACE_DIR"
echo "Gateway:   http://localhost:18789"
echo ""
