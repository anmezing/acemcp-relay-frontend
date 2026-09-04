import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/model-config-db", () => ({
  getUserModelConfigRow: vi.fn(),
  resetUserModelConfig: vi.fn(),
  saveUserModelConfig: vi.fn(),
}));
vi.mock("@/lib/platform-model-config", () => ({
  fetchPlatformModelConfig: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { encryptModelConfig } from "@/lib/model-config-crypto";
import {
  getUserModelConfigRow,
  resetUserModelConfig,
  saveUserModelConfig,
} from "@/lib/model-config-db";
import { fetchPlatformModelConfig } from "@/lib/platform-model-config";
import { DELETE, GET, POST } from "./route";

const getSession = vi.mocked(auth.api.getSession);
const getRow = vi.mocked(getUserModelConfigRow);
const saveConfig = vi.mocked(saveUserModelConfig);
const resetConfig = vi.mocked(resetUserModelConfig);
const getPlatformConfig = vi.mocked(fetchPlatformModelConfig);

function request(rerank: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/model-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rerank }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MODEL_CONFIG_SECRET = "model-config-route-test-secret";
  getSession.mockResolvedValue({ user: { id: "user-1" } } as Awaited<ReturnType<typeof auth.api.getSession>>);
  getPlatformConfig.mockResolvedValue({
    embeddings: {
      provider: "voyage",
      model: "voyage-code-3",
      baseUrl: "https://api.voyageai.com/v1/embeddings",
      dimensions: 1024,
      apiKeyConfigured: true,
      apiKeyCount: 1,
    },
    rerank: {
      provider: "siliconflow-compatible",
      model: "BAAI/bge-reranker-v2-m3",
      baseUrl: "https://api.siliconflow.cn/v1/rerank",
      apiKeyConfigured: true,
      apiKeyCount: 1,
    },
    promptEnhancer: {
      enabled: false,
      provider: "openai-compatible",
      model: "",
      baseUrl: "",
      apiKeyConfigured: false,
      apiKeyCount: 0,
    },
  });
});

describe("GET /api/model-config", () => {
  it("returns live platform defaults from Relay", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      platformDefaults: {
        embeddings: { provider: "voyage", model: "voyage-code-3" },
        rerank: { provider: "siliconflow-compatible" },
      },
    });
    expect(getPlatformConfig).toHaveBeenCalledTimes(1);
  });

  it("does not return any API-key derivative and exposes the effective source", async () => {
    getRow.mockResolvedValue({
      config_enc: encryptModelConfig({
        rerank: {
          provider: "voyage",
          model: "rerank-2.5",
          baseUrl: "https://api.voyageai.com/v1/rerank",
          apiKey: "private-key-shape-must-not-leak",
        },
      }),
    });

    const response = await GET();
    const data = await response.json();
    expect(data).toMatchObject({
      configured: true,
      effectiveSource: "personal",
      apiKeyConfigured: true,
      rerank: { provider: "voyage", model: "rerank-2.5" },
    });
    expect(data.rerank).not.toHaveProperty("apiKey");
  });

  it("reports platform fallback when no personal config exists", async () => {
    getRow.mockResolvedValue(null);
    const response = await GET();
    expect(await response.json()).toMatchObject({
      configured: false,
      effectiveSource: "platform",
      apiKeyConfigured: false,
    });
  });

  it("fails closed when Relay platform config is unavailable", async () => {
    getPlatformConfig.mockRejectedValueOnce(new Error("down"));
    const response = await GET();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "模型配置服务不可用" });
    expect(getRow).not.toHaveBeenCalled();
  });
});

describe("POST /api/model-config", () => {
  it("does not reuse a saved API key after switching providers", async () => {
    getRow.mockResolvedValue({
      config_enc: encryptModelConfig({
        rerank: {
          provider: "siliconflow-compatible",
          model: "BAAI/bge-reranker-v2-m3",
          baseUrl: "https://api.siliconflow.cn/v1/rerank",
          apiKey: "siliconflow-key",
        },
      }),
    });

    const response = await POST(request({
      provider: "voyage",
      model: "rerank-2.5-lite",
      baseUrl: "https://api.voyageai.com/v1/rerank",
      apiKey: "",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "请填写 rerank API Key" });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("does not reuse a custom-provider key after changing its base URL", async () => {
    getRow.mockResolvedValue({
      config_enc: encryptModelConfig({
        rerank: {
          provider: "custom",
          model: "old-model",
          baseUrl: "https://old.example/v1/rerank",
          apiKey: "custom-secret",
        },
      }),
    });

    const response = await POST(request({
      provider: "custom",
      model: "new-model",
      baseUrl: "https://new.example/v1/rerank",
      apiKey: "",
    }));

    expect(response.status).toBe(400);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("reuses the saved API key only for the same normalized credential target", async () => {
    getRow.mockResolvedValue({
      config_enc: encryptModelConfig({
        rerank: {
          provider: "voyage",
          model: "rerank-2.5-lite",
          baseUrl: "https://api.voyageai.com/v1/rerank",
          apiKey: "voyage-key",
        },
      }),
    });

    const response = await POST(request({
      provider: "voyage",
      model: "rerank-2.5",
      baseUrl: "https://evil.example/rerank",
      apiKey: "",
    }));

    expect(response.status).toBe(200);
    expect(saveConfig).toHaveBeenCalledWith("user-1", {
      rerank: {
        provider: "voyage",
        model: "rerank-2.5",
        baseUrl: "https://api.voyageai.com/v1/rerank",
        apiKey: "voyage-key",
      },
    });
  });
});


describe("DELETE /api/model-config", () => {
  it("requires authentication before deleting personal credentials", async () => {
    getSession.mockResolvedValueOnce(null);

    const response = await DELETE();

    expect(response.status).toBe(401);
    expect(resetConfig).not.toHaveBeenCalled();
  });

  it("removes the personal config so requests fall back to the platform", async () => {
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(resetConfig).toHaveBeenCalledWith("user-1");
    expect(await response.json()).toMatchObject({
      configured: false,
      effectiveSource: "platform",
      reset: true,
      apiKeyConfigured: false,
    });
  });
});
