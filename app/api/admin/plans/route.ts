import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import {
  listBillingPlans,
  saveBillingPlan,
  type BillingPlanInput,
} from "@/lib/billing";

export const runtime = "nodejs";

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({ plans: await listBillingPlans(true) });
  } catch (error) {
    console.error(
      "admin plans failed:",
      error instanceof Error ? error.message : "UNKNOWN"
    );
    return NextResponse.json({ error: "套餐列表加载失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as
    | BillingPlanInput
    | null;
  if (!body) {
    return NextResponse.json({ error: "请求数据无效" }, { status: 400 });
  }
  try {
    const plan = await saveBillingPlan(body);
    return NextResponse.json({ plan });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("admin save plan failed:", code);
    const conflict =
      typeof (error as { code?: unknown })?.code === "string" &&
      (error as { code: string }).code === "23505";
    if (conflict) {
      return NextResponse.json({ error: "套餐标识已存在" }, { status: 409 });
    }
    if (code.startsWith("INVALID_")) {
      return NextResponse.json({ error: "套餐参数无效" }, { status: 400 });
    }
    return NextResponse.json({ error: "套餐保存失败" }, { status: 500 });
  }
}
