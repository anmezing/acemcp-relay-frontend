import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/admin", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/platform-model-config", () => ({ fetchPlatformModelConfig: vi.fn() }));
vi.mock("@/lib/relay-console", () => ({ getRelayAdminHeaders: vi.fn(() => ({ "X-LCE-Console-Token": "console-token" })) }));

import { requireAdminSession } from "@/lib/admin";
import { fetchPlatformModelConfig } from "@/lib/platform-model-config";
import { getRelayAdminHeaders } from "@/lib/relay-console";
import { GET, POST } from "./route";

const admin = vi.mocked(requireAdminSession);
const platform = vi.mocked(fetchPlatformModelConfig);
const headers = vi.mocked(getRelayAdminHeaders);
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function request(body: string) {
  return new NextRequest("http://localhost/api/admin/model-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  admin.mockResolvedValue({ user: { id: "admin" } } as Awaited<ReturnType<typeof requireAdminSession>>);
  platform.mockResolvedValue({
    embeddings: {
      provider: "voyage",
      model: "voyage-code-3",
      baseUrl: "https://api.voyageai.com/v1/embeddings",
      dimensions: 1024,
      apiKeyConfigured: true,
    },
    rerank: {
      provider: "siliconflow-compatible",
      model: "BAAI/bge-reranker-v2-m3",
      baseUrl: "https://api.siliconflow.cn/v1/rerank",
      apiKeyConfigured: true,
    },
  });
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
});

describe("admin model config routes", () => {
  it("requires admin access", async () => {
    admin.mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads live config and forwards writes with console authentication", async () => {
    expect((await GET()).status).toBe(200);
    const response = await POST(request(JSON.stringify({ config: { embeddings: {}, rerank: {} } })));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "X-LCE-Console-Token": "console-token", "Content-Type": "application/json" },
    });
    expect(headers).toHaveBeenCalled();
  });

  it("bounds request bodies before proxying", async () => {
    const response = await POST(request("x".repeat(64 * 1024 + 1)));
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
