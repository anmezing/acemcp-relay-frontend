import { describe, expect, it } from "vitest";
import { validateModelConfigRequest } from "./model-config-validation";
import { promptProviderBaseUrl, PROMPT_ENHANCER_PROVIDER_PRESETS } from "./prompt-enhancer-options";

describe("model config boundaries", () => {
  it("switches known provider defaults and preserves custom proxy URLs", () => {
    expect(promptProviderBaseUrl(PROMPT_ENHANCER_PROVIDER_PRESETS.anthropic.baseUrl + "/", "gemini"))
      .toBe(PROMPT_ENHANCER_PROVIDER_PRESETS.gemini.baseUrl);
    expect(promptProviderBaseUrl("https://proxy.example/v1", "gemini")).toBe("https://proxy.example/v1");
    expect(promptProviderBaseUrl("", "anthropic")).toBe(PROMPT_ENHANCER_PROVIDER_PRESETS.anthropic.baseUrl);
  });
  it.each([
    { provider: "anthropic", jsonMode: true },
    { provider: "gemini", reasoningMode: "effort-high" },
    { reasoningMode: "invented" },
    { jsonMode: "true" },
  ])("rejects invalid options before proxying: %j", (promptEnhancer) => {
    expect(() => validateModelConfigRequest({ section: "promptEnhancer", config: { promptEnhancer } })).toThrow();
  });
  it("leaves provider-dependent validation of partial patches to the authoritative service", () => {
    expect(() => validateModelConfigRequest({ section: "promptEnhancer", config: { promptEnhancer: { reasoningMode: "effort-high" } } })).not.toThrow();
  });
});
