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
