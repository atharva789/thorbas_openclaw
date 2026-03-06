import { readFileSync, existsSync } from "fs";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

interface H1bRow {
  fiscalYear: string;
  employer: string;
  initialApproval: number;
  initialDenial: number;
  continuingApproval: number;
  continuingDenial: number;
}

function parseH1bCsv(csvPath: string): H1bRow[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n").slice(1); // skip header
  const rows: H1bRow[] = [];

  for (const line of lines) {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 6) continue;
    rows.push({
      fiscalYear: cols[0],
      employer: cols[1].toUpperCase(),
      initialApproval: parseInt(cols[2], 10) || 0,
      initialDenial: parseInt(cols[3], 10) || 0,
      continuingApproval: parseInt(cols[4], 10) || 0,
      continuingDenial: parseInt(cols[5], 10) || 0,
    });
  }
  return rows;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createVisaSponsorCheckTool(h1bCsvPath: string): any {
  return {
    name: "jobs_visa_sponsor_check",
    label: "Visa Sponsor Check",
    description:
      "Check if a company has a history of sponsoring H-1B visas using USCIS employer data. " +
      "Returns: confirmed (filed petitions), unknown (not in database), or denied_history (high denial rate). " +
      "This is a soft signal — not a guarantee of future sponsorship.",
    parameters: Type.Object({
      company_name: Type.String({ description: "Company name to look up (e.g., 'Google', 'Stripe')." }),
    }),
    async execute(_toolCallId: string, params: { company_name: string }) {
      if (!existsSync(h1bCsvPath)) {
        return jsonResult({
          status: "unknown",
          company: params.company_name,
          message: `H-1B data file not found at ${h1bCsvPath}. Run setup.sh to download USCIS data.`,
        });
      }

      try {
        const rows = parseH1bCsv(h1bCsvPath);
        const searchName = params.company_name.toUpperCase();

        const matches = rows.filter((r) => r.employer.includes(searchName));

        if (matches.length === 0) {
          return jsonResult({ status: "unknown", company: params.company_name, petitions_filed: 0 });
        }

        let totalApproved = 0;
        let totalDenied = 0;
        let mostRecentYear = "";

        for (const m of matches) {
          totalApproved += m.initialApproval + m.continuingApproval;
          totalDenied += m.initialDenial + m.continuingDenial;
          if (m.fiscalYear > mostRecentYear) mostRecentYear = m.fiscalYear;
        }

        const totalFiled = totalApproved + totalDenied;
        const approvalRate = totalFiled > 0 ? Math.round((totalApproved / totalFiled) * 100) : 0;

        const status = approvalRate < 50 ? "denied_history" : "confirmed";

        return jsonResult({
          status,
          company: params.company_name,
          petitions_filed: totalFiled,
          approval_rate: approvalRate,
          most_recent_year: mostRecentYear,
          matched_employers: matches.map((m) => m.employer).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5),
        });
      } catch (err) {
        return jsonResult({
          status: "unknown",
          company: params.company_name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
