import { readBoundedJson } from "./bounded-json";

export interface RootDeletion {
  id: string;
  root_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  deleted_files: number;
  error?: string;
  recovery_required?: boolean;
  attempt_count?: number;
  created_at: string;
  updated_at: string;
}

export type RootDeletions = Record<string, RootDeletion>;

export function isRootDeletion(value: unknown): value is RootDeletion {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<RootDeletion>;
  return (
    typeof job.id === "string" && job.id.length > 0 &&
    typeof job.root_id === "string" && job.root_id.length > 0 &&
    (job.status === "queued" || job.status === "running" || job.status === "succeeded" || job.status === "failed") &&
    typeof job.deleted_files === "number" && Number.isSafeInteger(job.deleted_files) && job.deleted_files >= 0 &&
    (job.error === undefined || typeof job.error === "string") &&
    (job.recovery_required === undefined || typeof job.recovery_required === "boolean") &&
    (!job.recovery_required || job.status === "running") &&
    (job.attempt_count === undefined || (Number.isSafeInteger(job.attempt_count) && job.attempt_count >= 0)) &&
    typeof job.created_at === "string" && Number.isFinite(Date.parse(job.created_at)) &&
    typeof job.updated_at === "string" && Number.isFinite(Date.parse(job.updated_at))
  );
}

export function isActiveRootDeletion(job: RootDeletion | undefined): boolean {
  return job?.status === "queued" || job?.status === "running";
}

export function readRootDeletions(value: unknown): RootDeletion[] | null {
  if (!value || typeof value !== "object" || !("deletions" in value)) return null;
  return Array.isArray(value.deletions) && value.deletions.every(isRootDeletion)
    ? value.deletions
    : null;
}

export function canRetryRootDeletion(job: RootDeletion | undefined): boolean {
  return job?.status === "failed" || (job?.status === "running" && job.recovery_required === true);
}

export interface RootDeletionList {
  jobs: RootDeletion[];
  uncertainRoots: Set<string>;
  unscoped: boolean;
}

export function readRootDeletionList(value: unknown): RootDeletionList | null {
  if (!value || typeof value !== "object" || !("deletions" in value) || !Array.isArray(value.deletions)) return null;
  const result: RootDeletionList = { jobs: [], uncertainRoots: new Set(), unscoped: false };
  const seen = new Set<string>();
  for (const entry of value.deletions) {
    const root = entry && typeof entry === "object" && typeof entry.root_id === "string" && entry.root_id ? entry.root_id : undefined;
    if (!root) { result.unscoped = true; continue; }
    if (seen.has(root) || !isRootDeletion(entry)) result.uncertainRoots.add(root);
    else result.jobs.push(entry);
    seen.add(root);
  }
  result.jobs = result.jobs.filter((job) => !result.uncertainRoots.has(job.root_id));
  return result;
}

export function mergeRootDeletions(current: RootDeletions, incoming: RootDeletion[]): RootDeletions {
  const next: RootDeletions = Object.assign(Object.create(null), current);
  for (const job of incoming) {
    const previous = next[job.root_id];
    if (previous) {
      if (previous.id === job.id) {
        if (!isActiveRootDeletion(previous) && isActiveRootDeletion(job)) continue;
        if (previous.status === "running" && job.status === "queued") continue;
        if (Date.parse(previous.updated_at) > Date.parse(job.updated_at)) continue;
      } else if (Date.parse(previous.created_at) > Date.parse(job.created_at)) {
        continue;
      }
    }
    next[job.root_id] = job;
  }
  // A list request started before a submission can omit the newly accepted job.
  // Only an explicit terminal status may release an active deletion in this view.
  return next;
}

export function reconcileRootDeletions(current: RootDeletions, incoming: RootDeletion[], uncertainRoots: ReadonlySet<string> = new Set(), unscoped = false): RootDeletions {
  const next = mergeRootDeletions(current, incoming);
  const roots = new Set(incoming.map((job) => job.root_id));
  // Call only for a list started after the last submission finished. All active
  // jobs are listed, but terminal jobs eventually leave the retention window.
  for (const rootId of Object.keys(next)) {
    if (!unscoped && !uncertainRoots.has(rootId) && !roots.has(rootId)) delete next[rootId];
  }
  return next;
}

export async function requestRootDeletionJson(
  url: string,
  init: RequestInit = {},
  callerSignal?: AbortSignal,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), 12_000);
  try {
    if (callerSignal?.aborted) throw callerSignal.reason;
    const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const data: unknown = await readBoundedJson(response, 256 * 1024, controller.signal).catch(() => null);
    controller.signal.throwIfAborted();
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onAbort);
  }
}

export function startRootDeletionMonitor<T = RootDeletion[]>(options: {
  load: (signal: AbortSignal) => Promise<T>;
  onUpdate: (jobs: T) => void;
  onError: (error: unknown) => void;
  hasActive: () => boolean;
  visibility?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
}): { refresh: () => void; stop: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let refreshRequested = false;
  let failures = 0;
  const visibility = options.visibility ?? (typeof document === "undefined" ? undefined : document);
  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (visibility?.hidden) return;
    timer = setTimeout(() => { void tick(); }, delay);
  };
  const tick = async () => {
    if (controller.signal.aborted || inFlight || visibility?.hidden) return;
    inFlight = true;
    try {
      const jobs = await options.load(controller.signal);
      if (controller.signal.aborted) return;
      failures = 0;
      options.onUpdate(jobs);
    } catch (error) {
      if (controller.signal.aborted) return;
      failures += 1;
      options.onError(error);
    } finally {
      inFlight = false;
      if (!controller.signal.aborted) {
        const delay = failures ? Math.min(3_000 * 2 ** (failures - 1), 30_000)
          : options.hasActive() ? 3_000 : 30_000;
        schedule(refreshRequested ? 0 : delay);
        refreshRequested = false;
      }
    }
  };
  const onVisibility = () => {
    clearTimeout(timer);
    if (visibility?.hidden) return;
    if (inFlight) refreshRequested = true;
    else schedule(0);
  };
  visibility?.addEventListener("visibilitychange", onVisibility);
  schedule(0);
  return {
    refresh() {
      if (controller.signal.aborted) return;
      if (inFlight) refreshRequested = true;
      else schedule(0);
    },
    stop() {
      controller.abort();
      clearTimeout(timer);
      visibility?.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
