import { BlockList, isIP } from "node:net";

import { ValidationError } from "./errors";

// 用户自定义 Rerank 端点的静态 URL 校验。前端只保存配置、不向该地址发请求；
// 实际出站调用及 DNS rebinding 防护由 LCE 的 safeOutboundRequest 负责。

const blockedAddresses = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  // 注意：不要在此加入 ::ffff:0:0/96（IPv4-mapped 全段）。Node BlockList 会把
  // 所有 IPv4 的 check 归一到该映射段，导致每个 IPv4 都被判为受阻（连公网也被拦）。
  // IPv4-mapped 地址改由 isPublicIpAddress 提取内嵌 IPv4 后按 IPv4 规则判定。
  // safe-outbound.test.ts 里"公网 IPv4 必须放行"的用例就是防止这一行被加回来。
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv6");
}

// 从 IPv4-mapped IPv6（::ffff:a.b.c.d 或 ::ffff:hhhh:hhhh）提取内嵌 IPv4，
// 无法识别则返回 null。用于确保 ::ffff:127.0.0.1 之类不能绕过 IPv4 黑名单。
function ipv4FromMappedV6(address: string): string | null {
  const lower = address.toLowerCase();
  if (!lower.startsWith("::ffff:")) return null;
  const rest = lower.slice(7);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(rest)) return rest;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return null;
}

export function isPublicIpAddress(address: string, family = isIP(address)): boolean {
  if (family !== 4 && family !== 6) return false;
  if (family === 6) {
    const mapped = ipv4FromMappedV6(address);
    if (mapped) return isPublicIpAddress(mapped, 4);
  }
  return !blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * URL.hostname 对 IPv6 字面量会带方括号（`https://[::1]/` → `[::1]`），而 isIP
 * 不认方括号、对它返回 0。不剥掉的话 IPv6 字面量会被当成普通主机名，直接跳过
 * IP 字面量校验——https://[::1]/ 这类内网目标就能通过 validateUserRerankProviderUrl。
 */
function hostnameToAddress(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function validateUserRerankProviderUrl(rawUrl: string, label = "baseUrl"): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError(`${label} 必须是合法的 HTTPS URL`);
  }
  if (url.protocol !== "https:") {
    throw new ValidationError(`${label} 必须以 https:// 开头`);
  }
  if (url.username || url.password) {
    throw new ValidationError(`${label} 不能包含用户名或密码`);
  }
  if (url.hash) {
    throw new ValidationError(`${label} 不能包含 # 片段`);
  }
  const address = hostnameToAddress(url.hostname);
  const family = isIP(address);
  if (family !== 0 && !isPublicIpAddress(address, family)) {
    throw new ValidationError(`${label} 不能指向内网或保留地址`);
  }
  return url;
}
