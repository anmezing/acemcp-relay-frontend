import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/admin", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/platform-model-config", () => ({ fetchPlatformModelConfig: vi.fn() }));
vi.mock("@/lib/relay-console", () => ({ getRelayAdminHeaders: vi.fn(() => ({ "X-LCE-Console-Token": "console-token" })) }));

import { requireAdminSession } from "@/lib/admin";
import { fetchPlatformModelConfig } from "@/lib/platform-model-config";
import { getRelayAdminHeaders } from "@/lib/relay-console";
import { GET, POST } from "./route";
import { MODEL_CONFIG_SAVE_PROXY_TIMEOUT_MS } from "@/lib/model-config-request";

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
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
});

afterEach(() => vi.useRealTimers());

describe("admin model config routes", () => {
  it("requires admin access", async () => {
    admin.mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads live config and forwards writes with console authentication", async () => {
    expect((await GET()).status).toBe(200);
    const patch = {
      section: "promptEnhancer",
      config: { promptEnhancer: { enabled: true, model: "gpt-5-mini" } },
      confirmEmbeddingReset: false,
    };
    const response = await POST(request(JSON.stringify(patch)));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "X-LCE-Console-Token": "console-token", "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    expect(headers).toHaveBeenCalled();
  });

  it("bounds request bodies before proxying", async () => {
    const response = await POST(request("x".repeat(64 * 1024 + 1)));
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards reasoning options in the prompt-only configuration patch", async () => {
    const patch = { section: "promptEnhancer", config: { promptEnhancer: { reasoningMode: "thinking-disabled", jsonMode: true } } };
    expect((await POST(request(JSON.stringify(patch)))).status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(patch);
  });

  it("returns a bounded timeout before the public proxy does and cancels relay work", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const response = POST(request(JSON.stringify({ section: "promptEnhancer", config: { promptEnhancer: {} } })));
    await vi.advanceTimersByTimeAsync(MODEL_CONFIG_SAVE_PROXY_TIMEOUT_MS);
    const result = await response;
    expect(result.status).toBe(504);
    expect((await result.json()).error).toContain("保存结果尚未确认");
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also bounds a stalled response body", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start() {} })));
    const response = POST(request("{}"));
    await vi.advanceTimersByTimeAsync(MODEL_CONFIG_SAVE_PROXY_TIMEOUT_MS);
    expect((await response).status).toBe(504);
  });

  it("propagates a browser disconnect to the relay request", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const pending = new Promise<void>((resolve) => { started = resolve; });
    fetchMock.mockImplementationOnce(() => { started(); return new Promise(() => {}); });
    const response = POST(new Request("http://localhost/api/admin/model-config", {
      method: "POST", body: "{}", signal: controller.signal,
    }));
    await pending;
    controller.abort();
    expect((await response).status).toBe(504);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
