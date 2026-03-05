# Hetzner CX23 Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy OpenClaw Gateway + Omniclaw plugin on a Hetzner CX23 VPS, accessible via Telegram, with Google Workspace tools and web browsing.

**Architecture:** Single Docker container running the OpenClaw Gateway with baked-in Omniclaw plugin and Chromium. Persistent state on host volumes. Telegram as the chat interface. Anthropic as LLM provider.

**Tech Stack:** Docker, Docker Compose, OpenClaw (Node.js), Omniclaw plugin (TypeScript), Chromium/Playwright, grammY (Telegram)

---

### Task 1: Create .env.example

**Files:**
- Create: `.env.example`

**Step 1: Write .env.example**

```bash
# =============================================================
# OpenClaw + Omniclaw — Hetzner CX23 Deployment
# =============================================================
# Copy to .env and fill in your values:
#   cp .env.example .env
#   nano .env
#
# Generate a gateway token:
#   openssl rand -hex 32
# =============================================================

# -------------------------------------------------------
# Gateway Authentication
# -------------------------------------------------------
# Required. Long random token to protect the Gateway API.
OPENCLAW_GATEWAY_TOKEN=

# Bind to all interfaces so Docker port mapping works.
# Security comes from the token, not network binding.
OPENCLAW_GATEWAY_BIND=lan

# -------------------------------------------------------
# Model Provider (set at least one)
# -------------------------------------------------------
ANTHROPIC_API_KEY=

# Optional: additional providers
# OPENAI_API_KEY=
# GEMINI_API_KEY=

# -------------------------------------------------------
# Telegram Bot
# -------------------------------------------------------
# Create a bot via @BotFather on Telegram, paste the token here.
TELEGRAM_BOT_TOKEN=

# -------------------------------------------------------
# Google Workspace (Omniclaw Plugin)
# -------------------------------------------------------
# Path to your Google Cloud OAuth client_secret.json.
# Place the file at: ./config/client_secret.json
# It gets mounted into the container automatically.
# Leave this default unless you change the mount path.
OMNICLAW_CLIENT_SECRET_PATH=/home/node/.openclaw/client_secret.json

# Where OAuth tokens are stored (inside container, persisted via volume).
OMNICLAW_TOKENS_PATH=/home/node/.openclaw/omniclaw-tokens.json

# -------------------------------------------------------
# GitHub (Optional)
# -------------------------------------------------------
# Personal Access Token for GitHub tools.
# GITHUB_TOKEN=

# -------------------------------------------------------
# Host Paths (usually no change needed)
# -------------------------------------------------------
OPENCLAW_CONFIG_DIR=/opt/openclaw/config
OPENCLAW_WORKSPACE_DIR=/opt/openclaw/workspace
```

**Step 2: Verify the file exists**

Run: `cat .env.example | head -5`
Expected: First 5 lines of the file.

**Step 3: Commit**

```bash
git add .env.example
git commit -m "feat: add .env.example with all deployment secrets"
```

---

### Task 2: Create Dockerfile

**Files:**
- Create: `Dockerfile`

**Step 1: Write the Dockerfile**

```dockerfile
# =============================================================
# OpenClaw + Omniclaw — Custom Image
# =============================================================
# Extends the official OpenClaw image with:
#   - Chromium + Xvfb (for web browsing)
#   - Omniclaw plugin (Google Workspace + GitHub tools)
# =============================================================

FROM ghcr.io/openclaw/openclaw:latest

# ── Install Chromium + Xvfb for browser automation ──────────
# Adds ~300MB but eliminates 60-90s Playwright install per start.
USER root
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        xvfb git && \
    mkdir -p /home/node/.cache/ms-playwright && \
    PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright \
        node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
    chown -R node:node /home/node/.cache/ms-playwright && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# ── Install Omniclaw plugin ────────────────────────────────
# Clone into the global extensions directory so OpenClaw discovers it
# automatically via its plugin discovery system.
USER node
RUN mkdir -p /home/node/.openclaw/extensions && \
    git clone --depth 1 https://github.com/mxy680/omniclaw.git \
        /home/node/.openclaw/extensions/omniclaw && \
    cd /home/node/.openclaw/extensions/omniclaw && \
    npm install --production && \
    npx tsc || true

# Fix permissions for plugin directory
USER root
RUN find /home/node/.openclaw/extensions -type d -exec chmod 755 {} + && \
    find /home/node/.openclaw/extensions -type f -exec chmod 644 {} + && \
    chown -R node:node /home/node/.openclaw/extensions

# ── Runtime ─────────────────────────────────────────────────
USER node
ENV NODE_ENV=production

CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
```

**Step 2: Verify the file**

Run: `head -20 Dockerfile`
Expected: FROM line and comments visible.

**Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: add Dockerfile extending OpenClaw with Chromium and Omniclaw"
```

---

### Task 3: Create docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

**Step 1: Write docker-compose.yml**

```yaml
services:
  openclaw-gateway:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      HOME: /home/node
      TERM: xterm-256color
      # Gateway auth
      OPENCLAW_GATEWAY_TOKEN: ${OPENCLAW_GATEWAY_TOKEN}
      OPENCLAW_GATEWAY_BIND: ${OPENCLAW_GATEWAY_BIND:-lan}
      # Model provider
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
      # Telegram
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}
      # GitHub (optional)
      GITHUB_TOKEN: ${GITHUB_TOKEN:-}
      # Playwright browser path
      PLAYWRIGHT_BROWSERS_PATH: /home/node/.cache/ms-playwright
    volumes:
      - ${OPENCLAW_CONFIG_DIR:-/opt/openclaw/config}:/home/node/.openclaw
      - ${OPENCLAW_WORKSPACE_DIR:-/opt/openclaw/workspace}:/home/node/.openclaw/workspace
    ports:
      # Expose only on localhost. Access via SSH port forward.
      - "127.0.0.1:18789:18789"
    init: true
    restart: unless-stopped
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:18789/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 30s
    # Memory limit as safety net on 4GB VPS
    deploy:
      resources:
        limits:
          memory: 3G
```

**Step 2: Verify YAML is valid**

Run: `docker compose config --quiet 2>&1 || echo "compose not available locally, will validate on VPS"`

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose.yml for single-service OpenClaw deployment"
```

---

### Task 4: Create Gateway config template

**Files:**
- Create: `config/openclaw.json`

**Step 1: Write openclaw.json**

This is the OpenClaw Gateway configuration that gets mounted into `/home/node/.openclaw/openclaw.json`.

```json
{
  "gateway": {
    "mode": "local",
    "bind": "lan",
    "auth": {
      "token": ""
    }
  },
  "providers": {
    "default": "anthropic",
    "anthropic": {
      "model": "claude-sonnet-4-6"
    }
  },
  "channels": {
    "telegram": {
      "enabled": true
    }
  },
  "plugins": {
    "omniclaw": {
      "enabled": true,
      "config": {
        "client_secret_path": "/home/node/.openclaw/client_secret.json",
        "tokens_path": "/home/node/.openclaw/omniclaw-tokens.json"
      }
    }
  }
}
```

**Note:** The `gateway.auth.token` is intentionally empty here — it gets set by `setup.sh` or read from the `OPENCLAW_GATEWAY_TOKEN` env var at runtime. OpenClaw resolves tokens from env vars first.

**Step 2: Verify JSON is valid**

Run: `python3 -c "import json; json.load(open('config/openclaw.json')); print('Valid JSON')" || node -e "JSON.parse(require('fs').readFileSync('config/openclaw.json','utf8')); console.log('Valid JSON')"`

**Step 3: Commit**

```bash
git add config/openclaw.json
git commit -m "feat: add OpenClaw Gateway config template"
```

---

### Task 5: Create agents.json config

**Files:**
- Create: `config/agents.json`

**Step 1: Write agents.json**

This defines the AI agent that will handle your Telegram tasks.

```json
{
  "version": 1,
  "agents": [
    {
      "id": "assistant",
      "name": "Assistant",
      "role": "Personal AI Assistant",
      "systemPrompt": "You are a personal AI assistant available 24/7 via Telegram. You help with email management (Gmail), calendar scheduling, file management (Google Drive), document editing (Docs, Sheets, Slides), YouTube research, GitHub workflows, and web browsing. Be concise in Telegram messages. When completing a task, summarize what you did. If a task is ambiguous, ask for clarification before proceeding.",
      "colorName": "blue",
      "permissions": {
        "services": [
          "gmail",
          "calendar",
          "drive",
          "docs",
          "sheets",
          "slides",
          "youtube",
          "github",
          "schedule"
        ]
      },
      "workspace": "/home/node/.openclaw/workspace"
    }
  ]
}
```

**Step 2: Verify JSON is valid**

Run: `python3 -c "import json; json.load(open('config/agents.json')); print('Valid JSON')" || node -e "JSON.parse(require('fs').readFileSync('config/agents.json','utf8')); console.log('Valid JSON')"`

**Step 3: Commit**

```bash
git add config/agents.json
git commit -m "feat: add agent config with full Google Workspace + GitHub permissions"
```

---

### Task 6: Create setup.sh

**Files:**
- Create: `setup.sh`

**Step 1: Write setup.sh**

```bash
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

# ── 1. System updates ─────────────────────────────────────
echo "==> Updating system packages..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# ── 2. Install Docker ─────────────────────────────────────
if command -v docker &>/dev/null; then
    echo "==> Docker already installed: $(docker --version)"
else
    echo "==> Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
    echo "==> Docker installed. You may need to log out and back in for group changes."
fi

# Verify Docker Compose
if ! docker compose version &>/dev/null; then
    echo "ERROR: Docker Compose v2 not available. Install Docker Desktop or docker-compose-plugin."
    exit 1
fi
echo "==> Docker Compose: $(docker compose version --short)"

# ── 3. Create persistent directories ─────────────────────
echo "==> Creating persistent directories..."
sudo mkdir -p "$CONFIG_DIR"
sudo mkdir -p "$WORKSPACE_DIR"
sudo mkdir -p "$CONFIG_DIR/extensions"
sudo mkdir -p "$CONFIG_DIR/agents"
# OpenClaw container runs as uid 1000 (node user)
sudo chown -R 1000:1000 "$CONFIG_DIR" "$WORKSPACE_DIR"

# ── 4. Set up .env ────────────────────────────────────────
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

# ── 5. Copy config templates ─────────────────────────────
echo "==> Copying config templates..."
if [ ! -f "$CONFIG_DIR/openclaw.json" ]; then
    cp "$SCRIPT_DIR/config/openclaw.json" "$CONFIG_DIR/openclaw.json"
    sudo chown 1000:1000 "$CONFIG_DIR/openclaw.json"
fi
if [ ! -f "$CONFIG_DIR/agents.json" ]; then
    cp "$SCRIPT_DIR/config/agents.json" "$CONFIG_DIR/agents.json"
    sudo chown 1000:1000 "$CONFIG_DIR/agents.json"
fi

# ── 6. Check for client_secret.json ──────────────────────
if [ ! -f "$CONFIG_DIR/client_secret.json" ]; then
    echo ""
    echo "WARNING: No client_secret.json found at $CONFIG_DIR/client_secret.json"
    echo "  Google Workspace tools won't work without it."
    echo "  Upload your Google Cloud OAuth client secret:"
    echo "    scp client_secret.json user@vps:$CONFIG_DIR/client_secret.json"
    echo "    sudo chown 1000:1000 $CONFIG_DIR/client_secret.json"
    echo ""
fi

# ── 7. Set up swap (safety net for 4GB VPS) ──────────────
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

# ── 8. Build Docker image ────────────────────────────────
echo "==> Building custom OpenClaw image (this takes a few minutes)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" build

# ── 9. Start everything ──────────────────────────────────
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
```

**Step 2: Make it executable**

Run: `chmod +x setup.sh`

**Step 3: Commit**

```bash
git add setup.sh
git commit -m "feat: add one-command VPS setup script"
```

---

### Task 7: Create .gitignore

**Files:**
- Create: `.gitignore`

**Step 1: Write .gitignore**

```
# Secrets
.env
config/client_secret.json
config/omniclaw-tokens.json

# OS
.DS_Store
Thumbs.db

# Docker
docker-compose.override.yml
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "feat: add .gitignore for secrets and OS files"
```

---

### Task 8: Create README with deployment instructions

**Files:**
- Create: `README.md`

**Step 1: Write README.md**

```markdown
# OpenClaw + Omniclaw — Hetzner Deployment

Personal AI assistant accessible via Telegram with Google Workspace, GitHub, and web browsing tools.

## What This Does

- **Telegram bot** that responds to your messages 24/7
- **Gmail**: search, read, send, reply, forward, manage labels
- **Google Calendar**: create, update, delete events, check availability
- **Google Drive**: upload, download, organize, share files
- **Google Docs/Sheets/Slides**: create, edit, export documents
- **YouTube**: search, get transcripts, channel info
- **GitHub**: issues, PRs, repos, actions, and more (95 tools)
- **Web browsing**: Chromium-powered page navigation and scraping

## Prerequisites

- Hetzner CX23 VPS (or similar: Ubuntu, 4GB+ RAM)
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Anthropic API Key (from [console.anthropic.com](https://console.anthropic.com))
- Google Cloud OAuth credentials (`client_secret.json`)

## Quick Start

```bash
# On your VPS:
git clone https://github.com/<your-user>/omniclaw-deploy.git
cd omniclaw-deploy
chmod +x setup.sh
./setup.sh

# Edit secrets:
nano .env

# Upload Google OAuth credentials:
# (from your laptop)
scp client_secret.json user@vps:/opt/openclaw/config/

# Start:
docker compose up -d

# Add Telegram:
docker compose exec openclaw-gateway \
  openclaw channels add --channel telegram --token $TELEGRAM_BOT_TOKEN

# One-time Google OAuth (from laptop):
ssh -L 9753:localhost:9753 user@vps
docker compose exec openclaw-gateway openclaw plugins config omniclaw
```

## Architecture

Single Docker container running OpenClaw Gateway with the Omniclaw plugin baked in.

See `docs/plans/2026-03-04-hetzner-deployment-design.md` for the full design.

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Custom image: OpenClaw + Chromium + Omniclaw |
| `docker-compose.yml` | Container orchestration |
| `.env.example` | Secrets template |
| `setup.sh` | One-command VPS provisioner |
| `config/openclaw.json` | Gateway configuration |
| `config/agents.json` | Agent definition + permissions |

## Maintenance

```bash
# View logs
docker compose logs -f

# Restart
docker compose restart

# Update OpenClaw base image
docker compose build --pull
docker compose up -d

# Update Omniclaw plugin (rebuilds image)
docker compose build --no-cache
docker compose up -d

# Health check
curl -s http://localhost:18789/healthz
```
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "feat: add README with deployment instructions"
```

---

### Task 9: Initialize git repo and push

**Step 1: Initialize git**

```bash
cd /Users/thorbthorb/Downloads/omniclaw
git init
git add -A
git log --oneline  # verify commits
```

**Step 2: Verify all files are present**

Run: `ls -la` — expect to see:
- `.env.example`
- `.gitignore`
- `Dockerfile`
- `docker-compose.yml`
- `setup.sh`
- `README.md`
- `config/openclaw.json`
- `config/agents.json`
- `docs/plans/` (design doc + this plan)

**Step 3: Final commit if any unstaged changes**

```bash
git add -A
git commit -m "feat: complete Hetzner deployment scaffolding"
```

---

### Task 10: Validate deployment locally (smoke test)

**Step 1: Validate docker-compose.yml**

Run: `docker compose config --quiet`
Expected: No errors.

**Step 2: Validate Dockerfile builds**

Run: `docker compose build` (if Docker is available)
Expected: Image builds successfully.

**Step 3: Test health check**

Run: `docker compose up -d && sleep 10 && curl -s http://localhost:18789/healthz`
Expected: `{"status":"ok"}` or similar.

**Step 4: Tear down**

Run: `docker compose down`
