import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { initDB } from "@/lib/db";
import {
  getMemberRole,
  listOrgMemberQuotas,
  setOrgMemberQuota,
} from "@/lib/org-db";

// 组织 owner 给本组织成员设个人每日请求上限（写 org_member_quotas，relay 已消费）。
// 谁能调：该组织 owner（非 owner 403，目标非本组织成员 400）。
// body: { orgId, userId, limit } — limit null=恢复默认, 0=不限, 正整数=每日上限
export async function GET(request: NextRequest) {
  try {
    await initDB().catch(console.error);
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const orgId = (request.nextUrl.searchParams.get("orgId") || "").trim();
    if (!orgId) {
      return NextResponse.json({ error: "缺少 orgId" }, { status: 400 });
    }
    if ((await getMemberRole(session.user.id, orgId)) !== "owner") {
      return NextResponse.json({ error: "仅组织所有者可操作" }, { status: 403 });
    }
    return NextResponse.json({ quotas: await listOrgMemberQuotas(orgId) });
  } catch (error) {
    console.error("读取成员配额失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await initDB().catch(console.error);
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    let body: { orgId?: string; userId?: string; limit?: number | null } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "无效请求" }, { status: 400 });
    }
    const orgId = (body.orgId || "").trim();
    const userId = (body.userId || "").trim();
    if (!orgId || !userId) {
      return NextResponse.json({ error: "缺少 orgId / userId" }, { status: 400 });
    }
    const limit = body.limit === null || body.limit === undefined ? null : Number(body.limit);
    if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 10_000_000)) {
      return NextResponse.json({ error: "无效的配额" }, { status: 400 });
    }

    // fail-closed：先验会话用户是本组织 owner，再验目标是本组织成员
    const callerRole = await getMemberRole(session.user.id, orgId);
    if (callerRole !== "owner") {
      return NextResponse.json({ error: "仅组织所有者可操作" }, { status: 403 });
    }
    const targetRole = await getMemberRole(userId, orgId);
    if (!targetRole) {
      return NextResponse.json({ error: "目标用户不是该组织成员" }, { status: 400 });
    }

    await setOrgMemberQuota(orgId, userId, limit);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("设置成员配额失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
