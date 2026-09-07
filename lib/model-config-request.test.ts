import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelConfigRequestTimeoutError, withModelConfigDeadline } from "./model-config-request";

afterEach(() => vi.useRealTimers());

describe("model configuration request deadline", () => {
  it("returns successful results and releases the timer", async () => {
    vi.useFakeTimers();
    await expect(withModelConfigDeadline(async () => "saved", 100)).resolves.toBe("saved");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds stalled requests even when their promise ignores cancellation", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const result = withModelConfigDeadline((signal) => {
      requestSignal = signal;
      return new Promise(() => {});
    }, 100);
    const assertion = expect(result).rejects.toBeInstanceOf(ModelConfigRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("covers response body parsing rather than only response headers", async () => {
    vi.useFakeTimers();
    const result = withModelConfigDeadline(async () => {
      const response = new Response(new ReadableStream({ start() {} }));
      return response.text();
    }, 100);
    const assertion = expect(result).rejects.toBeInstanceOf(ModelConfigRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("propagates cancellation and does not start an already cancelled request", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const operation = vi.fn<(signal: AbortSignal) => Promise<never>>(() => new Promise(() => {}));
    const first = withModelConfigDeadline(operation, 100, controller.signal);
    const reason = new Error("caller disconnected");
    const assertion = expect(first).rejects.toBe(reason);
    controller.abort(reason);
    await assertion;
    expect(operation.mock.calls[0][0].aborted).toBe(true);
    await expect(withModelConfigDeadline(operation, 100, controller.signal)).rejects.toBe(reason);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves provider errors and observes late failures after timeout", async () => {
    vi.useFakeTimers();
    const providerError = new Error("provider rejected request");
    await expect(withModelConfigDeadline(async () => { throw providerError; }, 100)).rejects.toBe(providerError);
    let fail!: (reason: unknown) => void;
    const result = withModelConfigDeadline(() => new Promise((_resolve, reject) => { fail = reject; }), 100);
    const assertion = expect(result).rejects.toBeInstanceOf(ModelConfigRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    fail(providerError);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
});
