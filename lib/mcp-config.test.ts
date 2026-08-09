import { describe, expect, it } from "vitest";
import { buildMcpConfigJson, buildMcpConfigToml, buildCloudMcpConfigJson, buildCloudMcpConfigToml } from "./mcp-config";
import { RELAY_URL } from "./relay";

describe("MCP config", () => {
  describe("remote HTTP mode", () => {
    it("generates placeholder config without key", () => {
      const config = JSON.parse(buildMcpConfigJson(null));

      expect(config).toEqual({
        mcpServers: {
          lce: {
            type: "http",
            url: `${RELAY_URL}/mcp`,
            headers: {
              Authorization: "Bearer YOUR_API_KEY",
            },
          },
        },
      });
    });

    it("uses the same credentials in JSON and TOML", () => {
      const json = buildMcpConfigJson("key-value");
      const toml = buildMcpConfigToml("key-value");

      expect(json).toContain('"Authorization": "Bearer key-value"');
      expect(json).toContain('"type": "http"');
      expect(toml).toContain('Authorization = "Bearer key-value"');
    });
  });

  describe("cloud stdio mode", () => {
    it("generates npx config with api key", () => {
      const config = JSON.parse(buildCloudMcpConfigJson("sk-test"));

      expect(config).toEqual({
        mcpServers: {
          lce: {
            command: "npx",
            args: ["-y", "@anmezing/lce-cloud@latest", "--key", "sk-test"],
          },
        },
      });
    });

    it("generates placeholder config without key", () => {
      const config = JSON.parse(buildCloudMcpConfigJson(null));

      expect(config.mcpServers.lce.args).toEqual([
        "-y",
        "@anmezing/lce-cloud@latest",
        "--key",
        "YOUR_API_KEY",
      ]);
    });

    it("generates TOML config", () => {
      const toml = buildCloudMcpConfigToml("sk-test");

      expect(toml).toContain('command = "npx"');
      expect(toml).toContain('"@anmezing/lce-cloud@latest"');
      expect(toml).toContain('"sk-test"');
    });
  });
});
