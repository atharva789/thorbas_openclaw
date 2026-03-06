import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createGreenhouseJobsTool(): any {
  return {
    name: "jobs_greenhouse_list",
    label: "Greenhouse List Jobs",
    description:
      "List open jobs from a Greenhouse job board. Requires the board_token (e.g., 'acmecorp' from boards.greenhouse.io/acmecorp). " +
      "Returns job IDs, titles, locations, departments, and description snippets.",
    parameters: Type.Object({
      board_token: Type.String({ description: "Greenhouse board token (from the careers page URL)." }),
      query: Type.Optional(Type.String({ description: "Search keyword to filter jobs." })),
      location: Type.Optional(Type.String({ description: "Filter by location name." })),
      department: Type.Optional(Type.String({ description: "Filter by department name." })),
    }),
    async execute(
      _toolCallId: string,
      params: { board_token: string; query?: string; location?: string; department?: string },
    ) {
      try {
        const url = `https://boards-api.greenhouse.io/v1/boards/${params.board_token}/jobs?content=true`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) {
          return jsonResult({ error: "api_error", status: resp.status, message: resp.statusText });
        }
        const data = (await resp.json()) as { jobs: Array<Record<string, unknown>> };

        let jobs = data.jobs.map((j: Record<string, unknown>) => ({
          id: j.id,
          title: j.title as string,
          location: (j.location as Record<string, unknown>)?.name ?? "",
          department: ((j.departments as Array<Record<string, unknown>>) ?? [])[0]?.name ?? "",
          description_snippet: String(j.content ?? "").replace(/<[^>]+>/g, "").slice(0, 200),
          url: `https://boards.greenhouse.io/${params.board_token}/jobs/${j.id}`,
        }));

        if (params.query) {
          const q = params.query.toLowerCase();
          jobs = jobs.filter(
            (j) => j.title.toLowerCase().includes(q) || j.description_snippet.toLowerCase().includes(q),
          );
        }
        if (params.location) {
          const loc = params.location.toLowerCase();
          jobs = jobs.filter((j) => j.location.toLowerCase().includes(loc));
        }
        if (params.department) {
          const dep = params.department.toLowerCase();
          jobs = jobs.filter((j) => j.department.toLowerCase().includes(dep));
        }

        return jsonResult({ board_token: params.board_token, count: jobs.length, jobs });
      } catch (err) {
        return jsonResult({ error: "fetch_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createGreenhouseApplyTool(): any {
  return {
    name: "jobs_greenhouse_apply",
    label: "Greenhouse Apply",
    description:
      "Submit a job application to a Greenhouse job board. Requires board_token, job_id, and applicant info. " +
      "The resume should be a local file path (e.g., from Google Drive download).",
    parameters: Type.Object({
      board_token: Type.String({ description: "Greenhouse board token." }),
      job_id: Type.Number({ description: "Greenhouse job ID (from jobs_greenhouse_list)." }),
      first_name: Type.String({ description: "Applicant first name." }),
      last_name: Type.String({ description: "Applicant last name." }),
      email: Type.String({ description: "Applicant email address." }),
      phone: Type.Optional(Type.String({ description: "Phone number." })),
      resume_url: Type.Optional(Type.String({ description: "URL to resume file (publicly accessible)." })),
      cover_letter: Type.Optional(Type.String({ description: "Cover letter text." })),
      linkedin_url: Type.Optional(Type.String({ description: "LinkedIn profile URL." })),
      answers: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: "Custom question answers as { question_id: answer }.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        board_token: string;
        job_id: number;
        first_name: string;
        last_name: string;
        email: string;
        phone?: string;
        resume_url?: string;
        cover_letter?: string;
        linkedin_url?: string;
        answers?: Record<string, string>;
      },
    ) {
      try {
        const url = `https://boards-api.greenhouse.io/v1/boards/${params.board_token}/jobs/${params.job_id}`;

        const formData = new FormData();
        formData.append("first_name", params.first_name);
        formData.append("last_name", params.last_name);
        formData.append("email", params.email);
        if (params.phone) formData.append("phone", params.phone);
        if (params.resume_url) formData.append("resume", params.resume_url);
        if (params.cover_letter) formData.append("cover_letter", params.cover_letter);
        if (params.linkedin_url) formData.append("linkedin_profile_url", params.linkedin_url);

        if (params.answers) {
          for (const [key, value] of Object.entries(params.answers)) {
            formData.append(`question_${key}`, value);
          }
        }

        const resp = await fetch(url, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(30_000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => resp.statusText);
          return jsonResult({ success: false, error: "api_error", status: resp.status, message: errText });
        }

        const data = (await resp.json()) as Record<string, unknown>;
        return jsonResult({
          success: true,
          application_id: data.id ?? data.application_id ?? null,
          status: data.status ?? "submitted",
        });
      } catch (err) {
        return jsonResult({ success: false, error: "submit_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
