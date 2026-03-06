import { Type } from "@sinclair/typebox";
import { jsonResult } from "./shared.js";

// Rate limiter: max 2 requests/sec for Lever API
let lastLeverRequest = 0;
async function leverRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastLeverRequest;
  if (elapsed < 500) {
    await new Promise((r) => setTimeout(r, 500 - elapsed));
  }
  lastLeverRequest = Date.now();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createLeverJobsTool(): any {
  return {
    name: "jobs_lever_list",
    label: "Lever List Jobs",
    description:
      "List open job postings from a Lever career site. Requires the site_name (e.g., 'mycompany' from jobs.lever.co/mycompany).",
    parameters: Type.Object({
      site_name: Type.String({ description: "Lever site name (from jobs.lever.co/{site_name})." }),
      location: Type.Optional(Type.String({ description: "Filter by location." })),
      team: Type.Optional(Type.String({ description: "Filter by team name." })),
      commitment: Type.Optional(Type.String({ description: "Filter by commitment (e.g., 'Full-time', 'Intern')." })),
    }),
    async execute(
      _toolCallId: string,
      params: { site_name: string; location?: string; team?: string; commitment?: string },
    ) {
      try {
        await leverRateLimit();
        const url = `https://api.lever.co/v0/postings/${params.site_name}?mode=json`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) {
          return jsonResult({ error: "api_error", status: resp.status, message: resp.statusText });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let postings = (await resp.json()) as any[];

        let jobs = postings.map((p) => ({
          id: p.id,
          title: p.text,
          location: p.categories?.location ?? "",
          team: p.categories?.team ?? "",
          commitment: p.categories?.commitment ?? "",
          description_snippet: String(p.descriptionPlain ?? p.description ?? "").slice(0, 200),
          apply_url: p.applyUrl ?? `https://jobs.lever.co/${params.site_name}/${p.id}/apply`,
        }));

        if (params.location) {
          const loc = params.location.toLowerCase();
          jobs = jobs.filter((j) => j.location.toLowerCase().includes(loc));
        }
        if (params.team) {
          const t = params.team.toLowerCase();
          jobs = jobs.filter((j) => j.team.toLowerCase().includes(t));
        }
        if (params.commitment) {
          const c = params.commitment.toLowerCase();
          jobs = jobs.filter((j) => j.commitment.toLowerCase().includes(c));
        }

        return jsonResult({ site_name: params.site_name, count: jobs.length, jobs });
      } catch (err) {
        return jsonResult({ error: "fetch_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createLeverApplyTool(): any {
  return {
    name: "jobs_lever_apply",
    label: "Lever Apply",
    description:
      "Submit a job application to a Lever posting. Requires site_name, posting_id, name, and email.",
    parameters: Type.Object({
      site_name: Type.String({ description: "Lever site name." }),
      posting_id: Type.String({ description: "Posting ID from jobs_lever_list." }),
      name: Type.String({ description: "Full name of applicant." }),
      email: Type.String({ description: "Applicant email." }),
      phone: Type.Optional(Type.String({ description: "Phone number." })),
      resume_url: Type.Optional(Type.String({ description: "URL to resume file." })),
      urls: Type.Optional(
        Type.Record(Type.String(), Type.String(), { description: "Profile URLs, e.g. { 'LinkedIn': 'https://...' }." }),
      ),
      comments: Type.Optional(Type.String({ description: "Additional comments or cover letter." })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        site_name: string;
        posting_id: string;
        name: string;
        email: string;
        phone?: string;
        resume_url?: string;
        urls?: Record<string, string>;
        comments?: string;
      },
    ) {
      try {
        await leverRateLimit();
        const url = `https://api.lever.co/v0/postings/${params.site_name}/${params.posting_id}`;

        const formData = new FormData();
        formData.append("name", params.name);
        formData.append("email", params.email);
        if (params.phone) formData.append("phone", params.phone);
        if (params.resume_url) formData.append("resume", params.resume_url);
        if (params.comments) formData.append("comments", params.comments);
        if (params.urls) {
          for (const [label, link] of Object.entries(params.urls)) {
            formData.append(`urls[${label}]`, link);
          }
        }

        const resp = await fetch(url, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(30_000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => resp.statusText);
          return jsonResult({ ok: false, error: "api_error", status: resp.status, message: errText });
        }

        const data = (await resp.json()) as Record<string, unknown>;
        return jsonResult({ ok: true, applicationId: data.applicationId ?? null });
      } catch (err) {
        return jsonResult({ ok: false, error: "submit_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
