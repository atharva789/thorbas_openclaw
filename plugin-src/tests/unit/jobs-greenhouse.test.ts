import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGreenhouseJobsTool, createGreenhouseApplyTool } from "../../src/tools/jobs-greenhouse.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("jobs_greenhouse_list", () => {
  const tool = createGreenhouseJobsTool();

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_greenhouse_list");
    expect(typeof tool.execute).toBe("function");
  });

  it("fetches and returns jobs from greenhouse API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jobs: [
          {
            id: 123,
            title: "Software Engineer",
            location: { name: "San Francisco" },
            departments: [{ name: "Engineering" }],
            content: "<p>Build cool stuff</p>",
          },
        ],
      }),
    });

    const result = await tool.execute("test", { board_token: "acmecorp" });
    expect(result.details.jobs).toHaveLength(1);
    expect(result.details.jobs[0].title).toBe("Software Engineer");
    expect(result.details.jobs[0].id).toBe(123);
  });

  it("returns error on API failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" });

    const result = await tool.execute("test", { board_token: "nonexistent" });
    expect(result.details.error).toBeDefined();
  });
});

describe("jobs_greenhouse_apply", () => {
  const tool = createGreenhouseApplyTool();

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_greenhouse_apply");
    expect(typeof tool.execute).toBe("function");
  });

  it("submits application via POST", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 456, status: "received" }),
    });

    const result = await tool.execute("test", {
      board_token: "acmecorp",
      job_id: 123,
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
    });
    expect(result.details.success).toBe(true);
  });
});
