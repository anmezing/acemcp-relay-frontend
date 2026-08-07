import { RELAY_URL } from "./relay";

const KEY_PLACEHOLDER = "YOUR_API_KEY";
const DEVICE_PLACEHOLDER = "YOUR_CLIENT_ID";

// MCP 配置的唯一构造点：展示（未取到值时用占位符）与一键复制共用。
// X-Client-Id 必须带上：生产 relay 为 DEVICE_BINDING_MODE=enforce，
// 缺失或未登记的设备 ID 会被 401（见 acemcp-relay/devices.go checkDeviceBinding）。

export function buildMcpConfigJson(apiKey: string | null, deviceId: string | null): string {
  return JSON.stringify(
    {
      mcpServers: {
        lce: {
          url: `${RELAY_URL}/mcp`,
          headers: {
            Authorization: `Bearer ${apiKey || KEY_PLACEHOLDER}`,
            "X-Client-Id": deviceId || DEVICE_PLACEHOLDER,
          },
        },
      },
    },
    null,
    2
  );
}

// TOML 基本字符串转义：仅需处理反斜杠与双引号（密钥/设备 ID 均为可见 ASCII）
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildMcpConfigToml(apiKey: string | null, deviceId: string | null): string {
  return [
    `[mcp_servers.lce]`,
    `url = ${tomlString(`${RELAY_URL}/mcp`)}`,
    `enabled = true`,
    ``,
    `[mcp_servers.lce.http_headers]`,
    `Authorization = ${tomlString(`Bearer ${apiKey || KEY_PLACEHOLDER}`)}`,
    `"X-Client-Id" = ${tomlString(deviceId || DEVICE_PLACEHOLDER)}`,
  ].join("\n");
}
