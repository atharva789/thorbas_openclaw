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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        hits: [{ objectID: "12345", title: "Ask HN: Who is hiring? (March 2026)" }],
      }),
    });
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
