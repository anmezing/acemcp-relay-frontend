import { createHash } from "node:crypto";

const CONSOLE_TOKEN_HEADER = "X-LCE-Console-Token";
const CONSOLE_TOKEN_CONTEXT = "acemcp-relay-console:";

export function getRelayConsoleHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  const secret = process.env.BETTER_AUTH_SECRET?.trim();

  if (secret) {
    headers[CONSOLE_TOKEN_HEADER] = createHash("sha256")
      .update(`${CONSOLE_TOKEN_CONTEXT}${secret}`)
      .digest("hex");
  }

  return headers;
}
