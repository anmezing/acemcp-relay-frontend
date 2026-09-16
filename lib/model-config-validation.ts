import { parsePromptEnhancerOptions, PROMPT_REASONING_MODES, type PromptEnhancerProvider } from "./prompt-enhancer-options";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateModelConfigRequest(value: unknown): void {
  if (!record(value)) throw new Error("Model configuration request must be an object");
  if (value.operationId !== undefined && (typeof value.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.operationId)))
    throw new Error("Invalid configuration operation identity");
  if (value.action === "recover") {
    if (!value.operationId) throw new Error("Configuration operation identity is required");
    return;
  }
  if (value.action === "models") {
    if (!["embeddings", "rerank", "promptEnhancer"].includes(String(value.kind))) throw new Error("Invalid model kind");
    return;
  }
  if (value.action !== undefined && value.action !== "save") throw new Error("Invalid model configuration action");
  if (!["embeddings", "rerank", "promptEnhancer"].includes(String(value.section))) throw new Error("Invalid model section");
  if (!record(value.config) || Object.keys(value.config).length !== 1 || !record(value.config[String(value.section)]))
    throw new Error("Config must contain exactly the selected model section");
  if (value.confirmEmbeddingReset !== undefined && typeof value.confirmEmbeddingReset !== "boolean")
    throw new Error("Invalid embedding reset confirmation");
  if (value.confirmEmbeddingReset === true && value.section !== "embeddings") throw new Error("Only embeddings can reset indexes");
  if (value.section !== "promptEnhancer") return;
  const prompt = value.config.promptEnhancer as Record<string, unknown>;
  if (prompt.enabled !== undefined && typeof prompt.enabled !== "boolean") throw new Error("Invalid prompt enhancer enabled value");
  if (prompt.jsonMode !== undefined && typeof prompt.jsonMode !== "boolean") throw new Error("Invalid prompt enhancer JSON mode");
  if (prompt.reasoningMode !== undefined && !(PROMPT_REASONING_MODES as readonly unknown[]).includes(prompt.reasoningMode))
    throw new Error("Invalid prompt enhancer reasoning mode");
  if (prompt.provider !== undefined) {
    if (!["openai-compatible", "openai-responses", "anthropic", "gemini"].includes(String(prompt.provider))) throw new Error("Invalid prompt enhancer provider");
    parsePromptEnhancerOptions(prompt.provider as PromptEnhancerProvider, prompt);
  }
}
