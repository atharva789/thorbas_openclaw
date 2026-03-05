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
  openclaw channels add --channel telegram --token YOUR_BOT_TOKEN_HERE

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
| `entrypoint.sh` | Syncs baked-in plugin to mounted volume on boot |

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
