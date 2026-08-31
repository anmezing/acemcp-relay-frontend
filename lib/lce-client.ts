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

// Next.js only inlines browser-visible variables when each process.env key is
// referenced statically. Keep the injectable object for tests, but do not pass
// process.env through an alias in client code.
const publicClientLaunchEnvironment = Object.freeze({
  NEXT_PUBLIC_LCE_CLIENT_PACKAGE_RUNNER: process.env.NEXT_PUBLIC_LCE_CLIENT_PACKAGE_RUNNER,
  NEXT_PUBLIC_LCE_CLIENT_PACKAGE_RUNNER_ARGS: process.env.NEXT_PUBLIC_LCE_CLIENT_PACKAGE_RUNNER_ARGS,
  NEXT_PUBLIC_LCE_CLIENT_PACKAGE_NAME: process.env.NEXT_PUBLIC_LCE_CLIENT_PACKAGE_NAME,
  NEXT_PUBLIC_LCE_CLIENT_PACKAGE_TAG: process.env.NEXT_PUBLIC_LCE_CLIENT_PACKAGE_TAG,
  NEXT_PUBLIC_LCE_CLIENT_GLOBAL_EXECUTABLE: process.env.NEXT_PUBLIC_LCE_CLIENT_GLOBAL_EXECUTABLE,
});

export function clientLaunchPolicy(
  env: Readonly<Record<string, string | undefined>> = publicClientLaunchEnvironment,
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
