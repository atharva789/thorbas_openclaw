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
