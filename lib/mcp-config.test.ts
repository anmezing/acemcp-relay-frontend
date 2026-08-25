import { describe, expect, it } from "vitest";
import { buildCloudMcpConfigJson, buildCloudMcpConfigToml } from "./mcp-config";

describe("MCP config", () => {
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
