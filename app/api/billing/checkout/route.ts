import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { auth } from "@/lib/auth";
import {
  attachOrderCodeUrl,
  createPendingOrder,
  failOrder,
  type PaymentProvider,
} from "@/lib/billing";
import {
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

  let orderId: string | null = null;
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
    orderId = order.id;
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
    if (orderId) await failOrder(orderId).catch(() => {});
    const message = error instanceof Error ? error.message : "UNKNOWN";
    console.error("billing checkout failed:", message);
    const status =
      message === "PLAN_NOT_FOUND"
        ? 404
        : message === "PLAN_NOT_PAYABLE"
          ? 400
          : message === "PAYMENT_ORDER_PENDING"
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
                ? "该支付渠道已有待支付订单，请完成或等待订单过期"
                : "支付平台下单失败，请稍后重试",
      },
      { status }
    );
  }
}
