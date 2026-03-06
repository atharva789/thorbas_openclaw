// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentToolResult = any;

export function jsonResult(payload: unknown): AgentToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

/**
 * Returns a standard auth-required error object directing the LLM to the
 * correct auth setup tool for the given service.
 */
export function authRequired(service: string) {
  return {
    error: "auth_required",
    action: `Call ${service}_auth_setup to authenticate.`,
  };
}
