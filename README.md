# OpenClaw + Omniclaw

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

- **Either** a Hetzner CX23 VPS (Ubuntu, 4GB+ RAM) **or** a Mac with Docker Desktop
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Anthropic API Key (from [console.anthropic.com](https://console.anthropic.com))
- Google Cloud OAuth credentials (`client_secret.json`)
- For Mac: [ngrok](https://ngrok.com) with an auth token (so Telegram can reach you)

## Quick Start — macOS

```bash
git clone https://github.com/atharva789/thorbas_openclaw.git
cd thorbas_openclaw
chmod +x setup-mac.sh
./setup-mac.sh

# Edit secrets:
nano .env

# Copy Google OAuth credentials:
cp /path/to/client_secret.json local-config/

# Start:
docker compose up -d

# One-time Google OAuth — run directly in the container (no agent timeout):
docker compose exec -it openclaw-gateway node /usr/local/bin/google-oauth-setup.js
# Open the printed URL in your browser, sign in, grant access.
# The script exits automatically once tokens are saved.

# Start ngrok tunnel (for Telegram):
ngrok http 18789

# Add Telegram:
docker compose exec openclaw-gateway \
  openclaw channels add --channel telegram --token YOUR_BOT_TOKEN

# Keep Mac awake:
caffeinate -dims
```

## Quick Start — Ubuntu VPS (Hetzner CX23)

```bash
git clone https://github.com/atharva789/thorbas_openclaw.git
cd thorbas_openclaw
chmod +x setup-vps.sh
./setup-vps.sh

# Edit secrets:
nano .env

# Upload Google OAuth credentials (from your laptop):
scp client_secret.json user@vps:/opt/openclaw/config/

# Start:
docker compose up -d

# Add Telegram:
docker compose exec openclaw-gateway \
  openclaw channels add --channel telegram --token YOUR_BOT_TOKEN

# One-time Google OAuth — SSH-tunnel port 9753, then run the CLI script:
ssh -L 9753:localhost:9753 user@<vps-ip>
# In a second terminal (still on your laptop):
docker compose exec -it openclaw-gateway node /usr/local/bin/google-oauth-setup.js
# Open the printed URL in your browser, sign in, grant access.
# The script exits automatically once tokens are saved.
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
| `setup-mac.sh` | macOS setup (Docker Desktop + ngrok) |
| `setup-vps.sh` | Ubuntu VPS setup (Hetzner CX23) |
| `config/openclaw.json` | Gateway configuration |
| `config/agents.json` | Agent definition + permissions |
| `entrypoint.sh` | Syncs baked-in plugin to mounted volume on boot |

## Job Automation Tools

12 tools for automated job search, ATS application submission, visa sponsorship checking, and tracking — designed for F-1 visa international students.

### Tools

| Tool | Description |
|------|-------------|
| `jobs_ats_detect` | Detect ATS (Greenhouse/Lever/Ashby) from a careers page URL |
| `jobs_greenhouse_list` | List open jobs from a Greenhouse board |
| `jobs_greenhouse_apply` | Submit application via Greenhouse API |
| `jobs_lever_list` | List open jobs from a Lever career site |
| `jobs_lever_apply` | Submit application via Lever API |
| `jobs_ashby_list` | List open jobs from Ashby board |
| `jobs_ashby_apply` | Submit application via Ashby API |
| `jobs_yc_companies` | Discover YC companies (optionally hiring-only) |
| `jobs_hn_hiring_search` | Search HN "Who is hiring?" threads |
| `jobs_visa_sponsor_check` | Check H-1B sponsorship history via USCIS data |
| `jobs_tracker_log` | Log applications to Google Sheets tracker |
| `jobs_scraper_search` | Search Indeed/Glassdoor/Google Jobs via sidecar |

### Architecture

- **TypeScript tools** in `plugin-src/` follow the Omniclaw factory-function + TypeBox pattern
- **Python sidecar** (`scraper/`) runs FastAPI + JobSpy for multi-site scraping
- **USCIS H-1B data** downloaded by setup scripts for visa sponsor checking
- **Google Sheets tracking** via the existing Omniclaw OAuth flow

### Setup

Both `setup-mac.sh` and `setup-vps.sh` automatically download USCIS H-1B employer data. The job scraper sidecar starts alongside the gateway via `docker-compose.yml`.

To activate job tools in the upstream Omniclaw plugin, apply the patch references in `plugin-src/src/mcp/`:
- `tool-registry-jobs-patch.ts` — imports and registration calls
- `agent-config-jobs-patch.ts` — add `"jobs"` to `VALID_SERVICES`

### Example Telegram Commands

```
Search for software engineer intern jobs in New York
Find YC companies hiring in fintech
Check if Google sponsors H-1B visas
Apply to job 12345 on Greenhouse board acmecorp
Search HN Who's Hiring for visa sponsor positions
```

## Google OAuth

The bot's Gmail/Calendar/Drive tools require a one-time OAuth flow that must be
completed **outside the agent loop**. The `gmail_auth_setup` tool (called from
Telegram) starts an OAuth server on port 9753 inside the container, but the
LLM's 2-minute response timeout kills the agent before the browser flow can
finish, leaving the port bound until the next container restart.

**Use the CLI script instead:**

```bash
# macOS — port 9753 is already forwarded to localhost:
docker compose exec -it openclaw-gateway node /usr/local/bin/google-oauth-setup.js

# VPS — SSH-tunnel the port first, then run from a second terminal:
ssh -L 9753:localhost:9753 user@<vps-ip>
docker compose exec -it openclaw-gateway node /usr/local/bin/google-oauth-setup.js
```

The script:
1. Prints a Google auth URL — open it in your browser and grant access
2. Receives the OAuth callback on port 9753 (no timeout)
3. Saves tokens to `/home/node/.openclaw/omniclaw-tokens.json`
4. Exits cleanly

If the script fails with **port already in use** (from a previous failed attempt):

```bash
docker compose restart openclaw-gateway
docker compose exec -it openclaw-gateway node /usr/local/bin/google-oauth-setup.js
```

If Google does not issue a `refresh_token`, revoke the app at
<https://myaccount.google.com/permissions> and re-run — the script uses
`prompt: consent` which forces a new refresh token on every run.

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
