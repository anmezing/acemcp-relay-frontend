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

    it("adds an explicit project root for MCP clients without roots/list", () => {
      const windowsPath = "D:\\code\\project with spaces";
      const config = JSON.parse(buildCloudMcpConfigJson("sk-test", windowsPath));
      expect(config.mcpServers.lce.args).toEqual([
        "-y",
        "@anmezing/lce-cloud@latest",
        "--key",
        "sk-test",
        "--repo",
        windowsPath,
      ]);

      const toml = buildCloudMcpConfigToml("sk-test", windowsPath);
      expect(toml).toContain('"--repo", "D:\\\\code\\\\project with spaces"');
    });

    it("omits blank project roots", () => {
      const config = JSON.parse(buildCloudMcpConfigJson("sk-test", "   "));
      expect(config.mcpServers.lce.args).not.toContain("--repo");
    });
  });
});
