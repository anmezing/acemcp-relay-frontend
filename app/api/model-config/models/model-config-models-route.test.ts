import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/model-config-db", () => ({ getUserModelConfigRow: vi.fn() }));
vi.mock("@/lib/model-config-crypto", () => ({
  decryptModelConfig: vi.fn(),
  modelConfigEnabled: vi.fn(() => !!process.env.MODEL_CONFIG_SECRET),
}));

import { auth } from "@/lib/auth";
import { decryptModelConfig } from "@/lib/model-config-crypto";
import { getUserModelConfigRow } from "@/lib/model-config-db";
import { POST } from "./route";

const getSession = vi.mocked(auth.api.getSession);
const getRow = vi.mocked(getUserModelConfigRow);
const decrypt = vi.mocked(decryptModelConfig);
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function request(body: unknown) {
  return new Request("http://localhost/api/model-config/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MODEL_CONFIG_SECRET = "model-config-models-route-test-secret";
  getSession.mockResolvedValue({ user: { id: "user-1" } } as Awaited<ReturnType<typeof auth.api.getSession>>);
  getRow.mockResolvedValue(null);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({
    data: [{ id: "BAAI/bge-reranker-v2-m3" }],
  }), { status: 200, headers: { "content-type": "application/json" } }));
});

describe("POST /api/model-config/models", () => {
  it("requires a session", async () => {
    getSession.mockResolvedValue(null);
    const response = await POST(request({ provider: "siliconflow-compatible", apiKey: "sk-test" }));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not proxy model discovery when personal model configuration is disabled", async () => {
    delete process.env.MODEL_CONFIG_SECRET;

    const response = await POST(request({
      provider: "siliconflow-compatible",
      apiKey: "sk-test",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "服务端未启用自定义 rerank（未配置 MODEL_CONFIG_SECRET）",
    });
    expect(getRow).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sanitizes failures while loading a saved API key", async () => {
    getRow.mockRejectedValue(new Error("database connection detail"));

    const response = await POST(request({
      provider: "siliconflow-compatible",
      apiKey: "",
    }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "获取模型失败，请稍后重试" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only discovers models from the fixed SiliconFlow endpoint", async () => {
    const response = await POST(request({
      provider: "siliconflow-compatible",
      apiKey: "sk-test",
      baseUrl: "https://evil.example/v1",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["BAAI/bge-reranker-v2-m3"] });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.siliconflow.cn/v1/models?type=text&sub_type=reranker"
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-test");
  });

  it("can use the saved key only for an existing SiliconFlow configuration", async () => {
    getRow.mockResolvedValue({ config_enc: "encrypted" });
    decrypt.mockReturnValue({
      rerank: {
        provider: "siliconflow-compatible",
        model: "BAAI/bge-reranker-v2-m3",
        baseUrl: "https://api.siliconflow.cn/v1/rerank",
        apiKey: "saved-key",
      },
    });
    const response = await POST(request({ provider: "siliconflow-compatible", apiKey: "" }));
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer saved-key");
  });

  it("maps provider authentication failures without returning provider bodies", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "sensitive detail" }), { status: 401 }));
    const response = await POST(request({ provider: "siliconflow-compatible", apiKey: "bad-key" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "API Key 无效或无权访问模型列表" });
  });
});
