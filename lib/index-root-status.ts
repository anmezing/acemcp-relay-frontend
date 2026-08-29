export interface IndexRootStatusLike {
  index_state?: string;
  indexed_at?: string;
  index_available?: boolean;
  indexed_files?: number;
  total_files?: number;
  file_count: number;
  progress_percent?: number;
}

export function resolveRootIndexState(root: IndexRootStatusLike): string {
  if (root.index_state) return root.index_state;
  return root.indexed_at ? "ready" : "not_started";
}

export function resolveRootIndexProgress(root: IndexRootStatusLike): number {
  const state = resolveRootIndexState(root);
  const value = root.progress_percent ?? (state === "ready" ? 100 : 0);
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function resolveRootIndexCounts(
  root: IndexRootStatusLike,
): { indexed: number; total: number } {
  const state = resolveRootIndexState(root);
  return {
    indexed: Math.max(0, root.indexed_files ?? (state === "ready" ? root.file_count : 0)),
    total: Math.max(0, root.total_files ?? root.file_count),
  };
}

export function hasBuildingIndexRoot(roots: readonly IndexRootStatusLike[] | null): boolean {
  return Boolean(roots?.some((root) => resolveRootIndexState(root) === "building"));
}

export interface IndexPollingPolicy {
  intervalMs: number;
  refreshStats: true;
  refreshRoots: true;
}

/**
 * Root state is always polled while the index page is visible. Polling only
 * active_job can miss a job that starts and completes (or fails) between two
 * statistics requests, leaving the UI stale until a manual refresh.
 */
export function resolveIndexPollingPolicy(hasActiveJob: boolean): IndexPollingPolicy {
  return {
    intervalMs: hasActiveJob ? 5000 : 30000,
    refreshStats: true,
    refreshRoots: true,
  };
}
