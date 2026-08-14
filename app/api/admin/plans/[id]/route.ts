import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { deleteBillingPlan } from "@/lib/billing";

export const runtime = "nodejs";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  try {
    if (!(await deleteBillingPlan(id))) {
      return NextResponse.json(
        { error: "套餐不存在，或已有订单不能删除；可改为停用" },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "admin delete plan failed:",
      error instanceof Error ? error.message : "UNKNOWN"
    );
    return NextResponse.json({ error: "删除套餐失败" }, { status: 500 });
  }
}
