import { NextRequest, NextResponse } from "next/server";
import { markOrderPaid } from "@/lib/billing";
import { verifyWechatNotification } from "@/lib/payments";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const payment = verifyWechatNotification(rawBody, request.headers);
    await markOrderPaid(payment);
    return NextResponse.json({ code: "SUCCESS", message: "成功" });
  } catch (error) {
    console.error(
      "wechat notify rejected:",
      error instanceof Error ? error.message : "UNKNOWN"
    );
    return NextResponse.json(
      { code: "FAIL", message: "支付通知校验失败" },
      { status: 400 }
    );
  }
}
