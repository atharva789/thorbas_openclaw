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
