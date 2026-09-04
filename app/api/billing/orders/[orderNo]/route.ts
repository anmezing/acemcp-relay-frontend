import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { closePaymentOrder } from "@/lib/payments";
import {
  cancelPendingOrder,
  closeExpiredOrders,
  getUserOrder,
} from "@/lib/billing";

export const runtime = "nodejs";

async function requireUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ orderNo: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  await closeExpiredOrders();
  const { orderNo } = await context.params;
  const order = await getUserOrder(userId, orderNo);
  if (!order) {
    return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  }
  return NextResponse.json({ order });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ orderNo: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const { orderNo } = await context.params;
  try {
    const current = await getUserOrder(userId, orderNo);
    if (!current) throw new Error("ORDER_NOT_FOUND");
    if (current.status === "canceled") {
      return NextResponse.json({ order: current });
    }
    if (current.status === "paid") throw new Error("ORDER_ALREADY_PAID");
    if (current.status === "closed") throw new Error("ORDER_ALREADY_EXPIRED");
    if (current.status !== "pending") throw new Error("ORDER_NOT_CANCELABLE");
    if (!current.codeUrl) throw new Error("ORDER_CREATION_IN_PROGRESS");

    // Do not claim cancellation until the payment provider confirms that the
    // transaction is closed. The following DB transition re-checks the status
    // under a row lock, so a concurrent successful callback wins safely.
    await closePaymentOrder(current);
    const order = await cancelPendingOrder(userId, orderNo);
    return NextResponse.json({ order });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    const status = message === "ORDER_NOT_FOUND" ? 404 : 409;
    const userMessage =
      message === "ORDER_NOT_FOUND"
        ? "订单不存在"
        : message === "ORDER_ALREADY_PAID"
          ? "订单已支付，不能取消"
          : message === "ORDER_ALREADY_EXPIRED"
            ? "订单已超时关闭"
            : message === "ORDER_CREATION_IN_PROGRESS"
              ? "支付平台正在创建订单，请稍后再取消"
              : message === "ORDER_NOT_CANCELABLE"
                ? "当前订单状态不能取消"
                : message.startsWith("ALIPAY_CLOSE_FAILED") ||
                    message.startsWith("WECHAT_CLOSE_FAILED")
                  ? "支付平台未确认关闭订单，请稍后重试"
                  : "订单状态已变化，请刷新后重试";
    return NextResponse.json({ error: userMessage }, { status });
  }
}
