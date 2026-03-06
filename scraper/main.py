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
