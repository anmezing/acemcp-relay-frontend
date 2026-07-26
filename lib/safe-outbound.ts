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
  ["::ffff:0:0", 96],
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

export function isPublicIpAddress(address: string, family = isIP(address)): boolean {
  if (family !== 4 && family !== 6) return false;
  return !blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
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
  const family = isIP(url.hostname);
  if (family !== 0 && !isPublicIpAddress(url.hostname, family)) {
    throw new Error(`${label} 不能指向内网或保留地址`);
  }
  return url;
}

async function resolvePublicAddress(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  const literalFamily = isIP(url.hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    return { address: url.hostname, family: literalFamily };
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
}

export async function safeByoRequest(
  rawUrl: string,
  options: SafeOutboundRequestOptions,
): Promise<Response> {
  const url = validateByoProviderUrl(rawUrl);
  const target = await resolvePublicAddress(url);
  const maxResponseBytes = options.maxResponseBytes ?? 16 * 1024 * 1024;

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
        servername: isIP(url.hostname) === 0 ? url.hostname : undefined,
        signal: options.signal,
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
