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
    it("generates stdio config with command and args", () => {
      const config = JSON.parse(buildCloudMcpConfigJson("sk-test", "~/lce-cloud.js"));

      expect(config).toEqual({
        mcpServers: {
          lce: {
            command: "node",
            args: ["~/lce-cloud.js", "--key", "sk-test"],
          },
        },
      });
    });

    it("generates placeholder config without key", () => {
      const config = JSON.parse(buildCloudMcpConfigJson(null, "~/lce-cloud.js"));

      expect(config.mcpServers.lce.args).toEqual(["~/lce-cloud.js", "--key", "YOUR_API_KEY"]);
    });

    it("generates TOML config", () => {
      const toml = buildCloudMcpConfigToml("sk-test", "~/lce-cloud.js");

      expect(toml).toContain('command = "node"');
      expect(toml).toContain('"~/lce-cloud.js"');
      expect(toml).toContain('"sk-test"');
    });
  });
});
