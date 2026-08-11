import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// 组织相关路由的权限自查测试：每个路由回答"谁能调"并验证拒绝路径。
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({
  initDB: vi.fn(async () => undefined),
  createApiKey: vi.fn(),
  getApiKey: vi.fn(),
  maskApiKey: (k: string) => `${k.slice(0, 8)}***`,
}));

vi.mock("@/lib/org-db", () => ({
  getMemberRole: vi.fn(),
  ensureOrgApiKey: vi.fn(),
  listUserApiKeys: vi.fn(),
  listOrgMemberQuotas: vi.fn(async () => []),
  setOrgMemberQuota: vi.fn(async () => undefined),
}));

import { auth } from "@/lib/auth";
import { createApiKey } from "@/lib/db";
import {
  ensureOrgApiKey,
  getMemberRole,
  listOrgMemberQuotas,
  listUserApiKeys,
  setOrgMemberQuota,
} from "@/lib/org-db";
import { GET as memberQuotaGet, POST as memberQuotaPost } from "./member-quota/route";
import { POST as mcpConfigPost } from "../mcp-config/route";
import { GET as keysGet } from "../keys/route";

const getSession = vi.mocked(auth.api.getSession);
const getMemberRoleMock = vi.mocked(getMemberRole);
const ensureOrgApiKeyMock = vi.mocked(ensureOrgApiKey);
const listOrgMemberQuotasMock = vi.mocked(listOrgMemberQuotas);
const setOrgMemberQuotaMock = vi.mocked(setOrgMemberQuota);
const createApiKeyMock = vi.mocked(createApiKey);
const listUserApiKeysMock = vi.mocked(listUserApiKeys);

function loginAs(userId: string | null) {
  getSession.mockResolvedValue(
    (userId ? { user: { id: userId } } : null) as Awaited<ReturnType<typeof auth.api.getSession>>
  );
}

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  loginAs("owner-1");
  ensureOrgApiKeyMock.mockResolvedValue(
    { api_key: "ace_org" } as Awaited<ReturnType<typeof ensureOrgApiKey>>
  );
});

describe("POST /api/org/member-quota（谁能调：仅该组织 owner）", () => {
  const quotaRequest = (body: unknown) =>
    jsonRequest("http://localhost/api/org/member-quota", body);

  it("未登录 401", async () => {
    loginAs(null);
    const res = await memberQuotaPost(quotaRequest({ orgId: "o1", userId: "u2", limit: 100 }));
    expect(res.status).toBe(401);
    expect(setOrgMemberQuotaMock).not.toHaveBeenCalled();
  });

  it("非 owner（member）调成员管理返回 403", async () => {
    getMemberRoleMock.mockResolvedValueOnce("member");
    const res = await memberQuotaPost(quotaRequest({ orgId: "o1", userId: "u2", limit: 100 }));
    expect(res.status).toBe(403);
    expect(setOrgMemberQuotaMock).not.toHaveBeenCalled();
  });

  it("非成员调返回 403（fail-closed）", async () => {
    getMemberRoleMock.mockResolvedValueOnce(null);
    const res = await memberQuotaPost(quotaRequest({ orgId: "o1", userId: "u2", limit: 100 }));
    expect(res.status).toBe(403);
    expect(setOrgMemberQuotaMock).not.toHaveBeenCalled();
  });

  it("目标不是本组织成员返回 400", async () => {
    getMemberRoleMock
      .mockResolvedValueOnce("owner") // 调用者
      .mockResolvedValueOnce(null); // 目标
    const res = await memberQuotaPost(quotaRequest({ orgId: "o1", userId: "u2", limit: 100 }));
    expect(res.status).toBe(400);
    expect(setOrgMemberQuotaMock).not.toHaveBeenCalled();
  });

  it("缺少 orgId/userId 返回 400", async () => {
    const res = await memberQuotaPost(quotaRequest({ userId: "u2" }));
    expect(res.status).toBe(400);
    expect(getMemberRoleMock).not.toHaveBeenCalled();
  });

  it("非法 limit 返回 400", async () => {
    const res = await memberQuotaPost(
      quotaRequest({ orgId: "o1", userId: "u2", limit: -1 })
    );
    expect(res.status).toBe(400);
    expect(setOrgMemberQuotaMock).not.toHaveBeenCalled();
  });

  it("owner 给本组织成员设上限：按 (org, user) 写 org_member_quotas", async () => {
    getMemberRoleMock
      .mockResolvedValueOnce("owner")
      .mockResolvedValueOnce("member");
    const res = await memberQuotaPost(quotaRequest({ orgId: "o1", userId: "u2", limit: 500 }));
    expect(res.status).toBe(200);
    expect(setOrgMemberQuotaMock).toHaveBeenCalledWith("o1", "u2", 500);
  });

  it("limit 为 null 时恢复默认", async () => {
    getMemberRoleMock
      .mockResolvedValueOnce("owner")
      .mockResolvedValueOnce("member");
    const res = await memberQuotaPost(quotaRequest({ orgId: "o1", userId: "u2", limit: null }));
    expect(res.status).toBe(200);
    expect(setOrgMemberQuotaMock).toHaveBeenCalledWith("o1", "u2", null);
  });

  it("owner 可读取本组织已保存的成员上限", async () => {
    getMemberRoleMock.mockResolvedValueOnce("owner");
    listOrgMemberQuotasMock.mockResolvedValueOnce([{ user_id: "u2", daily_limit: 500 }]);
    const res = await memberQuotaGet(
      new NextRequest("http://localhost/api/org/member-quota?orgId=o1")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ quotas: [{ user_id: "u2", daily_limit: 500 }] });
    expect(listOrgMemberQuotasMock).toHaveBeenCalledWith("o1");
  });

  it("普通成员不能读取组织成员上限", async () => {
    getMemberRoleMock.mockResolvedValueOnce("member");
    const res = await memberQuotaGet(
      new NextRequest("http://localhost/api/org/member-quota?orgId=o1")
    );
    expect(res.status).toBe(403);
    expect(listOrgMemberQuotasMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/mcp-config（谁能调：登录用户；orgId 须为该组织成员）", () => {
  const configRequest = (body: unknown) =>
    jsonRequest("http://localhost/api/mcp-config", body);

  it("未登录 401", async () => {
    loginAs(null);
    const res = await mcpConfigPost(configRequest({}));
    expect(res.status).toBe(401);
  });

  it("缺省（无 orgId）返回个人密钥", async () => {
    createApiKeyMock.mockResolvedValue(
      { api_key: "ace_personal" } as Awaited<ReturnType<typeof createApiKey>>
    );
    const res = await mcpConfigPost(configRequest({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ apiKey: "ace_personal" });
    expect(ensureOrgApiKeyMock).not.toHaveBeenCalled();
  });

  it("orgId：非成员 403，不发密钥（fail-closed）", async () => {
    getMemberRoleMock.mockResolvedValue(null);
    const res = await mcpConfigPost(configRequest({ orgId: "o1" }));
    expect(res.status).toBe(403);
    expect(ensureOrgApiKeyMock).not.toHaveBeenCalled();
    expect(createApiKeyMock).not.toHaveBeenCalled();
  });

  it("orgId：成员按 (user, org) 复用/发放组织密钥", async () => {
    getMemberRoleMock.mockResolvedValue("member");
    const res = await mcpConfigPost(configRequest({ orgId: "o1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ apiKey: "ace_org" });
    expect(ensureOrgApiKeyMock).toHaveBeenCalledWith("owner-1", "o1", "member");
  });
});

describe("GET /api/keys（谁能调：登录用户，只看自己的）", () => {
  it("未登录 401", async () => {
    loginAs(null);
    const res = await keysGet();
    expect(res.status).toBe(401);
    expect(listUserApiKeysMock).not.toHaveBeenCalled();
  });

  it("返回个人 + 组织密钥列表（掩码，不泄露完整 key）", async () => {
    listUserApiKeysMock.mockResolvedValue([
      {
        api_key: "ace_personal_secret",
        tier: "free",
        org_id: null,
        org_role: null,
        org_name: null,
        created_at: new Date("2026-01-01"),
      },
      {
        api_key: "ace_orgkey_secret",
        tier: "pro",
        org_id: "o1",
        org_role: "owner",
        org_name: "Acme",
        created_at: new Date("2026-02-01"),
      },
    ] as Awaited<ReturnType<typeof listUserApiKeys>>);

    const res = await keysGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.keys).toHaveLength(2);
    expect(data.keys[0].orgId).toBeNull();
    expect(data.keys[1]).toMatchObject({ orgId: "o1", orgName: "Acme", orgRole: "owner", tier: "pro" });
    for (const k of data.keys) {
      expect(k.maskedKey).not.toContain("secret");
      expect(JSON.stringify(k)).not.toContain("secret");
    }
  });
});
