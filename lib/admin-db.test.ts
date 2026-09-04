import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const deleteOrgQuotaCache = vi.fn(async () => undefined);
  const deleteQuotaLimitCache = vi.fn(async () => undefined);
  const connect = vi.fn(async () => ({ query, release }));
  return { query, release, deleteOrgQuotaCache, deleteQuotaLimitCache, connect };
});

vi.mock("@/lib/db", () => ({
  default: { connect: mocks.connect },
  deleteBannedCache: vi.fn(),
  deleteOrgQuotaCache: mocks.deleteOrgQuotaCache,
  deleteQuotaLimitCache: mocks.deleteQuotaLimitCache,
  resetApiKey: vi.fn(),
}));

import {
  clearRequestLogs,
  getCallStats,
  listGlobalLogs,
  listQuotas,
  listUsersWithStats,
  setUserQuota,
} from "./admin-db";

afterEach(() => vi.unstubAllEnvs());

describe("admin user authentication providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects every Better Auth provider linked to a user", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        id: "user-1",
        email: "user@example.com",
        name: "User",
        created_at: new Date("2026-08-12T00:00:00Z"),
        request_count: "2",
        last_request_at: null,
        banned: false,
        tier: "free",
        auth_providers: ["github", "linuxdo"],
      }],
    });

    const users = await listUsersWithStats();
    const sql = String(mocks.query.mock.calls[0]?.[0]);
    const selectClause = sql.slice(0, sql.indexOf('FROM "user"'));

    expect(selectClause).toContain("a.auth_providers");
    expect(sql).toContain("FROM account");
    expect(sql).toContain("LEFT JOIN request_log_user_stats r ON r.user_id = u.id");
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain("ORDER BY request_timestamp DESC, id DESC");
    expect(sql).toContain("LIMIT 1");
    expect(sql).not.toContain("GROUP BY u.id");
    expect(users[0]).toMatchObject({
      request_count: 2,
      auth_providers: ["github", "linuxdo"],
    });
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("returns an empty provider list when no account binding exists", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ id: "user-1", request_count: "0", auth_providers: null }],
    });

    await expect(listUsersWithStats()).resolves.toEqual([
      { id: "user-1", request_count: 0, auth_providers: [] },
    ]);
  });
});

describe("admin quota and log result mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEFAULT_DAILY_REQUEST_LIMIT", "10");
    vi.stubEnv("DAILY_INDEX_BYTES_LIMIT", "100");
    vi.stubEnv("PRO_DAILY_REQUEST_LIMIT", "20");
    vi.stubEnv("PRO_DAILY_INDEX_BYTES_LIMIT", "200");
  });

  it("converts bigint values and resolves override, subscription and base tier", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          user_id: "user-1",
          email: "user@example.com",
          today_count: "12",
          daily_limit: "500",
          daily_index_bytes_limit: "2147483648",
          base_tier: "free",
          subscription_plan_name: null,
          subscription_daily_request_limit: null,
          subscription_daily_index_bytes_limit: null,
        },
        {
          user_id: "user-2",
          email: null,
          today_count: 0,
          daily_limit: null,
          daily_index_bytes_limit: null,
          base_tier: "free",
          subscription_plan_name: "Team",
          subscription_daily_request_limit: "900",
          subscription_daily_index_bytes_limit: "4096",
        },
        {
          user_id: "user-3",
          email: "pro@example.com",
          today_count: "2",
          daily_limit: null,
          daily_index_bytes_limit: null,
          base_tier: "pro",
          subscription_plan_name: null,
          subscription_daily_request_limit: null,
          subscription_daily_index_bytes_limit: null,
        },
      ],
    });

    await expect(listQuotas()).resolves.toEqual([
      {
        user_id: "user-1",
        email: "user@example.com",
        today_count: 12,
        daily_limit: 500,
        daily_index_bytes_limit: 2147483648,
        effective_daily_limit: 500,
        effective_daily_index_bytes_limit: 2147483648,
        daily_limit_source: "admin_override",
        daily_index_bytes_limit_source: "admin_override",
        base_tier: "free",
        subscription_plan_name: null,
      },
      {
        user_id: "user-2",
        email: null,
        today_count: 0,
        daily_limit: null,
        daily_index_bytes_limit: null,
        effective_daily_limit: 900,
        effective_daily_index_bytes_limit: 4096,
        daily_limit_source: "subscription",
        daily_index_bytes_limit_source: "subscription",
        base_tier: "free",
        subscription_plan_name: "Team",
      },
      {
        user_id: "user-3",
        email: "pro@example.com",
        today_count: 2,
        daily_limit: null,
        daily_index_bytes_limit: null,
        effective_daily_limit: 20,
        effective_daily_index_bytes_limit: 200,
        daily_limit_source: "base_tier",
        daily_index_bytes_limit_source: "base_tier",
        base_tier: "pro",
        subscription_plan_name: null,
      },
    ]);
    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain("FROM user_subscriptions active");
    expect(sql).toContain("FROM request_log_daily_stats");
    expect(sql).toContain("GROUP BY user_id");
    expect(sql).toContain("AND keys.org_id IS NULL");
    expect(sql).not.toContain("ORDER BY (keys.org_id IS NULL) DESC");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("returns global log rows without applying quota-only fields", async () => {
    const row = {
      id: "log-1",
      user_id: "user-1",
      email: "user@example.com",
      status: "success",
      status_code: 200,
      request_path: "/mcp",
      request_method: "POST",
      request_timestamp: new Date("2026-08-13T00:00:00Z"),
      response_duration_ms: 25,
      client_ip: "127.0.0.1",
    };
    mocks.query.mockResolvedValueOnce({ rows: [row] });

    await expect(listGlobalLogs()).resolves.toEqual([row]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});


describe("admin call statistics calendar windows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses Asia/Shanghai calendar boundaries and returns recent days descending", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ today: "3", last30d: "9", total: "11" }] })
      .mockResolvedValueOnce({ rows: [{ date: "2026-09-04", count: "3" }] })
      .mockResolvedValueOnce({ rows: [{ path: "/mcp", count: "9" }] })
      .mockResolvedValueOnce({ rows: [{ user_id: "u1", email: null, count: "9" }] });

    const result = await getCallStats();
    expect(result.daily).toEqual([{ date: "2026-09-04", count: 3 }]);
    const sql = mocks.query.mock.calls.map((call) => String(call[0]));
    expect(sql[0]).toContain("::date - 29");
    expect(sql[1]).toContain("::date - 13");
    expect(sql[1]).toContain("ORDER BY stat_date DESC");
    expect(sql.every((query) => query.includes("request_log_") || query.includes("\"user\""))).toBe(true);
    expect(sql[2]).toContain("::date - 29");
    expect(sql[3]).toContain("::date - 29");
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});


describe("admin quota cache coherence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invalidates personal and canonical-owner organization quota caches after commit", async () => {
    mocks.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [{ organization_id: "org-1" }, { organization_id: "org-2" }],
      })
      .mockResolvedValueOnce({});

    await setUserQuota("owner-1", 500, 4096);

    const sql = mocks.query.mock.calls.map(([query]) => String(query));
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toContain("INSERT INTO user_quotas");
    expect(sql[2]).toContain("ROW_NUMBER() OVER");
    expect(sql[2]).toContain("owner_rank = 1 AND owner_user_id = $1");
    expect(sql[3]).toBe("COMMIT");
    expect(mocks.deleteQuotaLimitCache).toHaveBeenCalledWith("owner-1");
    expect(mocks.deleteOrgQuotaCache.mock.calls).toEqual([["org-1"], ["org-2"]]);
    expect(mocks.release.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteQuotaLimitCache.mock.invocationCallOrder[0]
    );
  });

  it("rolls back without invalidating caches when an inherited-org lookup fails", async () => {
    mocks.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("owner lookup failed"))
      .mockResolvedValueOnce({});

    await expect(setUserQuota("owner-1", null, null)).rejects.toThrow(
      "owner lookup failed"
    );
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(mocks.deleteQuotaLimitCache).not.toHaveBeenCalled();
    expect(mocks.deleteOrgQuotaCache).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});


describe("admin request-log cleanup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses transaction-safe TRUNCATE for a full purge and returns the aggregate count", async () => {
    mocks.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ count: "97" }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await expect(clearRequestLogs()).resolves.toBe(97);

    const calls = mocks.query.mock.calls.map((call) => ({
      sql: String(call[0]),
      params: call[1],
    }));
    expect(calls.map((call) => call.sql)).toEqual([
      "BEGIN",
      expect.stringContaining("FROM request_log_user_stats"),
      "TRUNCATE TABLE error_details, request_logs",
      "COMMIT",
    ]);
    expect(calls.some((call) => call.sql.startsWith("DELETE FROM request_logs"))).toBe(false);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("uses one cutoff consistently for error details and request logs", async () => {
    mocks.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 4 })
      .mockResolvedValueOnce({ rowCount: 3 })
      .mockResolvedValueOnce({});

    await expect(clearRequestLogs(30.9)).resolves.toBe(3);

    const deleteErrorCall = mocks.query.mock.calls[1];
    const deleteLogsCall = mocks.query.mock.calls[2];
    expect(String(deleteErrorCall[0])).toContain("DELETE FROM error_details");
    expect(String(deleteLogsCall[0])).toContain("DELETE FROM request_logs");
    expect(deleteErrorCall[1]).toEqual([30]);
    expect(deleteLogsCall[1]).toEqual([30]);
    expect(mocks.query.mock.calls[3]?.[0]).toBe("COMMIT");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases the connection when cleanup fails", async () => {
    mocks.query
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("truncate failed"))
      .mockResolvedValueOnce({});

    await expect(clearRequestLogs()).rejects.toThrow("truncate failed");
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
