# Job Automation Tools — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 12 job search, application, and tracking tools to the Omniclaw plugin so the agent can discover openings, submit ATS applications, check visa sponsorship, and track everything via Google Sheets — plus a Python sidecar for multi-site job scraping.

**Architecture:** TypeScript tools in the Omniclaw plugin repo (`mxy680/omniclaw`) following the existing factory-function + TypeBox pattern, registered in `tool-registry.ts`. A Python FastAPI sidecar runs alongside the gateway container for JobSpy-powered scraping.

**Tech Stack:** TypeScript, `@sinclair/typebox` 0.34.x, `googleapis`, `vitest`, Python 3.12, FastAPI, `python-jobspy`, Docker

**Upstream repo:** `https://github.com/mxy680/omniclaw` (plugin source — tools go here)
**Deployment repo:** `/Users/thorbthorb/Downloads/omniclaw` (Docker orchestration — sidecar + compose changes go here)

---

## Important Context for the Implementer

### Tool Pattern (from upstream `mxy680/omniclaw`)

Every tool is a plain object returned from a factory function:

```typescript
import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createXxxTool(): any {
  return {
    name: "xxx_action",              // snake_case, prefix = service for permissions
    label: "Xxx Action",             // human-readable
    description: "...",              // LLM-facing description
    parameters: Type.Object({ ... }),// @sinclair/typebox schema
    async execute(_toolCallId: string, params: { ... }) {
      return jsonResult({ ... });    // always use shared.ts jsonResult()
    },
  };
}
```

**Key conventions:**
- Import paths use `.js` extensions (ESM with `nodenext` resolution)
- `@sinclair/typebox` Type.Object, Type.String, Type.Optional, Type.Array, Type.Boolean, Type.Number
- OAuth tools take `clientManager: OAuthClientManager` and check `clientManager.listAccounts()`
- Non-OAuth tools take no args or a plain dependency (e.g., `ScheduleStore`)
- Tool names are prefixed with a service name (e.g., `gmail_send`, `sheets_append`). The permission system uses `toolName.split("_")[0]` to determine the service
- All new job tools should use prefix `jobs` so they map to a `jobs` service
- `jsonResult(payload)` returns `{ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload }`

### Registration (tool-registry.ts)

Tools are imported and added via `add(createXxxTool(...))` inside `createAllTools()`. Job tools require no OAuth — they use public APIs and native `fetch()`.

### Testing (vitest)

- Config: `vitest.config.ts` — `tests/**/*.test.ts`, `fileParallelism: false`
- Unit tests go in `tests/unit/`
- Run: `npx vitest run tests/unit/<file>.test.ts`

### Sheets Append Pattern (for job-tracker-log)

The existing `sheets-append.ts` tool takes `clientManager`, creates a Sheets client via `google.sheets({ version: "v4", auth: client })`, and calls `sheets.spreadsheets.values.append()` with `valueInputOption: "USER_ENTERED"`.

### File Paths

All new tool files go in the **upstream plugin repo** (`mxy680/omniclaw`):
- `src/tools/jobs-*.ts` — tool source files
- `src/mcp/tool-registry.ts` — registration (modify)
- `src/mcp/agent-config.ts` — add `"jobs"` to VALID_SERVICES (modify)
- `tests/unit/jobs-*.test.ts` — unit tests

Sidecar and Docker changes go in the **deployment repo** (`/Users/thorbthorb/Downloads/omniclaw`):
- `scraper/` — Python sidecar
- `docker-compose.yml` — add sidecar service (modify)
- `setup.sh` — add USCIS data download (modify)
- `.env.example` — add new env vars (modify)
- `config/agents.json` — add `"jobs"` service permission (modify)

---

## Task 1: Python Sidecar — FastAPI + JobSpy

**Files:**
- Create: `scraper/Dockerfile`
- Create: `scraper/requirements.txt`
- Create: `scraper/main.py`

**Step 1: Create `scraper/requirements.txt`**

```
fastapi==0.115.12
uvicorn[standard]==0.34.2
python-jobspy==1.1.75
```

**Step 2: Create `scraper/main.py`**

```python
"""Job scraper sidecar — FastAPI + python-jobspy."""
from __future__ import annotations

import re
import traceback
from typing import Optional

from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="job-scraper", version="0.1.0")


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


# ── POST /scrape/jobs ─────────────────────────────────────────────────────────

class ScrapeJobsRequest(BaseModel):
    search_term: str
    location: Optional[str] = None
    sites: Optional[list[str]] = None
    results_wanted: Optional[int] = 20
    hours_old: Optional[int] = 72

class JobResult(BaseModel):
    title: str | None = None
    company: str | None = None
    location: str | None = None
    url: str | None = None
    date_posted: str | None = None
    description_snippet: str | None = None
    salary: str | None = None

@app.post("/scrape/jobs")
async def scrape_jobs(req: ScrapeJobsRequest):
    try:
        from jobspy import scrape_jobs as jobspy_scrape

        allowed_sites = {"indeed", "glassdoor", "google", "zip_recruiter"}
        sites = [s for s in (req.sites or ["indeed", "google"]) if s in allowed_sites]
        if not sites:
            sites = ["indeed", "google"]

        df = jobspy_scrape(
            site_name=sites,
            search_term=req.search_term,
            location=req.location or "",
            results_wanted=min(req.results_wanted or 20, 50),
            hours_old=req.hours_old or 72,
            country_indeed="USA",
        )

        results: list[dict] = []
        for _, row in df.iterrows():
            desc = str(row.get("description", "") or "")
            results.append({
                "title": str(row.get("title", "") or ""),
                "company": str(row.get("company_name", "") or ""),
                "location": str(row.get("location", "") or ""),
                "url": str(row.get("job_url", "") or ""),
                "date_posted": str(row.get("date_posted", "") or ""),
                "description_snippet": desc[:300] if desc else "",
                "salary": str(row.get("min_amount", "") or ""),
            })

        return {"success": True, "count": len(results), "jobs": results}
    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


# ── POST /scrape/career-page ─────────────────────────────────────────────────

class CareerPageRequest(BaseModel):
    url: str

ATS_PATTERNS = [
    (r"boards\.greenhouse\.io/(\w+)", "greenhouse"),
    (r"job-boards\.greenhouse\.io/(\w+)", "greenhouse"),
    (r"jobs\.lever\.co/([\w-]+)", "lever"),
    (r"jobs\.ashbyhq\.com/([\w-]+)", "ashby"),
    (r"apply\.workable\.com/([\w-]+)", "workable"),
]

@app.post("/scrape/career-page")
async def scrape_career_page(req: CareerPageRequest):
    try:
        import urllib.request

        headers = {"User-Agent": "Mozilla/5.0 (compatible; JobBot/1.0)"}
        request = urllib.request.Request(req.url, headers=headers)
        with urllib.request.urlopen(request, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="replace")

        # Check URL first, then page content
        for pattern, ats_name in ATS_PATTERNS:
            m = re.search(pattern, req.url)
            if m:
                return {"ats": ats_name, "board_token": m.group(1)}

        for pattern, ats_name in ATS_PATTERNS:
            m = re.search(pattern, html)
            if m:
                return {"ats": ats_name, "board_token": m.group(1)}

        return {"ats": "unknown", "board_token": ""}
    except Exception as e:
        return {"ats": "unknown", "board_token": "", "error": str(e)}


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8787)
```

**Step 3: Create `scraper/Dockerfile`**

```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 8787
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8787"]
```

**Step 4: Verify sidecar builds locally**

Run: `docker build -t job-scraper-test ./scraper`
Expected: Image builds successfully.

**Step 5: Commit**

```bash
git add scraper/
git commit -m "feat(scraper): add Python FastAPI + JobSpy sidecar"
```

---

## Task 2: Update docker-compose.yml with Sidecar Service

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add job-scraper service and update gateway**

Add to `docker-compose.yml`:
- A `job-scraper` service built from `./scraper`
- `JOB_SCRAPER_URL` and `JOB_TRACKER_SHEET_ID` env vars to gateway
- `depends_on` with health check condition

The gateway service gets these new environment variables:
```yaml
JOB_SCRAPER_URL: http://job-scraper:8787
JOB_TRACKER_SHEET_ID: ${JOB_TRACKER_SHEET_ID:-1EHOO6p87ERIgvmTkiSbn9kG__lSeStpwf8uV4Y-soS4}
```

And a `depends_on`:
```yaml
depends_on:
  job-scraper:
    condition: service_healthy
```

The new service block:
```yaml
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

**Step 2: Update `.env.example`**

Add:
```bash
# Job Automation
JOB_TRACKER_SHEET_ID=1EHOO6p87ERIgvmTkiSbn9kG__lSeStpwf8uV4Y-soS4
```

**Step 3: Update `config/agents.json`**

Add `"jobs"` to the `permissions.services` array.

**Step 4: Commit**

```bash
git add docker-compose.yml .env.example config/agents.json
git commit -m "feat: add job-scraper sidecar to docker-compose and wire up env vars"
```

---

## Task 3: Update setup.sh — USCIS H-1B CSV Download

**Files:**
- Modify: `setup.sh`

**Step 1: Add USCIS data download section**

Between the config copy and the Docker build steps, add a section that downloads the USCIS H-1B employer data CSV to `$WORKSPACE_DIR/uscis/h1b_data.csv`. Use `curl` to fetch from `https://www.uscis.gov/sites/default/files/document/data/` (the exact URL varies by fiscal year — use the latest available FY2024 file).

Since the exact USCIS download URL changes by fiscal year, the setup script should:
1. Create `$WORKSPACE_DIR/uscis/` directory
2. Download from a hardcoded URL for FY2024 H-1B data
3. If the download fails, print a warning but don't abort — the visa-check tool will return "unknown" for all companies

```bash
# ── Section 7b: Download USCIS H-1B Employer Data ──────────────────────────
echo ""
echo "=== Section 7b: USCIS H-1B Data ==="
USCIS_DIR="$WORKSPACE_DIR/uscis"
sudo mkdir -p "$USCIS_DIR"
sudo chown 1000:1000 "$USCIS_DIR"
USCIS_CSV="$USCIS_DIR/h1b_data.csv"
if [ ! -f "$USCIS_CSV" ]; then
    echo "Downloading USCIS H-1B employer data..."
    curl -fsSL -o "$USCIS_CSV" \
        "https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-All.csv" \
        2>/dev/null || {
        echo "WARNING: Could not download USCIS H-1B data."
        echo "The visa-sponsor-check tool will return 'unknown' for all companies."
        echo "You can manually place the CSV at: $USCIS_CSV"
    }
else
    echo "USCIS H-1B data already present, skipping download."
fi
```

**Step 2: Commit**

```bash
git add setup.sh
git commit -m "feat(setup): download USCIS H-1B employer CSV for visa checking"
```

---

## Task 4: ATS Detect Tool

This and all following tasks create files in the **upstream plugin repo** (`mxy680/omniclaw`). Since we cannot directly modify the upstream repo from this deployment repo, the tool source files will be staged in a local directory `plugin-src/` that mirrors the upstream `src/` structure. These files are meant to be submitted as a PR to `mxy680/omniclaw` or manually copied in.

**Files:**
- Create: `plugin-src/src/tools/jobs-ats-detect.ts`
- Create: `plugin-src/tests/unit/jobs-ats-detect.test.ts`

**Step 1: Write the failing test**

Create `plugin-src/tests/unit/jobs-ats-detect.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAtsDetectTool } from "../../src/tools/jobs-ats-detect.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("jobs_ats_detect", () => {
  const tool = createAtsDetectTool("http://localhost:8787");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_ats_detect");
    expect(typeof tool.description).toBe("string");
    expect(typeof tool.parameters).toBe("object");
    expect(typeof tool.execute).toBe("function");
  });

  it("detects greenhouse from URL pattern in HTML", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<iframe src="https://boards.greenhouse.io/acmecorp/jobs"></iframe>'),
    });

    const result = await tool.execute("test", { url: "https://acme.com/careers" });
    expect(result.details.ats).toBe("greenhouse");
    expect(result.details.board_token).toBe("acmecorp");
  });

  it("detects lever from URL pattern in HTML", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<a href="https://jobs.lever.co/mycompany">Apply</a>'),
    });

    const result = await tool.execute("test", { url: "https://mycompany.com/jobs" });
    expect(result.details.ats).toBe("lever");
    expect(result.details.board_token).toBe("mycompany");
  });

  it("detects ashby from URL pattern in HTML", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<div data-ashby="true"><script src="https://jobs.ashbyhq.com/coolstartup"></script></div>'),
    });

    const result = await tool.execute("test", { url: "https://coolstartup.com/careers" });
    expect(result.details.ats).toBe("ashby");
    expect(result.details.board_token).toBe("coolstartup");
  });

  it("returns unknown when no ATS detected and sidecar also fails", async () => {
    // Primary fetch returns clean HTML
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("<html><body>Jobs page</body></html>"),
    });
    // Sidecar fallback
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ats: "unknown", board_token: "" }),
    });

    const result = await tool.execute("test", { url: "https://example.com/careers" });
    expect(result.details.ats).toBe("unknown");
  });

  it("falls back to sidecar when primary fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ats: "greenhouse", board_token: "fallbackcorp" }),
    });

    const result = await tool.execute("test", { url: "https://fallback.com/careers" });
    expect(result.details.ats).toBe("greenhouse");
    expect(result.details.board_token).toBe("fallbackcorp");
  });
});
```

**Step 2: Write the implementation**

Create `plugin-src/src/tools/jobs-ats-detect.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

const ATS_PATTERNS: Array<{ regex: RegExp; ats: string }> = [
  { regex: /boards\.greenhouse\.io\/([\w-]+)/, ats: "greenhouse" },
  { regex: /job-boards\.greenhouse\.io\/([\w-]+)/, ats: "greenhouse" },
  { regex: /jobs\.lever\.co\/([\w-]+)/, ats: "lever" },
  { regex: /jobs\.ashbyhq\.com\/([\w-]+)/, ats: "ashby" },
  { regex: /apply\.workable\.com\/([\w-]+)/, ats: "workable" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAtsDetectTool(scraperUrl: string): any {
  return {
    name: "jobs_ats_detect",
    label: "ATS Detect",
    description:
      "Detect which Applicant Tracking System (ATS) a company uses by analyzing their careers page URL. " +
      "Supports Greenhouse, Lever, Ashby, and Workable. Returns the ATS type and board token needed for listing/applying.",
    parameters: Type.Object({
      url: Type.String({ description: "The company's careers page URL (e.g., https://acme.com/careers)." }),
    }),
    async execute(_toolCallId: string, params: { url: string }) {
      // First: check the URL itself for known ATS patterns
      for (const { regex, ats } of ATS_PATTERNS) {
        const urlMatch = regex.exec(params.url);
        if (urlMatch) {
          return jsonResult({ ats, board_token: urlMatch[1], careers_url: params.url });
        }
      }

      // Second: fetch the page HTML and search for ATS patterns
      try {
        const resp = await fetch(params.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; JobBot/1.0)" },
          signal: AbortSignal.timeout(15_000),
        });
        if (resp.ok) {
          const html = await resp.text();
          for (const { regex, ats } of ATS_PATTERNS) {
            const htmlMatch = regex.exec(html);
            if (htmlMatch) {
              return jsonResult({ ats, board_token: htmlMatch[1], careers_url: params.url });
            }
          }
        }
      } catch {
        // Fall through to sidecar
      }

      // Third: fallback to Python sidecar
      try {
        const sidecarResp = await fetch(`${scraperUrl}/scrape/career-page`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: params.url }),
          signal: AbortSignal.timeout(20_000),
        });
        if (sidecarResp.ok) {
          const data = (await sidecarResp.json()) as { ats: string; board_token: string };
          return jsonResult({ ats: data.ats, board_token: data.board_token, careers_url: params.url });
        }
      } catch {
        // Fall through
      }

      return jsonResult({ ats: "unknown", board_token: "", careers_url: params.url });
    },
  };
}
```

**Step 3: Commit**

```bash
git add plugin-src/src/tools/jobs-ats-detect.ts plugin-src/tests/unit/jobs-ats-detect.test.ts
git commit -m "feat(jobs): add ATS detection tool with sidecar fallback"
```

---

## Task 5: Greenhouse Tools (List + Apply)

**Files:**
- Create: `plugin-src/src/tools/jobs-greenhouse.ts`
- Create: `plugin-src/tests/unit/jobs-greenhouse.test.ts`

**Step 1: Write the failing test**

Create `plugin-src/tests/unit/jobs-greenhouse.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGreenhouseJobsTool, createGreenhouseApplyTool } from "../../src/tools/jobs-greenhouse.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("jobs_greenhouse_list", () => {
  const tool = createGreenhouseJobsTool();

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_greenhouse_list");
    expect(typeof tool.execute).toBe("function");
  });

  it("fetches and returns jobs from greenhouse API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jobs: [
          {
            id: 123,
            title: "Software Engineer",
            location: { name: "San Francisco" },
            departments: [{ name: "Engineering" }],
            content: "<p>Build cool stuff</p>",
          },
        ],
      }),
    });

    const result = await tool.execute("test", { board_token: "acmecorp" });
    expect(result.details.jobs).toHaveLength(1);
    expect(result.details.jobs[0].title).toBe("Software Engineer");
    expect(result.details.jobs[0].id).toBe(123);
  });

  it("returns error on API failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" });

    const result = await tool.execute("test", { board_token: "nonexistent" });
    expect(result.details.error).toBeDefined();
  });
});

describe("jobs_greenhouse_apply", () => {
  const tool = createGreenhouseApplyTool();

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_greenhouse_apply");
    expect(typeof tool.execute).toBe("function");
  });

  it("submits application via POST", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 456, status: "received" }),
    });

    const result = await tool.execute("test", {
      board_token: "acmecorp",
      job_id: 123,
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
    });
    expect(result.details.success).toBe(true);
  });
});
```

**Step 2: Write the implementation**

Create `plugin-src/src/tools/jobs-greenhouse.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createGreenhouseJobsTool(): any {
  return {
    name: "jobs_greenhouse_list",
    label: "Greenhouse List Jobs",
    description:
      "List open jobs from a Greenhouse job board. Requires the board_token (e.g., 'acmecorp' from boards.greenhouse.io/acmecorp). " +
      "Returns job IDs, titles, locations, departments, and description snippets.",
    parameters: Type.Object({
      board_token: Type.String({ description: "Greenhouse board token (from the careers page URL)." }),
      query: Type.Optional(Type.String({ description: "Search keyword to filter jobs." })),
      location: Type.Optional(Type.String({ description: "Filter by location name." })),
      department: Type.Optional(Type.String({ description: "Filter by department name." })),
    }),
    async execute(
      _toolCallId: string,
      params: { board_token: string; query?: string; location?: string; department?: string },
    ) {
      try {
        const url = `https://boards-api.greenhouse.io/v1/boards/${params.board_token}/jobs?content=true`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) {
          return jsonResult({ error: "api_error", status: resp.status, message: resp.statusText });
        }
        const data = (await resp.json()) as { jobs: Array<Record<string, unknown>> };

        let jobs = data.jobs.map((j: Record<string, unknown>) => ({
          id: j.id,
          title: j.title as string,
          location: (j.location as Record<string, unknown>)?.name ?? "",
          department: ((j.departments as Array<Record<string, unknown>>) ?? [])[0]?.name ?? "",
          description_snippet: String(j.content ?? "").replace(/<[^>]+>/g, "").slice(0, 200),
          url: `https://boards.greenhouse.io/${params.board_token}/jobs/${j.id}`,
        }));

        // Client-side filtering
        if (params.query) {
          const q = params.query.toLowerCase();
          jobs = jobs.filter(
            (j) => j.title.toLowerCase().includes(q) || j.description_snippet.toLowerCase().includes(q),
          );
        }
        if (params.location) {
          const loc = params.location.toLowerCase();
          jobs = jobs.filter((j) => j.location.toLowerCase().includes(loc));
        }
        if (params.department) {
          const dep = params.department.toLowerCase();
          jobs = jobs.filter((j) => j.department.toLowerCase().includes(dep));
        }

        return jsonResult({ board_token: params.board_token, count: jobs.length, jobs });
      } catch (err) {
        return jsonResult({ error: "fetch_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createGreenhouseApplyTool(): any {
  return {
    name: "jobs_greenhouse_apply",
    label: "Greenhouse Apply",
    description:
      "Submit a job application to a Greenhouse job board. Requires board_token, job_id, and applicant info. " +
      "The resume should be a local file path (e.g., from Google Drive download).",
    parameters: Type.Object({
      board_token: Type.String({ description: "Greenhouse board token." }),
      job_id: Type.Number({ description: "Greenhouse job ID (from jobs_greenhouse_list)." }),
      first_name: Type.String({ description: "Applicant first name." }),
      last_name: Type.String({ description: "Applicant last name." }),
      email: Type.String({ description: "Applicant email address." }),
      phone: Type.Optional(Type.String({ description: "Phone number." })),
      resume_url: Type.Optional(Type.String({ description: "URL to resume file (publicly accessible)." })),
      cover_letter: Type.Optional(Type.String({ description: "Cover letter text." })),
      linkedin_url: Type.Optional(Type.String({ description: "LinkedIn profile URL." })),
      answers: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: "Custom question answers as { question_id: answer }.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        board_token: string;
        job_id: number;
        first_name: string;
        last_name: string;
        email: string;
        phone?: string;
        resume_url?: string;
        cover_letter?: string;
        linkedin_url?: string;
        answers?: Record<string, string>;
      },
    ) {
      try {
        const url = `https://boards-api.greenhouse.io/v1/boards/${params.board_token}/jobs/${params.job_id}`;

        const formData = new FormData();
        formData.append("first_name", params.first_name);
        formData.append("last_name", params.last_name);
        formData.append("email", params.email);
        if (params.phone) formData.append("phone", params.phone);
        if (params.resume_url) formData.append("resume", params.resume_url);
        if (params.cover_letter) formData.append("cover_letter", params.cover_letter);
        if (params.linkedin_url) formData.append("linkedin_profile_url", params.linkedin_url);

        // Custom question answers
        if (params.answers) {
          for (const [key, value] of Object.entries(params.answers)) {
            formData.append(`question_${key}`, value);
          }
        }

        const resp = await fetch(url, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(30_000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => resp.statusText);
          return jsonResult({ success: false, error: "api_error", status: resp.status, message: errText });
        }

        const data = (await resp.json()) as Record<string, unknown>;
        return jsonResult({
          success: true,
          application_id: data.id ?? data.application_id ?? null,
          status: data.status ?? "submitted",
        });
      } catch (err) {
        return jsonResult({ success: false, error: "submit_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
```

**Step 3: Commit**

```bash
git add plugin-src/src/tools/jobs-greenhouse.ts plugin-src/tests/unit/jobs-greenhouse.test.ts
git commit -m "feat(jobs): add Greenhouse list + apply tools"
```

---

## Task 6: Lever Tools (List + Apply)

**Files:**
- Create: `plugin-src/src/tools/jobs-lever.ts`
- Create: `plugin-src/tests/unit/jobs-lever.test.ts`

**Step 1: Write the failing test**

Create `plugin-src/tests/unit/jobs-lever.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLeverJobsTool, createLeverApplyTool } from "../../src/tools/jobs-lever.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("jobs_lever_list", () => {
  const tool = createLeverJobsTool();

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_lever_list");
  });

  it("fetches and returns lever postings", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          id: "abc-123",
          text: "Backend Engineer",
          categories: { location: "Remote", team: "Engineering", commitment: "Full-time" },
          description: "Build backend services",
          applyUrl: "https://jobs.lever.co/myco/abc-123/apply",
        },
      ]),
    });

    const result = await tool.execute("test", { site_name: "myco" });
    expect(result.details.jobs).toHaveLength(1);
    expect(result.details.jobs[0].title).toBe("Backend Engineer");
  });
});

describe("jobs_lever_apply", () => {
  const tool = createLeverApplyTool();

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_lever_apply");
  });

  it("submits application", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, applicationId: "app-789" }),
    });

    const result = await tool.execute("test", {
      site_name: "myco",
      posting_id: "abc-123",
      name: "Jane Doe",
      email: "jane@example.com",
    });
    expect(result.details.ok).toBe(true);
  });
});
```

**Step 2: Write the implementation**

Create `plugin-src/src/tools/jobs-lever.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

// Rate limiter: max 2 requests/sec for Lever API
let lastLeverRequest = 0;
async function leverRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastLeverRequest;
  if (elapsed < 500) {
    await new Promise((r) => setTimeout(r, 500 - elapsed));
  }
  lastLeverRequest = Date.now();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createLeverJobsTool(): any {
  return {
    name: "jobs_lever_list",
    label: "Lever List Jobs",
    description:
      "List open job postings from a Lever career site. Requires the site_name (e.g., 'mycompany' from jobs.lever.co/mycompany).",
    parameters: Type.Object({
      site_name: Type.String({ description: "Lever site name (from jobs.lever.co/{site_name})." }),
      location: Type.Optional(Type.String({ description: "Filter by location." })),
      team: Type.Optional(Type.String({ description: "Filter by team name." })),
      commitment: Type.Optional(Type.String({ description: "Filter by commitment (e.g., 'Full-time', 'Intern')." })),
    }),
    async execute(
      _toolCallId: string,
      params: { site_name: string; location?: string; team?: string; commitment?: string },
    ) {
      try {
        await leverRateLimit();
        const url = `https://api.lever.co/v0/postings/${params.site_name}?mode=json`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) {
          return jsonResult({ error: "api_error", status: resp.status, message: resp.statusText });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let postings = (await resp.json()) as any[];

        let jobs = postings.map((p) => ({
          id: p.id,
          title: p.text,
          location: p.categories?.location ?? "",
          team: p.categories?.team ?? "",
          commitment: p.categories?.commitment ?? "",
          description_snippet: String(p.descriptionPlain ?? p.description ?? "").slice(0, 200),
          apply_url: p.applyUrl ?? `https://jobs.lever.co/${params.site_name}/${p.id}/apply`,
        }));

        if (params.location) {
          const loc = params.location.toLowerCase();
          jobs = jobs.filter((j) => j.location.toLowerCase().includes(loc));
        }
        if (params.team) {
          const t = params.team.toLowerCase();
          jobs = jobs.filter((j) => j.team.toLowerCase().includes(t));
        }
        if (params.commitment) {
          const c = params.commitment.toLowerCase();
          jobs = jobs.filter((j) => j.commitment.toLowerCase().includes(c));
        }

        return jsonResult({ site_name: params.site_name, count: jobs.length, jobs });
      } catch (err) {
        return jsonResult({ error: "fetch_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createLeverApplyTool(): any {
  return {
    name: "jobs_lever_apply",
    label: "Lever Apply",
    description:
      "Submit a job application to a Lever posting. Requires site_name, posting_id, name, and email.",
    parameters: Type.Object({
      site_name: Type.String({ description: "Lever site name." }),
      posting_id: Type.String({ description: "Posting ID from jobs_lever_list." }),
      name: Type.String({ description: "Full name of applicant." }),
      email: Type.String({ description: "Applicant email." }),
      phone: Type.Optional(Type.String({ description: "Phone number." })),
      resume_url: Type.Optional(Type.String({ description: "URL to resume file." })),
      urls: Type.Optional(
        Type.Record(Type.String(), Type.String(), { description: "Profile URLs, e.g. { 'LinkedIn': 'https://...' }." }),
      ),
      comments: Type.Optional(Type.String({ description: "Additional comments or cover letter." })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        site_name: string;
        posting_id: string;
        name: string;
        email: string;
        phone?: string;
        resume_url?: string;
        urls?: Record<string, string>;
        comments?: string;
      },
    ) {
      try {
        await leverRateLimit();
        const url = `https://api.lever.co/v0/postings/${params.site_name}/${params.posting_id}`;

        const formData = new FormData();
        formData.append("name", params.name);
        formData.append("email", params.email);
        if (params.phone) formData.append("phone", params.phone);
        if (params.resume_url) formData.append("resume", params.resume_url);
        if (params.comments) formData.append("comments", params.comments);
        if (params.urls) {
          for (const [label, link] of Object.entries(params.urls)) {
            formData.append(`urls[${label}]`, link);
          }
        }

        const resp = await fetch(url, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(30_000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => resp.statusText);
          return jsonResult({ ok: false, error: "api_error", status: resp.status, message: errText });
        }

        const data = (await resp.json()) as Record<string, unknown>;
        return jsonResult({ ok: true, applicationId: data.applicationId ?? null });
      } catch (err) {
        return jsonResult({ ok: false, error: "submit_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
```

**Step 3: Commit**

```bash
git add plugin-src/src/tools/jobs-lever.ts plugin-src/tests/unit/jobs-lever.test.ts
git commit -m "feat(jobs): add Lever list + apply tools with rate limiting"
```

---

## Task 7: Ashby Tools (List + Apply)

**Files:**
- Create: `plugin-src/src/tools/jobs-ashby.ts`
- Create: `plugin-src/tests/unit/jobs-ashby.test.ts`

**Step 1: Write the failing test**

Create `plugin-src/tests/unit/jobs-ashby.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAshbyJobsTool, createAshbyApplyTool } from "../../src/tools/jobs-ashby.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("jobs_ashby_list", () => {
  const tool = createAshbyJobsTool();

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_ashby_list");
  });

  it("fetches jobs from ashby API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jobs: [
          {
            id: "job-1",
            title: "ML Engineer",
            location: "New York",
            department: "AI",
            employmentType: "FullTime",
            compensationTierSummary: "$150k - $200k",
          },
        ],
      }),
    });

    const result = await tool.execute("test", { board_name: "coolai" });
    expect(result.details.jobs).toHaveLength(1);
    expect(result.details.jobs[0].title).toBe("ML Engineer");
  });
});

describe("jobs_ashby_apply", () => {
  const tool = createAshbyApplyTool();

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_ashby_apply");
  });

  it("submits application", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, applicationId: "app-1" }),
    });

    const result = await tool.execute("test", {
      job_posting_id: "job-1",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
    });
    expect(result.details.success).toBe(true);
  });
});
```

**Step 2: Write the implementation**

Create `plugin-src/src/tools/jobs-ashby.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAshbyJobsTool(): any {
  return {
    name: "jobs_ashby_list",
    label: "Ashby List Jobs",
    description:
      "List open jobs from an Ashby job board. Requires the board_name (e.g., 'coolstartup' from jobs.ashbyhq.com/coolstartup).",
    parameters: Type.Object({
      board_name: Type.String({ description: "Ashby board name (from jobs.ashbyhq.com/{name})." }),
      include_compensation: Type.Optional(
        Type.Boolean({ description: "Include compensation data. Defaults to true.", default: true }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { board_name: string; include_compensation?: boolean },
    ) {
      try {
        const incComp = params.include_compensation !== false;
        const url = `https://api.ashbyhq.com/posting-api/job-board/${params.board_name}?includeCompensation=${incComp}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) {
          return jsonResult({ error: "api_error", status: resp.status, message: resp.statusText });
        }
        const data = (await resp.json()) as { jobs: Array<Record<string, unknown>> };

        const jobs = (data.jobs ?? []).map((j) => ({
          id: j.id,
          title: j.title,
          location: j.location ?? j.locationName ?? "",
          department: j.department ?? j.departmentName ?? "",
          employment_type: j.employmentType ?? "",
          compensation: j.compensationTierSummary ?? j.compensation ?? "",
        }));

        return jsonResult({ board_name: params.board_name, count: jobs.length, jobs });
      } catch (err) {
        return jsonResult({ error: "fetch_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAshbyApplyTool(): any {
  return {
    name: "jobs_ashby_apply",
    label: "Ashby Apply",
    description:
      "Submit a job application via Ashby's posting API. Requires job_posting_id and applicant info.",
    parameters: Type.Object({
      job_posting_id: Type.String({ description: "Ashby job posting ID from jobs_ashby_list." }),
      first_name: Type.String({ description: "Applicant first name." }),
      last_name: Type.String({ description: "Applicant last name." }),
      email: Type.String({ description: "Applicant email." }),
      phone: Type.Optional(Type.String({ description: "Phone number." })),
      linkedin_url: Type.Optional(Type.String({ description: "LinkedIn profile URL." })),
      resume_url: Type.Optional(Type.String({ description: "URL to resume file." })),
      form_answers: Type.Optional(
        Type.Record(Type.String(), Type.String(), { description: "Custom form answers as { field_id: value }." }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        job_posting_id: string;
        first_name: string;
        last_name: string;
        email: string;
        phone?: string;
        linkedin_url?: string;
        resume_url?: string;
        form_answers?: Record<string, string>;
      },
    ) {
      try {
        const body = {
          jobPostingId: params.job_posting_id,
          applicationForm: {
            firstName: params.first_name,
            lastName: params.last_name,
            email: params.email,
            phone: params.phone,
            linkedInUrl: params.linkedin_url,
            resumeUrl: params.resume_url,
            ...(params.form_answers ?? {}),
          },
        };

        const resp = await fetch("https://api.ashbyhq.com/applicationForm.submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => resp.statusText);
          return jsonResult({ success: false, error: "api_error", status: resp.status, message: errText });
        }

        const data = (await resp.json()) as Record<string, unknown>;
        return jsonResult({ success: true, applicationId: data.applicationId ?? null });
      } catch (err) {
        return jsonResult({ success: false, error: "submit_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
```

**Step 3: Commit**

```bash
git add plugin-src/src/tools/jobs-ashby.ts plugin-src/tests/unit/jobs-ashby.test.ts
git commit -m "feat(jobs): add Ashby list + apply tools"
```

---

## Task 8: YC Companies Discovery Tool

**Files:**
- Create: `plugin-src/src/tools/jobs-yc.ts`
- Create: `plugin-src/tests/unit/jobs-yc.test.ts`

**Step 1: Write the failing test**

Create `plugin-src/tests/unit/jobs-yc.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createYcCompaniesTool } from "../../src/tools/jobs-yc.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("jobs_yc_companies", () => {
  const tool = createYcCompaniesTool();

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_yc_companies");
  });

  it("fetches hiring companies from YC API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          name: "Stripe",
          url: "https://stripe.com",
          description: "Payments infrastructure",
          batch: "S2010",
          industries: ["Fintech"],
          tags: ["developer-tools"],
          isHiring: true,
          teamSize: 5000,
        },
      ]),
    });

    const result = await tool.execute("test", { hiring_only: true });
    expect(result.details.companies).toHaveLength(1);
    expect(result.details.companies[0].name).toBe("Stripe");
  });

  it("filters by query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { name: "Stripe", description: "Payments", isHiring: true },
        { name: "Airbnb", description: "Travel", isHiring: true },
      ]),
    });

    const result = await tool.execute("test", { hiring_only: true, query: "payment" });
    expect(result.details.companies).toHaveLength(1);
  });
});
```

**Step 2: Write the implementation**

Create `plugin-src/src/tools/jobs-yc.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createYcCompaniesTool(): any {
  return {
    name: "jobs_yc_companies",
    label: "YC Companies",
    description:
      "Discover Y Combinator companies, optionally filtered to only those currently hiring. " +
      "Uses the open-source yc-oss API. No authentication required.",
    parameters: Type.Object({
      hiring_only: Type.Optional(
        Type.Boolean({ description: "Only return companies that are currently hiring. Defaults to true.", default: true }),
      ),
      batch: Type.Optional(Type.String({ description: "Filter by YC batch (e.g., 'S24', 'W23')." })),
      industry: Type.Optional(Type.String({ description: "Filter by industry (e.g., 'Fintech', 'Healthcare')." })),
      tag: Type.Optional(Type.String({ description: "Filter by tag (e.g., 'developer-tools', 'b2b')." })),
      query: Type.Optional(Type.String({ description: "Free-text search across company name and description." })),
    }),
    async execute(
      _toolCallId: string,
      params: { hiring_only?: boolean; batch?: string; industry?: string; tag?: string; query?: string },
    ) {
      try {
        const hiringOnly = params.hiring_only !== false;
        const endpoint = hiringOnly
          ? "https://yc-oss.github.io/api/companies/hiring.json"
          : "https://yc-oss.github.io/api/companies/all.json";

        const resp = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) {
          return jsonResult({ error: "api_error", status: resp.status });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let companies = (await resp.json()) as any[];

        companies = companies.map((c) => ({
          name: c.name ?? "",
          url: c.url ?? c.website ?? "",
          description: c.description ?? c.oneLiner ?? "",
          batch: c.batch ?? "",
          industry: Array.isArray(c.industries) ? c.industries.join(", ") : (c.industry ?? ""),
          tags: Array.isArray(c.tags) ? c.tags : [],
          is_hiring: c.isHiring ?? false,
          team_size: c.teamSize ?? null,
        }));

        if (params.batch) {
          const b = params.batch.toUpperCase();
          companies = companies.filter((c) => String(c.batch).toUpperCase().includes(b));
        }
        if (params.industry) {
          const ind = params.industry.toLowerCase();
          companies = companies.filter((c) => c.industry.toLowerCase().includes(ind));
        }
        if (params.tag) {
          const t = params.tag.toLowerCase();
          companies = companies.filter((c) =>
            c.tags.some((tag: string) => tag.toLowerCase().includes(t)),
          );
        }
        if (params.query) {
          const q = params.query.toLowerCase();
          companies = companies.filter(
            (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
          );
        }

        return jsonResult({ count: companies.length, companies: companies.slice(0, 100) });
      } catch (err) {
        return jsonResult({ error: "fetch_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
```

**Step 3: Commit**

```bash
git add plugin-src/src/tools/jobs-yc.ts plugin-src/tests/unit/jobs-yc.test.ts
git commit -m "feat(jobs): add YC Companies discovery tool"
```

---

## Task 9: HN Who's Hiring Search Tool

**Files:**
- Create: `plugin-src/src/tools/jobs-hn-hiring.ts`
- Create: `plugin-src/tests/unit/jobs-hn-hiring.test.ts`

**Step 1: Write the failing test**

Create `plugin-src/tests/unit/jobs-hn-hiring.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHnHiringSearchTool } from "../../src/tools/jobs-hn-hiring.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("jobs_hn_hiring_search", () => {
  const tool = createHnHiringSearchTool();

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_hn_hiring_search");
  });

  it("finds hiring thread and searches comments", async () => {
    // First call: find latest "Who is hiring" story
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        hits: [{ objectID: "12345", title: "Ask HN: Who is hiring? (March 2026)" }],
      }),
    });
    // Second call: search comments in that story
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        hits: [
          {
            objectID: "67890",
            comment_text: "Acme Corp | Software Engineer | NYC | VISA sponsor | Full-time",
            created_at: "2026-03-01T12:00:00.000Z",
            story_id: 12345,
          },
        ],
      }),
    });

    const result = await tool.execute("test", { query: "visa sponsor" });
    expect(result.details.comments).toHaveLength(1);
    expect(result.details.comments[0].text_snippet).toContain("Acme Corp");
  });

  it("returns empty when no story found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ hits: [] }),
    });

    const result = await tool.execute("test", { query: "test" });
    expect(result.details.error).toBe("no_hiring_thread");
  });
});
```

**Step 2: Write the implementation**

Create `plugin-src/src/tools/jobs-hn-hiring.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createHnHiringSearchTool(): any {
  return {
    name: "jobs_hn_hiring_search",
    label: "HN Who's Hiring Search",
    description:
      "Search the latest Hacker News 'Who is hiring?' thread for job postings matching your query. " +
      "Great for finding startups, visa-sponsoring companies, and remote positions. " +
      "Uses the HN Algolia API (no auth required).",
    parameters: Type.Object({
      query: Type.String({
        description:
          "Search terms to find in job postings (e.g., 'visa sponsor', 'intern', 'H-1B', 'remote', 'React').",
      }),
      months_back: Type.Optional(
        Type.Number({
          description: "How many months back to look for hiring threads. Defaults to 1 (current/latest).",
          default: 1,
        }),
      ),
    }),
    async execute(_toolCallId: string, params: { query: string; months_back?: number }) {
      try {
        // Step 1: Find the latest "Who is hiring?" story
        const storyUrl =
          "https://hn.algolia.com/api/v1/search?query=%22Who+is+hiring%22&tags=story&hitsPerPage=5";
        const storyResp = await fetch(storyUrl, { signal: AbortSignal.timeout(10_000) });
        if (!storyResp.ok) {
          return jsonResult({ error: "algolia_error", status: storyResp.status });
        }
        const storyData = (await storyResp.json()) as { hits: Array<{ objectID: string; title: string }> };

        // Filter to "Ask HN: Who is hiring?" posts
        const hiringStories = storyData.hits.filter((h) =>
          h.title.toLowerCase().includes("who is hiring"),
        );
        if (hiringStories.length === 0) {
          return jsonResult({ error: "no_hiring_thread", message: "Could not find a recent 'Who is hiring?' thread." });
        }

        const storyId = hiringStories[0].objectID;
        const storyTitle = hiringStories[0].title;

        // Step 2: Search comments in that story
        const commentUrl =
          `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(params.query)}` +
          `&tags=comment,story_${storyId}&hitsPerPage=30`;
        const commentResp = await fetch(commentUrl, { signal: AbortSignal.timeout(10_000) });
        if (!commentResp.ok) {
          return jsonResult({ error: "algolia_error", status: commentResp.status });
        }
        const commentData = (await commentResp.json()) as {
          hits: Array<{
            objectID: string;
            comment_text: string;
            created_at: string;
            story_id: number;
          }>;
        };

        const comments = commentData.hits.map((c) => {
          // Strip HTML tags
          const plainText = c.comment_text?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "";
          // Guess company name (first line, before first |)
          const firstLine = plainText.split("\n")[0] ?? plainText.slice(0, 100);
          const companyGuess = firstLine.split("|")[0]?.trim() ?? "";

          return {
            company_guess: companyGuess,
            text_snippet: plainText.slice(0, 500),
            full_text: plainText,
            posted_at: c.created_at,
            hn_url: `https://news.ycombinator.com/item?id=${c.objectID}`,
          };
        });

        return jsonResult({
          story_id: storyId,
          story_title: storyTitle,
          query: params.query,
          count: comments.length,
          comments,
        });
      } catch (err) {
        return jsonResult({ error: "fetch_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
```

**Step 3: Commit**

```bash
git add plugin-src/src/tools/jobs-hn-hiring.ts plugin-src/tests/unit/jobs-hn-hiring.test.ts
git commit -m "feat(jobs): add HN Who's Hiring search tool"
```

---

## Task 10: Visa Sponsor Check Tool

**Files:**
- Create: `plugin-src/src/tools/jobs-visa-check.ts`
- Create: `plugin-src/tests/unit/jobs-visa-check.test.ts`

**Step 1: Write the failing test**

Create `plugin-src/tests/unit/jobs-visa-check.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createVisaSponsorCheckTool } from "../../src/tools/jobs-visa-check.js";
import * as fs from "fs";

vi.mock("fs");
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockExistsSync = vi.mocked(fs.existsSync);

describe("jobs_visa_sponsor_check", () => {
  const tool = createVisaSponsorCheckTool("/fake/path/h1b_data.csv");

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_visa_sponsor_check");
  });

  it("returns confirmed when company found in CSV", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "Fiscal Year,Employer,Initial Approval,Initial Denial,Continuing Approval,Continuing Denial\n" +
      "2024,GOOGLE LLC,5000,50,3000,30\n" +
      "2024,ACME CORP,100,10,50,5\n",
    );

    const result = await tool.execute("test", { company_name: "Google" });
    expect(result.details.status).toBe("confirmed");
    expect(result.details.petitions_filed).toBeGreaterThan(0);
  });

  it("returns unknown when company not found", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "Fiscal Year,Employer,Initial Approval,Initial Denial,Continuing Approval,Continuing Denial\n" +
      "2024,GOOGLE LLC,5000,50,3000,30\n",
    );

    const result = await tool.execute("test", { company_name: "NonexistentCorp" });
    expect(result.details.status).toBe("unknown");
  });

  it("returns unknown when CSV file does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await tool.execute("test", { company_name: "Google" });
    expect(result.details.status).toBe("unknown");
    expect(result.details.message).toContain("not found");
  });
});
```

**Step 2: Write the implementation**

Create `plugin-src/src/tools/jobs-visa-check.ts`:

```typescript
import { readFileSync, existsSync } from "fs";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

interface H1bRow {
  fiscalYear: string;
  employer: string;
  initialApproval: number;
  initialDenial: number;
  continuingApproval: number;
  continuingDenial: number;
}

function parseH1bCsv(csvPath: string): H1bRow[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n").slice(1); // skip header
  const rows: H1bRow[] = [];

  for (const line of lines) {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 6) continue;
    rows.push({
      fiscalYear: cols[0],
      employer: cols[1].toUpperCase(),
      initialApproval: parseInt(cols[2], 10) || 0,
      initialDenial: parseInt(cols[3], 10) || 0,
      continuingApproval: parseInt(cols[4], 10) || 0,
      continuingDenial: parseInt(cols[5], 10) || 0,
    });
  }
  return rows;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createVisaSponsorCheckTool(h1bCsvPath: string): any {
  return {
    name: "jobs_visa_sponsor_check",
    label: "Visa Sponsor Check",
    description:
      "Check if a company has a history of sponsoring H-1B visas using USCIS employer data. " +
      "Returns: ✅ confirmed (filed petitions), ⚠️ unknown (not in database), or ❌ denied_history (high denial rate). " +
      "This is a soft signal — not a guarantee of future sponsorship.",
    parameters: Type.Object({
      company_name: Type.String({ description: "Company name to look up (e.g., 'Google', 'Stripe')." }),
    }),
    async execute(_toolCallId: string, params: { company_name: string }) {
      if (!existsSync(h1bCsvPath)) {
        return jsonResult({
          status: "unknown",
          company: params.company_name,
          message: `H-1B data file not found at ${h1bCsvPath}. Run setup.sh to download USCIS data.`,
        });
      }

      try {
        const rows = parseH1bCsv(h1bCsvPath);
        const searchName = params.company_name.toUpperCase();

        // Find all matching rows (fuzzy: substring match)
        const matches = rows.filter((r) => r.employer.includes(searchName));

        if (matches.length === 0) {
          return jsonResult({ status: "unknown", company: params.company_name, petitions_filed: 0 });
        }

        // Aggregate across all matching rows
        let totalApproved = 0;
        let totalDenied = 0;
        let mostRecentYear = "";

        for (const m of matches) {
          totalApproved += m.initialApproval + m.continuingApproval;
          totalDenied += m.initialDenial + m.continuingDenial;
          if (m.fiscalYear > mostRecentYear) mostRecentYear = m.fiscalYear;
        }

        const totalFiled = totalApproved + totalDenied;
        const approvalRate = totalFiled > 0 ? Math.round((totalApproved / totalFiled) * 100) : 0;

        // High denial rate = denied_history
        const status = approvalRate < 50 ? "denied_history" : "confirmed";

        return jsonResult({
          status,
          company: params.company_name,
          petitions_filed: totalFiled,
          approval_rate: approvalRate,
          most_recent_year: mostRecentYear,
          matched_employers: matches.map((m) => m.employer).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5),
        });
      } catch (err) {
        return jsonResult({
          status: "unknown",
          company: params.company_name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
```

**Step 3: Commit**

```bash
git add plugin-src/src/tools/jobs-visa-check.ts plugin-src/tests/unit/jobs-visa-check.test.ts
git commit -m "feat(jobs): add USCIS H-1B visa sponsor check tool"
```

---

## Task 11: Job Tracker Log Tool

**Files:**
- Create: `plugin-src/src/tools/jobs-tracker.ts`
- Create: `plugin-src/tests/unit/jobs-tracker.test.ts`

**Step 1: Write the failing test**

Create `plugin-src/tests/unit/jobs-tracker.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createJobTrackerLogTool } from "../../src/tools/jobs-tracker.js";

// Mock OAuthClientManager
const mockClientManager = {
  listAccounts: () => ["default"],
  getClient: () => ({}),
};

describe("jobs_tracker_log", () => {
  const tool = createJobTrackerLogTool(
    mockClientManager as any,
    "1EHOO6p87ERIgvmTkiSbn9kG__lSeStpwf8uV4Y-soS4",
  );

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_tracker_log");
    expect(typeof tool.execute).toBe("function");
  });

  it("has required parameters", () => {
    // Check parameter schema includes required fields
    const params = tool.parameters;
    expect(params).toBeDefined();
  });
});
```

**Step 2: Write the implementation**

Create `plugin-src/src/tools/jobs-tracker.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import { google } from "googleapis";
import type { OAuthClientManager } from "../auth/oauth-client-manager.js";
import { jsonResult, authRequired } from "./shared.js";

const AUTH_REQUIRED = authRequired("sheets");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createJobTrackerLogTool(clientManager: OAuthClientManager, sheetId: string): any {
  return {
    name: "jobs_tracker_log",
    label: "Job Tracker Log",
    description:
      "Log a job application to the tracking Google Sheet. Appends a row with date, company, role, ATS, status, URL, visa sponsor status, and notes. " +
      "Uses the configured tracking sheet.",
    parameters: Type.Object({
      company: Type.String({ description: "Company name." }),
      role: Type.String({ description: "Job title / role." }),
      ats: Type.Optional(Type.String({ description: "ATS platform (greenhouse, lever, ashby, etc.).", default: "unknown" })),
      url: Type.String({ description: "Job posting URL." }),
      status: Type.Optional(Type.String({ description: "Application status (e.g., 'Applied', 'Interested', 'Rejected').", default: "Applied" })),
      visa_sponsor: Type.Optional(Type.String({ description: "Visa sponsorship status (confirmed, unknown, denied_history).", default: "unknown" })),
      notes: Type.Optional(Type.String({ description: "Additional notes." })),
      account: Type.Optional(Type.String({ description: "Google account name. Defaults to 'default'.", default: "default" })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        company: string;
        role: string;
        ats?: string;
        url: string;
        status?: string;
        visa_sponsor?: string;
        notes?: string;
        account?: string;
      },
    ) {
      const account = params.account ?? "default";
      if (!clientManager.listAccounts().includes(account)) {
        return jsonResult(AUTH_REQUIRED);
      }

      const client = clientManager.getClient(account);
      const sheets = google.sheets({ version: "v4", auth: client });

      const dateApplied = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      const row = [
        dateApplied,
        params.company,
        params.role,
        params.ats ?? "unknown",
        params.status ?? "Applied",
        params.url,
        params.visa_sponsor ?? "unknown",
        params.notes ?? "",
      ];

      try {
        const res = await sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: "Sheet1",
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [row] },
        });

        return jsonResult({
          success: true,
          spreadsheet_id: sheetId,
          row_number: res.data.updates?.updatedRows ?? 1,
          data: {
            date: dateApplied,
            company: params.company,
            role: params.role,
            status: params.status ?? "Applied",
          },
        });
      } catch (err) {
        return jsonResult({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
```

**Step 3: Commit**

```bash
git add plugin-src/src/tools/jobs-tracker.ts plugin-src/tests/unit/jobs-tracker.test.ts
git commit -m "feat(jobs): add job tracker log tool (Google Sheets)"
```

---

## Task 12: JobSpy Scraper Bridge Tool

**Files:**
- Create: `plugin-src/src/tools/jobs-scraper-bridge.ts`
- Create: `plugin-src/tests/unit/jobs-scraper-bridge.test.ts`

**Step 1: Write the failing test**

Create `plugin-src/tests/unit/jobs-scraper-bridge.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createJobspySearchTool } from "../../src/tools/jobs-scraper-bridge.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("jobs_scraper_search", () => {
  const tool = createJobspySearchTool("http://localhost:8787");

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_scraper_search");
  });

  it("calls sidecar and returns results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        count: 2,
        jobs: [
          { title: "SWE", company: "Acme", location: "NYC", url: "https://acme.com/jobs/1" },
          { title: "SRE", company: "Beta", location: "SF", url: "https://beta.com/jobs/2" },
        ],
      }),
    });

    const result = await tool.execute("test", { search_term: "software engineer" });
    expect(result.details.count).toBe(2);
    expect(result.details.jobs).toHaveLength(2);
  });

  it("handles sidecar failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await tool.execute("test", { search_term: "test" });
    expect(result.details.success).toBe(false);
    expect(result.details.error).toContain("Connection refused");
  });
});
```

**Step 2: Write the implementation**

Create `plugin-src/src/tools/jobs-scraper-bridge.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createJobspySearchTool(scraperUrl: string): any {
  return {
    name: "jobs_scraper_search",
    label: "Job Search (Multi-Site)",
    description:
      "Search for jobs across Indeed, Glassdoor, Google Jobs, and ZipRecruiter simultaneously. " +
      "Powered by the JobSpy scraper sidecar. Returns job titles, companies, locations, URLs, and salary info. " +
      "Note: LinkedIn is excluded by design.",
    parameters: Type.Object({
      search_term: Type.String({ description: "Job search query (e.g., 'software engineer intern')." }),
      location: Type.Optional(Type.String({ description: "Location filter (e.g., 'New York', 'Remote')." })),
      sites: Type.Optional(
        Type.Array(Type.String(), {
          description: "Sites to search: 'indeed', 'glassdoor', 'google', 'zip_recruiter'. Defaults to ['indeed', 'google'].",
        }),
      ),
      results_wanted: Type.Optional(
        Type.Number({ description: "Max results to return (1-50). Defaults to 20.", default: 20 }),
      ),
      hours_old: Type.Optional(
        Type.Number({ description: "Only show jobs posted within this many hours. Defaults to 72.", default: 72 }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        search_term: string;
        location?: string;
        sites?: string[];
        results_wanted?: number;
        hours_old?: number;
      },
    ) {
      try {
        const resp = await fetch(`${scraperUrl}/scrape/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            search_term: params.search_term,
            location: params.location,
            sites: params.sites,
            results_wanted: Math.min(params.results_wanted ?? 20, 50),
            hours_old: params.hours_old ?? 72,
          }),
          signal: AbortSignal.timeout(60_000), // Scraping can be slow
        });

        if (!resp.ok) {
          return jsonResult({ success: false, error: "sidecar_error", status: resp.status });
        }

        const data = (await resp.json()) as { success: boolean; count: number; jobs: unknown[]; error?: string };
        return jsonResult(data);
      } catch (err) {
        return jsonResult({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
```

**Step 3: Commit**

```bash
git add plugin-src/src/tools/jobs-scraper-bridge.ts plugin-src/tests/unit/jobs-scraper-bridge.test.ts
git commit -m "feat(jobs): add JobSpy scraper bridge tool"
```

---

## Task 13: Tool Registration + Agent Permissions

**Files:**
- Create: `plugin-src/src/mcp/tool-registry-jobs-patch.ts` (a reference file showing the exact imports/registrations to add to the upstream `tool-registry.ts`)
- Create: `plugin-src/src/mcp/agent-config-jobs-patch.ts` (a reference file showing the `VALID_SERVICES` addition)

**Step 1: Create the tool-registry patch reference**

Create `plugin-src/src/mcp/tool-registry-jobs-patch.ts`:

```typescript
/**
 * PATCH REFERENCE — Add these lines to the upstream tool-registry.ts
 *
 * This file is NOT imported directly. It documents the exact changes needed
 * to register the 12 new job tools in mxy680/omniclaw's tool-registry.ts.
 */

// ── Imports to add at the top of tool-registry.ts ────────────────────────────

// After the existing GitHub imports:
import { createAtsDetectTool } from "../tools/jobs-ats-detect.js";
import { createGreenhouseJobsTool, createGreenhouseApplyTool } from "../tools/jobs-greenhouse.js";
import { createLeverJobsTool, createLeverApplyTool } from "../tools/jobs-lever.js";
import { createAshbyJobsTool, createAshbyApplyTool } from "../tools/jobs-ashby.js";
import { createYcCompaniesTool } from "../tools/jobs-yc.js";
import { createHnHiringSearchTool } from "../tools/jobs-hn-hiring.js";
import { createVisaSponsorCheckTool } from "../tools/jobs-visa-check.js";
import { createJobTrackerLogTool } from "../tools/jobs-tracker.js";
import { createJobspySearchTool } from "../tools/jobs-scraper-bridge.js";

// ── Registration block to add inside createAllTools() ────────────────────────

// After the GitHub tools block, before `return tools`:

// Job tools — no OAuth required (except job-tracker which uses Sheets)
{
  const scraperUrl = process.env.JOB_SCRAPER_URL ?? "http://job-scraper:8787";
  const h1bCsvPath = process.env.H1B_CSV_PATH ??
    path.join(os.homedir(), ".openclaw", "workspace", "uscis", "h1b_data.csv");
  const trackerSheetId = process.env.JOB_TRACKER_SHEET_ID ?? "";

  add(createAtsDetectTool(scraperUrl));
  add(createGreenhouseJobsTool());
  add(createGreenhouseApplyTool());
  add(createLeverJobsTool());
  add(createLeverApplyTool());
  add(createAshbyJobsTool());
  add(createAshbyApplyTool());
  add(createYcCompaniesTool());
  add(createHnHiringSearchTool());
  add(createVisaSponsorCheckTool(h1bCsvPath));
  add(createJobspySearchTool(scraperUrl));

  // Job tracker requires Sheets OAuth
  if (config.client_secret_path && trackerSheetId) {
    const tokensPath =
      config.tokens_path ?? path.join(os.homedir(), ".openclaw", "omniclaw-tokens.json");
    const tokenStore = new TokenStore(tokensPath);
    const clientManager = new OAuthClientManager(
      config.client_secret_path,
      config.oauth_port ?? 9753,
      tokenStore,
    );
    add(createJobTrackerLogTool(clientManager, trackerSheetId));
  }
}
```

**Step 2: Create the agent-config patch reference**

Create `plugin-src/src/mcp/agent-config-jobs-patch.ts`:

```typescript
/**
 * PATCH REFERENCE — Modify VALID_SERVICES in agent-config.ts
 *
 * Add "jobs" to the VALID_SERVICES array so agents can be granted
 * permission to use job-prefixed tools.
 */

// Change from:
export const VALID_SERVICES = [
  "gmail", "calendar", "drive", "docs", "sheets", "slides", "youtube", "schedule", "github",
] as const;

// Change to:
export const VALID_SERVICES = [
  "gmail", "calendar", "drive", "docs", "sheets", "slides", "youtube", "schedule", "github", "jobs",
] as const;
```

**Step 3: Update `config/agents.json` in deployment repo**

In the deployment repo's `config/agents.json`, add `"jobs"` to the services array. (This was already noted in Task 2.)

**Step 4: Commit**

```bash
git add plugin-src/src/mcp/tool-registry-jobs-patch.ts plugin-src/src/mcp/agent-config-jobs-patch.ts
git commit -m "docs(jobs): add tool-registry and agent-config patch references"
```

---

## Task 14: Integration Smoke Test

**Files:**
- Create: `plugin-src/tests/unit/jobs-tool-shapes.test.ts`

**Step 1: Write a comprehensive shape test**

This test verifies all 12 tools have correct shapes without needing network access:

Create `plugin-src/tests/unit/jobs-tool-shapes.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createAtsDetectTool } from "../../src/tools/jobs-ats-detect.js";
import { createGreenhouseJobsTool, createGreenhouseApplyTool } from "../../src/tools/jobs-greenhouse.js";
import { createLeverJobsTool, createLeverApplyTool } from "../../src/tools/jobs-lever.js";
import { createAshbyJobsTool, createAshbyApplyTool } from "../../src/tools/jobs-ashby.js";
import { createYcCompaniesTool } from "../../src/tools/jobs-yc.js";
import { createHnHiringSearchTool } from "../../src/tools/jobs-hn-hiring.js";
import { createVisaSponsorCheckTool } from "../../src/tools/jobs-visa-check.js";
import { createJobspySearchTool } from "../../src/tools/jobs-scraper-bridge.js";

const ALL_TOOLS = [
  createAtsDetectTool("http://localhost:8787"),
  createGreenhouseJobsTool(),
  createGreenhouseApplyTool(),
  createLeverJobsTool(),
  createLeverApplyTool(),
  createAshbyJobsTool(),
  createAshbyApplyTool(),
  createYcCompaniesTool(),
  createHnHiringSearchTool(),
  createVisaSponsorCheckTool("/fake/path.csv"),
  createJobspySearchTool("http://localhost:8787"),
];

describe("All job tools", () => {
  it("each tool has name, label, description, parameters, execute", () => {
    for (const tool of ALL_TOOLS) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.label).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.parameters).toBe("object");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("all tool names start with 'jobs_'", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toMatch(/^jobs_/);
    }
  });

  it("all tool names are unique", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("produces 11 tools (tracker excluded — requires OAuth)", () => {
    expect(ALL_TOOLS).toHaveLength(11);
  });
});
```

**Step 2: Commit**

```bash
git add plugin-src/tests/unit/jobs-tool-shapes.test.ts
git commit -m "test(jobs): add comprehensive tool shape tests for all 11 non-OAuth job tools"
```

---

## Task 15: Update Deployment Repo README

**Files:**
- Modify: `README.md`

**Step 1: Add job automation section to README**

Add a "Job Automation" section documenting the new tools, the sidecar, and setup instructions for the USCIS data.

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add job automation tools section to README"
```

---

## Task 16: Final Push

**Step 1: Push all deployment repo changes**

```bash
git push
```

**Step 2: Verify file tree**

The deployment repo should now contain:
```
scraper/
  Dockerfile
  requirements.txt
  main.py
plugin-src/
  src/tools/
    jobs-ats-detect.ts
    jobs-greenhouse.ts
    jobs-lever.ts
    jobs-ashby.ts
    jobs-yc.ts
    jobs-hn-hiring.ts
    jobs-visa-check.ts
    jobs-tracker.ts
    jobs-scraper-bridge.ts
  src/mcp/
    tool-registry-jobs-patch.ts
    agent-config-jobs-patch.ts
  tests/unit/
    jobs-ats-detect.test.ts
    jobs-greenhouse.test.ts
    jobs-lever.test.ts
    jobs-ashby.test.ts
    jobs-yc.test.ts
    jobs-hn-hiring.test.ts
    jobs-visa-check.test.ts
    jobs-tracker.test.ts
    jobs-scraper-bridge.test.ts
    jobs-tool-shapes.test.ts
```

**Step 3: Summary of what to do next (for the user)**

To make these tools live:
1. **Submit a PR** to `mxy680/omniclaw` with the contents of `plugin-src/` (copy files to matching paths in the upstream repo, apply the patch references to `tool-registry.ts` and `agent-config.ts`)
2. **Or fork** `mxy680/omniclaw`, apply the changes, and update the `Dockerfile` to clone your fork instead
3. Run `docker compose build --no-cache && docker compose up -d` on the VPS
4. Test via Telegram: "Search for software engineer intern jobs in New York"
