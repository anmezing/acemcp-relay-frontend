import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { initDB } from "@/lib/db";
import { listOrgsWithQuotas, setOrgQuota } from "@/lib/org-db";

// 平台管理员：组织列表（owner、成员数、当前配额）。谁能调：仅 ADMIN_EMAILS。
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    await initDB().catch(console.error);
    return NextResponse.json({ orgs: await listOrgsWithQuotas() });
  } catch (error) {
    console.error("admin orgs failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// 给组织分配共享配额池（写 org_quotas，relay 读）。谁能调：仅 ADMIN_EMAILS。
// body: { orgId, dailyRequestLimit, dailyIndexBytesLimit } — null=未设置(默认)
export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: {
    orgId?: string;
    dailyRequestLimit?: number | null;
    dailyIndexBytesLimit?: number | null;
  } = {};
  try {
    body = await request.json();
  } catch {}
  const orgId = (body.orgId || "").trim();
  if (!orgId) {
    return NextResponse.json({ error: "missing orgId" }, { status: 400 });
  }
  const parseLimit = (value: number | null | undefined, max: number) => {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > max) return undefined;
    return n;
  };
  const requestLimit = parseLimit(body.dailyRequestLimit, 1_000_000_000);
  const bytesLimit = parseLimit(body.dailyIndexBytesLimit, Number.MAX_SAFE_INTEGER);
  if (requestLimit === undefined || bytesLimit === undefined) {
    return NextResponse.json({ error: "invalid limit" }, { status: 400 });
  }
  try {
    const ok = await setOrgQuota(orgId, requestLimit, bytesLimit);
    if (!ok) {
      return NextResponse.json({ error: "organization not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("admin set org quota failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
