import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isActiveRootDeletion,
  isRootDeletion,
  mergeRootDeletions,
  readRootDeletions,
  reconcileRootDeletions,
  requestRootDeletionJson,
  startRootDeletionMonitor,
  type RootDeletion,
} from "./root-deletions";

function deletion(overrides: Partial<RootDeletion> = {}): RootDeletion {
  return {
    id: "job-1",
    root_id: "root-1",
    status: "queued",
    deleted_files: 0,
    created_at: "2026-09-08T00:00:00Z",
    updated_at: "2026-09-08T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("root deletion state", () => {
  it("requires an explicit job contract, not a legacy deletion response", () => {
    expect(isRootDeletion(deletion())).toBe(true);
    expect(isRootDeletion({ deleted: true, deleted_files: 5 })).toBe(false);
    expect(isRootDeletion(deletion({ status: "unknown" as RootDeletion["status"] }))).toBe(false);
    expect(isRootDeletion(deletion({ id: "" }))).toBe(false);
    expect(isRootDeletion(deletion({ deleted_files: -1 }))).toBe(false);
    expect(isRootDeletion(deletion({ deleted_files: 1.5 }))).toBe(false);
    expect(isRootDeletion(deletion({ deleted_files: Number.MAX_SAFE_INTEGER + 1 }))).toBe(false);
    expect(isRootDeletion(deletion({ updated_at: "invalid" }))).toBe(false);
    expect(readRootDeletions({ deletions: [deletion()] })).toEqual([deletion()]);
    expect(readRootDeletions({ deletions: [{}] })).toBeNull();
    expect(readRootDeletions({ error: "unavailable" })).toBeNull();
  });

  it("restores active and failed jobs while keeping uncertain running jobs active", () => {
    const running = deletion({ status: "running", error: "Result uncertain, retrying" });
    const failed = deletion({ root_id: "root-2", id: "job-2", status: "failed", error: "Permission denied" });
    const state = mergeRootDeletions({}, [running, failed]);
    expect(state["root-1"]).toEqual(running);
    expect(state["root-2"]).toEqual(failed);
    expect(isActiveRootDeletion(running)).toBe(true);
    expect(isActiveRootDeletion(failed)).toBe(false);
  });

  it("does not discard a submitted job when a previously started list omits it", () => {
    const current = { "root-1": deletion() };
    expect(mergeRootDeletions(current, [])).toEqual(current);
  });

  it("reconciles jobs absent from a fresh authoritative list without declaring success", () => {
    const previous = { "root-1": deletion({ status: "running" }) };
    expect(reconcileRootDeletions(previous, [])).toEqual({});
    expect(previous["root-1"].status).toBe("running");
    const failed = deletion({ status: "failed", error: "Permission denied" });
    expect(reconcileRootDeletions(previous, [failed])["root-1"]).toEqual(failed);
  });

  it.each(["__proto__", "constructor", "toString"])("tracks the prototype property root ID %s", (rootId) => {
    const job = deletion({ root_id: rootId });
    const next = mergeRootDeletions({}, [job]);
    expect(Object.values(next)).toEqual([job]);
    expect(isActiveRootDeletion(next[rootId])).toBe(true);
    expect(reconcileRootDeletions(next, [])).toEqual({});
  });

  it("does not regress a job to queued or active after completion", () => {
    const running = deletion({ status: "running" });
    expect(mergeRootDeletions({ "root-1": running }, [deletion()])["root-1"]).toEqual(running);
    const completed = deletion({ status: "succeeded", deleted_files: 42 });
    expect(mergeRootDeletions({ "root-1": completed }, [running])["root-1"]).toEqual(completed);
    expect(isActiveRootDeletion(completed)).toBe(false);
  });

  it("keeps newer job updates and replaces a failed attempt with a retry", () => {
    const failed = deletion({ status: "failed" });
    const retry = deletion({ id: "job-2", created_at: "2026-09-08T01:00:00Z", updated_at: "2026-09-08T01:00:00Z" });
    const current = mergeRootDeletions({ "root-1": failed }, [retry]);
    expect(current["root-1"]).toEqual(retry);
    expect(mergeRootDeletions(current, [failed])["root-1"]).toEqual(retry);
    const updated = { ...retry, status: "running" as const, error: "Retrying", updated_at: "2026-09-08T02:00:00Z" };
    expect(mergeRootDeletions({ "root-1": updated }, [{ ...retry, status: "running" }])["root-1"]).toEqual(updated);
  });
});

describe("root deletion monitoring", () => {
  it("polls active jobs every 3 seconds and idle lists every 30 seconds", async () => {
    vi.useFakeTimers();
    let active = true;
    const load = vi.fn(async () => [deletion()]);
    const monitor = startRootDeletionMonitor({ load, onUpdate: vi.fn(), onError: vi.fn(), hasActive: () => active });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(load).toHaveBeenCalledTimes(2);
    active = false;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(load).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(load).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(4);
    monitor.stop();
  });

  it("never overlaps polls even when refreshed during a slow request", async () => {
    vi.useFakeTimers();
    let finish!: (jobs: RootDeletion[]) => void;
    const load = vi.fn(() => new Promise<RootDeletion[]>((resolve) => { finish = resolve; }));
    const monitor = startRootDeletionMonitor({ load, onUpdate: vi.fn(), onError: vi.fn(), hasActive: () => true });
    await vi.advanceTimersByTimeAsync(0);
    monitor.refresh();
    monitor.refresh();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(1);
    finish([deletion()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    monitor.stop();
    finish([]);
  });

  it("preserves the last known state and retries transient failures with bounded backoff", async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const onError = vi.fn();
    const load = vi.fn<() => Promise<RootDeletion[]>>()
      .mockResolvedValueOnce([deletion({ status: "running" })])
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([deletion({ status: "succeeded" })]);
    const monitor = startRootDeletionMonitor({ load, onUpdate, onError, hasActive: () => true });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(onError).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(onUpdate).toHaveBeenLastCalledWith([deletion({ status: "succeeded" })]);
    monitor.stop();
  });

  it("ignores responses after tenant switches or unmounts, including a switch back", async () => {
    vi.useFakeTimers();
    let finishOld!: (jobs: RootDeletion[]) => void;
    let oldSignal!: AbortSignal;
    const onUpdate = vi.fn();
    const old = startRootDeletionMonitor({
      load: (signal) => {
        oldSignal = signal;
        return new Promise((resolve) => { finishOld = resolve; });
      },
      onUpdate,
      onError: vi.fn(),
      hasActive: () => true,
    });
    await vi.advanceTimersByTimeAsync(0);
    old.stop();
    expect(oldSignal.aborted).toBe(true);
    const current = startRootDeletionMonitor({
      load: async () => [], onUpdate, onError: vi.fn(), hasActive: () => false,
    });
    await vi.advanceTimersByTimeAsync(0);
    finishOld([deletion()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith([]);
    current.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("root deletion request deadline", () => {
  it("aborts requests after 12 seconds, below the edge proxy timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })));
    const request = requestRootDeletionJson("/api/roots/delete");
    const assertion = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates cancellation and clears timers on unmount", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })));
    const request = requestRootDeletionJson("/api/roots/delete", {}, caller.signal);
    const assertion = expect(request).rejects.toMatchObject({ name: "AbortError" });
    caller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
