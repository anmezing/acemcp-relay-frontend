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

    it("generates a config for an already-installed global client", () => {
      const config = JSON.parse(buildCloudMcpConfigJson("sk-test", undefined, "global"));

      expect(config).toEqual({
        mcpServers: {
          lce: {
            command: "lce-cloud",
            args: ["--key", "sk-test"],
          },
        },
      });

      const toml = buildCloudMcpConfigToml("sk-test", undefined, "global");
      expect(toml).toContain('command = "lce-cloud"');
      expect(toml).toContain('args = ["--key", "sk-test"]');
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

      const globalConfig = JSON.parse(buildCloudMcpConfigJson("sk-test", windowsPath, "global"));
      expect(globalConfig.mcpServers.lce).toEqual({
        command: "lce-cloud",
        args: ["--key", "sk-test", "--repo", windowsPath],
      });
    });

    it("omits blank project roots", () => {
      const config = JSON.parse(buildCloudMcpConfigJson("sk-test", "   "));
      expect(config.mcpServers.lce.args).not.toContain("--repo");
    });
  });
});
