import dns from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP } from "node:net";

// 用户自带模型端点的安全出站请求（防 SSRF）。
// 与 lce/src/security/safeOutboundRequest.ts 保持同等防护：仅 HTTPS、
// 禁内网/保留地址段、DNS 解析后按解析结果直连（防 rebinding）、禁重定向、
// 限制响应体大小。改这里时两边一起改。

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
 * IP 字面量校验——https://[::1]/ 这类内网目标就能通过 validateByoProviderUrl。
 */
function hostnameToAddress(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function validateByoProviderUrl(rawUrl: string, label = "baseUrl"): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} 必须是合法的 HTTPS URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} 必须以 https:// 开头`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} 不能包含用户名或密码`);
  }
  if (url.hash) {
    throw new Error(`${label} 不能包含 # 片段`);
  }
  const address = hostnameToAddress(url.hostname);
  const family = isIP(address);
  if (family !== 0 && !isPublicIpAddress(address, family)) {
    throw new Error(`${label} 不能指向内网或保留地址`);
  }
  return url;
}

async function resolvePublicAddress(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  const literal = hostnameToAddress(url.hostname);
  const literalFamily = isIP(literal);
  if (literalFamily === 4 || literalFamily === 6) {
    // 字面量在 validateByoProviderUrl 已判过一次，这里复判以便该函数独立成立
    if (!isPublicIpAddress(literal, literalFamily)) {
      throw new Error("baseUrl 指向内网或保留地址");
    }
    return { address: literal, family: literalFamily };
  }

  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error("baseUrl 域名无法解析");
  }
  for (const result of addresses) {
    if (!isPublicIpAddress(result.address, result.family)) {
      throw new Error("baseUrl 域名解析到了内网或保留地址");
    }
  }
  const selected = addresses[0];
  return { address: selected.address, family: selected.family as 4 | 6 };
}

export interface SafeOutboundRequestOptions {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  maxResponseBytes?: number;
  timeoutMs?: number;
}

// 目标端点由用户提供，可能永不作答：没有超时时请求会一直挂住一个 Node
// 进程的连接和调用方的 await。默认值兜底，调用方可用 signal/timeoutMs 覆盖。
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * 决定本次请求用哪个中止信号。
 *
 * 调用方给了 signal 就用它（它通常已经组合了自己的超时与取消）；否则必须自己
 * 兜一个超时——没有信号时 https.request 会一直等一个永不作答的对端。
 */
export function resolveRequestSignal(
  signal?: AbortSignal,
  timeoutMs?: number,
): AbortSignal {
  return signal ?? AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

export async function safeByoRequest(
  rawUrl: string,
  options: SafeOutboundRequestOptions,
): Promise<Response> {
  const url = validateByoProviderUrl(rawUrl);
  const target = await resolvePublicAddress(url);
  const maxResponseBytes = options.maxResponseBytes ?? 16 * 1024 * 1024;
  const signal = resolveRequestSignal(options.signal, options.timeoutMs);

  return new Promise<Response>((resolve, reject) => {
    const request = https.request(
      {
        protocol: "https:",
        hostname: target.address,
        family: target.family,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: options.method,
        headers: {
          ...options.headers,
          Host: url.host,
        },
        // IP 字面量不做 SNI；否则会把 [::1] 这类字面量当成 SNI 主机名发出去
        servername: isIP(hostnameToAddress(url.hostname)) === 0 ? url.hostname : undefined,
        signal,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          reject(new Error("baseUrl 返回了重定向，已按安全策略拒绝"));
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += buffer.length;
          if (received > maxResponseBytes) {
            request.destroy(new Error("响应超出大小限制"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.set(name, String(value));
            }
          }
          resolve(new Response(Buffer.concat(chunks), { status, headers }));
        });
      },
    );

    request.on("error", reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}
