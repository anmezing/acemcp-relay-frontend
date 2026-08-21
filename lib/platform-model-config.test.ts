import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/relay-console", () => ({
  getRelayAdminHeaders: vi.fn(() => ({ "X-LCE-Console-Token": "test" })),
}));

import { fetchPlatformModelConfig } from "./platform-model-config";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function responseConfig(promptEnhancer: unknown) {
  return {
    config: {
      embeddings: {
        provider: "voyage",
        model: "voyage-code-3",
        baseUrl: "https://api.voyageai.com/v1/embeddings",
        dimensions: 1024,
        apiKeyConfigured: true,
        apiKeyCount: 2,
      },
      rerank: {
        provider: "voyage",
        model: "rerank-2.5-lite",
        baseUrl: "https://api.voyageai.com/v1/rerank",
        apiKeyConfigured: true,
        apiKeyCount: 1,
      },
      promptEnhancer,
    },
  };
}

beforeEach(() => fetchMock.mockReset());

describe("platform prompt enhancer config parsing", () => {
  it("returns prompt enhancer state without provider secrets", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(responseConfig({
      enabled: true,
      provider: "openai-compatible",
      model: "chat-v1",
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKeyConfigured: true,
      apiKeyCount: 3,
      apiKey: "must-not-pass-through",
    })), { status: 200 }));

    const result = await fetchPlatformModelConfig();
    expect(result.promptEnhancer).toEqual({
      enabled: true,
      provider: "openai-compatible",
      model: "chat-v1",
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKeyConfigured: true,
      apiKeyCount: 3,
    });
    expect(JSON.stringify(result)).not.toContain("must-not-pass-through");
  });

  it("fails closed when the backend omits the prompt enhancer contract", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(responseConfig(undefined)), { status: 200 }));
    await expect(fetchPlatformModelConfig()).rejects.toThrow("promptEnhancer");
  });

  it("preserves native Anthropic and Gemini providers from the backend", async () => {
    for (const provider of ["anthropic", "gemini"] as const) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(responseConfig({
        enabled: true,
        provider,
        model: provider === "anthropic" ? "claude-3-5-sonnet" : "gemini-2.5-flash",
        baseUrl: provider === "anthropic"
          ? "https://api.anthropic.com/v1/messages"
          : "https://generativelanguage.googleapis.com/v1beta/models",
        apiKeyConfigured: true,
        apiKeyCount: 1,
      })), { status: 200 }));
      const result = await fetchPlatformModelConfig();
      expect(result.promptEnhancer.provider).toBe(provider);
    }
  });
});

