import { describe, expect, it } from "vitest";
import {
  RERANK_PROVIDER_PRESETS,
  normalizedRerankBaseUrl,
} from "./rerank-providers";
import { normalizeUserModelConfig } from "./model-config-crypto";

describe("rerank provider presets", () => {
  it("uses fixed official endpoints for built-in providers", () => {
    expect(normalizedRerankBaseUrl("siliconflow-compatible", "https://evil.example/rerank"))
      .toBe(RERANK_PROVIDER_PRESETS["siliconflow-compatible"].baseUrl);
    expect(normalizedRerankBaseUrl("voyage", "https://evil.example/rerank"))
      .toBe(RERANK_PROVIDER_PRESETS.voyage.baseUrl);
  });

  it("keeps the submitted endpoint only for custom providers", () => {
    expect(normalizedRerankBaseUrl("custom", " https://provider.example/v1/rerank "))
      .toBe("https://provider.example/v1/rerank");
  });

  it("normalization cannot be used to override a built-in provider endpoint", () => {
    const config = normalizeUserModelConfig({
      rerank: {
        provider: "siliconflow-compatible",
        model: "BAAI/bge-reranker-v2-m3",
        baseUrl: "https://evil.example/rerank",
        apiKey: "secret",
      },
    });
    expect(config.rerank.baseUrl).toBe("https://api.siliconflow.cn/v1/rerank");
  });
});
