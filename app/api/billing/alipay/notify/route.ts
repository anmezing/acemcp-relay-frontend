import { NextRequest, NextResponse } from "next/server";
import { markOrderPaid } from "@/lib/billing";
import { verifyAlipayNotification } from "@/lib/payments";

export const runtime = "nodejs";

function callbackText(value: "success" | "failure", status = 200) {
  return new NextResponse(value, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const postData: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value !== "string") throw new Error("ALIPAY_FORM_INVALID");
      postData[key] = value;
    }
    const payment = verifyAlipayNotification(postData);
    await markOrderPaid(payment);
    return callbackText("success");
  } catch (error) {
    console.error(
      "alipay notify rejected:",
      error instanceof Error ? error.message : "UNKNOWN"
    );
    return callbackText("failure", 400);
  }
}
