import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAtsDetectTool } from "../../src/tools/jobs-ats-detect.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("jobs_ats_detect", () => {
  const tool = createAtsDetectTool("http://localhost:8787");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_ats_detect");
    expect(typeof tool.description).toBe("string");
    expect(typeof tool.parameters).toBe("object");
    expect(typeof tool.execute).toBe("function");
  });

  it("detects greenhouse from URL pattern in HTML", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<iframe src="https://boards.greenhouse.io/acmecorp/jobs"></iframe>'),
    });

    const result = await tool.execute("test", { url: "https://acme.com/careers" });
    expect(result.details.ats).toBe("greenhouse");
    expect(result.details.board_token).toBe("acmecorp");
  });

  it("detects lever from URL pattern in HTML", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<a href="https://jobs.lever.co/mycompany">Apply</a>'),
    });

    const result = await tool.execute("test", { url: "https://mycompany.com/jobs" });
    expect(result.details.ats).toBe("lever");
    expect(result.details.board_token).toBe("mycompany");
  });

  it("detects ashby from URL pattern in HTML", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<div data-ashby="true"><script src="https://jobs.ashbyhq.com/coolstartup"></script></div>'),
    });

    const result = await tool.execute("test", { url: "https://coolstartup.com/careers" });
    expect(result.details.ats).toBe("ashby");
    expect(result.details.board_token).toBe("coolstartup");
  });

  it("returns unknown when no ATS detected and sidecar also fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("<html><body>Jobs page</body></html>"),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ats: "unknown", board_token: "" }),
    });

    const result = await tool.execute("test", { url: "https://example.com/careers" });
    expect(result.details.ats).toBe("unknown");
  });

  it("falls back to sidecar when primary fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ats: "greenhouse", board_token: "fallbackcorp" }),
    });

    const result = await tool.execute("test", { url: "https://fallback.com/careers" });
    expect(result.details.ats).toBe("greenhouse");
    expect(result.details.board_token).toBe("fallbackcorp");
  });
});
