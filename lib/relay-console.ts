import { createHash } from "node:crypto";

const CONSOLE_TOKEN_HEADER = "X-LCE-Console-Token";
const CONSOLE_TOKEN_CONTEXT = "acemcp-relay-console:";

export function getRelayAdminHeaders(): Record<string, string> {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) return {};
  return {
    [CONSOLE_TOKEN_HEADER]: createHash("sha256")
      .update(`${CONSOLE_TOKEN_CONTEXT}${secret}`)
      .digest("hex"),
  };
}

export function getRelayConsoleHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    ...getRelayAdminHeaders(),
  };
  return headers;
}
