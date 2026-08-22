import { isIP } from "node:net";

export interface AuthIpAddressOptions {
  ipAddressHeaders: string[];
  trustedProxies?: string[];
}

function isValidIpOrCidr(value: string): boolean {
  const slash = value.lastIndexOf("/");
  const address = slash === -1 ? value : value.slice(0, slash);
  const family = isIP(address);
  if (family === 0) return false;
  if (slash === -1) return true;
  const prefix = value.slice(slash + 1);
  if (!/^\d+$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Build Better Auth's client-IP policy from the explicitly trusted proxy chain.
 * Without a configured chain, forwarded headers are attacker-controlled; disabling
 * them makes Better Auth use its shared fallback rate-limit key instead of trusting
 * a caller-supplied address.
 */
export function authIpAddressOptions(rawTrustedProxies?: string): AuthIpAddressOptions {
  const trustedProxies = [...new Set(
    (rawTrustedProxies ?? "")
      .split(",")
      .map((proxy) => proxy.trim())
      .filter(Boolean),
  )];

  const invalid = trustedProxies.filter((proxy) => !isValidIpOrCidr(proxy));
  if (invalid.length > 0) {
    throw new Error(
      `BETTER_AUTH_TRUSTED_PROXIES contains invalid IP/CIDR entries: ${invalid.join(", ")}`,
    );
  }

  if (trustedProxies.length === 0) {
    return { ipAddressHeaders: [] };
  }
  return {
    ipAddressHeaders: ["x-forwarded-for"],
    trustedProxies,
  };
}
