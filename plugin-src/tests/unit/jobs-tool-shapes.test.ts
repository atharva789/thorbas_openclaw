import { describe, it, expect } from "vitest";
import { createAtsDetectTool } from "../../src/tools/jobs-ats-detect.js";
import { createGreenhouseJobsTool, createGreenhouseApplyTool } from "../../src/tools/jobs-greenhouse.js";
import { createLeverJobsTool, createLeverApplyTool } from "../../src/tools/jobs-lever.js";
import { createAshbyJobsTool, createAshbyApplyTool } from "../../src/tools/jobs-ashby.js";
import { createYcCompaniesTool } from "../../src/tools/jobs-yc.js";
import { createHnHiringSearchTool } from "../../src/tools/jobs-hn-hiring.js";
import { createVisaSponsorCheckTool } from "../../src/tools/jobs-visa-check.js";
import { createJobspySearchTool } from "../../src/tools/jobs-scraper-bridge.js";

const ALL_TOOLS = [
  createAtsDetectTool("http://localhost:8787"),
  createGreenhouseJobsTool(),
  createGreenhouseApplyTool(),
  createLeverJobsTool(),
  createLeverApplyTool(),
  createAshbyJobsTool(),
  createAshbyApplyTool(),
  createYcCompaniesTool(),
  createHnHiringSearchTool(),
  createVisaSponsorCheckTool("/fake/path.csv"),
  createJobspySearchTool("http://localhost:8787"),
];

describe("All job tools", () => {
  it("each tool has name, label, description, parameters, execute", () => {
    for (const tool of ALL_TOOLS) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.label).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.parameters).toBe("object");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("all tool names start with 'jobs_'", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toMatch(/^jobs_/);
    }
  });

  it("all tool names are unique", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("produces 11 tools (tracker excluded — requires OAuth)", () => {
    expect(ALL_TOOLS).toHaveLength(11);
  });
});
