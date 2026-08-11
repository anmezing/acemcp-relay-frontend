import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ getApiKey: vi.fn(), initDB: vi.fn(async () => undefined) }));
vi.mock("@/lib/org-db", () => ({ getMemberRole: vi.fn(), ensureOrgApiKey: vi.fn() }));

import { auth } from "@/lib/auth";
import { getApiKey } from "@/lib/db";
import { ensureOrgApiKey, getMemberRole } from "@/lib/org-db";
import { GET } from "./route";

const getSession = vi.mocked(auth.api.getSession);
const getApiKeyMock = vi.mocked(getApiKey);
const getMemberRoleMock = vi.mocked(getMemberRole);
const ensureOrgApiKeyMock = vi.mocked(ensureOrgApiKey);
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: "user-1" } } as Awaited<ReturnType<typeof auth.api.getSession>>);
  getApiKeyMock.mockResolvedValue({ api_key: "sk-personal" } as Awaited<ReturnType<typeof getApiKey>>);
  getMemberRoleMock.mockResolvedValue(null);
  ensureOrgApiKeyMock.mockResolvedValue({ api_key: "sk-org" } as Awaited<ReturnType<typeof ensureOrgApiKey>>);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ exists: true, fileCount: 2, languages: {} }), { status: 200 }));
});

describe("GET /api/tenant-stats", () => {
  it("uses the personal key by default", async () => {
    const response = await GET(new NextRequest("http://localhost/api/tenant-stats"));

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toContain("/mcp/tenant-stats");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-personal");
    expect(getMemberRoleMock).not.toHaveBeenCalled();
  });

  it("uses the selected organization key for member stats", async () => {
    getMemberRoleMock.mockResolvedValue("member");

    const response = await GET(new NextRequest("http://localhost/api/tenant-stats?orgId=org-1"));

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-org");
    expect(ensureOrgApiKeyMock).toHaveBeenCalledWith("user-1", "org-1", "member");
    expect(getApiKeyMock).not.toHaveBeenCalled();
  });

  it("rejects organization stats for non-members before contacting Relay", async () => {
    const response = await GET(new NextRequest("http://localhost/api/tenant-stats?orgId=org-1"));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
