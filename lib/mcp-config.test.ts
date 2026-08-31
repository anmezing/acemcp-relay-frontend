import { describe, expect, it } from "vitest";
import type { ClientLaunchPolicy } from "./lce-client";
import { buildCloudMcpConfigJson, buildCloudMcpConfigToml } from "./mcp-config";

const launchPolicy: ClientLaunchPolicy = {
  packageRunnerCommand: "configured-package-runner",
  packageRunnerArgsPrefix: ["--accept"],
  packageSpecifier: "configured-client@stable",
  installedClientCommand: "configured-installed-client",
};

describe("MCP config", () => {
  describe("cloud stdio mode", () => {
    it("uses the configured package-runner policy with an api key", () => {
      const config = JSON.parse(
        buildCloudMcpConfigJson("sk-test", undefined, "package-runner", launchPolicy),
      );

      expect(config).toEqual({
        mcpServers: {
          lce: {
            command: "configured-package-runner",
            args: ["--accept", "configured-client@stable", "--key", "sk-test"],
          },
        },
      });
    });

    it("generates placeholder config without key", () => {
      const config = JSON.parse(
        buildCloudMcpConfigJson(null, undefined, "package-runner", launchPolicy),
      );
      expect(config.mcpServers.lce.args).toEqual([
        "--accept",
        "configured-client@stable",
        "--key",
        "YOUR_API_KEY",
      ]);
    });

    it("uses the configured already-installed client command", () => {
      const config = JSON.parse(
        buildCloudMcpConfigJson("sk-test", undefined, "global", launchPolicy),
      );
      expect(config.mcpServers.lce).toEqual({
        command: "configured-installed-client",
        args: ["--key", "sk-test"],
      });

      const toml = buildCloudMcpConfigToml("sk-test", undefined, "global", launchPolicy);
      expect(toml).toContain('command = "configured-installed-client"');
      expect(toml).toContain('args = ["--key", "sk-test"]');
    });

    it("generates TOML from the configured launcher", () => {
      const toml = buildCloudMcpConfigToml(
        "sk-test",
        undefined,
        "package-runner",
        launchPolicy,
      );
      expect(toml).toContain('command = "configured-package-runner"');
      expect(toml).toContain('"configured-client@stable"');
      expect(toml).toContain('"sk-test"');
    });

    it("adds an explicit project root for hosts without roots/list", () => {
      const windowsPath = "D:\\code\\project with spaces";
      const config = JSON.parse(
        buildCloudMcpConfigJson("sk-test", windowsPath, "package-runner", launchPolicy),
      );
      expect(config.mcpServers.lce.args).toEqual([
        "--accept",
        "configured-client@stable",
        "--key",
        "sk-test",
        "--repo",
        windowsPath,
      ]);

      const toml = buildCloudMcpConfigToml(
        "sk-test",
        windowsPath,
        "package-runner",
        launchPolicy,
      );
      expect(toml).toContain('"--repo", "D:\\\\code\\\\project with spaces"');
    });

    it("omits blank project roots", () => {
      const config = JSON.parse(
        buildCloudMcpConfigJson("sk-test", "   ", "package-runner", launchPolicy),
      );
      expect(config.mcpServers.lce.args).not.toContain("--repo");
    });
  });
});
