import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { initDB } from "@/lib/db";
import { getMemberRole, getOrgUsage } from "@/lib/org-db";

// 组织用量报表（近 30 天每日请求数、成员 Top 分布、当日配额使用）。
// 谁能调：该组织成员（owner/member 都可读；写操作路由仍要求 owner）。
// 非成员 403（fail-closed）。字节用量本期不做：request_logs 无字节数
// （索引字节计数在 relay 的 Redis），不返回假数据。
export async function GET(request: NextRequest) {
  try {
    await initDB().catch(console.error);
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const orgId = request.nextUrl.searchParams.get("orgId")?.trim() || "";
    if (!orgId) {
      return NextResponse.json({ error: "缺少 orgId" }, { status: 400 });
    }

    const role = await getMemberRole(session.user.id, orgId);
    if (!role) {
      return NextResponse.json({ error: "不是该组织成员" }, { status: 403 });
    }

    return NextResponse.json(await getOrgUsage(orgId));
  } catch (error) {
    console.error("获取组织用量失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
