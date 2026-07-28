import { BlockList, isIP } from "node:net";

/**
 * 设备登录回调地址的白名单。
 *
 * 这个问题的严重性来自 /api/auth/device 的行为：它把用户的 relay API key 作为
 * 查询参数拼到 callback 上再 302 过去。callback 只要能被 `new URL()` 解析就放行，
 * 等于任何人构造一条链接、诱导已登录用户点开，就能把对方的长期凭据收走。
 *
 * 合法的 callback 只有一种：插件在本机监听随机端口起的回环 HTTP 服务
 * （payload/extension/out/byok/runtime/lce/login.js 里的
 * `http://127.0.0.1:<port>/callback`）。这正是 RFC 8252 §7.3 为原生应用定义的
 * loopback 重定向：端口必须任意（每次登录都不同），主机必须回环。
 *
 * 因此策略是"只允许回环，端口不限"，而不是维护一份外部域名白名单——token 落到
 * 用户自己机器上不构成外泄，落到别处都构成。
 *
 * 解析上的坑（均已由下面的测试钉死）：
 * - `http://127.0.0.1@evil.com/` 的 hostname 是 `evil.com`，所以必须判 hostname，
 *   顺带拒绝带凭据的 URL。
 * - `127.0.0.1.evil.com` 是普通域名，所以不能用前缀/包含匹配。
 * - `2130706433`、`0x7f000001`、`127.1` 会被 URL 规范化成 `127.0.0.1`，交给 isIP
 *   判定即可，不必自己解析这些变形写法。
 * - IPv6 的 hostname 带方括号（`[::1]`），isIP 对它返回 0，必须先剥掉。
 * - `::ffff:127.0.0.1` 会被规范化成 `::ffff:7f00:1`，要提取内嵌 IPv4 后按 IPv4 判，
 *   否则 IPv4 回环段可以被映射写法绕过。
 */

const loopbackV4 = new BlockList();
loopbackV4.addSubnet("127.0.0.0", 8, "ipv4");

/** URL.hostname 对 IPv6 会带方括号，isIP 不认，先剥掉。 */
function unwrapIpv6Host(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * 从 IPv4-mapped IPv6（::ffff:a.b.c.d 或 ::ffff:hhhh:hhhh）提取内嵌 IPv4。
 * 与 lce/src/security/safeOutboundRequest.ts 中的同名函数保持一致。
 */
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

/** 该主机是否指向调用者本机。 */
export function isLoopbackHost(hostname: string): boolean {
  const host = unwrapIpv6Host(hostname);
  const family = isIP(host);

  if (family === 4) return loopbackV4.check(host, "ipv4");
  if (family === 6) {
    const mapped = ipv4FromMappedV6(host);
    if (mapped) return isLoopbackHost(mapped);
    // ::1 是唯一的 IPv6 回环地址；BlockList 对单地址判定同样精确。
    return host === "::1";
  }
  // 非 IP 字面量只认 localhost 本身。URL 已经把主机名小写化，这里仍显式小写以防
  // 调用方传入未规范化的字符串。
  return host.toLowerCase() === "localhost";
}

export class DeviceCallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceCallbackError";
  }
}

/**
 * 校验设备登录回调地址，返回可安全重定向的 URL。
 * 任何不指向本机的目标都会抛错——凭据只允许交回用户自己的机器。
 */
export function validateDeviceCallback(rawCallback: string): URL {
  let url: URL;
  try {
    url = new URL(rawCallback);
  } catch {
    throw new DeviceCallbackError("callback 不是合法的 URL");
  }

  // 只允许 http/https：自定义 scheme（vscode: 之类）由操作系统按注册表分发，
  // 无法在这里确认最终接收者，而回环流程也用不到它。
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DeviceCallbackError("callback 只能使用 http 或 https");
  }
  if (url.username || url.password) {
    throw new DeviceCallbackError("callback 不能包含用户名或密码");
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new DeviceCallbackError("callback 只能指向本机回环地址");
  }
  return url;
}
