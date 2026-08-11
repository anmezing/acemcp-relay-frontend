import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// 组织用量路由权限自查：谁能调 = 该组织成员（owner/member 都可读），
// 非成员 403（fail-closed），未鉴权前不触发聚合查询。
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({
  initDB: vi.fn(async () => undefined),
}));

vi.mock("@/lib/org-db", () => ({
  getMemberRole: vi.fn(),
  getOrgUsage: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { getMemberRole, getOrgUsage } from "@/lib/org-db";
import { GET } from "./route";

const getSession = vi.mocked(auth.api.getSession);
const getMemberRoleMock = vi.mocked(getMemberRole);
const getOrgUsageMock = vi.mocked(getOrgUsage);

const usagePayload = {
  daily: [{ date: "2026-08-01", count: 12 }],
  topMembers: [{ user_id: "u1", email: "a@b.dev", name: "A", count: 9 }],
  today: { used: 3, limit: 100 },
};

function usageRequest(orgId?: string) {
  const url = orgId
    ? `http://localhost/api/org/usage?orgId=${orgId}`
    : "http://localhost/api/org/usage";
  return new NextRequest(url);
}

function loginAs(userId: string | null) {
  getSession.mockResolvedValue(
    (userId ? { user: { id: userId } } : null) as Awaited<ReturnType<typeof auth.api.getSession>>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  loginAs("user-1");
  getOrgUsageMock.mockResolvedValue(usagePayload);
});

describe("GET /api/org/usage（谁能调：该组织成员）", () => {
  it("未登录 401，不查用量", async () => {
    loginAs(null);
    const res = await GET(usageRequest("o1"));
    expect(res.status).toBe(401);
    expect(getOrgUsageMock).not.toHaveBeenCalled();
  });

  it("缺少 orgId 返回 400", async () => {
    const res = await GET(usageRequest());
    expect(res.status).toBe(400);
    expect(getMemberRoleMock).not.toHaveBeenCalled();
    expect(getOrgUsageMock).not.toHaveBeenCalled();
  });

  it("非成员 403（fail-closed），不查用量", async () => {
    getMemberRoleMock.mockResolvedValue(null);
    const res = await GET(usageRequest("o1"));
    expect(res.status).toBe(403);
    expect(getOrgUsageMock).not.toHaveBeenCalled();
  });

  it("member 可读组织用量", async () => {
    getMemberRoleMock.mockResolvedValue("member");
    const res = await GET(usageRequest("o1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(usagePayload);
    expect(getMemberRoleMock).toHaveBeenCalledWith("user-1", "o1");
    expect(getOrgUsageMock).toHaveBeenCalledWith("o1");
  });

  it("owner 可读组织用量", async () => {
    getMemberRoleMock.mockResolvedValue("owner");
    const res = await GET(usageRequest("o1"));
    expect(res.status).toBe(200);
    expect(getOrgUsageMock).toHaveBeenCalledWith("o1");
  });

  it("聚合查询异常返回 500", async () => {
    getMemberRoleMock.mockResolvedValue("owner");
    getOrgUsageMock.mockRejectedValue(new Error("db down"));
    const res = await GET(usageRequest("o1"));
    expect(res.status).toBe(500);
  });
});
