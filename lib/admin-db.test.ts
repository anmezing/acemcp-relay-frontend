import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { query, release, connect };
});

vi.mock("@/lib/db", () => ({
  default: { connect: mocks.connect },
  deleteBannedCache: vi.fn(),
  deleteQuotaLimitCache: vi.fn(),
  resetApiKey: vi.fn(),
}));

import {
  listGlobalLogs,
  listQuotas,
  listUsersWithStats,
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
    expect(sql).toContain("ORDER BY (keys.org_id IS NULL) DESC");
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
