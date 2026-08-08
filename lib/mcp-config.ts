import { RELAY_URL } from "./relay";

const KEY_PLACEHOLDER = "YOUR_API_KEY";
const BOOT_PATH = "~/.lce/boot.js";

// ── Cloud Mode (stdio, 推荐) ──────────────────────────────────

export function buildCloudMcpConfigJson(apiKey: string | null): string {
  return JSON.stringify(
    {
      mcpServers: {
        lce: {
          command: "node",
          args: [BOOT_PATH, "--key", apiKey || KEY_PLACEHOLDER],
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
    `command = "node"`,
    `args = [${tomlString(BOOT_PATH)}, "--key", ${tomlString(apiKey || KEY_PLACEHOLDER)}]`,
  ].join("\n");
}

export const INSTALL_COMMAND = "curl -sL https://513689.xyz/boot.js -o ~/.lce/boot.js && curl -sL https://513689.xyz/lce-cloud.cjs -o ~/.lce/lce-cloud.cjs";
export const INSTALL_COMMAND_WIN = 'powershell -c "New-Item -ItemType Directory -Force $HOME\\.lce | Out-Null; Invoke-WebRequest https://513689.xyz/boot.js -OutFile $HOME\\.lce\\boot.js; Invoke-WebRequest https://513689.xyz/lce-cloud.cjs -OutFile $HOME\\.lce\\lce-cloud.cjs"';

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
