import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const billingMocks = vi.hoisted(() => ({
  attachOrderCodeUrl: vi.fn(),
  createPendingOrder: vi.fn(),
  failOrder: vi.fn(),
}));
const paymentMocks = vi.hoisted(() => {
  class PaymentOrderRejectedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PaymentOrderRejectedError";
    }
  }
  return {
    closePaymentOrder: vi.fn(),
    createAlipayNativeOrder: vi.fn(),
    createWechatNativeOrder: vi.fn(),
    PaymentOrderRejectedError,
    paymentAvailability: vi.fn(),
  };
});
const authMocks = vi.hoisted(() => ({ getSession: vi.fn() }));
const qrMocks = vi.hoisted(() => ({ toDataURL: vi.fn() }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: authMocks.getSession } } }));
vi.mock("@/lib/billing", () => billingMocks);
vi.mock("@/lib/payments", () => paymentMocks);
vi.mock("qrcode", () => ({ default: qrMocks }));

import { POST } from "./route";

const pendingOrder = {
  id: "order-id",
  orderNo: "LCE20260904ABCDEF",
  userId: "user-1",
  planId: "plan-1",
  provider: "wechat" as const,
  status: "pending" as const,
  fulfillmentStatus: "pending" as const,
  fulfillmentError: null,
  amountFen: 2990,
  currency: "CNY",
  planSnapshot: {
    planId: "plan-1",
    code: "pro-monthly",
    name: "Pro 月付",
    tier: "pro" as const,
    durationDays: 30,
    dailyRequestLimit: 1000,
    dailyIndexBytesLimit: 1024,
    subaccountLimit: 3,
  },
  providerTradeNo: null,
  codeUrl: null,
  expiresAt: new Date("2026-09-04T07:15:00Z"),
  paidAt: null,
  createdAt: new Date("2026-09-04T07:00:00Z"),
  updatedAt: new Date("2026-09-04T07:00:00Z"),
};

function request(provider: "alipay" | "wechat" = "wechat") {
  return new NextRequest("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId: "plan-1", provider }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
  paymentMocks.paymentAvailability.mockReturnValue({ alipay: true, wechat: true });
  billingMocks.createPendingOrder.mockResolvedValue({ ...pendingOrder });
  billingMocks.attachOrderCodeUrl.mockImplementation(async (_id, codeUrl) => ({
    ...pendingOrder,
    codeUrl,
  }));
  billingMocks.failOrder.mockResolvedValue(undefined);
  paymentMocks.closePaymentOrder.mockResolvedValue(undefined);
  paymentMocks.createWechatNativeOrder.mockResolvedValue("weixin://wxpay/example");
  paymentMocks.createAlipayNativeOrder.mockResolvedValue("https://qr.alipay.example/order");
  qrMocks.toDataURL.mockResolvedValue("data:image/png;base64,qr");
});

describe("POST /api/billing/checkout", () => {
  it("returns a conflict before provider creation when an upgrade term is too short", async () => {
    billingMocks.createPendingOrder.mockRejectedValue(
      new Error("SUBSCRIPTION_UPGRADE_TERM_TOO_SHORT")
    );

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "该升级套餐的有效期不足以覆盖当前剩余期限；请选择更长期限的升级套餐，或等待当前套餐临近到期后再升级",
    });
    expect(paymentMocks.createWechatNativeOrder).not.toHaveBeenCalled();
    expect(paymentMocks.closePaymentOrder).not.toHaveBeenCalled();
  });

  it("reuses an existing payable provider order without creating another one", async () => {
    billingMocks.createPendingOrder.mockResolvedValue({
      ...pendingOrder,
      codeUrl: "weixin://wxpay/existing",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(paymentMocks.createWechatNativeOrder).not.toHaveBeenCalled();
    expect(paymentMocks.closePaymentOrder).not.toHaveBeenCalled();
    expect(billingMocks.failOrder).not.toHaveBeenCalled();
    expect(qrMocks.toDataURL).toHaveBeenCalledWith(
      "weixin://wxpay/existing",
      expect.any(Object)
    );
  });

  it("closes a provider order even after an authenticated business rejection before failing locally", async () => {
    paymentMocks.createWechatNativeOrder.mockRejectedValue(
      new paymentMocks.PaymentOrderRejectedError("WECHAT_CREATE_FAILED:PARAM_ERROR")
    );

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(billingMocks.failOrder).toHaveBeenCalledWith("order-id");
    expect(paymentMocks.closePaymentOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: "order-id" })
    );
  });

  it("closes an ambiguously-created external order before marking the local order failed", async () => {
    paymentMocks.createWechatNativeOrder.mockRejectedValue(new Error("fetch failed"));

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(paymentMocks.closePaymentOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: "order-id" })
    );
    expect(billingMocks.failOrder).toHaveBeenCalledWith("order-id");
    expect(paymentMocks.closePaymentOrder.mock.invocationCallOrder[0]).toBeLessThan(
      billingMocks.failOrder.mock.invocationCallOrder[0]
    );
  });

  it("keeps the local order pending when provider cleanup is inconclusive", async () => {
    paymentMocks.createWechatNativeOrder.mockRejectedValue(new Error("fetch failed"));
    paymentMocks.closePaymentOrder.mockRejectedValue(new Error("close timed out"));

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(paymentMocks.closePaymentOrder).toHaveBeenCalledTimes(1);
    expect(billingMocks.failOrder).not.toHaveBeenCalled();
  });
});
