import { beforeEach, describe, expect, it, vi } from "vitest";

// admin 组织路由权限自查：谁能调 = 仅 ADMIN_EMAILS（requireAdminSession）。
vi.mock("@/lib/admin", () => ({
  requireAdminSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  initDB: vi.fn(async () => undefined),
}));

vi.mock("@/lib/org-db", () => ({
  listOrgsWithQuotas: vi.fn(),
  setOrgQuota: vi.fn(),
}));

import { NextRequest } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { listOrgsWithQuotas, setOrgQuota } from "@/lib/org-db";
import { GET, POST } from "./route";

const requireAdminMock = vi.mocked(requireAdminSession);
const listOrgsMock = vi.mocked(listOrgsWithQuotas);
const setOrgQuotaMock = vi.mocked(setOrgQuota);

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/orgs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(
    { user: { id: "admin" } } as Awaited<ReturnType<typeof requireAdminSession>>
  );
  setOrgQuotaMock.mockResolvedValue(true);
});

describe("GET /api/admin/orgs", () => {
  it("非管理员 403", async () => {
    requireAdminMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listOrgsMock).not.toHaveBeenCalled();
  });

  it("返回组织列表（owner、成员数、配额）", async () => {
    const orgs = [
      {
        org_id: "o1",
        name: "Acme",
        slug: "acme",
        owner_email: "boss@acme.dev",
        member_count: 3,
        daily_request_limit: 1000,
        daily_index_bytes_limit: null,
        effective_daily_request_limit: 1000,
        effective_daily_index_bytes_limit: 4096,
        daily_request_source: "admin_override",
        daily_index_bytes_source: "subscription",
        plan_name: "Team",
        owner_tier: "free",
        created_at: new Date(),
      },
    ];
    listOrgsMock.mockResolvedValue(orgs as Awaited<ReturnType<typeof listOrgsWithQuotas>>);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.orgs).toHaveLength(1);
    expect(data.orgs[0]).toMatchObject({
      org_id: "o1",
      member_count: 3,
      effective_daily_request_limit: 1000,
      daily_index_bytes_source: "subscription",
    });
  });
});

describe("POST /api/admin/orgs", () => {
  it("非管理员 403", async () => {
    requireAdminMock.mockResolvedValue(null);
    const res = await POST(postRequest({ orgId: "o1", dailyRequestLimit: 100 }));
    expect(res.status).toBe(403);
    expect(setOrgQuotaMock).not.toHaveBeenCalled();
  });

  it("缺少 orgId 返回 400", async () => {
    const res = await POST(postRequest({ dailyRequestLimit: 100 }));
    expect(res.status).toBe(400);
    expect(setOrgQuotaMock).not.toHaveBeenCalled();
  });

  it("非法配额（负数/非整数）返回 400", async () => {
    const res1 = await POST(postRequest({ orgId: "o1", dailyRequestLimit: -5 }));
    expect(res1.status).toBe(400);
    const res2 = await POST(postRequest({ orgId: "o1", dailyIndexBytesLimit: 1.5 }));
    expect(res2.status).toBe(400);
    expect(setOrgQuotaMock).not.toHaveBeenCalled();
  });

  it("组织不存在返回 404（fail-closed，不留孤儿配额）", async () => {
    setOrgQuotaMock.mockResolvedValue(false);
    const res = await POST(postRequest({ orgId: "ghost", dailyRequestLimit: 100 }));
    expect(res.status).toBe(404);
  });

  it("写入 org_quotas（null = 未设置）", async () => {
    const res = await POST(
      postRequest({ orgId: "o1", dailyRequestLimit: 1000, dailyIndexBytesLimit: null })
    );
    expect(res.status).toBe(200);
    expect(setOrgQuotaMock).toHaveBeenCalledWith("o1", 1000, null);
  });
});
