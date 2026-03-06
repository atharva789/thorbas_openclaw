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
