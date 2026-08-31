import { modelDiscoveryResultLimit } from "@/lib/server-runtime-config";

interface SiliconFlowModelsResponse {
  data?: Array<{ id?: unknown }>;
}

export function parseSiliconFlowRerankModels(payload: unknown): string[] {
  const data = (payload as SiliconFlowModelsResponse | null)?.data;
  if (!Array.isArray(data)) return [];
  return [...new Set(
    data
      .map((item) => (typeof item?.id === "string" ? item.id.trim() : ""))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b)).slice(0, modelDiscoveryResultLimit());
}
