import { describe, expect, it } from "vitest";
import {
  hasBuildingIndexRoot,
  resolveIndexPollingPolicy,
  resolveRootIndexCounts,
  resolveRootIndexProgress,
  resolveRootIndexState,
} from "./index-root-status";

describe("index root status", () => {
  it("keeps legacy published roots ready when the relay omits task fields", () => {
    const root = { indexed_at: "2026-08-29T00:00:00Z", file_count: 27 };

    expect(resolveRootIndexState(root)).toBe("ready");
    expect(resolveRootIndexProgress(root)).toBe(100);
    expect(resolveRootIndexCounts(root)).toEqual({ indexed: 27, total: 27 });
  });

  it("uses the current task counters and clamps malformed percentages", () => {
    const root = {
      index_state: "building",
      indexed_at: "2026-08-29T00:00:00Z",
      index_available: true,
      indexed_files: 4,
      total_files: 10,
      file_count: 27,
      progress_percent: 120,
    };

    expect(resolveRootIndexProgress(root)).toBe(100);
    expect(resolveRootIndexCounts(root)).toEqual({ indexed: 4, total: 10 });
    expect(hasBuildingIndexRoot([root])).toBe(true);
  });

  it("does not treat a failed update with an old snapshot as actively building", () => {
    const root = {
      index_state: "failed",
      indexed_at: "2026-08-29T00:00:00Z",
      index_available: true,
      indexed_files: 3,
      total_files: 8,
      file_count: 25,
      progress_percent: 37,
    };

    expect(resolveRootIndexState(root)).toBe("failed");
    expect(resolveRootIndexProgress(root)).toBe(37);
    expect(hasBuildingIndexRoot([root])).toBe(false);
  });

  it("keeps root status polling enabled even when no active job is observed", () => {
    expect(resolveIndexPollingPolicy(false)).toEqual({
      intervalMs: 30000,
      refreshStats: true,
      refreshRoots: true,
    });
    expect(resolveIndexPollingPolicy(true)).toEqual({
      intervalMs: 5000,
      refreshStats: true,
      refreshRoots: true,
    });
  });
});
