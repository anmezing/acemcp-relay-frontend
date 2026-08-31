export const PROVIDER_ENDPOINTS = Object.freeze({
  voyageEmbeddings: "https://api.voyageai.com/v1/embeddings",
  voyageRerank: "https://api.voyageai.com/v1/rerank",
  siliconFlowRerank: "https://api.siliconflow.cn/v1/rerank",
  siliconFlowRerankModels:
    "https://api.siliconflow.cn/v1/models?type=text&sub_type=reranker",
  anthropicMessages: "https://api.anthropic.com/v1/messages",
  geminiModels: "https://generativelanguage.googleapis.com/v1beta/models",
});

export const CLOUD_VECTOR_DIMENSIONS = 1024;
export const MAX_MODEL_PROVIDER_API_KEYS = 100;

export const EMBEDDING_PROVIDER_PRESETS = {
  "openai-compatible": {
    label: "OpenAI-compatible / Custom",
    baseUrl: "",
    models: [] as readonly string[],
  },
  voyage: {
    label: "Voyage AI",
    baseUrl: PROVIDER_ENDPOINTS.voyageEmbeddings,
    models: ["voyage-code-3"] as readonly string[],
  },
} as const;

export const PROMPT_ENHANCER_PROVIDER_PRESETS = {
  "openai-compatible": { label: "OpenAI-compatible / Custom", baseUrl: "" },
  anthropic: { label: "Anthropic", baseUrl: PROVIDER_ENDPOINTS.anthropicMessages },
  gemini: { label: "Google Gemini", baseUrl: PROVIDER_ENDPOINTS.geminiModels },
} as const;

export const SILICONFLOW_RERANK_MODELS_URL = PROVIDER_ENDPOINTS.siliconFlowRerankModels;
