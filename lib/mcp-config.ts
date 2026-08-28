const KEY_PLACEHOLDER = "YOUR_API_KEY";
// npx 每次启动解析 @latest 并使用缓存，客户端更新随 npm 发布自动到达用户，
// 无需安装命令、无需本地路径（也因此不存在 ~ 展开问题）。
const CLOUD_PACKAGE = "@anmezing/lce-cloud@latest";

// ── Cloud Mode (stdio, 推荐) ──────────────────────────────────

function cloudArgs(apiKey: string | null, repoPath?: string): string[] {
  const args = ["-y", CLOUD_PACKAGE, "--key", apiKey || KEY_PLACEHOLDER];
  const normalizedRepoPath = repoPath?.trim();
  if (normalizedRepoPath) args.push("--repo", normalizedRepoPath);
  return args;
}

export function buildCloudMcpConfigJson(apiKey: string | null, repoPath?: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        lce: {
          command: "npx",
          args: cloudArgs(apiKey, repoPath),
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

export function buildCloudMcpConfigToml(apiKey: string | null, repoPath?: string): string {
  const args = cloudArgs(apiKey, repoPath).map(tomlString).join(", ");
  return [
    `[mcp_servers.lce]`,
    `command = "npx"`,
    `args = [${args}]`,
  ].join("\n");
}
