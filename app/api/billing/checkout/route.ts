import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { auth } from "@/lib/auth";
import {
  attachOrderCodeUrl,
  createPendingOrder,
  failOrder,
  type BillingOrder,
  type PaymentProvider,
} from "@/lib/billing";
import {
  closePaymentOrder,
  createAlipayNativeOrder,
  createWechatNativeOrder,
  paymentAvailability,
} from "@/lib/payments";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    planId?: unknown;
    provider?: unknown;
  } | null;
  const planId =
    typeof body?.planId === "string" ? body.planId.trim() : "";
  const provider =
    body?.provider === "alipay" || body?.provider === "wechat"
      ? body.provider
      : null;
  if (!planId || !provider) {
    return NextResponse.json({ error: "套餐或支付渠道无效" }, { status: 400 });
  }
  const availability = paymentAvailability();
  if (!availability[provider]) {
    return NextResponse.json(
      { error: provider === "alipay" ? "支付宝尚未配置" : "微信支付尚未配置" },
      { status: 503 }
    );
  }

  let newlyCreatedOrder: BillingOrder | null = null;
  try {
    const order = await createPendingOrder(
      session.user.id,
      planId,
      provider as PaymentProvider
    );
    if (order.codeUrl) {
      const qrCodeDataUrl = await QRCode.toDataURL(order.codeUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 256,
      });
      return NextResponse.json({ order, qrCodeDataUrl });
    }

    // From this point onward an external order may exist. Never mark the local
    // order failed after an ambiguous network error unless the provider confirms
    // closure; otherwise a later signed payment callback could be discarded.
    newlyCreatedOrder = order;
    const codeUrl =
      provider === "alipay"
        ? await createAlipayNativeOrder(order)
        : await createWechatNativeOrder(order);
    const updated = await attachOrderCodeUrl(order.id, codeUrl);
    const qrCodeDataUrl = await QRCode.toDataURL(codeUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    });
    return NextResponse.json({
      order: updated,
      qrCodeDataUrl,
    });
  } catch (error) {
    if (newlyCreatedOrder) {
      try {
        // Even a signed business-level rejection can mean "duplicate merchant
        // order number", so it does not prove that no payable provider order
        // exists. Close/reconcile first, then make the local failure terminal.
        await closePaymentOrder(newlyCreatedOrder);
        await failOrder(newlyCreatedOrder.id);
      } catch (cleanupError) {
        // Keep it pending until expiry when provider state is uncertain. A valid
        // callback can still settle it, avoiding a paid-but-unfulfilled order.
        console.error(
          "billing checkout cleanup inconclusive:",
          cleanupError instanceof Error ? cleanupError.message : "UNKNOWN"
        );
      }
    }
    const message = error instanceof Error ? error.message : "UNKNOWN";
    console.error("billing checkout failed:", message);
    const status =
      message === "PLAN_NOT_FOUND"
        ? 404
        : message === "PLAN_NOT_PAYABLE"
          ? 400
          : message === "PAYMENT_ORDER_PENDING" ||
              message === "SUBSCRIPTION_DOWNGRADE_NOT_ALLOWED" ||
              message === "SUBSCRIPTION_UPGRADE_TERM_TOO_SHORT"
            ? 409
            : 502;
    return NextResponse.json(
      {
        error:
          message === "PLAN_NOT_FOUND"
            ? "套餐不存在或已下架"
            : message === "PLAN_NOT_PAYABLE"
              ? "该套餐不能在线支付"
              : message === "PAYMENT_ORDER_PENDING"
                ? "已有待支付订单，请完成或等待订单过期后再更换套餐或支付方式"
                : message === "SUBSCRIPTION_DOWNGRADE_NOT_ALLOWED"
                  ? "有效期内只允许续费或提升全部权益；降级请在当前套餐到期后购买"
                  : message === "SUBSCRIPTION_UPGRADE_TERM_TOO_SHORT"
                    ? "该升级套餐的有效期不足以覆盖当前剩余期限；请选择更长期限的升级套餐，或等待当前套餐临近到期后再升级"
                    : "支付平台下单失败，请稍后重试",
      },
      { status }
    );
  }
}
