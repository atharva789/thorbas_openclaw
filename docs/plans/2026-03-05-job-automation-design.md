# Job Automation Tools — Design Document

**Date:** 2026-03-05
**Status:** Approved

## Goal

Add job search, application, and tracking tools to Omniclaw so the agent can: discover job openings (YC, HN, Indeed, Glassdoor, Google Jobs), check visa sponsorship status, submit applications via ATS APIs (Greenhouse, Lever, Ashby), and track everything in a Google Sheet — all triggered by a Telegram message.

## Decisions

- **Skip LinkedIn:** No LinkedIn automation (ToS violation, ban risk)
- **ATS auth:** Auto-detect board tokens from career page URLs
- **Resume storage:** Google Drive (primary) + local cache in workspace
- **Application tracking:** Auto-log to specific Google Sheet (`1EHOO6p87ERIgvmTkiSbn9kG__lSeStpwf8uV4Y-soS4`) + Telegram summary
- **Visa filtering:** Soft — flag companies with ✅ confirmed / ⚠️ unknown / ❌ denied, don't exclude

## Architecture

Two containers: OpenClaw Gateway (TypeScript tools) + Python sidecar (JobSpy scraper).

```
OpenClaw Gateway Container
  └── Omniclaw Plugin
       ├── Existing tools (Gmail, Sheets, Drive, etc.)
       ├── NEW: ATS Apply Tools (7 tools)
       │    ├── ats-detect
       │    ├── greenhouse-jobs / greenhouse-apply
       │    ├── lever-jobs / lever-apply
       │    └── ashby-jobs / ashby-apply
       ├── NEW: Job Discovery Tools (3 tools)
       │    ├── yc-companies
       │    ├── hn-hiring-search
       │    └── visa-sponsor-check
       ├── NEW: Job Tracking (1 tool)
       │    └── job-tracker-log
       └── NEW: Scraper Bridge (1 tool)
            └── jobspy-search (calls Python sidecar)

Python Sidecar Container (FastAPI + JobSpy)
  ├── POST /scrape/jobs (multi-site search)
  ├── POST /scrape/career-page (ATS detection)
  └── GET /health
```

## Component Details

### ATS Apply Tools (TypeScript)

#### ats-detect
- **Input:** `{ url: string }` — a company careers page URL
- **Logic:** Fetch the page HTML, search for known ATS patterns:
  - `boards.greenhouse.io/{token}` or `<script>` referencing Greenhouse
  - `jobs.lever.co/{site}` or Lever embed scripts
  - `jobs.ashbyhq.com/{name}` or Ashby embed scripts
  - `apply.workable.com/{name}` for Workable (list-only, no apply API)
- **Output:** `{ ats: "greenhouse"|"lever"|"ashby"|"workable"|"unknown", board_token: string, careers_url: string }`
- **Fallback:** If fetch fails, try the Python sidecar's `/scrape/career-page`

#### greenhouse-jobs
- **Input:** `{ board_token: string, query?: string, location?: string, department?: string }`
- **Endpoint:** `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`
- **Output:** Array of `{ id, title, location, department, description_snippet, questions_url }`
- **Fetch questions:** `GET .../jobs/{id}?questions=true` to get required application fields

#### greenhouse-apply
- **Input:** `{ board_token: string, job_id: number, first_name: string, last_name: string, email: string, phone?: string, resume_path?: string, cover_letter?: string, answers?: Record<string, string> }`
- **Endpoint:** `POST https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}`
- **Auth:** Basic Auth (board API key as username). Key auto-extracted from board's embed script or configured.
- **Content-Type:** `multipart/form-data` (for resume upload)
- **Output:** `{ success: boolean, application_id?: string, error?: string }`
- **Note:** Greenhouse doesn't validate required fields server-side, but we should.

#### lever-jobs
- **Input:** `{ site_name: string, location?: string, team?: string, commitment?: string }`
- **Endpoint:** `GET https://api.lever.co/v0/postings/{site}?mode=json`
- **Output:** Array of `{ id, text (title), categories, description_snippet, apply_url }`

#### lever-apply
- **Input:** `{ site_name: string, posting_id: string, name: string, email: string, phone?: string, resume_path?: string, urls?: Record<string, string>, comments?: string }`
- **Endpoint:** `POST https://api.lever.co/v0/postings/{site}/{id}?key={key}`
- **Rate limit:** Max 2 req/sec. Tool enforces this internally.
- **Output:** `{ ok: boolean, applicationId?: string, error?: string }`

#### ashby-jobs
- **Input:** `{ board_name: string, include_compensation?: boolean }`
- **Endpoint:** `GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true`
- **Output:** Array of `{ id, title, location, department, compensation, employment_type }`

#### ashby-apply
- **Input:** `{ job_posting_id: string, first_name: string, last_name: string, email: string, phone?: string, resume_path?: string, linkedin_url?: string, form_answers?: Record<string, string> }`
- **Endpoint:** `POST https://api.ashbyhq.com/applicationForm.submit`
- **Auth:** Basic Auth (API key)
- **Content-Type:** `multipart/form-data`
- **Output:** `{ success: boolean, applicationId?: string, error?: string }`

### Job Discovery Tools (TypeScript)

#### yc-companies
- **Input:** `{ hiring_only?: boolean, batch?: string, industry?: string, tag?: string, query?: string }`
- **Endpoint:** `https://yc-oss.github.io/api/companies/hiring.json` (or filtered endpoints)
- **Output:** Array of `{ name, url, description, batch, industry, tags, is_hiring, team_size }`
- **No auth, no rate limit** (static JSON files on GitHub Pages)

#### hn-hiring-search
- **Input:** `{ query: string, months_back?: number }`
- **Logic:**
  1. Search for latest "Who is hiring?" story via Algolia
  2. Fetch all comments from that story
  3. Filter comments matching query (e.g., "intern", "visa", "sponsor", "H-1B")
- **Endpoint:** `GET https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_{id}&query={query}`
- **Rate limit:** 10,000 req/hr
- **Output:** Array of `{ company_guess, text_snippet, full_text, posted_at, hn_url }`

#### visa-sponsor-check
- **Input:** `{ company_name: string }`
- **Logic:**
  1. Search local USCIS H-1B CSV data (downloaded during setup) for company name
  2. Return petition counts, approval/denial rates
  3. If no match, return "unknown"
- **Data source:** USCIS H-1B Employer Data Hub CSV, stored at `~/.openclaw/workspace/uscis/h1b_data.csv`
- **Output:** `{ status: "confirmed"|"unknown"|"denied_history", petitions_filed?: number, approval_rate?: number, most_recent_year?: number }`

### Job Tracking (TypeScript)

#### job-tracker-log
- **Input:** `{ company: string, role: string, ats: string, url: string, status?: string, notes?: string }`
- **Logic:** Uses existing Sheets API (googleapis) to append a row to the configured sheet
- **Sheet ID:** `1EHOO6p87ERIgvmTkiSbn9kG__lSeStpwf8uV4Y-soS4` (stored in plugin config)
- **Columns:** Date Applied | Company | Role | ATS | Status | URL | Visa Sponsor | Notes
- **Output:** `{ success: boolean, row_number: number }`

### Python Sidecar (FastAPI + JobSpy)

#### Service: `job-scraper`
- **Image:** Python 3.12-slim + FastAPI + python-jobspy
- **Port:** 8787 (internal only, not exposed to host)
- **Memory limit:** 512MB

#### POST /scrape/jobs
- **Input:** `{ search_term: string, location?: string, sites?: string[], results_wanted?: number, hours_old?: number }`
- **Sites:** `["indeed", "glassdoor", "google", "zip_recruiter"]` (no LinkedIn)
- **Output:** Array of `{ title, company, location, url, date_posted, description_snippet, salary }`
- **Uses:** `python-jobspy` library (concurrent multi-site scraping)

#### POST /scrape/career-page
- **Input:** `{ url: string }`
- **Logic:** Fetch the career page, detect ATS from URL patterns and page content
- **Output:** `{ ats: string, board_token: string }`

### Updated docker-compose.yml

```yaml
services:
  openclaw-gateway:
    # ... existing config ...
    environment:
      # ... existing vars ...
      JOB_SCRAPER_URL: http://job-scraper:8787
      JOB_TRACKER_SHEET_ID: "1EHOO6p87ERIgvmTkiSbn9kG__lSeStpwf8uV4Y-soS4"
    depends_on:
      job-scraper:
        condition: service_healthy

  job-scraper:
    build:
      context: ./scraper
      dockerfile: Dockerfile
    restart: unless-stopped
    expose:
      - "8787"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8787/health')"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    deploy:
      resources:
        limits:
          memory: 512M
```

## Files to Create

### In Omniclaw plugin repo (mxy680/omniclaw)

1. `src/tools/jobs-ats-detect.ts` — ATS detection from career URLs
2. `src/tools/jobs-greenhouse.ts` — Greenhouse list + apply tools
3. `src/tools/jobs-lever.ts` — Lever list + apply tools
4. `src/tools/jobs-ashby.ts` — Ashby list + apply tools
5. `src/tools/jobs-yc.ts` — YC companies discovery
6. `src/tools/jobs-hn-hiring.ts` — HN Who's Hiring search
7. `src/tools/jobs-visa-check.ts` — USCIS H-1B sponsor lookup
8. `src/tools/jobs-tracker.ts` — Google Sheet application logger
9. `src/tools/jobs-scraper-bridge.ts` — Calls Python sidecar
10. `src/mcp/tool-registry.ts` — Updated to register new tools

### In deployment repo (this repo)

11. `scraper/Dockerfile` — Python sidecar image
12. `scraper/main.py` — FastAPI app with JobSpy endpoints
13. `scraper/requirements.txt` — Python dependencies
14. `docker-compose.yml` — Updated with job-scraper service
15. `setup.sh` — Updated to download USCIS CSV data
16. `.env.example` — Updated with new env vars

## RAM Budget (Updated for 4GB VPS)

| Component           | Estimated RAM |
|---------------------|---------------|
| OS + Docker         | ~400MB        |
| Node.js (Gateway)   | ~250MB        |
| Chromium (idle)     | ~150MB        |
| Python sidecar      | ~200MB        |
| **Total (idle)**    | **~1.0GB**    |
| **Total (active)**  | **~1.8GB**    |
| **Headroom**        | **~2.2GB**    |

Still fits in 4GB with swap.
