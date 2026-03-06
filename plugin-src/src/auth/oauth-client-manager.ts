/**
 * Stub type for OAuthClientManager — the real implementation lives in the
 * upstream mxy680/omniclaw repo. This stub exists so TypeScript tools that
 * reference the type can compile in isolation.
 */
export interface OAuthClientManager {
  listAccounts(): string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getClient(account: string): any;
}
