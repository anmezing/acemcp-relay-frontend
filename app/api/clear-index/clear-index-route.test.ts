import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ getApiKey: vi.fn(), initDB: vi.fn(async () => undefined) }));
vi.mock("@/lib/org-db", () => ({ getMemberRole: vi.fn(), ensureOrgApiKey: vi.fn() }));

import { auth } from "@/lib/auth";
import { getApiKey } from "@/lib/db";
import { ensureOrgApiKey, getMemberRole } from "@/lib/org-db";
import { POST } from "./route";

const getSession = vi.mocked(auth.api.getSession);
const getApiKeyMock = vi.mocked(getApiKey);
const getMemberRoleMock = vi.mocked(getMemberRole);
const ensureOrgApiKeyMock = vi.mocked(ensureOrgApiKey);
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function request(body: unknown = {}) {
  return new Request("http://localhost/api/clear-index", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: "user-1" } } as Awaited<ReturnType<typeof auth.api.getSession>>);
  getApiKeyMock.mockResolvedValue({ api_key: "sk-personal" } as Awaited<ReturnType<typeof getApiKey>>);
  getMemberRoleMock.mockResolvedValue(null);
  ensureOrgApiKeyMock.mockResolvedValue({ api_key: "sk-org" } as Awaited<ReturnType<typeof ensureOrgApiKey>>);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
});

describe("POST /api/clear-index", () => {
  it("uses the personal key for the personal tenant", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-personal");
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it("requires an organization owner and forwards the organization key", async () => {
    getMemberRoleMock.mockResolvedValue("owner");

    const response = await POST(request({ org_id: "org-1" }));

    expect(response.status).toBe(200);
    expect(ensureOrgApiKeyMock).toHaveBeenCalledWith("user-1", "org-1", "owner");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-org");
  });

  it("rejects organization clearing for members", async () => {
    getMemberRoleMock.mockResolvedValue("member");

    const response = await POST(request({ org_id: "org-1" }));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
