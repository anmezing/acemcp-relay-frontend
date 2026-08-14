import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { closeExpiredOrders, getBillingOverview } from "@/lib/billing";
import { paymentAvailability } from "@/lib/payments";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  try {
    await closeExpiredOrders();
    const overview = await getBillingOverview(session.user.id);
    return NextResponse.json({
      ...overview,
      providers: paymentAvailability(),
    });
  } catch (error) {
    console.error(
      "billing overview failed:",
      error instanceof Error ? error.message : "UNKNOWN"
    );
    return NextResponse.json({ error: "套餐信息加载失败" }, { status: 500 });
  }
}
