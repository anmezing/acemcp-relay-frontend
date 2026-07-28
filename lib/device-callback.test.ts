import { describe, expect, it } from "vitest";
import { DeviceCallbackError, isLoopbackHost, validateDeviceCallback } from "./device-callback";

// 这些用例是 /api/auth/device 的安全边界：该端点把用户的 relay API key 拼到
// callback 上重定向出去，任何一条"必须拒绝"用例变成放行，都等于凭据外泄。

describe("validateDeviceCallback 放行插件真实使用的回环回调", () => {
  // 插件监听随机端口（server.listen(0)），所以端口必须不受限制。
  it.each([
    "http://127.0.0.1:1/callback",
    "http://127.0.0.1:65535/callback",
    "http://127.0.0.1:49152/callback?state=x",
    "http://127.0.0.2:8080/callback", // 整个 127.0.0.0/8 都是本机
    "http://[::1]:8080/callback",
    "http://localhost:8080/callback",
    "https://127.0.0.1:8443/callback",
  ])("放行 %s", (raw) => {
    expect(() => validateDeviceCallback(raw)).not.toThrow();
  });

  it("返回解析后的 URL，供调用方拼接 token", () => {
    const url = validateDeviceCallback("http://127.0.0.1:5000/callback");
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.port).toBe("5000");
  });
});

describe("validateDeviceCallback 拒绝一切非本机目标", () => {
  it.each([
    ["外部域名", "https://evil.com/steal"],
    ["外部 IP", "http://203.0.113.5/steal"],
    // hostname 是 evil.com，凭据部分只是幌子
    ["userinfo 混淆", "http://127.0.0.1@evil.com/steal"],
    ["userinfo 混淆带密码", "http://127.0.0.1:pw@evil.com/steal"],
    // 普通域名，不能被前缀/包含匹配误判为回环
    ["回环前缀域名", "http://127.0.0.1.evil.com/steal"],
    ["回环结尾域名", "http://evil-127.0.0.1.com/steal"],
    ["localhost 子域", "http://localhost.evil.com/steal"],
    // fragment 里放回环字样不影响 host 判定
    ["fragment 混淆", "https://evil.com/steal#127.0.0.1"],
    ["内网非回环", "http://192.168.1.5/steal"],
    ["链路本地", "http://169.254.169.254/latest/meta-data"],
    ["IPv6 非回环", "http://[2606:4700::1111]/steal"],
    // ::ffff:127.0.0.1 规范化后是 ::ffff:7f00:1，映射写法不能绕过 IPv4 判定
    // （这里断言的是"映射到非回环的地址必须拒绝"）
    ["IPv4 映射非回环", "http://[::ffff:8.8.8.8]/steal"],
  ])("拒绝 %s", (_label, raw) => {
    expect(() => validateDeviceCallback(raw)).toThrow(DeviceCallbackError);
  });

  it.each([
    ["javascript 伪协议", "javascript:alert(1)"],
    ["data 伪协议", "data:text/html,<script>fetch(location)</script>"],
    ["file 协议", "file:///etc/passwd"],
    ["自定义 scheme", "vscode://evil.publisher/steal"],
  ])("拒绝 %s", (_label, raw) => {
    expect(() => validateDeviceCallback(raw)).toThrow(DeviceCallbackError);
  });

  it.each([["空串", ""], ["纯路径", "/callback"], ["无 scheme", "127.0.0.1:8080/callback"]])(
    "拒绝无法解析的 %s",
    (_label, raw) => {
      expect(() => validateDeviceCallback(raw)).toThrow(DeviceCallbackError);
    },
  );
});

describe("isLoopbackHost 处理 URL 规范化后的各种写法", () => {
  // URL 解析器会把这些变形统一成 127.0.0.1，这里确认判定跟得上
  it.each(["127.0.0.1", "127.1", "2130706433", "0x7f000001"])(
    "%s 规范化后是回环",
    (raw) => {
      expect(isLoopbackHost(new URL(`http://${raw}/`).hostname)).toBe(true);
    },
  );

  it("IPv4 映射的回环地址算回环", () => {
    // new URL 会把 [::ffff:127.0.0.1] 规范化成 [::ffff:7f00:1]
    const host = new URL("http://[::ffff:127.0.0.1]/").hostname;
    expect(host).toBe("[::ffff:7f00:1]");
    expect(isLoopbackHost(host)).toBe(true);
  });

  it("IPv4 映射的公网地址不算回环", () => {
    expect(isLoopbackHost(new URL("http://[::ffff:8.8.8.8]/").hostname)).toBe(false);
  });

  it("带方括号的 IPv6 主机名能被识别", () => {
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
  });

  it("大小写不影响 localhost 判定", () => {
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
  });
});
