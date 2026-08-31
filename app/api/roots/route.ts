import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getApiKey, initDB } from "@/lib/db";
import { ensureOrgApiKey, getMemberRole } from "@/lib/org-db";
import { getRelayConsoleHeaders } from "@/lib/relay-console";

const RELAY_URL = process.env.LCE_RELAY_URL || "http://relay:3009";

// 谁能调：登录用户。?orgId= 时须为该组织成员（403），用组织密钥查询
// 组织租户的索引；缺省用个人密钥查个人租户。
export async function GET(request: NextRequest) {
  try {
    await initDB();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const orgId = request.nextUrl.searchParams.get("orgId")?.trim() || null;
    let apiKey: string;
    let role: "owner" | "member" | null = null;
    if (orgId) {
      role = await getMemberRole(session.user.id, orgId);
      if (!role) {
        return NextResponse.json({ error: "不是该组织成员" }, { status: 403 });
      }
      apiKey = (await ensureOrgApiKey(session.user.id, orgId, role)).api_key;
    } else {
      const keyRecord = await getApiKey(session.user.id);
      if (!keyRecord) {
        return NextResponse.json({ roots: [] });
      }
      apiKey = keyRecord.api_key;
    }

    const res = await fetch(`${RELAY_URL}/mcp/roots`, {
      headers: getRelayConsoleHeaders(apiKey),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: data.error || "获取索引列表失败" },
        { status: res.status }
      );
    }

    const data = await res.json();
    // 组织上下文附带调用者角色，前端据此隐藏成员的删除按钮
    return NextResponse.json(orgId ? { ...data, orgRole: role } : data);
  } catch (error) {
    console.error("获取索引列表失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
