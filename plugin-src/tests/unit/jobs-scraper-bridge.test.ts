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
