import { PROVIDER_ENDPOINTS } from "./model-provider-presets";

export type RerankProvider = "siliconflow-compatible" | "voyage" | "custom";

export interface RerankProviderPreset {
  label: string;
  baseUrl: string;
  models: readonly string[];
  dynamicModels: boolean;
}

export const RERANK_PROVIDER_PRESETS: Record<RerankProvider, RerankProviderPreset> = {
  "siliconflow-compatible": {
    label: "SiliconFlow",
    baseUrl: PROVIDER_ENDPOINTS.siliconFlowRerank,
    models: [],
    dynamicModels: true,
  },
  voyage: {
    label: "Voyage AI",
    baseUrl: PROVIDER_ENDPOINTS.voyageRerank,
    models: ["rerank-2.5", "rerank-2.5-lite"],
    dynamicModels: false,
  },
  custom: {
    label: "自定义兼容服务",
    baseUrl: "",
    models: [],
    dynamicModels: false,
  },
};

export function isRerankProvider(value: unknown): value is RerankProvider {
  return value === "siliconflow-compatible" || value === "voyage" || value === "custom";
}

export function normalizedRerankBaseUrl(provider: RerankProvider, submitted: unknown): string {
  const preset = RERANK_PROVIDER_PRESETS[provider];
  return provider === "custom" ? String(submitted ?? "").trim() : preset.baseUrl;
}
