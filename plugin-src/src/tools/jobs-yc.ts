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
