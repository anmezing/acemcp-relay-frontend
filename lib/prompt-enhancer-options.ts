export type PromptEnhancerProvider = "openai-compatible" | "openai-responses" | "anthropic" | "gemini";

export const PROMPT_REASONING_MODES = [
  "provider-default",
  "effort-none", "effort-minimal", "effort-low", "effort-medium", "effort-high", "effort-xhigh", "effort-max",
  "thinking-disabled", "thinking-low", "thinking-high", "thinking-max",
] as const;

export type PromptReasoningMode = typeof PROMPT_REASONING_MODES[number];

export function promptReasoningModes(provider: PromptEnhancerProvider): PromptReasoningMode[] {
  if (provider === "openai-compatible") return [...PROMPT_REASONING_MODES];
  if (provider === "openai-responses") return PROMPT_REASONING_MODES.filter((mode) => !mode.startsWith("thinking-"));
  return ["provider-default"];
}

export function parsePromptEnhancerOptions(provider: PromptEnhancerProvider, value: Record<string, unknown>) {
  const reasoningMode = value.reasoningMode ?? "provider-default";
  if (!promptReasoningModes(provider).includes(reasoningMode as PromptReasoningMode)) {
    throw new Error("Invalid promptEnhancer reasoningMode for API type");
  }
  if (value.jsonMode !== undefined && typeof value.jsonMode !== "boolean") {
    throw new Error("Invalid promptEnhancer jsonMode");
  }
  if (value.jsonMode === true && provider !== "openai-compatible") {
    throw new Error("promptEnhancer jsonMode requires Chat Completions");
  }
  return { reasoningMode: reasoningMode as PromptReasoningMode, jsonMode: value.jsonMode === true };
}
