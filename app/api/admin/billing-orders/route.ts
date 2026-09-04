import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { listManualReviewOrders, reconcilePaidOrder } from "@/lib/billing";

export const runtime = "nodejs";

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({ orders: await listManualReviewOrders() });
  } catch (error) {
    console.error(
      "admin manual-review orders failed:",
      error instanceof Error ? error.message : "UNKNOWN"
    );
    return NextResponse.json({ error: "待审核订单加载失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as
    | { orderNo?: unknown }
    | null;
  const orderNo = typeof body?.orderNo === "string" ? body.orderNo.trim() : "";
  if (!orderNo) {
    return NextResponse.json({ error: "订单号无效" }, { status: 400 });
  }

  try {
    const order = await reconcilePaidOrder(orderNo);
    return NextResponse.json({
      order,
      resolved: order.fulfillmentStatus === "applied",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("admin reconcile paid order failed:", code);
    const status =
      code === "ORDER_NOT_FOUND"
        ? 404
        : code === "INVALID_ORDER_NO"
          ? 400
          : code === "ORDER_NOT_PAID" ||
              code === "ORDER_NOT_RECONCILABLE" ||
              code === "ORDER_STATE_CHANGED"
            ? 409
            : 500;
    return NextResponse.json(
      {
        error:
          code === "ORDER_NOT_FOUND"
            ? "订单不存在"
            : code === "ORDER_NOT_PAID" || code === "ORDER_NOT_RECONCILABLE"
              ? "订单当前状态不能重试履约"
              : code === "ORDER_STATE_CHANGED"
                ? "订单状态已变化，请刷新后重试"
                : "订单履约重试失败",
      },
      { status }
    );
  }
}
