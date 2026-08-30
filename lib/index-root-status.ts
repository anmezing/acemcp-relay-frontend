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


export interface IndexRootActions {
  canDismissFailure: boolean;
  canDeleteIndex: boolean;
}

export function resolveRootIndexActions(
  root: IndexRootStatusLike,
  canManage: boolean,
  requiresRootReset = false,
): IndexRootActions {
  if (!canManage) {
    return { canDismissFailure: false, canDeleteIndex: false };
  }
  const state = resolveRootIndexState(root);
  const indexAvailable = root.index_available ?? Boolean(root.indexed_at);
  const resetFailedRoot = state === "failed" && requiresRootReset;
  return {
    canDismissFailure: state === "failed" && !resetFailedRoot,
    canDeleteIndex: (indexAvailable || resetFailedRoot) && state !== "building",
  };
}

export function hasBuildingIndexRoot(roots: readonly IndexRootStatusLike[] | null): boolean {
  return Boolean(roots?.some((root) => resolveRootIndexState(root) === "building"));
}

export interface RootsSectionVisibilityInput {
  hasPublishedIndex: boolean;
  rootCount: number;
  loading: boolean;
  hasError: boolean;
  hasActionResult: boolean;
}

/**
 * The published tenant snapshot and the latest root task are independent.
 * A first indexing attempt can fail before a snapshot exists, in which case
 * tenant-stats reports exists=false while /mcp/roots still returns the failed
 * task that the user needs to inspect or dismiss.
 */
export function shouldShowRootsSection(input: RootsSectionVisibilityInput): boolean {
  return (
    input.hasPublishedIndex ||
    input.rootCount > 0 ||
    input.loading ||
    input.hasError ||
    input.hasActionResult
  );
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
