export const LCE_CLIENT_PACKAGE_NAME = "@anmezing/lce-cloud";

function stringArraySetting(name: string, raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be a JSON string array`);
  }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error(`${name} must be a JSON string array`);
  }
  return parsed;
}

export interface ClientLaunchPolicy {
  packageRunnerCommand?: string;
  packageRunnerArgsPrefix: readonly string[];
  packageSpecifier: string;
  installedClientCommand?: string;
}

export function clientLaunchPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ClientLaunchPolicy {
  const packageName = env.NEXT_PUBLIC_LCE_CLIENT_PACKAGE_NAME?.trim() || LCE_CLIENT_PACKAGE_NAME;
  const packageTag = env.NEXT_PUBLIC_LCE_CLIENT_PACKAGE_TAG?.trim() || "latest";
  return Object.freeze({
    packageRunnerCommand: env.NEXT_PUBLIC_LCE_CLIENT_PACKAGE_RUNNER?.trim() || undefined,
    packageRunnerArgsPrefix: Object.freeze(stringArraySetting(
      "NEXT_PUBLIC_LCE_CLIENT_PACKAGE_RUNNER_ARGS",
      env.NEXT_PUBLIC_LCE_CLIENT_PACKAGE_RUNNER_ARGS,
    )),
    packageSpecifier: `${packageName}@${packageTag}`,
    installedClientCommand: env.NEXT_PUBLIC_LCE_CLIENT_GLOBAL_EXECUTABLE?.trim() || undefined,
  });
}
