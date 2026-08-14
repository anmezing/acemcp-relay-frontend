import { beforeEach, describe, expect, it, vi } from "vitest";

// 组织密钥数据层：ensure 的"存在即复用"幂等性、角色纠正，以及删除/配额清理。
const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const deleteOrgMemberQuotaCache = vi.fn(async () => undefined);
  const deleteOrgQuotaCache = vi.fn(async () => undefined);
  return { query, release, connect, deleteOrgMemberQuotaCache, deleteOrgQuotaCache };
});

vi.mock("@/lib/db", () => ({
  default: { connect: mocks.connect },
  initDB: vi.fn(async () => undefined),
  deleteOrgMemberQuotaCache: mocks.deleteOrgMemberQuotaCache,
  deleteOrgQuotaCache: mocks.deleteOrgQuotaCache,
  generateApiKey: () => ({ id: "new-hash", apiKey: "ace_new" }),
  lockUserCredentialsTx: vi.fn(async (client: { query: typeof mocks.query }, userId: string) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('acemcp:user-credentials'), hashtext($1))", [userId]);
  }),
}));

import {
  deleteAllOrgApiKeys,
  deleteOrgApiKey,
  ensureOrgApiKey,
  getOrgUsage,
  listOrgsWithQuotas,
  listOrgMemberQuotas,
  reconcileUserOrgApiKeys,
  setOrgMemberQuota,
  setOrgQuota,
  updateOrgApiKeyRole,
} from "./org-db";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("DEFAULT_DAILY_REQUEST_LIMIT", "0");
  vi.stubEnv("DAILY_INDEX_BYTES_LIMIT", "0");
  vi.stubEnv("PRO_DAILY_REQUEST_LIMIT", "0");
  vi.stubEnv("PRO_DAILY_INDEX_BYTES_LIMIT", "0");
});

describe("ensureOrgApiKey", () => {
  it("不存在时在锁内插入 (user, org) 组织密钥", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT * FROM api_keys")) return { rows: [] };
      if (sql.includes("INSERT INTO api_keys")) {
        return { rows: [{ id: "new-hash", api_key: "ace_new", org_id: "o1", org_role: "member" }] };
      }
      return { rows: [] };
    });

    const row = await ensureOrgApiKey("u1", "o1", "member");
    expect(row.api_key).toBe("ace_new");

    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toContain("acemcp:user-credentials");
    expect(statements.at(-1)).toBe("COMMIT");
    const insert = mocks.query.mock.calls.find(([sql]) => String(sql).includes("INSERT"));
    expect(insert?.[1]).toEqual(["new-hash", "u1", "ace_new", "o1", "member"]);
  });

  it("已存在且角色一致时复用，不插入不更新（重复安全）", async () => {
    const existing = { id: "k1", api_key: "ace_exist", org_role: "member" };
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT * FROM api_keys")) return { rows: [existing] };
      return { rows: [] };
    });

    const row = await ensureOrgApiKey("u1", "o1", "member");
    expect(row).toEqual(existing);
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s) => s.includes("INSERT INTO") || s.includes("UPDATE api_keys"))).toBe(false);
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("已存在但角色漂移时纠正 org_role（不一致自愈）", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT * FROM api_keys")) {
        return { rows: [{ id: "k1", api_key: "ace_exist", org_role: "member" }] };
      }
      if (sql.includes("UPDATE api_keys")) {
        return { rows: [{ id: "k1", api_key: "ace_exist", org_role: "owner" }] };
      }
      return { rows: [] };
    });

    const row = await ensureOrgApiKey("u1", "o1", "owner");
    expect(row.org_role).toBe("owner");
    const update = mocks.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE api_keys"));
    expect(update?.[1]).toEqual(["u1", "o1", "owner"]);
  });

  it("插入失败时回滚（中断安全）", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT * FROM api_keys")) return { rows: [] };
      if (sql.includes("INSERT INTO api_keys")) throw new Error("unique violation");
      return { rows: [] };
    });

    await expect(ensureOrgApiKey("u1", "o1", "member")).rejects.toThrow("unique violation");
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});

describe("reconcileUserOrgApiKeys", () => {
  it("replays current memberships through the idempotent key path", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM "member" AS members')) {
        return { rows: [{ org_id: "o1", role: "admin, owner" }] };
      }
      if (sql.includes("SELECT * FROM api_keys")) {
        return { rows: [{ id: "k1", api_key: "ace_existing", org_role: "member" }] };
      }
      if (sql.includes("UPDATE api_keys")) {
        return { rows: [{ id: "k1", api_key: "ace_existing", org_role: "owner" }] };
      }
      return { rows: [] };
    });

    await reconcileUserOrgApiKeys("u1");

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE members."userId" = $1'),
      ["u1"]
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE api_keys"),
      ["u1", "o1", "owner"]
    );
  });
});

describe("deleteOrgApiKey / updateOrgApiKeyRole / deleteAllOrgApiKeys", () => {
  it("删除组织密钥和成员配额", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("DELETE FROM api_keys")) return { rows: [{ id: "k1" }] };
      return { rows: [] };
    });

    await deleteOrgApiKey("u1", "o1");
    expect(mocks.deleteOrgMemberQuotaCache).toHaveBeenCalledWith("o1", "u1");
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s) => s.includes("DELETE FROM org_member_quotas"))).toBe(true);
  });

  it("无密钥可删时仍保持幂等", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await deleteOrgApiKey("u1", "o1");
    expect(mocks.deleteOrgMemberQuotaCache).toHaveBeenCalledWith("o1", "u1");
  });

  it("角色更新同步冗余展示字段", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE api_keys")) return { rows: [{ id: "k1" }] };
      return { rows: [] };
    });

    await updateOrgApiKeyRole("u1", "o1", "owner");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE api_keys SET org_role"),
      ["u1", "o1", "owner"]
    );
  });

  it("删除组织时吊销全部组织密钥并清组织及成员配额", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("DELETE FROM api_keys")) return { rows: [{ id: "k1" }, { id: "k2" }] };
      if (sql.includes("DELETE FROM org_member_quotas")) return { rows: [{ user_id: "u1" }] };
      return { rows: [] };
    });

    await deleteAllOrgApiKeys("o1");
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s) => s.includes("DELETE FROM org_quotas"))).toBe(true);
    expect(statements.some((s) => s.includes("DELETE FROM org_member_quotas"))).toBe(true);
    expect(mocks.deleteOrgMemberQuotaCache).toHaveBeenCalledWith("o1", "u1");
  });
});

describe("organization member quotas", () => {
  it("lists limits by org and converts database numerics", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ user_id: "u1", daily_limit: "12" }] });
    await expect(listOrgMemberQuotas("o1")).resolves.toEqual([
      { user_id: "u1", daily_limit: 12 },
    ]);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE org_id = $1"),
      ["o1"]
    );
  });

  it("upserts by (org, user) and clears the matching relay cache", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await setOrgMemberQuota("o1", "u1", 25);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (org_id, user_id)"),
      ["o1", "u1", 25]
    );
    expect(mocks.deleteOrgMemberQuotaCache).toHaveBeenCalledWith("o1", "u1");
  });

  it("removes only the selected org member limit when restoring default", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await setOrgMemberQuota("o2", "u1", null);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE org_id = $1 AND user_id = $2"),
      ["o2", "u1"]
    );
  });
});

describe("organization shared quota", () => {
  it("invalidates the relay organization quota cache after saving nullable dimensions", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT 1 FROM "organization"')) return { rows: [{ exists: true }] };
      return { rows: [] };
    });

    await expect(setOrgQuota("o1", 1000, null)).resolves.toBe(true);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO org_quotas"),
      ["o1", 1000, null]
    );
    expect(mocks.deleteOrgQuotaCache).toHaveBeenCalledWith("o1");
    expect(mocks.deleteOrgQuotaCache.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.release.mock.invocationCallOrder.at(-1) ?? 0
    );
  });
});

describe("getOrgUsage（组织用量聚合）", () => {
  type QuotaRow = {
    daily_request_limit?: string | number | null;
    daily_index_bytes_limit?: string | number | null;
    owner_user_id?: string | null;
    owner_tier?: string | null;
    plan_name?: string | null;
    subscription_daily_request_limit?: string | number | null;
    subscription_daily_index_bytes_limit?: string | number | null;
    subscription_expires_at?: string | null;
  };

  const mockUsageQueries = (quotaRows: QuotaRow[]) => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("org_effective_quota")) return { rows: quotaRows };
      if (sql.includes("AS used")) return { rows: [{ used: "7" }] };
      if (sql.includes("LEFT JOIN \"user\"")) {
        return { rows: [{ user_id: "u1", email: "a@b.dev", name: "A", count: "3" }] };
      }
      if (sql.includes("to_char")) return { rows: [{ date: "2026-08-01", count: "5" }] };
      return { rows: [] };
    });
  };

  it("按 tenant_id 聚合，且每条 request_logs 查询都限定时间窗", async () => {
    mockUsageQueries([{
      daily_request_limit: "100",
      daily_index_bytes_limit: null,
      owner_user_id: "owner-1",
      owner_tier: "free",
    }]);

    const usage = await getOrgUsage("o1");
    expect(usage.daily).toEqual([{ date: "2026-08-01", count: 5 }]);
    expect(usage.topMembers).toEqual([
      { user_id: "u1", email: "a@b.dev", name: "A", count: 3 },
    ]);
    expect(usage.today).toEqual({
      used: 7,
      limit: 100,
      source: "admin_override",
      planName: null,
    });

    const logQueries = mocks.query.mock.calls.filter(([sql]) =>
      String(sql).includes("request_logs")
    );
    expect(logQueries.length).toBe(3);
    for (const [sql, params] of logQueries) {
      expect(String(sql)).toMatch(/tenant_id = \$1/);
      expect(String(sql)).toMatch(/INTERVAL '\d+ days'/);
      expect(params).toEqual(["o1"]);
    }
  });

  it("无 owner 和覆盖时使用平台 Free 默认，不再把未设置误报为未设限", async () => {
    vi.stubEnv("DEFAULT_DAILY_REQUEST_LIMIT", "25");
    mockUsageQueries([]);
    const usage = await getOrgUsage("o1");
    expect(usage.today).toEqual({
      used: 7,
      limit: 25,
      source: "platform_default",
      planName: null,
    });
  });

  it("无管理员覆盖时继承 canonical owner 的有效套餐", async () => {
    mockUsageQueries([{
      daily_request_limit: null,
      daily_index_bytes_limit: null,
      owner_user_id: "owner-1",
      owner_tier: "free",
      plan_name: "Team",
      subscription_daily_request_limit: "2000",
      subscription_daily_index_bytes_limit: "4096",
      subscription_expires_at: "2026-09-01T00:00:00.000Z",
    }]);

    const usage = await getOrgUsage("o1");
    expect(usage.today).toEqual({
      used: 7,
      limit: 2000,
      source: "subscription",
      planName: "Team",
    });
  });
});

describe("listOrgsWithQuotas（管理员覆盖与继承值分离）", () => {
  it("逐维度解析：请求使用管理员覆盖，索引字节继承 owner 套餐", async () => {
    mocks.query.mockResolvedValue({
      rows: [{
        org_id: "o1",
        name: "Acme",
        slug: "acme",
        owner_email: "owner@example.com",
        member_count: 2,
        requests_7d: 12,
        daily_request_limit: "100",
        daily_index_bytes_limit: null,
        owner_user_id: "owner-1",
        owner_tier: "free",
        plan_name: "Team",
        subscription_daily_request_limit: "2000",
        subscription_daily_index_bytes_limit: "8192",
        subscription_expires_at: "2026-09-01T00:00:00.000Z",
        created_at: new Date("2026-08-01T00:00:00.000Z"),
      }],
    });

    const [org] = await listOrgsWithQuotas();
    expect(org).toMatchObject({
      daily_request_limit: 100,
      daily_index_bytes_limit: null,
      effective_daily_request_limit: 100,
      effective_daily_index_bytes_limit: 8192,
      daily_request_source: "admin_override",
      daily_index_bytes_source: "subscription",
      plan_name: "Team",
      owner_tier: "free",
    });
  });
});
