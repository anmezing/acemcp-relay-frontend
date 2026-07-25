import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { listQuotas, setUserQuota } from "@/lib/admin-db";

function defaultDailyLimit(): number {
  const n = parseInt(process.env.DEFAULT_DAILY_REQUEST_LIMIT || "0");
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({
      quotas: await listQuotas(),
      defaultLimit: defaultDailyLimit(),
    });
  } catch (error) {
    console.error("admin quotas failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// body: { userId, limit } — limit null=恢复默认, 0=不限, 正整数=每日上限
export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: { userId?: string; limit?: number | null } = {};
  try {
    body = await request.json();
  } catch {}
  const userId = (body.userId || "").trim();
  if (!userId) {
    return NextResponse.json({ error: "missing userId" }, { status: 400 });
  }
  const limit = body.limit === null || body.limit === undefined ? null : Number(body.limit);
  if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 10_000_000)) {
    return NextResponse.json({ error: "invalid limit" }, { status: 400 });
  }
  try {
    await setUserQuota(userId, limit);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("admin set quota failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
