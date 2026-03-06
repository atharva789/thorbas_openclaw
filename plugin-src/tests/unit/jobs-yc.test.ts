import { describe, it, expect, vi, beforeEach } from "vitest";
import { createYcCompaniesTool } from "../../src/tools/jobs-yc.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("jobs_yc_companies", () => {
  const tool = createYcCompaniesTool();

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_yc_companies");
  });

  it("fetches hiring companies from YC API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          name: "Stripe",
          url: "https://stripe.com",
          description: "Payments infrastructure",
          batch: "S2010",
          industries: ["Fintech"],
          tags: ["developer-tools"],
          isHiring: true,
          teamSize: 5000,
        },
      ]),
    });

    const result = await tool.execute("test", { hiring_only: true });
    expect(result.details.companies).toHaveLength(1);
    expect(result.details.companies[0].name).toBe("Stripe");
  });

  it("filters by query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { name: "Stripe", description: "Payments", isHiring: true },
        { name: "Airbnb", description: "Travel", isHiring: true },
      ]),
    });

    const result = await tool.execute("test", { hiring_only: true, query: "payment" });
    expect(result.details.companies).toHaveLength(1);
  });
});
