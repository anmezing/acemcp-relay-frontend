export interface RootDeletion {
  id: string;
  root_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  deleted_files: number;
  error?: string;
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

export function reconcileRootDeletions(current: RootDeletions, incoming: RootDeletion[]): RootDeletions {
  const next = mergeRootDeletions(current, incoming);
  const roots = new Set(incoming.map((job) => job.root_id));
  // Call only for a list started after the last submission finished. All active
  // jobs are listed, but terminal jobs eventually leave the retention window.
  for (const rootId of Object.keys(next)) {
    if (!roots.has(rootId)) delete next[rootId];
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
    const data: unknown = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onAbort);
  }
}

export function startRootDeletionMonitor(options: {
  load: (signal: AbortSignal) => Promise<RootDeletion[]>;
  onUpdate: (jobs: RootDeletion[]) => void;
  onError: (error: unknown) => void;
  hasActive: () => boolean;
}): { refresh: () => void; stop: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let refreshRequested = false;
  let failures = 0;
  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => { void tick(); }, delay);
  };
  const tick = async () => {
    if (controller.signal.aborted || inFlight) return;
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
    },
  };
}
