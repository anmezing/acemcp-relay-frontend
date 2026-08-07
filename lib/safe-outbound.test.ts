import { describe, expect, it } from "vitest";
import { isPublicIpAddress, validateUserRerankProviderUrl } from "./safe-outbound";

/**
 * 这份用例集与 lce/src/security/safeOutboundRequest.test.ts 覆盖同一套地址判定：
 * 两边是各自独立实现的同一条 SSRF 防线，靠相同的判定结果保持同构。改任一侧的
 * 网段表或映射地址处理，都应该让两边的用例同时通过。
 *
 * 历史教训（务必保留 "公网 IPv4 必须放行" 这组）：曾经有人把 ::ffff:0:0/96 加进
 * IPv6 黑名单，Node 的 BlockList 会把所有 IPv4 的 check 归一到该映射段，结果每个
 * 公网 IPv4 都被判为内网，用户自定义 Rerank 的公网端点会全部被拒绝。
 */

describe("isPublicIpAddress 放行公网地址", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "104.18.7.1",
    "203.0.114.1",
    "2606:4700::1111",
    "2400:cb00::1",
  ])("放行 %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });
});

describe("isPublicIpAddress 拦截内网与保留地址", () => {
  it.each([
    ["未指定地址", "0.0.0.0"],
    ["私有 A 段", "10.0.0.5"],
    ["CGNAT", "100.64.0.1"],
    ["回环", "127.0.0.1"],
    ["链路本地 / 云元数据", "169.254.169.254"],
    ["私有 B 段", "172.16.0.1"],
    ["IETF 协议段", "192.0.0.1"],
    ["文档段 TEST-NET-1", "192.0.2.1"],
    ["6to4 中继", "192.88.99.1"],
    ["私有 C 段", "192.168.1.1"],
    ["基准测试段", "198.18.0.1"],
    ["文档段 TEST-NET-2", "198.51.100.1"],
    ["文档段 TEST-NET-3", "203.0.113.1"],
    ["组播", "224.0.0.1"],
    ["保留 / 广播", "255.255.255.255"],
  ])("拦截 %s", (_label, address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each([
    ["IPv6 未指定", "::"],
    ["IPv6 回环", "::1"],
    ["NAT64", "64:ff9b::1"],
    ["Teredo", "2001::1"],
    ["IPv6 文档段", "2001:db8::1"],
    ["6to4", "2002::1"],
    ["唯一本地地址", "fc00::1"],
    ["链路本地", "fe80::1"],
    ["组播", "ff00::1"],
  ])("拦截 %s", (_label, address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });
});

describe("isPublicIpAddress 按内嵌 IPv4 判定映射地址", () => {
  // ::ffff:0:0/96 不能整段拉黑（会连带拦掉所有 IPv4），必须提取内嵌地址再判
  it.each(["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:192.168.1.1"])(
    "拦截映射到内网的 %s",
    (address) => {
      expect(isPublicIpAddress(address)).toBe(false);
    },
  );

  it.each(["::ffff:8.8.8.8", "::ffff:808:808"])("放行映射到公网的 %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });
});

describe("isPublicIpAddress 拒绝非 IP 输入", () => {
  it.each(["", "example.com", "not-an-ip", "999.999.999.999"])("拒绝 %s", (value) => {
    expect(isPublicIpAddress(value)).toBe(false);
  });
});

describe("validateUserRerankProviderUrl", () => {
  it("放行公网 HTTPS 端点", () => {
    expect(() => validateUserRerankProviderUrl("https://api.siliconflow.cn/v1/rerank")).not.toThrow();
    expect(() => validateUserRerankProviderUrl("https://api.voyageai.com/v1/rerank")).not.toThrow();
  });

  it.each([
    ["非 HTTPS", "http://api.openai.com/v1"],
    ["伪协议", "javascript:alert(1)"],
    ["非法 URL", "not a url"],
    ["带凭据", "https://user:pw@api.openai.com/v1"],
    ["带 fragment", "https://api.openai.com/v1#x"],
    ["回环 IP 字面量", "https://127.0.0.1/v1"],
    ["内网 IP 字面量", "https://192.168.1.1/v1"],
    ["云元数据 IP", "https://169.254.169.254/latest"],
    // IPv6 字面量：URL.hostname 带方括号，isIP 对它返回 0。不剥方括号的话
    // 这一整类内网目标都会被当成普通主机名放行。
    ["映射回环字面量", "https://[::ffff:127.0.0.1]/v1"],
    ["IPv6 回环字面量", "https://[::1]/v1"],
    ["IPv6 唯一本地地址", "https://[fd00::1]/v1"],
    ["IPv6 链路本地", "https://[fe80::1]/v1"],
  ])("拒绝 %s", (_label, raw) => {
    expect(() => validateUserRerankProviderUrl(raw)).toThrow();
  });

  it("放行公网 IPv6 字面量", () => {
    expect(() => validateUserRerankProviderUrl("https://[2606:4700::1111]/v1")).not.toThrow();
  });

  it("主机名不在保存配置时解析，由 LCE 在实际请求前做 DNS 校验", () => {
    expect(() => validateUserRerankProviderUrl("https://internal.corp/v1")).not.toThrow();
  });
});
