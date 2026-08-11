import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getApiKey, initDB } from "@/lib/db";
import { ensureOrgApiKey, getMemberRole } from "@/lib/org-db";

// 谁能调：登录用户。?orgId= 时要求是该组织成员（fail-closed：非成员 403），
// 返回本人在该组织的密钥；否则返回个人密钥。
export async function GET(request: NextRequest) {
  try {
    // 请求时惰性初始化（幂等）；模块级调用会在 next build 期连不上库
    await initDB().catch(console.error);
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const orgId = request.nextUrl.searchParams.get("orgId")?.trim() || null;
    if (orgId) {
      const role = await getMemberRole(session.user.id, orgId);
      if (!role) {
        return NextResponse.json({ error: "不是该组织成员" }, { status: 403 });
      }
      // 存在即复用；同时兜底修复 hooks 失败导致的缺失组织密钥
      const keyRecord = await ensureOrgApiKey(session.user.id, orgId, role);
      return NextResponse.json({ apiKey: keyRecord.api_key });
    }

    const keyRecord = await getApiKey(session.user.id);

    if (!keyRecord) {
      return NextResponse.json({ error: "没有 API Key" }, { status: 404 });
    }

    return NextResponse.json({
      apiKey: keyRecord.api_key,
    });
  } catch (error) {
    console.error("获取 API Key 失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
