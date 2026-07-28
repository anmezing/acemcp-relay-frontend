import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

// safeByoRequest 打的是用户自己填的端点，对端可能接受连接后永不作答。
// 没有中止信号时 https.request 会一直挂着，占住一个连接和调用方的 await。
// 这组用例覆盖两件事：兜底信号本身正确，以及它确实被交给了 https.request。

const requestSpy = vi.hoisted(() => vi.fn());

vi.mock("node:https", () => ({
  default: { request: requestSpy },
  request: requestSpy,
}));

const { DEFAULT_TIMEOUT_MS, resolveRequestSignal, safeByoRequest } = await import("./safe-outbound");

afterEach(() => {
  requestSpy.mockReset();
});

describe("resolveRequestSignal", () => {
  it("调用方给了 signal 就原样使用（它可能已组合了取消与自身超时）", () => {
    const provided = AbortSignal.timeout(60_000);
    expect(resolveRequestSignal(provided, 5)).toBe(provided);
  });

  it("没有 signal 时兜一个超时信号，而不是返回 undefined", () => {
    const signal = resolveRequestSignal(undefined, undefined);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("兜底信号到点会真的 abort", async () => {
    const signal = resolveRequestSignal(undefined, 10);
    expect(signal.aborted).toBe(false);
    await vi.waitFor(() => expect(signal.aborted).toBe(true), { timeout: 2_000 });
    expect((signal.reason as Error)?.name).toBe("TimeoutError");
  });

  it("默认超时是有限值，不是 Infinity/0", () => {
    expect(Number.isFinite(DEFAULT_TIMEOUT_MS)).toBe(true);
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("safeByoRequest 把中止信号交给底层请求", () => {
  // 用 IP 字面量绕开 DNS（resolvePublicAddress 走字面量分支），
  // 再 mock node:https 阻断真实连接：整组用例不碰网络。
  const PUBLIC_LITERAL = "https://8.8.8.8/v1/embeddings";

  function stubRequest(): void {
    requestSpy.mockImplementation(() => {
      const req = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
        destroy: () => void;
      };
      req.write = () => {};
      req.end = () => {};
      req.destroy = () => {};
      return req;
    });
  }

  it("调用方没传 signal 时也必须带上一个（否则请求会永久挂起）", async () => {
    stubRequest();
    void safeByoRequest(PUBLIC_LITERAL, { method: "POST", body: "{}" });

    await vi.waitFor(() => expect(requestSpy).toHaveBeenCalledOnce());
    const passed = requestSpy.mock.calls[0][0].signal;
    expect(passed).toBeInstanceOf(AbortSignal);
    expect(passed.aborted).toBe(false);
  });

  it("timeoutMs 生效：到点后传下去的 signal 被 abort", async () => {
    stubRequest();
    void safeByoRequest(PUBLIC_LITERAL, { method: "POST", body: "{}", timeoutMs: 10 });

    await vi.waitFor(() => expect(requestSpy).toHaveBeenCalledOnce());
    const passed: AbortSignal = requestSpy.mock.calls[0][0].signal;
    await vi.waitFor(() => expect(passed.aborted).toBe(true), { timeout: 2_000 });
  });

  it("调用方自己的 signal 优先，不被默认超时覆盖", async () => {
    stubRequest();
    const controller = new AbortController();
    void safeByoRequest(PUBLIC_LITERAL, {
      method: "POST",
      body: "{}",
      signal: controller.signal,
      timeoutMs: 10,
    });

    await vi.waitFor(() => expect(requestSpy).toHaveBeenCalledOnce());
    expect(requestSpy.mock.calls[0][0].signal).toBe(controller.signal);
  });

  it("被 SSRF 守卫拒绝时根本不会发起请求", async () => {
    stubRequest();
    await expect(safeByoRequest("https://127.0.0.1/v1", { method: "POST" })).rejects.toThrow();
    expect(requestSpy).not.toHaveBeenCalled();
  });
});
