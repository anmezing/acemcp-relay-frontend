import { getRelayAdminHeaders } from "@/lib/relay-console";

export const LCE_CLOUD_PACKAGE = "@anmezing/lce-cloud";
export const LCE_CLOUD_UPGRADE_COMMAND = `npm install -g ${LCE_CLOUD_PACKAGE}@latest`;

const RELAY_URL = process.env.LCE_RELAY_URL || "http://relay:3009";
const RELAY_POLICY_URL = `${RELAY_URL}/internal/client-version-policy`;
const NPM_LATEST_URL = "https://registry.npmjs.org/@anmezing%2Flce-cloud/latest";
const CLIENT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface RelayClientVersionPolicy {
  packageName: string;
  minimumVersion: string | null;
  indexClientVersionRequired: boolean;
}

export interface ClientVersionSummary extends RelayClientVersionPolicy {
  latestVersion: string | null;
  latestVersionSource: "npm" | null;
  warnings: string[];
}

function optionalVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const version = value.trim();
  return CLIENT_VERSION_PATTERN.test(version) ? version : null;
}

async function responseMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error.trim()
    ? body.error.trim()
    : `HTTP ${response.status}`;
}

export async function fetchPublishedClientVersion(): Promise<string> {
  const response = await fetch(NPM_LATEST_URL, {
    headers: { Accept: "application/json" },
    next: { revalidate: 900 },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  const body = await response.json() as { version?: unknown };
  const version = optionalVersion(body.version);
  if (!version) throw new Error("npm registry returned an invalid version");
  return version;
}

export async function fetchRelayClientVersionPolicy(): Promise<RelayClientVersionPolicy> {
  const response = await fetch(RELAY_POLICY_URL, {
    headers: getRelayAdminHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  const body = await response.json() as Record<string, unknown>;
  return {
    packageName: typeof body.package === "string" && body.package.trim()
      ? body.package.trim()
      : LCE_CLOUD_PACKAGE,
    minimumVersion: optionalVersion(body.minimum_version),
    indexClientVersionRequired: body.index_client_version_required === true,
  };
}

export async function getClientVersionSummary(): Promise<ClientVersionSummary> {
  const [publishedResult, policyResult] = await Promise.allSettled([
    fetchPublishedClientVersion(),
    fetchRelayClientVersionPolicy(),
  ]);
  const policy = policyResult.status === "fulfilled"
    ? policyResult.value
    : {
        packageName: LCE_CLOUD_PACKAGE,
        minimumVersion: null,
        indexClientVersionRequired: false,
      };
  const publishedVersion = publishedResult.status === "fulfilled" ? publishedResult.value : null;
  return {
    ...policy,
    latestVersion: publishedVersion,
    latestVersionSource: publishedVersion ? "npm" : null,
    warnings: [
      ...(publishedResult.status === "rejected" ? ["npm_registry_unavailable"] : []),
      ...(policyResult.status === "rejected" ? ["relay_policy_unavailable"] : []),
    ],
  };
}

export async function saveRelayMinimumClientVersion(minimumVersion: string | null): Promise<RelayClientVersionPolicy> {
  const normalized = minimumVersion?.trim() || null;
  if (normalized !== null && !CLIENT_VERSION_PATTERN.test(normalized)) {
    throw new Error("invalid client version");
  }
  const response = await fetch(RELAY_POLICY_URL, {
    method: "POST",
    headers: {
      ...getRelayAdminHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ minimum_version: normalized }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  const body = await response.json() as Record<string, unknown>;
  return {
    packageName: typeof body.package === "string" && body.package.trim()
      ? body.package.trim()
      : LCE_CLOUD_PACKAGE,
    minimumVersion: optionalVersion(body.minimum_version),
    indexClientVersionRequired: body.index_client_version_required === true,
  };
}
