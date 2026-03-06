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
          signal: AbortSignal.timeout(60_000),
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
