import { clientLaunchPolicy, type ClientLaunchPolicy } from "@/lib/lce-client";

const KEY_PLACEHOLDER = "YOUR_API_KEY";

export type McpLaunchMode = "package-runner" | "global";

function cloudArgs(
  apiKey: string | null,
  repoPath: string | undefined,
  launchMode: McpLaunchMode,
  policy: ClientLaunchPolicy,
): string[] {
  const args = launchMode === "global"
    ? ["--key", apiKey || KEY_PLACEHOLDER]
    : [
        ...policy.packageRunnerArgsPrefix,
        policy.packageSpecifier,
        "--key",
        apiKey || KEY_PLACEHOLDER,
      ];
  const normalizedRepoPath = repoPath?.trim();
  if (normalizedRepoPath) args.push("--repo", normalizedRepoPath);
  return args;
}

function requiredLaunchCommand(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required to generate this client launch mode`);
  return value;
}

function cloudCommand(launchMode: McpLaunchMode, policy: ClientLaunchPolicy): string {
  return launchMode === "global"
    ? requiredLaunchCommand("NEXT_PUBLIC_LCE_CLIENT_GLOBAL_EXECUTABLE", policy.installedClientCommand)
    : requiredLaunchCommand("NEXT_PUBLIC_LCE_CLIENT_PACKAGE_RUNNER", policy.packageRunnerCommand);
}

export function buildCloudMcpConfigJson(
  apiKey: string | null,
  repoPath?: string,
  launchMode: McpLaunchMode = "package-runner",
  policy: ClientLaunchPolicy = clientLaunchPolicy(),
): string {
  return JSON.stringify(
    {
      mcpServers: {
        lce: {
          command: cloudCommand(launchMode, policy),
          args: cloudArgs(apiKey, repoPath, launchMode, policy),
        },
      },
    },
    null,
    2,
  );
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildCloudMcpConfigToml(
  apiKey: string | null,
  repoPath?: string,
  launchMode: McpLaunchMode = "package-runner",
  policy: ClientLaunchPolicy = clientLaunchPolicy(),
): string {
  const args = cloudArgs(apiKey, repoPath, launchMode, policy).map(tomlString).join(", ");
  return [
    `[mcp_servers.lce]`,
    `command = ${tomlString(cloudCommand(launchMode, policy))}`,
    `args = [${args}]`,
  ].join("\n");
}
