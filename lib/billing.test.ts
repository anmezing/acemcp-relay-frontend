import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const release = vi.fn();
  const connect = vi.fn(async () => ({
    query: clientQuery,
    release,
  }));
  const poolQuery = vi.fn();
  const deleteQuotaLimitCache = vi.fn(async () => undefined);
  const deleteOrgQuotaCache = vi.fn(async () => undefined);
  return {
    clientQuery,
    release,
    connect,
    poolQuery,
    deleteQuotaLimitCache,
    deleteOrgQuotaCache,
  };
});

vi.mock("@/lib/db", () => ({
  default: {
    connect: mocks.connect,
    query: mocks.poolQuery,
  },
  initDB: vi.fn(async () => undefined),
  deleteQuotaLimitCache: mocks.deleteQuotaLimitCache,
  deleteOrgQuotaCache: mocks.deleteOrgQuotaCache,
}));

import {
  createPendingOrder,
  getOrganizationMembershipLimit,
  getSubaccountUsage,
  markOrderPaid,
} from "./billing";

const planRow = {
  id: "plan-1",
  code: "pro-monthly",
  name: "Pro 月付",
  description: "",
  tier: "pro",
  price_fen: "1234",
  duration_days: 30,
  daily_request_limit: "1000",
  daily_index_bytes_limit: "1048576",
  subaccount_limit: 3,
  active: true,
  sort_order: 1,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

function orderRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "order-id",
    order_no: "LCE20260813ABCDEF",
    user_id: "user-1",
    plan_id: "plan-1",
    provider: "alipay",
    status: "pending",
    amount_fen: "1234",
    currency: "CNY",
    plan_snapshot: {
      planId: "plan-1",
      code: "pro-monthly",
      name: "Pro 月付",
      tier: "pro",
      durationDays: 30,
      dailyRequestLimit: 1000,
      dailyIndexBytesLimit: 1048576,
      subaccountLimit: 3,
    },
    provider_trade_no: null,
    code_url: null,
    expires_at: "2026-08-13T07:00:00Z",
    paid_at: null,
    created_at: "2026-08-13T06:45:00Z",
    updated_at: "2026-08-13T06:45:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.poolQuery.mockResolvedValue({ rows: [] });
});

describe("subscription subaccount seats", () => {
  it("counts each account once except the entitlement holder regardless of role", async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [{ seat_limit: "3", used: "2" }],
    });

    await expect(getSubaccountUsage("owner-1")).resolves.toEqual({
      limit: 3,
      used: 2,
    });

    const [sql, params] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('counted."userId" <> $1');
    expect(sql).toContain('COUNT(DISTINCT counted."userId")');
    expect(sql).not.toContain("COALESCE(counted.role");
    expect(params).toEqual(["owner-1"]);
  });

  it("allows a new account only while a unique subaccount seat remains", async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [
        {
          target_members: "2",
          seat_limit: "3",
          used: "1",
          candidate_already_counted: false,
          candidate_is_owner: false,
        },
      ],
    });

    await expect(
      getOrganizationMembershipLimit("org-1", "candidate-1")
    ).resolves.toBe(3);

    const [sql, params] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('counted."userId" <> o.user_id');
    expect(sql).toContain('COUNT(DISTINCT counted."userId")');
    expect(sql).not.toContain("COALESCE(counted.role");
    expect(params).toEqual(["org-1", "candidate-1"]);
  });

  it("allows an already-counted account to join another owned organization", async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [
        {
          target_members: "2",
          seat_limit: "1",
          used: "1",
          candidate_already_counted: true,
          candidate_is_owner: false,
        },
      ],
    });

    await expect(
      getOrganizationMembershipLimit("org-1", "candidate-1")
    ).resolves.toBe(3);
  });
});

describe("pending billing orders", () => {
  it("reuses an unexpired QR order for the same plan and provider", async () => {
    const existing = orderRow({ code_url: "https://qr.example/order" });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM billing_plans")) return { rows: [planRow] };
      if (sql.includes("FROM billing_orders") && sql.includes("FOR UPDATE")) {
        return { rows: [existing] };
      }
      return { rows: [] };
    });

    const result = await createPendingOrder("user-1", "plan-1", "alipay");

    expect(result.codeUrl).toBe("https://qr.example/order");
    expect(
      mocks.clientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO billing_orders")
      )
    ).toBe(false);
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("rejects another order while the provider is still creating a QR", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM billing_plans")) return { rows: [planRow] };
      if (sql.includes("FROM billing_orders") && sql.includes("FOR UPDATE")) {
        return { rows: [orderRow()] };
      }
      return { rows: [] };
    });

    await expect(
      createPendingOrder("user-1", "plan-1", "alipay")
    ).rejects.toThrow("PAYMENT_ORDER_PENDING");
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});

describe("paid order state transition", () => {
  it("accepts a signed late callback for a locally closed order exactly once", async () => {
    const paidAt = new Date("2026-08-13T06:30:00Z");
    const currentExpiry = new Date("2026-08-20T06:30:00Z");
    const closed = orderRow({ status: "closed" });
    const paid = orderRow({
      status: "paid",
      provider_trade_no: "trade-1",
      paid_at: paidAt.toISOString(),
    });
    let insertedSubscriptionParams: unknown[] | undefined;
    mocks.clientQuery.mockImplementation(
      async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM billing_orders")) return { rows: [closed] };
        if (sql.includes("SELECT expires_at")) {
          return { rows: [{ expires_at: currentExpiry }] };
        }
        if (sql.includes("INSERT INTO user_subscriptions")) {
          insertedSubscriptionParams = params;
          return { rows: [] };
        }
        if (sql.includes("UPDATE billing_orders")) return { rows: [paid] };
        return { rows: [] };
      }
    );

    const result = await markOrderPaid({
      provider: "alipay",
      orderNo: "LCE20260813ABCDEF",
      amountFen: 1234,
      currency: "CNY",
      providerTradeNo: "trade-1",
      paidAt,
    });

    expect(result.status).toBe("paid");
    expect(insertedSubscriptionParams?.[8]).toEqual(
      new Date("2026-09-19T06:30:00Z")
    );
    const subscriptionInsert = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO user_subscriptions")
    );
    expect(String(subscriptionInsert?.[0])).toContain(
      "EXCLUDED.starts_at >= user_subscriptions.starts_at"
    );
    expect(String(subscriptionInsert?.[0])).toContain(
      "GREATEST(user_subscriptions.starts_at, EXCLUDED.starts_at)"
    );
    expect(mocks.deleteQuotaLimitCache).toHaveBeenCalledWith("user-1");
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("does not extend again but retries cache invalidation for a duplicate callback", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM billing_orders")) {
        return {
          rows: [
            orderRow({
              status: "paid",
              provider_trade_no: "trade-1",
              paid_at: "2026-08-13T06:30:00Z",
            }),
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      markOrderPaid({
        provider: "alipay",
        orderNo: "LCE20260813ABCDEF",
        amountFen: 1234,
        currency: "CNY",
        providerTradeNo: "trade-1",
        paidAt: new Date("2026-08-13T06:30:00Z"),
      })
    ).resolves.toMatchObject({ status: "paid" });

    expect(
      mocks.clientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO user_subscriptions")
      )
    ).toBe(false);
    expect(mocks.deleteQuotaLimitCache).toHaveBeenCalledWith("user-1");
  });

  it("rejects a duplicate callback carrying a different platform trade number", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM billing_orders")) {
        return {
          rows: [
            orderRow({
              status: "paid",
              provider_trade_no: "trade-original",
              paid_at: "2026-08-13T06:30:00Z",
            }),
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      markOrderPaid({
        provider: "alipay",
        orderNo: "LCE20260813ABCDEF",
        amountFen: 1234,
        currency: "CNY",
        providerTradeNo: "trade-other",
        paidAt: new Date("2026-08-13T06:30:00Z"),
      })
    ).rejects.toThrow("ORDER_TRADE_NO_MISMATCH");
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});
