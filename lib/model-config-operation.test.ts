import { afterEach, describe, expect, it, vi } from "vitest";
import { isModelConfigOperationActive, parseModelConfigOperation, requestModelConfigOperation } from "./model-config-operation";

const job = {
  id: "f223a6b2-a315-4c52-b40b-5dc43df041ba", section: "embeddings", embeddingChanged: true,
  status: "running", attempt_count: 5, recovery_required: true, updated_at: "2026-09-16T12:00:00Z",
};
afterEach(() => vi.unstubAllGlobals());

describe("durable model configuration operations", () => {
  it("keeps uncertain operations active and requires explicit valid status", () => {
    expect(isModelConfigOperationActive(parseModelConfigOperation({ operation: job }))).toBe(true);
    expect(parseModelConfigOperation({ operation: null })).toBeNull();
    for (const value of [{}, { operation: { ...job, status: "unknown" } }, { operation: { ...job, status: "succeeded" } }, { operation: { ...job, attempt_count: -1 } }]) {
      expect(() => parseModelConfigOperation(value)).toThrow();
    }
  });
  it("recovers the original operation and propagates cancellation", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ operation: job })));
    vi.stubGlobal("fetch", fetch);
    expect(await requestModelConfigOperation(job.id, undefined, true)).toEqual(job);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: "recover", operationId: job.id });
    const controller = new AbortController();
    controller.abort();
    await expect(requestModelConfigOperation(job.id, controller.signal)).rejects.toBeDefined();
  });
  it("does not release an uncertain operation on a missing or different receipt", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const operation of [null, { ...job, id: "another-operation" }]) {
      fetch.mockResolvedValue(new Response(JSON.stringify({ operation })));
      await expect(requestModelConfigOperation(job.id, undefined, true)).rejects.toThrow(/identity/);
    }
  });
});
