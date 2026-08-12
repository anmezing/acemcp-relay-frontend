import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/model-config-db", () => ({
  getUserModelConfigRow: vi.fn(),
  resetUserModelConfig: vi.fn(),
  saveUserModelConfig: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { encryptModelConfig } from "@/lib/model-config-crypto";
import {
  getUserModelConfigRow,
  saveUserModelConfig,
} from "@/lib/model-config-db";
import { POST } from "./route";

const getSession = vi.mocked(auth.api.getSession);
const getRow = vi.mocked(getUserModelConfigRow);
const saveConfig = vi.mocked(saveUserModelConfig);

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

  it("reuses the saved API key when editing the same provider", async () => {
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
