import { describe, expect, it } from "vitest";
import { buildMcpConfigJson, buildMcpConfigToml } from "./mcp-config";
import { RELAY_URL } from "./relay";

describe("MCP config", () => {
  it("includes the registered client header in the homepage placeholder config", () => {
    const config = JSON.parse(buildMcpConfigJson(null, null));

    expect(config).toEqual({
      mcpServers: {
        lce: {
          url: `${RELAY_URL}/mcp`,
          headers: {
            Authorization: "Bearer YOUR_API_KEY",
            "X-Client-Id": "YOUR_CLIENT_ID",
          },
        },
      },
    });
  });

  it("uses the same credentials in JSON and Codex TOML configs", () => {
    const json = buildMcpConfigJson("key-value", "client-value");
    const toml = buildMcpConfigToml("key-value", "client-value");

    expect(json).toContain('"Authorization": "Bearer key-value"');
    expect(json).toContain('"X-Client-Id": "client-value"');
    expect(toml).toContain('Authorization = "Bearer key-value"');
    expect(toml).toContain('"X-Client-Id" = "client-value"');
  });
});
