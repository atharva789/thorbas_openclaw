/**
 * PATCH REFERENCE — Modify VALID_SERVICES in agent-config.ts
 *
 * Add "jobs" to the VALID_SERVICES array so agents can be granted
 * permission to use job-prefixed tools.
 */

// Change from:
export const VALID_SERVICES = [
  "gmail", "calendar", "drive", "docs", "sheets", "slides", "youtube", "schedule", "github",
] as const;

// Change to:
export const VALID_SERVICES = [
  "gmail", "calendar", "drive", "docs", "sheets", "slides", "youtube", "schedule", "github", "jobs",
] as const;
