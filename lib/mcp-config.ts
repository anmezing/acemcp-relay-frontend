const KEY_PLACEHOLDER = "YOUR_API_KEY";
// npx 每次启动解析 @latest 并使用缓存，客户端更新随 npm 发布自动到达用户，
// 无需安装命令、无需本地路径（也因此不存在 ~ 展开问题）。
const CLOUD_PACKAGE = "@anmezing/lce-cloud@latest";

// ── Cloud Mode (stdio, 推荐) ──────────────────────────────────

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
