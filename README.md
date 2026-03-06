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
- **USCIS H-1B data** downloaded by `setup.sh` for visa sponsor checking
- **Google Sheets tracking** via the existing Omniclaw OAuth flow

### Setup

The `setup.sh` script automatically downloads USCIS H-1B employer data. The job scraper sidecar starts alongside the gateway via `docker-compose.yml`.

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
