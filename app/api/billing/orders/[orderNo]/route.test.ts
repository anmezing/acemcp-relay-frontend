import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMocks = vi.hoisted(() => ({ getSession: vi.fn() }));
const billingMocks = vi.hoisted(() => ({
  cancelPendingOrder: vi.fn(),
  closeExpiredOrders: vi.fn(),
  getUserOrder: vi.fn(),
}));
const paymentMocks = vi.hoisted(() => ({ closePaymentOrder: vi.fn() }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: authMocks.getSession } } }));
vi.mock("@/lib/billing", () => billingMocks);
vi.mock("@/lib/payments", () => paymentMocks);

import { DELETE } from "./route";

const pendingOrder = {
  id: "order-id",
  orderNo: "LCE20260904ABCDEF",
  userId: "user-1",
  provider: "wechat" as const,
  status: "pending" as const,
  codeUrl: "weixin://wxpay/example",
};

const context = {
  params: Promise.resolve({ orderNo: pendingOrder.orderNo }),
};
const request = new NextRequest(
  `http://localhost/api/billing/orders/${pendingOrder.orderNo}`,
  { method: "DELETE" }
);

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
  billingMocks.getUserOrder.mockResolvedValue({ ...pendingOrder });
  billingMocks.cancelPendingOrder.mockResolvedValue({
    ...pendingOrder,
    status: "canceled",
  });
  paymentMocks.closePaymentOrder.mockResolvedValue(undefined);
});

describe("DELETE /api/billing/orders/[orderNo]", () => {
  it("closes the provider order before committing the local cancellation", async () => {
    const response = await DELETE(request, context);

    expect(response.status).toBe(200);
    expect(paymentMocks.closePaymentOrder).toHaveBeenCalledWith(pendingOrder);
    expect(billingMocks.cancelPendingOrder).toHaveBeenCalledWith(
      "user-1",
      pendingOrder.orderNo
    );
    expect(paymentMocks.closePaymentOrder.mock.invocationCallOrder[0]).toBeLessThan(
      billingMocks.cancelPendingOrder.mock.invocationCallOrder[0]
    );
  });

  it("does not cancel locally if the provider does not confirm closure", async () => {
    paymentMocks.closePaymentOrder.mockRejectedValue(
      new Error("WECHAT_CLOSE_FAILED:ORDER_PAID")
    );

    const response = await DELETE(request, context);

    expect(response.status).toBe(409);
    expect(billingMocks.cancelPendingOrder).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "支付平台未确认关闭订单，请稍后重试",
    });
  });

  it("does not try to close or cancel a paid order", async () => {
    billingMocks.getUserOrder.mockResolvedValue({
      ...pendingOrder,
      status: "paid",
    });

    const response = await DELETE(request, context);

    expect(response.status).toBe(409);
    expect(paymentMocks.closePaymentOrder).not.toHaveBeenCalled();
    expect(billingMocks.cancelPendingOrder).not.toHaveBeenCalled();
  });

  it("waits for provider-order creation before allowing cancellation", async () => {
    billingMocks.getUserOrder.mockResolvedValue({
      ...pendingOrder,
      codeUrl: null,
    });

    const response = await DELETE(request, context);

    expect(response.status).toBe(409);
    expect(paymentMocks.closePaymentOrder).not.toHaveBeenCalled();
    expect(billingMocks.cancelPendingOrder).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    authMocks.getSession.mockResolvedValue(null);

    const response = await DELETE(request, context);

    expect(response.status).toBe(401);
    expect(billingMocks.getUserOrder).not.toHaveBeenCalled();
  });
});
