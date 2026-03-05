# OpenClaw + Omniclaw: Hetzner CX23 Deployment Design

**Date:** 2026-03-04
**Status:** Draft

## Goal

Deploy a 24/7 personal AI automation server on a Hetzner CX23 VPS (Ubuntu, 4GB RAM) that you can interact with by texting a Telegram bot. The agent handles Gmail, Google Calendar/Drive/Docs/Sheets/Slides, YouTube, GitHub, and web browsing.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Hetzner CX23 VPS                   │
│              Ubuntu 24.04, 4GB RAM              │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │    Docker Container (single process)      │  │
│  │    Image: custom, based on               │  │
│  │    ghcr.io/openclaw/openclaw:latest       │  │
│  │                                           │  │
│  │  OpenClaw Gateway (:18789)                │  │
│  │    ├── Telegram Channel (grammY)          │  │
│  │    ├── Omniclaw Plugin (baked in)         │  │
│  │    │    ├── Gmail (20 tools)              │  │
│  │    │    ├── Calendar (11 tools)           │  │
│  │    │    ├── Drive (15 tools)              │  │
│  │    │    ├── Docs (8 tools)               │  │
│  │    │    ├── Sheets (11 tools)            │  │
│  │    │    ├── Slides (9 tools)             │  │
│  │    │    ├── YouTube (10 tools)            │  │
│  │    │    └── GitHub (95 tools)             │  │
│  │    ├── Browser (Chromium + Playwright)     │  │
│  │    ├── Agent config (agents.json)          │  │
│  │    └── Scheduler (cron jobs)               │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  Host volumes:                                  │
│    /opt/openclaw/config/  → container config    │
│    /opt/openclaw/workspace/ → agent artifacts   │
└─────────────────────────────────────────────────┘
         │
         │ Telegram Bot API (outbound HTTPS)
         ▼
    Telegram Servers ←→ Your Phone
```

## Components

### 1. Dockerfile

Extends `ghcr.io/openclaw/openclaw:latest`:
- Installs Chromium + Xvfb via `OPENCLAW_INSTALL_BROWSER=1` build arg (~300MB)
- Clones and builds the omniclaw plugin (`mxy680/omniclaw`)
- Copies Google OAuth `client_secret.json` into the image
- Runs as non-root `node` user (uid 1000)

### 2. docker-compose.yml

Single service:
- `openclaw-gateway`: the main container
- Mounts `/opt/openclaw/config` → `/home/node/.openclaw`
- Mounts `/opt/openclaw/workspace` → `/home/node/.openclaw/workspace`
- Exposes port 18789 on localhost only (SSH port forward for admin)
- `restart: unless-stopped` for 24/7 uptime
- Health check via `/healthz` endpoint
- Environment: gateway token, Anthropic API key, Telegram bot token

### 3. .env.example

```
# Gateway
OPENCLAW_GATEWAY_TOKEN=       # openssl rand -hex 32
OPENCLAW_GATEWAY_BIND=lan

# Model provider
ANTHROPIC_API_KEY=sk-ant-...

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABCDEF...

# Google OAuth (path inside container)
OMNICLAW_CLIENT_SECRET_PATH=/home/node/.openclaw/client_secret.json

# Optional: GitHub
GITHUB_TOKEN=ghp_...
```

### 4. setup.sh

Single-command VPS provisioning:
1. Updates system packages
2. Installs Docker + Docker Compose
3. Clones this repo
4. Prompts for secrets (or reads from `.env`)
5. Creates persistent directories (`/opt/openclaw/{config,workspace}`)
6. Copies `client_secret.json` to config dir
7. Builds the custom Docker image
8. Starts everything with `docker compose up -d`
9. Prints instructions for Telegram pairing and Google OAuth

### 5. openclaw.json (Gateway config template)

Configures:
- Anthropic as model provider
- Telegram channel with bot token
- Omniclaw plugin path and config (client_secret_path, tokens_path)
- Agent definition (name, permissions, system prompt)

## Security

- Gateway binds to `0.0.0.0` but **requires auth token** for all requests
- Telegram access: OpenClaw's built-in DM pairing — first message triggers pairing, then only paired users can interact
- Google OAuth tokens stored in mounted volume (persistent, private)
- Container runs as non-root
- No ports exposed except 18789 (gateway) behind token auth
- SSH key auth for VPS access (no password)

## Google OAuth Flow (One-Time)

1. SSH to VPS with port forward: `ssh -L 9753:localhost:9753 user@vps`
2. Run: `docker compose exec openclaw-gateway openclaw plugins config omniclaw`
3. Browser opens on your laptop (forwarded via SSH) for Google OAuth consent
4. Tokens saved to `/opt/openclaw/config/omniclaw-tokens.json`
5. Done — tokens persist across restarts

## RAM Budget (4GB CX23)

| Component          | Estimated RAM |
|--------------------|---------------|
| OS + Docker        | ~400MB        |
| Node.js (Gateway)  | ~200MB        |
| Chromium (idle)    | ~150MB        |
| Chromium (active)  | ~300-500MB    |
| LLM API overhead   | ~50MB         |
| **Total (idle)**   | **~800MB**    |
| **Total (active)** | **~1.2GB**    |
| **Headroom**       | **~2.8GB**    |

Comfortable fit. Swap (2GB) recommended as safety net.

## Files to Create

1. `Dockerfile` — custom image extending official OpenClaw
2. `docker-compose.yml` — single-service deployment
3. `.env.example` — secrets template
4. `setup.sh` — one-command VPS provisioner
5. `config/openclaw.json` — Gateway configuration template
6. `config/agents.json` — Agent definition
