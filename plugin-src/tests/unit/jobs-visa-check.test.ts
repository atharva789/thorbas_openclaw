import { describe, it, expect, vi, beforeEach } from "vitest";
import { createVisaSponsorCheckTool } from "../../src/tools/jobs-visa-check.js";
import * as fs from "fs";

vi.mock("fs");
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockExistsSync = vi.mocked(fs.existsSync);

describe("jobs_visa_sponsor_check", () => {
  const tool = createVisaSponsorCheckTool("/fake/path/h1b_data.csv");

  beforeEach(() => vi.clearAllMocks());

  it("has correct tool shape", () => {
    expect(tool.name).toBe("jobs_visa_sponsor_check");
  });

  it("returns confirmed when company found in CSV", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "Fiscal Year,Employer,Initial Approval,Initial Denial,Continuing Approval,Continuing Denial\n" +
      "2024,GOOGLE LLC,5000,50,3000,30\n" +
      "2024,ACME CORP,100,10,50,5\n",
    );

    const result = await tool.execute("test", { company_name: "Google" });
    expect(result.details.status).toBe("confirmed");
    expect(result.details.petitions_filed).toBeGreaterThan(0);
  });

  it("returns unknown when company not found", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "Fiscal Year,Employer,Initial Approval,Initial Denial,Continuing Approval,Continuing Denial\n" +
      "2024,GOOGLE LLC,5000,50,3000,30\n",
    );

    const result = await tool.execute("test", { company_name: "NonexistentCorp" });
    expect(result.details.status).toBe("unknown");
  });

  it("returns unknown when CSV file does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await tool.execute("test", { company_name: "Google" });
    expect(result.details.status).toBe("unknown");
    expect(result.details.message).toContain("not found");
  });
});
