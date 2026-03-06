import { describe, it, expect } from "vitest";
import { createJobTrackerLogTool } from "../../src/tools/jobs-tracker.js";

const mockClientManager = {
  listAccounts: () => ["default"],
  getClient: () => ({}),
};

describe("jobs_tracker_log", () => {
  const tool = createJobTrackerLogTool(
    mockClientManager as any,
    "1EHOO6p87ERIgvmTkiSbn9kG__lSeStpwf8uV4Y-soS4",
  );

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_tracker_log");
    expect(typeof tool.execute).toBe("function");
  });

  it("has required parameters", () => {
    const params = tool.parameters;
    expect(params).toBeDefined();
  });
});
