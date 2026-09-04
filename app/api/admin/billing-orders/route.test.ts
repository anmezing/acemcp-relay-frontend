import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  listManualReviewOrders: vi.fn(),
  reconcilePaidOrder: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ requireAdminSession: mocks.requireAdminSession }));
vi.mock("@/lib/billing", () => ({
  listManualReviewOrders: mocks.listManualReviewOrders,
  reconcilePaidOrder: mocks.reconcilePaidOrder,
}));

import { GET, POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/admin/billing-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin paid-order reconciliation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminSession.mockResolvedValue({ user: { id: "admin" } });
    mocks.listManualReviewOrders.mockResolvedValue([]);
  });

  it("requires administrator access", async () => {
    mocks.requireAdminSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
    expect((await POST(request({ orderNo: "order-1" }))).status).toBe(403);
  });

  it("lists only the manual-review queue returned by billing", async () => {
    const orders = [{ orderNo: "order-1" }];
    mocks.listManualReviewOrders.mockResolvedValue(orders);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ orders });
  });

  it("rejects an empty order number", async () => {
    expect((await POST(request({ orderNo: "  " }))).status).toBe(400);
    expect(mocks.reconcilePaidOrder).not.toHaveBeenCalled();
  });

  it("reports whether a retry actually applied the entitlement", async () => {
    mocks.reconcilePaidOrder.mockResolvedValue({
      orderNo: "order-1",
      fulfillmentStatus: "manual_review",
    });
    const pending = await POST(request({ orderNo: "order-1" }));
    expect(pending.status).toBe(200);
    await expect(pending.json()).resolves.toMatchObject({ resolved: false });

    mocks.reconcilePaidOrder.mockResolvedValue({
      orderNo: "order-1",
      fulfillmentStatus: "applied",
    });
    const applied = await POST(request({ orderNo: "order-1" }));
    await expect(applied.json()).resolves.toMatchObject({ resolved: true });
  });

  it("maps missing and conflicting order states without leaking internals", async () => {
    mocks.reconcilePaidOrder.mockRejectedValueOnce(new Error("ORDER_NOT_FOUND"));
    expect((await POST(request({ orderNo: "missing" }))).status).toBe(404);

    mocks.reconcilePaidOrder.mockRejectedValueOnce(new Error("ORDER_NOT_PAID"));
    expect((await POST(request({ orderNo: "pending" }))).status).toBe(409);

    mocks.reconcilePaidOrder.mockRejectedValueOnce(new Error("connection reset"));
    const failed = await POST(request({ orderNo: "order-1" }));
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ error: "订单履约重试失败" });
  });
});
