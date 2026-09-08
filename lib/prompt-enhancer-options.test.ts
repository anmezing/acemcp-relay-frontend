import { describe, expect, it } from "vitest";
import { parsePromptEnhancerOptions, promptReasoningModes } from "./prompt-enhancer-options";

describe("prompt enhancer reasoning options", () => {
  it("keeps extensions opt-in and prevents protocol mismatches", () => {
    expect(parsePromptEnhancerOptions("openai-compatible", {})).toEqual({ reasoningMode: "provider-default", jsonMode: false });
    expect(promptReasoningModes("openai-compatible")).toContain("thinking-disabled");
    expect(promptReasoningModes("openai-responses")).toContain("effort-low");
    expect(promptReasoningModes("openai-responses")).not.toContain("thinking-disabled");
    expect(promptReasoningModes("anthropic")).toEqual(["provider-default"]);
    expect(promptReasoningModes("gemini")).toEqual(["provider-default"]);
  });

  it("rejects unknown options instead of silently changing provider behavior", () => {
    expect(() => parsePromptEnhancerOptions("openai-compatible", { reasoningMode: "invented" })).toThrow();
    expect(() => parsePromptEnhancerOptions("openai-responses", { reasoningMode: "thinking-disabled" })).toThrow();
    expect(() => parsePromptEnhancerOptions("anthropic", { jsonMode: true })).toThrow();
    expect(() => parsePromptEnhancerOptions("openai-compatible", { jsonMode: "true" })).toThrow();
  });
});
