import { readBoundedJson } from "./bounded-json";
import { withModelConfigDeadline } from "./model-config-request";

export interface ModelConfigOperation {
  id: string;
  section: "embeddings" | "rerank" | "promptEnhancer";
  embeddingChanged: boolean;
  status: "pending" | "running" | "succeeded" | "rejected";
  attempt_count: number;
  recovery_required: boolean;
  updated_at: string;
  error?: string;
}

export function parseModelConfigOperation(value: unknown): ModelConfigOperation | null {
  if (!value || typeof value !== "object" || !("operation" in value)) throw new Error("Invalid configuration operation response");
  if (value.operation === null) return null;
  const job = value.operation as Partial<ModelConfigOperation> | undefined;
  if (!job || typeof job.id !== "string" || !job.id ||
    !["embeddings", "rerank", "promptEnhancer"].includes(job.section ?? "") ||
    !["pending", "running", "succeeded", "rejected"].includes(job.status ?? "") ||
    typeof job.embeddingChanged !== "boolean" || typeof job.recovery_required !== "boolean" ||
    (job.recovery_required && job.status !== "running") ||
    !Number.isSafeInteger(job.attempt_count) || job.attempt_count! < 0 ||
    typeof job.updated_at !== "string" || !Number.isFinite(Date.parse(job.updated_at)) ||
    (job.error !== undefined && typeof job.error !== "string")) throw new Error("Invalid configuration operation response");
  return job as ModelConfigOperation;
}

export function isModelConfigOperationActive(job: ModelConfigOperation | null): boolean {
  return job?.status === "pending" || job?.status === "running";
}

export async function requestModelConfigOperation(operationId: string, signal?: AbortSignal, recover = false): Promise<ModelConfigOperation | null> {
  return withModelConfigDeadline(async (requestSignal) => {
    const response = await fetch(recover ? "/api/admin/model-config" : `/api/admin/model-config?operation=${encodeURIComponent(operationId)}`, {
      method: recover ? "POST" : "GET", cache: "no-store", signal: requestSignal,
      ...(recover ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recover", operationId }) } : {}),
    });
    const value = await readBoundedJson(response, 64 * 1024, requestSignal);
    if (!response.ok) throw new Error("Configuration operation status unavailable");
    const operation = parseModelConfigOperation(value);
    if (operationId !== "latest" && (!operation || operation.id !== operationId))
      throw new Error("Configuration operation identity mismatch");
    return operation;
  }, 15_000, signal);
}
