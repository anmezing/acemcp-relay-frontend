import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/admin", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/relay-console", () => ({ getRelayAdminHeaders: vi.fn(() => ({ "X-LCE-Console-Token": "console-token" })) }));

import { requireAdminSession } from "@/lib/admin";
import { getRelayAdminHeaders } from "@/lib/relay-console";
import { POST } from "./route";

const admin = vi.mocked(requireAdminSession);
const headers = vi.mocked(getRelayAdminHeaders);
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function request(body: string) {
  return new NextRequest("http://localhost/api/admin/model-config/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  admin.mockResolvedValue({ user: { id: "admin" } } as Awaited<ReturnType<typeof requireAdminSession>>);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ models: ["m1"] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
});

describe("POST /api/admin/model-config/models", () => {
  it("forwards only the model discovery fields", async () => {
    const response = await POST(request(JSON.stringify({
      kind: "embeddings",
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1/embeddings",
      apiKey: "secret",
      extra: "ignored",
    })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["m1"] });
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({
      action: "models",
      kind: "embeddings",
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1/embeddings",
      apiKey: "secret",
    }));
    expect(headers).toHaveBeenCalled();
  });

  it("rejects oversized bodies", async () => {
    const response = await POST(request("x".repeat(64 * 1024 + 1)));
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts prompt enhancer model discovery", async () => {
    await POST(request(JSON.stringify({
      kind: "promptEnhancer",
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "secret",
    })));
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({
      action: "models",
      kind: "promptEnhancer",
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "secret",
    }));
  });
});
