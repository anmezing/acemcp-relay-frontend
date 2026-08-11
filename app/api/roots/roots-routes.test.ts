import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// 路由单测：mock 掉鉴权 / 数据库 / relay fetch，只验证代理逻辑
// （鉴权分支、组织上下文权限、上游透传、错误映射、409 冲突）。
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({
  getApiKey: vi.fn(),
  initDB: vi.fn(async () => undefined),
}));

vi.mock("@/lib/org-db", () => ({
  getMemberRole: vi.fn(),
  ensureOrgApiKey: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { getApiKey } from "@/lib/db";
import { ensureOrgApiKey, getMemberRole } from "@/lib/org-db";
import { GET } from "./route";
import { POST } from "./delete/route";

const getSession = vi.mocked(auth.api.getSession);
const getApiKeyMock = vi.mocked(getApiKey);
const getMemberRoleMock = vi.mocked(getMemberRole);
const ensureOrgApiKeyMock = vi.mocked(ensureOrgApiKey);
const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

function relayResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function loginAs(userId: string | null) {
  getSession.mockResolvedValue(
    // 只关心 user.id，其余 session 字段路由不消费
    (userId ? { user: { id: userId } } : null) as Awaited<ReturnType<typeof auth.api.getSession>>
  );
}

function rootsRequest(orgId?: string) {
  const url = orgId
    ? `http://localhost/api/roots?orgId=${orgId}`
    : "http://localhost/api/roots";
  return new NextRequest(url);
}

function deleteRequest(body: unknown) {
  return new Request("http://localhost/api/roots/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  loginAs("user-1");
  getApiKeyMock.mockResolvedValue({ api_key: "sk-test" } as Awaited<ReturnType<typeof getApiKey>>);
  getMemberRoleMock.mockResolvedValue(null);
  ensureOrgApiKeyMock.mockResolvedValue(
    { api_key: "sk-org" } as Awaited<ReturnType<typeof ensureOrgApiKey>>
  );
});

describe("GET /api/roots", () => {
  it("透传 relay 的 roots 列表并携带鉴权头", async () => {
    const roots = [
      {
        workspace_id: "ws-1",
        root_id: "root-1",
        branch: "main",
        revision: "abc",
        cloud_revision: 3,
        indexed_at: "2026-08-09T00:00:00Z",
        file_count: 10,
        total_size_bytes: 2048,
      },
    ];
    fetchMock.mockResolvedValue(relayResponse(200, { roots }));

    const res = await GET(rootsRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roots });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/mcp/roots");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
  });

  it("未登录返回 401", async () => {
    loginAs(null);

    const res = await GET(rootsRequest());

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("没有 API Key 时返回空列表且不请求 relay", async () => {
    getApiKeyMock.mockResolvedValue(null as Awaited<ReturnType<typeof getApiKey>>);

    const res = await GET(rootsRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roots: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("上游错误按原状态码透传 error", async () => {
    fetchMock.mockResolvedValue(relayResponse(502, { error: "relay 不可用" }));

    const res = await GET(rootsRequest());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "relay 不可用" });
  });

  it("fetch 抛异常返回 500", async () => {
    fetchMock.mockRejectedValue(new Error("connect refused"));

    const res = await GET(rootsRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "服务器错误" });
  });

  it("orgId 上下文：非成员 403 且不请求 relay（fail-closed）", async () => {
    getMemberRoleMock.mockResolvedValue(null);

    const res = await GET(rootsRequest("org-1"));

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ensureOrgApiKeyMock).not.toHaveBeenCalled();
  });

  it("orgId 上下文：成员用组织密钥查询并附带角色", async () => {
    getMemberRoleMock.mockResolvedValue("member");
    fetchMock.mockResolvedValue(relayResponse(200, { roots: [] }));

    const res = await GET(rootsRequest("org-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roots: [], orgRole: "member" });
    expect(ensureOrgApiKeyMock).toHaveBeenCalledWith("user-1", "org-1", "member");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer sk-org");
    expect(getApiKeyMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/roots/delete", () => {
  it("转发 root_id 并透传删除结果", async () => {
    fetchMock.mockResolvedValue(relayResponse(200, { deleted: true, deleted_files: 42 }));

    const res = await POST(deleteRequest({ root_id: "root-1" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, deleted_files: 42 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/mcp/delete-root");
    expect(JSON.parse(init.body)).toEqual({ root_id: "root-1" });
    expect(init.headers.Authorization).toBe("Bearer sk-test");
  });

  it("缺少 root_id 返回 400 且不请求 relay", async () => {
    const res = await POST(deleteRequest({}));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "缺少 root_id" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("body 非法 JSON 返回 400", async () => {
    const res = await POST(deleteRequest("not-json{"));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("未登录返回 401", async () => {
    loginAs(null);

    const res = await POST(deleteRequest({ root_id: "root-1" }));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("有运行中任务时透传 409 与错误信息", async () => {
    fetchMock.mockResolvedValue(relayResponse(409, { error: "索引任务进行中" }));

    const res = await POST(deleteRequest({ root_id: "root-1" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "索引任务进行中" });
  });

  it("上游错误无 error 字段时使用兜底文案", async () => {
    fetchMock.mockResolvedValue(relayResponse(500, {}));

    const res = await POST(deleteRequest({ root_id: "root-1" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "删除失败" });
  });

  it("组织索引：member 角色删除返回 403（仅 owner 可删）", async () => {
    getMemberRoleMock.mockResolvedValue("member");

    const res = await POST(deleteRequest({ root_id: "root-1", org_id: "org-1" }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "仅组织所有者可删除组织索引" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("组织索引：非成员删除返回 403", async () => {
    getMemberRoleMock.mockResolvedValue(null);

    const res = await POST(deleteRequest({ root_id: "root-1", org_id: "org-1" }));

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("组织索引：owner 用组织密钥转发删除", async () => {
    getMemberRoleMock.mockResolvedValue("owner");
    fetchMock.mockResolvedValue(relayResponse(200, { deleted: true }));

    const res = await POST(deleteRequest({ root_id: "root-1", org_id: "org-1" }));

    expect(res.status).toBe(200);
    expect(ensureOrgApiKeyMock).toHaveBeenCalledWith("user-1", "org-1", "owner");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer sk-org");
    // relay 只收 root_id（org 归属由密钥的 org_id 决定）
    expect(JSON.parse(init.body)).toEqual({ root_id: "root-1" });
  });
});
