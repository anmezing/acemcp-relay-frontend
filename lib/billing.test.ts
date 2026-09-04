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
  const getDailyQuotaUsage = vi.fn(async () => ({
    available: true,
    requestsUsed: 12,
    indexBytesUsed: 2048,
    resetAt: "2026-08-14T16:00:00.000Z",
  }));
  return {
    clientQuery,
    release,
    connect,
    poolQuery,
    deleteQuotaLimitCache,
    deleteOrgQuotaCache,
    getDailyQuotaUsage,
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
  getDailyQuotaUsage: mocks.getDailyQuotaUsage,
}));

import {
  createPendingOrder,
  getOrganizationMembershipLimit,
  getBillingOverview,
  getSubaccountUsage,
  markOrderPaid,
  listManualReviewOrders,
  reconcilePaidOrder,
  deleteBillingPlan,
  saveBillingPlan,
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
    fulfillment_status: "pending",
    fulfillment_error: null,
    fulfillment_effective_at: null,
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

function subscriptionRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    user_id: "user-1",
    plan_id: "plan-1",
    plan_name: "Pro 月付",
    tier: "pro",
    daily_request_limit: "1000",
    daily_index_bytes_limit: "1048576",
    subaccount_limit: 3,
    starts_at: "2026-08-01T06:30:00Z",
    expires_at: "2026-08-20T06:30:00Z",
    source_order_id: "previous-order",
    updated_at: "2026-08-01T06:30:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.poolQuery.mockResolvedValue({ rows: [] });
});


describe("billing plan validation", () => {
  const validInput = {
    code: " pro-monthly ",
    name: " Pro 月付 ",
    description: " 适合团队 ",
    tier: "pro" as const,
    priceFen: 2990,
    durationDays: 30,
    dailyRequestLimit: 10_000,
    dailyIndexBytesLimit: 10_000_000,
    subaccountLimit: 5,
    active: true,
    sortOrder: 1,
  };

  it("normalizes trusted text fields and persists strict scalar values", async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [planRow] });

    await saveBillingPlan(validInput);

    const [, params] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    expect(params.slice(1)).toEqual([
      "pro-monthly",
      "Pro 月付",
      "适合团队",
      "pro",
      2990,
      30,
      10_000,
      10_000_000,
      5,
      true,
      1,
    ]);
  });

  it("rejects empty numeric strings instead of coercing them to zero", async () => {
    await expect(
      saveBillingPlan({ ...validInput, priceFen: "" } as unknown as typeof validInput)
    ).rejects.toThrowError("INVALID_PRICE_FEN");
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it("rejects oversized descriptions and malformed supplied identifiers", async () => {
    await expect(
      saveBillingPlan({ ...validInput, description: "x".repeat(2_001) })
    ).rejects.toThrowError("INVALID_PLAN_DESCRIPTION");
    await expect(
      saveBillingPlan({ ...validInput, id: "invalid id" })
    ).rejects.toThrowError("INVALID_PLAN_ID");
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it("rejects non-boolean active flags and unrepresentable durations", async () => {
    await expect(
      saveBillingPlan({ ...validInput, active: "false" } as unknown as typeof validInput)
    ).rejects.toThrowError("INVALID_PLAN_ACTIVE");
    await expect(
      saveBillingPlan({ ...validInput, durationDays: 100_000_000 })
    ).rejects.toThrowError("INVALID_SUBSCRIPTION_EXPIRY");
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it("deletes a plan only when neither orders nor subscriptions reference it", async () => {
    mocks.poolQuery.mockResolvedValue({ rowCount: 1, rows: [] });

    await expect(deleteBillingPlan("plan-1")).resolves.toBe(true);

    const [sql, params] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM billing_orders o WHERE o.plan_id = p.id");
    expect(sql).toContain("FROM user_subscriptions s WHERE s.plan_id = p.id");
    expect(params).toEqual(["plan-1"]);
  });
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
    expect(sql).toContain('ROW_NUMBER() OVER');
    expect(sql).toContain('WHERE owner_rank = 1');
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
    expect(sql).toContain('JOIN canonical_ownership ownership');
    expect(sql).toContain('WHERE owner_rank = 1');
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

describe("billing overview quota usage", () => {
  it("returns the Relay Redis counters used by the quota gate", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) =>
      sql.includes("clock_timestamp()")
        ? { rows: [{ effective_at: "2026-08-13T06:50:00Z" }] }
        : { rows: [] }
    );

    const overview = await getBillingOverview("user-1");

    expect(overview.usage).toEqual({
      available: true,
      requestsUsed: 12,
      indexBytesUsed: 2048,
      resetAt: "2026-08-14T16:00:00.000Z",
    });
    expect(mocks.getDailyQuotaUsage).toHaveBeenCalledWith("user-1");
  });
});

describe("pending billing orders", () => {
  it("reuses an unexpired QR order for the same plan and provider", async () => {
    const existing = orderRow({ code_url: "https://qr.example/order" });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM billing_plans")) return { rows: [planRow] };
      if (sql.includes("clock_timestamp()")) {
        return { rows: [{ now: "2026-08-13T06:50:00Z" }] };
      }
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
      if (sql.includes("clock_timestamp()")) {
        return { rows: [{ now: "2026-08-13T06:50:00Z" }] };
      }
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
    const paidAt = new Date("2026-08-13T06:50:00Z");
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
        if (sql.includes("clock_timestamp()")) {
          return { rows: [{ settled_at: paidAt.toISOString() }] };
        }
        if (sql.includes("FROM user_subscriptions")) {
          return { rows: [subscriptionRow({ expires_at: currentExpiry.toISOString() })] };
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
      "starts_at = EXCLUDED.starts_at"
    );
    expect(String(subscriptionInsert?.[0])).toContain(
      "expires_at = EXCLUDED.expires_at"
    );
    expect(mocks.deleteQuotaLimitCache).toHaveBeenCalledWith("user-1");
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("does not report a durable settlement as failed when post-commit cache invalidation fails", async () => {
    const paidAt = new Date("2026-08-13T06:50:00Z");
    const closed = orderRow({ status: "closed" });
    const paid = orderRow({
      status: "paid",
      fulfillment_status: "applied",
      fulfillment_error: null,
      fulfillment_effective_at: paidAt.toISOString(),
      provider_trade_no: "trade-1",
      paid_at: paidAt.toISOString(),
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM billing_orders")) return { rows: [closed] };
      if (sql.includes("clock_timestamp()")) {
        return { rows: [{ settled_at: paidAt.toISOString() }] };
      }
      if (sql.includes("FROM user_subscriptions")) return { rows: [] };
      if (sql.includes('COUNT(DISTINCT counted."userId")')) {
        return { rows: [{ used: "0" }] };
      }
      if (sql.includes("UPDATE billing_orders")) return { rows: [paid] };
      return { rows: [] };
    });
    mocks.poolQuery.mockRejectedValue(new Error("cache membership lookup unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(markOrderPaid({
      provider: "alipay",
      orderNo: "LCE20260813ABCDEF",
      amountFen: 1234,
      currency: "CNY",
      providerTradeNo: "trade-1",
      paidAt,
    })).resolves.toMatchObject({
      status: "paid",
      fulfillmentStatus: "applied",
    });

    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(consoleError).toHaveBeenCalledWith(
      "billing entitlement cache invalidation failed:",
      expect.objectContaining({ userId: "user-1" })
    );
    consoleError.mockRestore();
  });

  it("does not extend again but retries cache invalidation for a duplicate callback", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM billing_orders")) {
        return {
          rows: [
            orderRow({
              status: "paid",
              fulfillment_status: "applied",
              fulfillment_error: null,
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


it("routes a paid order to manual review when its seat limit is below current usage", async () => {
  const paidAt = new Date("2026-09-04T06:50:00Z");
  const paid = orderRow({
    status: "paid",
    fulfillment_status: "manual_review",
    fulfillment_error: "SUBACCOUNT_LIMIT_BELOW_CURRENT_USAGE",
    provider_trade_no: "trade-overcommitted",
    paid_at: paidAt.toISOString(),
  });
  mocks.clientQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM billing_orders")) return { rows: [orderRow()] };
    if (sql.includes("clock_timestamp()")) {
      return { rows: [{ settled_at: paidAt.toISOString() }] };
    }
    if (sql.includes("FROM user_subscriptions")) return { rows: [] };
    if (sql.includes('COUNT(DISTINCT counted."userId")')) {
      return { rows: [{ used: "4" }] };
    }
    if (sql.includes("UPDATE billing_orders")) return { rows: [paid] };
    return { rows: [] };
  });

  await expect(
    markOrderPaid({
      provider: "alipay",
      orderNo: "LCE20260813ABCDEF",
      amountFen: 1234,
      currency: "CNY",
      providerTradeNo: "trade-overcommitted",
      paidAt,
    })
  ).resolves.toMatchObject({
    status: "paid",
    fulfillmentStatus: "manual_review",
    fulfillmentError: "SUBACCOUNT_LIMIT_BELOW_CURRENT_USAGE",
  });

  expect(
    mocks.clientQuery.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO user_subscriptions")
    )
  ).toBe(false);
  const update = mocks.clientQuery.mock.calls.find(([sql]) =>
    String(sql).includes("UPDATE billing_orders")
  );
  expect(update?.[1]).toEqual([
    "order-id",
    "trade-overcommitted",
    paidAt,
    paidAt,
    "manual_review",
    "SUBACCOUNT_LIMIT_BELOW_CURRENT_USAGE",
  ]);
  expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
});


describe("paid-order reconciliation", () => {
  it("lists the manual-review queue through the partial-index query", async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [
        orderRow({
          status: "paid",
          fulfillment_status: "manual_review",
          fulfillment_error: "SUBACCOUNT_LIMIT_BELOW_CURRENT_USAGE",
          paid_at: "2026-09-04T06:50:00Z",
          fulfillment_effective_at: "2026-09-04T06:50:05Z",
        }),
      ],
    });

    await expect(listManualReviewOrders(20)).resolves.toHaveLength(1);
    const [sql, params] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("fulfillment_status = 'manual_review'");
    expect(sql).toContain("ORDER BY updated_at DESC, id DESC");
    expect(params).toEqual([20]);
  });

  it("retries a paid manual-review order with the original database effective time", async () => {
    const effectiveAt = new Date("2026-09-04T06:50:05Z");
    const pendingReview = orderRow({
      status: "paid",
      fulfillment_status: "manual_review",
      fulfillment_error: "SUBACCOUNT_LIMIT_BELOW_CURRENT_USAGE",
      provider_trade_no: "trade-1",
      paid_at: "2026-09-04T06:50:00Z",
      fulfillment_effective_at: effectiveAt.toISOString(),
    });
    const applied = orderRow({
      ...pendingReview,
      fulfillment_status: "applied",
      fulfillment_error: null,
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM billing_orders")) return { rows: [pendingReview] };
      if (sql.includes("FROM user_subscriptions")) return { rows: [] };
      if (sql.includes('COUNT(DISTINCT counted."userId")')) {
        return { rows: [{ used: "0" }] };
      }
      if (sql.includes("UPDATE billing_orders")) return { rows: [applied] };
      return { rows: [] };
    });

    await expect(reconcilePaidOrder("LCE20260813ABCDEF")).resolves.toMatchObject({
      fulfillmentStatus: "applied",
    });

    const subscriptionWrite = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO user_subscriptions")
    );
    expect(subscriptionWrite?.[1]).toEqual([
      "user-1",
      "plan-1",
      "Pro 月付",
      "pro",
      1000,
      1048576,
      3,
      effectiveAt,
      new Date("2026-10-04T06:50:05Z"),
      "order-id",
    ]);
    expect(mocks.deleteQuotaLimitCache).toHaveBeenCalledWith("user-1");
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("keeps an unresolved retry in manual review without granting rights", async () => {
    const pendingReview = orderRow({
      status: "paid",
      fulfillment_status: "manual_review",
      fulfillment_error: "SUBACCOUNT_LIMIT_BELOW_CURRENT_USAGE",
      provider_trade_no: "trade-1",
      paid_at: "2026-09-04T06:50:00Z",
      fulfillment_effective_at: "2026-09-04T06:50:05Z",
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM billing_orders")) return { rows: [pendingReview] };
      if (sql.includes("FROM user_subscriptions")) return { rows: [] };
      if (sql.includes('COUNT(DISTINCT counted."userId")')) {
        return { rows: [{ used: "4" }] };
      }
      if (sql.includes("UPDATE billing_orders")) return { rows: [pendingReview] };
      return { rows: [] };
    });

    await expect(reconcilePaidOrder("LCE20260813ABCDEF")).resolves.toMatchObject({
      fulfillmentStatus: "manual_review",
      fulfillmentError: "SUBACCOUNT_LIMIT_BELOW_CURRENT_USAGE",
    });
    expect(
      mocks.clientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO user_subscriptions")
      )
    ).toBe(false);
    expect(mocks.deleteQuotaLimitCache).not.toHaveBeenCalled();
  });
});
