import { RELAY_URL } from "./relay";

const KEY_PLACEHOLDER = "YOUR_API_KEY";

// ── Cloud Mode (stdio, 推荐) ──────────────────────────────────

const CLOUD_PACKAGE = "@anmezing/lce-cloud";

export function buildCloudMcpConfigJson(apiKey: string | null): string {
  return JSON.stringify(
    {
      mcpServers: {
        lce: {
          command: "npx",
          args: ["-y", CLOUD_PACKAGE, "--key", apiKey || KEY_PLACEHOLDER],
        },
      },
    },
    null,
    2
  );
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildCloudMcpConfigToml(apiKey: string | null): string {
  return [
    `[mcp_servers.lce]`,
    `command = "npx"`,
    `args = ["-y", ${tomlString(CLOUD_PACKAGE)}, "--key", ${tomlString(apiKey || KEY_PLACEHOLDER)}]`,
  ].join("\n");
}

// ── Remote HTTP Mode (备选) ──────────────────────────────────

export function buildMcpConfigJson(apiKey: string | null): string {
  return JSON.stringify(
    {
      mcpServers: {
        lce: {
          type: "http",
          url: `${RELAY_URL}/mcp`,
          headers: {
            Authorization: `Bearer ${apiKey || KEY_PLACEHOLDER}`,
          },
        },
      },
    },
    null,
    2
  );
}

export function buildMcpConfigToml(apiKey: string | null): string {
  return [
    `[mcp_servers.lce]`,
    `url = ${tomlString(`${RELAY_URL}/mcp`)}`,
    `enabled = true`,
    ``,
    `[mcp_servers.lce.http_headers]`,
    `Authorization = ${tomlString(`Bearer ${apiKey || KEY_PLACEHOLDER}`)}`,
  ].join("\n");
}
