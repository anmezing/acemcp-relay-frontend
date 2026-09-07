export const MODEL_CONFIG_SAVE_PROXY_TIMEOUT_MS = 95_000;
export const MODEL_CONFIG_SAVE_CLIENT_TIMEOUT_MS = 100_000;
export const MODEL_CONFIG_READ_TIMEOUT_MS = 20_000;
export const MODEL_CONFIG_DISCOVERY_TIMEOUT_MS = 35_000;

export class ModelConfigRequestTimeoutError extends Error {
  constructor() {
    super("Model configuration request timed out");
    this.name = "ModelConfigRequestTimeoutError";
  }
}

export async function withModelConfigDeadline<Result>(
  operation: (signal: AbortSignal) => Promise<Result>,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<Result> {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  let rejectAborted!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
  const onAbort = () => rejectAborted(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new ModelConfigRequestTimeoutError()), timeoutMs);
  try {
    if (callerSignal?.aborted) {
      return await Promise.reject(callerSignal.reason);
    }
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
