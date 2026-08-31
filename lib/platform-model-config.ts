import { getRelayAdminHeaders } from "@/lib/relay-console";

const RELAY_URL = process.env.LCE_RELAY_URL || "http://relay:3009";
const CONFIG_URL = `${RELAY_URL}/internal/platform-model-config`;
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface PlatformModelConfigView {
  embeddings: {
    provider: "openai-compatible" | "voyage";
    model: string;
    baseUrl: string;
    dimensions: number;
    outputDimension?: number;
    outputDtype?: "float";
    queryPrefix?: string;
    documentPrefix?: string;
    apiKeyConfigured: boolean;
    apiKeyCount: number;
  };
  rerank: {
    provider: "siliconflow-compatible" | "voyage" | "custom";
    model: string;
    baseUrl: string;
    apiKeyConfigured: boolean;
    apiKeyCount: number;
  };
  promptEnhancer: {
    enabled: boolean;
    provider: "openai-compatible" | "anthropic" | "gemini";
    model: string;
    baseUrl: string;
    apiKeyConfigured: boolean;
    apiKeyCount: number;
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`模型配置响应缺少 ${field}`);
  }
  return value.trim();
}

function parseView(value: unknown): PlatformModelConfigView {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("模型配置服务返回了无效响应");
  }
  const config = (value as { config?: unknown }).config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("模型配置服务返回了无效响应");
  }
  const embeddings = (config as { embeddings?: unknown }).embeddings;
  const rerank = (config as { rerank?: unknown }).rerank;
  const promptEnhancer = (config as { promptEnhancer?: unknown }).promptEnhancer;
  if (!embeddings || typeof embeddings !== "object" || Array.isArray(embeddings)) {
    throw new Error("模型配置响应缺少 embeddings");
  }
  if (!rerank || typeof rerank !== "object" || Array.isArray(rerank)) {
    throw new Error("模型配置响应缺少 rerank");
  }
  if (!promptEnhancer || typeof promptEnhancer !== "object" || Array.isArray(promptEnhancer)) {
    throw new Error("模型配置响应缺少 promptEnhancer");
  }

  const embeddingValue = embeddings as Record<string, unknown>;
  const rerankValue = rerank as Record<string, unknown>;
  const promptEnhancerValue = promptEnhancer as Record<string, unknown>;
  if (embeddingValue.provider !== "openai-compatible" && embeddingValue.provider !== "voyage") {
    throw new Error("模型配置响应包含未知 embeddings provider");
  }
  if (
    rerankValue.provider !== "siliconflow-compatible" &&
    rerankValue.provider !== "voyage" &&
    rerankValue.provider !== "custom"
  ) {
    throw new Error("模型配置响应包含未知 rerank provider");
  }
  if (
    promptEnhancerValue.provider !== "openai-compatible" &&
    promptEnhancerValue.provider !== "anthropic" &&
    promptEnhancerValue.provider !== "gemini"
  ) {
    throw new Error("模型配置响应包含未知 promptEnhancer provider");
  }
  if (typeof promptEnhancerValue.enabled !== "boolean") {
    throw new Error("模型配置响应包含无效 promptEnhancer enabled");
  }
  if (
    typeof embeddingValue.dimensions !== "number" ||
    !Number.isSafeInteger(embeddingValue.dimensions) ||
    embeddingValue.dimensions <= 0
  ) {
    throw new Error("模型配置响应包含无效 embeddings dimensions");
  }
  if (
    embeddingValue.outputDimension !== undefined &&
    (
      typeof embeddingValue.outputDimension !== "number" ||
      !Number.isSafeInteger(embeddingValue.outputDimension) ||
      embeddingValue.outputDimension <= 0
    )
  ) {
    throw new Error("模型配置响应包含无效 embeddings outputDimension");
  }

  return {
    embeddings: {
      provider: embeddingValue.provider,
      model: requiredString(embeddingValue.model, "embeddings.model"),
      baseUrl: requiredString(embeddingValue.baseUrl, "embeddings.baseUrl"),
      dimensions: embeddingValue.dimensions,
      outputDimension: typeof embeddingValue.outputDimension === "number"
        ? embeddingValue.outputDimension
        : undefined,
      outputDtype: embeddingValue.outputDtype === "float" ? "float" : undefined,
      queryPrefix: typeof embeddingValue.queryPrefix === "string"
        ? embeddingValue.queryPrefix
        : undefined,
      documentPrefix: typeof embeddingValue.documentPrefix === "string"
        ? embeddingValue.documentPrefix
        : undefined,
      apiKeyConfigured: embeddingValue.apiKeyConfigured === true,
      apiKeyCount: typeof embeddingValue.apiKeyCount === "number" && Number.isSafeInteger(embeddingValue.apiKeyCount)
        ? embeddingValue.apiKeyCount
        : 0,
    },
    rerank: {
      provider: rerankValue.provider,
      model: requiredString(rerankValue.model, "rerank.model"),
      baseUrl: requiredString(rerankValue.baseUrl, "rerank.baseUrl"),
      apiKeyConfigured: rerankValue.apiKeyConfigured === true,
      apiKeyCount: typeof rerankValue.apiKeyCount === "number" && Number.isSafeInteger(rerankValue.apiKeyCount)
        ? rerankValue.apiKeyCount
        : 0,
    },
    promptEnhancer: {
      enabled: promptEnhancerValue.enabled,
      provider: promptEnhancerValue.provider,
      model: typeof promptEnhancerValue.model === "string" ? promptEnhancerValue.model.trim() : "",
      baseUrl: typeof promptEnhancerValue.baseUrl === "string" ? promptEnhancerValue.baseUrl.trim() : "",
      apiKeyConfigured: promptEnhancerValue.apiKeyConfigured === true,
      apiKeyCount: typeof promptEnhancerValue.apiKeyCount === "number" && Number.isSafeInteger(promptEnhancerValue.apiKeyCount)
        ? promptEnhancerValue.apiKeyCount
        : 0,
    },
  };
}

export async function fetchPlatformModelConfig(): Promise<PlatformModelConfigView> {
  const response = await fetch(CONFIG_URL, {
    headers: getRelayAdminHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("模型配置响应过大");
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("模型配置服务返回了无效响应");
  }
  if (!response.ok) {
    const error = data && typeof data === "object" &&
      typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : `HTTP ${response.status}`;
    throw new Error(error);
  }
  return parseView(data);
}
