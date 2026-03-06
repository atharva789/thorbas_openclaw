import { Type } from "@sinclair/typebox";
import { google } from "googleapis";
import type { OAuthClientManager } from "../auth/oauth-client-manager.js";
import { jsonResult, authRequired } from "./shared.js";

const AUTH_REQUIRED = authRequired("sheets");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createJobTrackerLogTool(clientManager: OAuthClientManager, sheetId: string): any {
  return {
    name: "jobs_tracker_log",
    label: "Job Tracker Log",
    description:
      "Log a job application to the tracking Google Sheet. Appends a row with date, company, role, ATS, status, URL, visa sponsor status, and notes. " +
      "Uses the configured tracking sheet.",
    parameters: Type.Object({
      company: Type.String({ description: "Company name." }),
      role: Type.String({ description: "Job title / role." }),
      ats: Type.Optional(Type.String({ description: "ATS platform (greenhouse, lever, ashby, etc.).", default: "unknown" })),
      url: Type.String({ description: "Job posting URL." }),
      status: Type.Optional(Type.String({ description: "Application status (e.g., 'Applied', 'Interested', 'Rejected').", default: "Applied" })),
      visa_sponsor: Type.Optional(Type.String({ description: "Visa sponsorship status (confirmed, unknown, denied_history).", default: "unknown" })),
      notes: Type.Optional(Type.String({ description: "Additional notes." })),
      account: Type.Optional(Type.String({ description: "Google account name. Defaults to 'default'.", default: "default" })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        company: string;
        role: string;
        ats?: string;
        url: string;
        status?: string;
        visa_sponsor?: string;
        notes?: string;
        account?: string;
      },
    ) {
      const account = params.account ?? "default";
      if (!clientManager.listAccounts().includes(account)) {
        return jsonResult(AUTH_REQUIRED);
      }

      const client = clientManager.getClient(account);
      const sheets = google.sheets({ version: "v4", auth: client });

      const dateApplied = new Date().toISOString().split("T")[0];
      const row = [
        dateApplied,
        params.company,
        params.role,
        params.ats ?? "unknown",
        params.status ?? "Applied",
        params.url,
        params.visa_sponsor ?? "unknown",
        params.notes ?? "",
      ];

      try {
        const res = await sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: "Sheet1",
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [row] },
        });

        return jsonResult({
          success: true,
          spreadsheet_id: sheetId,
          row_number: res.data.updates?.updatedRows ?? 1,
          data: {
            date: dateApplied,
            company: params.company,
            role: params.role,
            status: params.status ?? "Applied",
          },
        });
      } catch (err) {
        return jsonResult({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
