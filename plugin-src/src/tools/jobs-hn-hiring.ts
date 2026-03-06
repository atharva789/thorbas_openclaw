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
        const storyUrl =
          "https://hn.algolia.com/api/v1/search?query=%22Who+is+hiring%22&tags=story&hitsPerPage=5";
        const storyResp = await fetch(storyUrl, { signal: AbortSignal.timeout(10_000) });
        if (!storyResp.ok) {
          return jsonResult({ error: "algolia_error", status: storyResp.status });
        }
        const storyData = (await storyResp.json()) as { hits: Array<{ objectID: string; title: string }> };

        const hiringStories = storyData.hits.filter((h) =>
          h.title.toLowerCase().includes("who is hiring"),
        );
        if (hiringStories.length === 0) {
          return jsonResult({ error: "no_hiring_thread", message: "Could not find a recent 'Who is hiring?' thread." });
        }

        const storyId = hiringStories[0].objectID;
        const storyTitle = hiringStories[0].title;

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
          const plainText = c.comment_text?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "";
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
