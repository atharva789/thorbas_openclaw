import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAshbyJobsTool(): any {
  return {
    name: "jobs_ashby_list",
    label: "Ashby List Jobs",
    description:
      "List open jobs from an Ashby job board. Requires the board_name (e.g., 'coolstartup' from jobs.ashbyhq.com/coolstartup).",
    parameters: Type.Object({
      board_name: Type.String({ description: "Ashby board name (from jobs.ashbyhq.com/{name})." }),
      include_compensation: Type.Optional(
        Type.Boolean({ description: "Include compensation data. Defaults to true.", default: true }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { board_name: string; include_compensation?: boolean },
    ) {
      try {
        const incComp = params.include_compensation !== false;
        const url = `https://api.ashbyhq.com/posting-api/job-board/${params.board_name}?includeCompensation=${incComp}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) {
          return jsonResult({ error: "api_error", status: resp.status, message: resp.statusText });
        }
        const data = (await resp.json()) as { jobs: Array<Record<string, unknown>> };

        const jobs = (data.jobs ?? []).map((j) => ({
          id: j.id,
          title: j.title,
          location: j.location ?? j.locationName ?? "",
          department: j.department ?? j.departmentName ?? "",
          employment_type: j.employmentType ?? "",
          compensation: j.compensationTierSummary ?? j.compensation ?? "",
        }));

        return jsonResult({ board_name: params.board_name, count: jobs.length, jobs });
      } catch (err) {
        return jsonResult({ error: "fetch_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAshbyApplyTool(): any {
  return {
    name: "jobs_ashby_apply",
    label: "Ashby Apply",
    description:
      "Submit a job application via Ashby's posting API. Requires job_posting_id and applicant info.",
    parameters: Type.Object({
      job_posting_id: Type.String({ description: "Ashby job posting ID from jobs_ashby_list." }),
      first_name: Type.String({ description: "Applicant first name." }),
      last_name: Type.String({ description: "Applicant last name." }),
      email: Type.String({ description: "Applicant email." }),
      phone: Type.Optional(Type.String({ description: "Phone number." })),
      linkedin_url: Type.Optional(Type.String({ description: "LinkedIn profile URL." })),
      resume_url: Type.Optional(Type.String({ description: "URL to resume file." })),
      form_answers: Type.Optional(
        Type.Record(Type.String(), Type.String(), { description: "Custom form answers as { field_id: value }." }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        job_posting_id: string;
        first_name: string;
        last_name: string;
        email: string;
        phone?: string;
        linkedin_url?: string;
        resume_url?: string;
        form_answers?: Record<string, string>;
      },
    ) {
      try {
        const body = {
          jobPostingId: params.job_posting_id,
          applicationForm: {
            firstName: params.first_name,
            lastName: params.last_name,
            email: params.email,
            phone: params.phone,
            linkedInUrl: params.linkedin_url,
            resumeUrl: params.resume_url,
            ...(params.form_answers ?? {}),
          },
        };

        const resp = await fetch("https://api.ashbyhq.com/applicationForm.submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => resp.statusText);
          return jsonResult({ success: false, error: "api_error", status: resp.status, message: errText });
        }

        const data = (await resp.json()) as Record<string, unknown>;
        return jsonResult({ success: true, applicationId: data.applicationId ?? null });
      } catch (err) {
        return jsonResult({ success: false, error: "submit_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
